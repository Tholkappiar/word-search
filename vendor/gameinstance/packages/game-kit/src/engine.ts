import { z } from "zod";
import {
  canonicalGameStateHash, canonicalGameStateJson, cloneGameData, discoverInspectorFields, inspectorMetadataFor,
  parseGameData, readGameStatePath, writeGameStatePath
} from "./engine-schema.js";
import type { GameDefinition, GameEngine, GameEngineOptions, GameScenario, GameSnapshot, PendingInputResult, RecordedGameInput, ScenarioAssertion, ScenarioAssertionResult, SimulationContext, StatePatch } from "./engine-types.js";

export * from "./engine-types.js";
export type { InspectorField, InspectorMetadata, JsonValue } from "./engine-schema.js";
export { canonicalGameStateHash, readGameStatePath } from "./engine-schema.js";
export { createSharedGameStateSchema } from "./engine-shared.js";

const rngAlgorithm = "mulberry32-v1" as const;
const positiveInteger = z.number().int().positive();
const nonnegativeInteger = z.number().int().nonnegative();
const uint32 = z.number().int().min(0).max(0xffffffff);
const snapshotEnvelope = z.object({
  formatVersion: z.literal(1), gameId: z.string(), schemaVersion: z.string(), simulationRevision: z.string(),
  rngAlgorithm: z.literal(rngAlgorithm), seed: uint32, rngState: uint32,
  tickRate: positiveInteger, tick: nonnegativeInteger, inputCursor: nonnegativeInteger,
  timeMs: z.number().finite().nonnegative(), state: z.unknown(), startingConfig: z.unknown()
}).strict();

const assertionSchema = z.intersection(
  z.object({ tick: nonnegativeInteger, path: z.string() }),
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("equals"), value: z.unknown() }),
    z.object({ kind: z.literal("closeTo"), value: z.number().finite(), tolerance: z.number().finite().nonnegative() }),
    z.object({ kind: z.literal("between"), min: z.number().finite(), max: z.number().finite() }),
    z.object({ kind: z.literal("hash"), value: z.string().regex(/^[0-9a-f]{8}$/) })
  ])
);

export function normalizeGameSeed(seed: number | string): number {
  if (typeof seed === "number") {
    if (!Number.isFinite(seed) || !Number.isInteger(seed)) throw new Error("Game seed must be an integer or string");
    return seed >>> 0;
  }
  let result = 2166136261;
  for (let index = 0; index < seed.length; index++) result = Math.imul(result ^ seed.charCodeAt(index), 16777619);
  return result >>> 0;
}

export function defineGame<TState, TConfig, TInput, TResult>(definition: GameDefinition<TState, TConfig, TInput, TResult>): GameDefinition<TState, TConfig, TInput, TResult> {
  for (const [name, value] of Object.entries({ id: definition.id, schemaVersion: definition.schemaVersion, simulationRevision: definition.simulationRevision })) {
    if (!value.trim()) throw new Error(`Game ${name} must not be empty`);
  }
  return Object.freeze({ ...definition, initialConfig: parseGameData(definition.configSchema, definition.initialConfig), ...(definition.inspector ? { inspector: cloneGameData(definition.inspector) } : {}) });
}

type Timeline<TState, TConfig, TInput> = {
  checkpoints: GameSnapshot<TState, TConfig>[];
  inputs: RecordedGameInput<TInput>[];
  headTick: number;
};

/** Deterministic simulation; transport deduplication and browser/React effects live outside it. */
export function createGameEngine<TState, TConfig, TInput, TResult>(
  definition: GameDefinition<TState, TConfig, TInput, TResult>, options: GameEngineOptions = {}
): GameEngine<TState, TConfig, TInput, TResult> {
  const tickRate = positiveInteger.max(1000).parse(options.tickRate ?? 60);
  const historySeconds = z.number().finite().min(5).parse(options.historySeconds ?? 5);
  let checkpointInterval = positiveInteger.parse(options.checkpointIntervalTicks ?? Math.max(1, Math.round(tickRate / 10)));
  const memoryLimitBytes = positiveInteger.parse(options.memoryLimitBytes ?? 16 * 1024 * 1024);
  const pendingLimit = positiveInteger.parse(options.pendingInputLimit ?? 1000);
  let seed = normalizeGameSeed(options.seed ?? 1);
  let rngState = seed;
  let tick = 0;
  let inputCursor = 0;
  let frozen = false;
  let timeScale = 1;
  let recordingSuspended = false;
  let startingConfig = parseGameData(definition.configSchema, definition.initialConfig);
  let nextStartingConfig = cloneGameData(startingConfig);
  let state: TState;
  let branch: "original" | "edited" = "original";
  let timelines: Partial<Record<"original" | "edited", Timeline<TState, TConfig, TInput>>> = {};
  let pending: { id: number; input: TInput }[] = [];
  let pendingId = 0;
  let scenarioAssertions: ScenarioAssertion[] = [];
  const listeners = new Set<() => void>();
  const pendingResultListeners = new Set<(completion: PendingInputResult<TInput, TResult>) => void>();
  const metadata = cloneGameData(definition.inspector ?? {});

  function context(atTick: number, replaying: boolean) {
    let nextRng = rngState;
    const ctx: SimulationContext = {
      tick: atTick, timeMs: atTick * 1000 / tickRate,
      deltaMs: 1000 / tickRate, deltaSeconds: 1 / tickRate, replaying,
      random() {
        nextRng = (nextRng + 0x6d2b79f5) >>> 0;
        let value = nextRng;
        value = Math.imul(value ^ value >>> 15, value | 1);
        value ^= value + Math.imul(value ^ value >>> 7, value | 61);
        return ((value ^ value >>> 14) >>> 0) / 4294967296;
      }
    };
    return { ctx, getRng: () => nextRng };
  }

  function notify() {
    for (const listener of listeners) {
      try { listener(); } catch { /* Observers cannot roll back an accepted command. */ }
    }
  }

  function completePending(completion: PendingInputResult<TInput, TResult>) {
    for (const listener of pendingResultListeners) {
      try { listener({ ...completion, input: cloneGameData(completion.input) }); } catch { /* ACK observers cannot undo a terminal result. */ }
    }
  }

  function discardPending(reason: string) {
    const discarded = pending; pending = [];
    for (const entry of discarded) completePending({ pendingId: entry.id, input: entry.input, status: "discarded", error: reason, position: { tick, inputCursor } });
  }

  function snapshot(): GameSnapshot<TState, TConfig> {
    return cloneGameData({ formatVersion: 1 as const, gameId: definition.id, schemaVersion: definition.schemaVersion,
      simulationRevision: definition.simulationRevision, rngAlgorithm, seed, rngState,
      tickRate, tick, timeMs: tick * 1000 / tickRate, inputCursor, state, startingConfig });
  }

  function timeline() { return timelines[branch]!; }
  function copyTimeline(source: Timeline<TState, TConfig, TInput>) { return cloneGameData(source); }

  function restoreSnapshot(value: GameSnapshot<TState, TConfig>) {
    state = cloneGameData(value.state); startingConfig = cloneGameData(value.startingConfig);
    tick = value.tick; inputCursor = value.inputCursor; seed = value.seed; rngState = value.rngState;
  }

  function validateSnapshot(raw: unknown, allowRevisionMismatch = false): GameSnapshot<TState, TConfig> {
    const parsed = snapshotEnvelope.parse(cloneGameData(raw));
    if (parsed.gameId !== definition.id) throw new Error("Snapshot belongs to a different game");
    if (parsed.schemaVersion !== definition.schemaVersion) throw new Error("Snapshot state schema is incompatible");
    if (!allowRevisionMismatch && parsed.simulationRevision !== definition.simulationRevision) throw new Error("Snapshot simulation revision is incompatible");
    if (parsed.tickRate !== tickRate) throw new Error("Snapshot tick rate is incompatible");
    if (Math.abs(parsed.timeMs - parsed.tick * 1000 / tickRate) > 1e-7) throw new Error("Snapshot simulation clock is inconsistent");
    return { ...parsed, simulationRevision: definition.simulationRevision, state: parseGameData(definition.stateSchema, parsed.state), startingConfig: parseGameData(definition.configSchema, parsed.startingConfig) };
  }

  function initialize(config: TConfig, nextSeed: number) {
    const previousRng = rngState;
    rngState = nextSeed;
    const transaction = context(0, false);
    let initial: TState;
    try { initial = parseGameData(definition.stateSchema, definition.createInitialState(cloneGameData(config), transaction.ctx)); }
    catch (error) { rngState = previousRng; throw error; }
    state = initial; startingConfig = cloneGameData(config); nextStartingConfig = cloneGameData(config); seed = nextSeed; rngState = transaction.getRng();
    discardPending("Game restarted before queued input was applied");
    tick = 0; inputCursor = 0; branch = "original"; scenarioAssertions = [];
    timelines = { original: { checkpoints: [snapshot()], inputs: [], headTick: 0 } };
  }

  function historyBytes() {
    return new TextEncoder().encode(JSON.stringify({ timelines, current: snapshot(), pending })).byteLength;
  }

  function pruneHistory() {
    const track = timeline();
    const cutoff = track.headTick - Math.ceil(historySeconds * tickRate);
    const eligible = track.checkpoints.filter((entry) => entry.tick <= cutoff);
    const baseline = eligible[eligible.length - 1];
    if (baseline) {
      track.checkpoints = track.checkpoints.filter((entry) => entry.tick > baseline.tick || entry.tick === baseline.tick && entry.inputCursor >= baseline.inputCursor);
      track.inputs = track.inputs.filter((entry) => entry.inputCursor > baseline.inputCursor);
    }
    // The budget is soft: preserving five seconds takes priority over silently shortening history.
    // Coarsening checkpoints is safe because the accepted-input journal remains complete.
    while (track.checkpoints.length > 2 && historyBytes() > memoryLimitBytes) {
      track.checkpoints = track.checkpoints.filter((_, index, array) => index === 0 || index === array.length - 1 || index % 2 === 0);
      checkpointInterval = Math.min(checkpointInterval * 2, Math.ceil(historySeconds * tickRate));
    }
  }

  function checkpoint(force = false) {
    if (recordingSuspended) return;
    const track = timeline();
    track.headTick = Math.max(track.headTick, tick);
    if (force || tick % checkpointInterval === 0) {
      const next = snapshot();
      const previous = track.checkpoints.findIndex((entry) => entry.tick === tick && entry.inputCursor === inputCursor);
      if (previous >= 0) track.checkpoints[previous] = next;
      else track.checkpoints.push(next);
      track.checkpoints.sort((left, right) => left.tick - right.tick || left.inputCursor - right.inputCursor);
      pruneHistory();
    }
  }

  function prepareEdit() {
    const track = timeline();
    const historical = tick < track.headTick || track.inputs.some((entry) => entry.inputCursor > inputCursor);
    if (branch === "original" && historical) {
      // One original and one editable branch; the original remains recoverable until restart/load.
      if (timelines.edited) throw new Error("An edited branch already exists; select it or restart before creating another");
      timelines.edited = copyTimeline(track); branch = "edited";
    }
    timeline().checkpoints = timeline().checkpoints.filter((entry) => entry.tick < tick || entry.tick === tick && entry.inputCursor <= inputCursor);
  }

  function appendInput(event: RecordedGameInput<TInput>) {
    prepareEdit();
    const track = timeline();
    const index = track.inputs.findIndex((entry) => entry.inputCursor > inputCursor);
    const insertion = index < 0 ? track.inputs.length : index;
    for (let offset = insertion; offset < track.inputs.length; offset++) track.inputs[offset]!.inputCursor++;
    track.inputs.splice(insertion, 0, cloneGameData(event));
    inputCursor = event.inputCursor;
    checkpoint(true);
  }

  function applyPatches(changes: StatePatch[]) {
    if (!Array.isArray(changes) || changes.length === 0) throw new Error("A state patch must contain at least one change");
    const draft = cloneGameData(state);
    const seen = new Set<string>();
    for (const change of changes) {
      const path = change.path.startsWith("/") ? change.path.slice(1).replaceAll("/", ".") : change.path;
      if (seen.has(path)) throw new Error(`Duplicate patch path: ${path}`);
      seen.add(path);
      const policy = inspectorMetadataFor(metadata, path);
      if (policy.editable !== true) throw new Error(`State field is read-only: ${path}`);
      if (typeof change.value === "number" && (policy.min !== undefined && change.value < policy.min || policy.max !== undefined && change.value > policy.max)) throw new Error(`State field is outside its editable range: ${path}`);
      writeGameStatePath(draft, path, change.value);
    }
    return parseGameData(definition.stateSchema, draft);
  }

  function runCommand(input: TInput, replaying: boolean) {
    const transaction = context(tick, replaying);
    const transition = definition.applyCommand(cloneGameData(state), cloneGameData(input), transaction.ctx);
    const nextState = parseGameData(definition.stateSchema, transition.state);
    const effects = cloneGameData(transition.effects ?? []);
    return { state: nextState, result: transition.result, rng: transaction.getRng(), effects };
  }

  function publishEffects(effects: Parameters<NonNullable<GameEngineOptions["onEffect"]>>[0][], replaying: boolean) {
    if (replaying) return;
    for (const effect of effects) {
      try { options.onEffect?.(cloneGameData(effect)); } catch { /* Effect failures must not reject an already committed command. */ }
    }
  }

  function applyRecordedInputs() {
    for (const event of timeline().inputs) {
      if (event.inputCursor <= inputCursor) continue;
      if (event.tick > tick) break;
      if (event.tick < tick) throw new Error("Input journal is inconsistent with its checkpoint cursor");
      if (event.kind === "command") {
        const next = runCommand(event.input, true); state = next.state; rngState = next.rng;
      } else state = applyPatches(event.changes);
      inputCursor = event.inputCursor;
    }
  }

  function advanceOne(forceReplay = false) {
    const replaying = forceReplay || frozen || branch === "edited" || tick < timeline().headTick || timeline().inputs.some((entry) => entry.inputCursor > inputCursor);
    applyRecordedInputs();
    const transaction = context(tick + 1, replaying);
    const transition = definition.step(cloneGameData(state), transaction.ctx);
    const nextState = parseGameData(definition.stateSchema, transition.state);
    const effects = cloneGameData(transition.effects ?? []);
    state = nextState; rngState = transaction.getRng(); tick++;
    applyRecordedInputs();
    checkpoint();
    publishEffects(effects, replaying);
  }

  function seekInternal(target: number) {
    nonnegativeInteger.parse(target);
    const track = timeline();
    const earliest = track.checkpoints[0]!.tick;
    if (target < earliest || target > track.headTick) throw new Error(`Seek tick must be between ${earliest} and ${track.headTick}`);
    const candidates = track.checkpoints.filter((entry) => entry.tick <= target);
    restoreSnapshot(candidates[candidates.length - 1]!);
    applyRecordedInputs();
    while (tick < target) advanceOne(true);
  }

  function travel(target: number) {
    const saved = snapshot(); const wasFrozen = frozen; const track = timeline();
    const savedTrack = { checkpoints: [...track.checkpoints], inputs: [...track.inputs], headTick: track.headTick };
    frozen = true;
    try { seekInternal(target); }
    catch (error) { restoreSnapshot(saved); timelines[branch] = savedTrack; frozen = wasFrozen; throw error; }
  }

  function checkedAssertions(raw: unknown): ScenarioAssertion[] {
    const entries = z.array(assertionSchema).parse(cloneGameData(raw)) as ScenarioAssertion[];
    for (const assertion of entries) if (assertion.kind === "between" && assertion.min > assertion.max) throw new Error("Assertion minimum exceeds maximum");
    return entries;
  }

  initialize(startingConfig, seed);

  const engine: GameEngine<TState, TConfig, TInput, TResult> = {
    definition,
    getState: () => cloneGameData(state),
    getStartingConfig: () => cloneGameData(nextStartingConfig),
    getTimeScale: () => timeScale,
    setTimeScale(value) { timeScale = z.number().finite().min(0.1).max(4).parse(value); notify(); },
    setStartingConfig(config) { nextStartingConfig = parseGameData(definition.configSchema, config); notify(); },
    getSnapshot: snapshot,
    getInspectorFields: () => discoverInspectorFields(state, metadata),
    getHistory() {
      const track = timeline(); const bytes = historyBytes();
      return { earliestTick: track.checkpoints[0]!.tick, headTick: track.headTick, currentTick: tick, inputCursor, branch,
        branches: timelines.edited ? ["original", "edited"] : ["original"], frozen, pendingInputs: pending.length,
        retainedSeconds: (track.headTick - track.checkpoints[0]!.tick) / tickRate, bytes, memoryLimitBytes, memoryLimited: bytes > memoryLimitBytes, timeScale };
    },
    getJournal: () => cloneGameData(timeline().inputs),
    dispatch(raw, dispatchOptions = {}) {
      const input = parseGameData(definition.inputSchema, raw, false);
      if (frozen && dispatchOptions.whileFrozen !== "apply") {
        if (pending.length >= pendingLimit) throw new Error("Pending input queue is full");
        const id = ++pendingId; pending.push({ id, input }); notify(); return { status: "queued", pendingId: id };
      }
      const next = runCommand(input, frozen || tick < timeline().headTick);
      // Validate edit capacity before committing state or RNG.
      if (branch === "original" && timelines.edited && (tick < timeline().headTick || timeline().inputs.some((entry) => entry.inputCursor > inputCursor))) throw new Error("An edited branch already exists; select it before editing");
      const event: RecordedGameInput<TInput> = { kind: "command", tick, inputCursor: inputCursor + 1, input };
      state = next.state; rngState = next.rng; appendInput(event);
      publishEffects(next.effects, frozen || branch === "edited"); notify();
      return { status: "applied", result: next.result, position: { tick, inputCursor } };
    },
    patch(changes) {
      const detached = cloneGameData(changes);
      const next = applyPatches(detached);
      if (branch === "original" && timelines.edited && (tick < timeline().headTick || timeline().inputs.some((entry) => entry.inputCursor > inputCursor))) throw new Error("An edited branch already exists; select it before editing");
      state = next; appendInput({ kind: "patch", tick, inputCursor: inputCursor + 1, changes: detached }); notify(); return snapshot();
    },
    advance(count = 1) {
      nonnegativeInteger.max(1_000_000).parse(count);
      if (!frozen) for (let index = 0; index < count; index++) advanceOne();
      notify(); return snapshot();
    },
    step(count = 1) {
      positiveInteger.max(1_000_000).parse(count);
      frozen = true;
      for (let index = 0; index < count; index++) advanceOne(true);
      notify(); return snapshot();
    },
    freeze() { frozen = true; notify(); },
    resume(resumeOptions = {}) {
      if (resumeOptions.pending === "discard") discardPending("Queued input discarded by debugger");
      if (resumeOptions.pending === "apply") {
        while (pending.length) {
          const entry = pending.shift()!;
          try {
            const receipt = engine.dispatch(entry.input, { whileFrozen: "apply" });
            if (receipt.status === "applied") completePending({ pendingId: entry.id, input: entry.input, status: "applied", result: receipt.result, position: receipt.position });
          } catch (error) {
            completePending({ pendingId: entry.id, input: entry.input, status: "rejected", error: error instanceof Error ? error.message : "Queued input failed", position: { tick, inputCursor } });
          }
        }
      }
      frozen = false; notify();
    },
    seek(target) { travel(target); notify(); return snapshot(); },
    replay(target = timeline().headTick) { travel(target); notify(); return snapshot(); },
    selectBranch(nextBranch) {
      if (!timelines[nextBranch]) throw new Error(`Timeline branch does not exist: ${nextBranch}`);
      const previousBranch = branch; branch = nextBranch;
      try { travel(timeline().headTick); } catch (error) { branch = previousBranch; throw error; }
      notify(); return snapshot();
    },
    discardBranch() {
      engine.selectBranch("original"); delete timelines.edited;
      notify(); return snapshot();
    },
    keepBranch() {
      if (!timelines.edited) throw new Error("No edited branch to keep");
      engine.selectBranch("edited");
      timelines = { original: copyTimeline(timeline()) }; branch = "original";
      notify(); return snapshot();
    },
    restore(raw, restoreOptions = {}) {
      const baseline = validateSnapshot(raw, restoreOptions.allowRevisionMismatch);
      restoreSnapshot(baseline); nextStartingConfig = cloneGameData(baseline.startingConfig);
      discardPending("Snapshot restored before queued input was applied");
      branch = "original"; frozen = true; scenarioAssertions = [];
      timelines = { original: { checkpoints: [baseline], inputs: [], headTick: baseline.tick } };
      notify(); return snapshot();
    },
    restart(restartOptions = {}) {
      const config = parseGameData(definition.configSchema, restartOptions.config ?? nextStartingConfig);
      const nextSeed = normalizeGameSeed(restartOptions.seed ?? seed);
      initialize(config, nextSeed); notify(); return snapshot();
    },
    exportScenario(exportOptions = {}) {
      const track = timeline();
      const endTick = exportOptions.regression ? tick : track.headTick;
      const inRange = (assertion: ScenarioAssertion) => assertion.tick >= track.checkpoints[0]!.tick && assertion.tick <= endTick;
      // Stored assertions can refer to the discarded future of an imported capture.
      // Explicit assertions must instead be rejected when they cannot be checked.
      const assertions = checkedAssertions(exportOptions.assertions ?? (exportOptions.regression ? scenarioAssertions.filter(inRange) : scenarioAssertions));
      for (const assertion of assertions) if (!inRange(assertion)) throw new Error(`Scenario assertion is outside ${exportOptions.regression ? "captured" : "retained"} history`);
      if (exportOptions.regression) assertions.push({ tick, path: "", kind: "hash", value: canonicalGameStateHash(state) });
      const inputs = exportOptions.regression ? track.inputs.filter(input => input.tick <= tick && input.inputCursor <= inputCursor) : track.inputs;
      return cloneGameData({ formatVersion: 1 as const, gameId: definition.id, schemaVersion: definition.schemaVersion,
        simulationRevision: definition.simulationRevision, rngAlgorithm, initialSnapshot: track.checkpoints[0]!,
        inputs, endTick, assertions });
    },
    loadScenario(raw, loadOptions = {}) {
      const envelope = z.object({ formatVersion: z.literal(1), gameId: z.string(), schemaVersion: z.string(), simulationRevision: z.string(),
        rngAlgorithm: z.literal(rngAlgorithm), initialSnapshot: z.unknown(), inputs: z.array(z.unknown()), endTick: nonnegativeInteger, assertions: z.unknown() }).strict().parse(cloneGameData(raw));
      if (envelope.gameId !== definition.id || envelope.schemaVersion !== definition.schemaVersion) throw new Error("Scenario game/schema is incompatible");
      if (!loadOptions.allowRevisionMismatch && envelope.simulationRevision !== definition.simulationRevision) throw new Error("Scenario simulation revision is incompatible");
      const baseline = validateSnapshot(envelope.initialSnapshot, loadOptions.allowRevisionMismatch);
      const rawBaseline = snapshotEnvelope.parse(envelope.initialSnapshot);
      if (rawBaseline.gameId !== envelope.gameId || rawBaseline.schemaVersion !== envelope.schemaVersion || rawBaseline.simulationRevision !== envelope.simulationRevision) throw new Error("Scenario metadata disagrees with its snapshot");
      const assertions = checkedAssertions(envelope.assertions);
      let previousTick = baseline.tick; let previousCursor = baseline.inputCursor;
      const inputs: RecordedGameInput<TInput>[] = envelope.inputs.map((rawInput) => {
        const position = z.object({ tick: nonnegativeInteger, inputCursor: nonnegativeInteger, kind: z.enum(["command", "patch"]) }).passthrough().parse(rawInput);
        if (position.tick < previousTick || position.tick > envelope.endTick || position.inputCursor !== previousCursor + 1) throw new Error("Scenario input ordering is invalid");
        previousTick = position.tick; previousCursor = position.inputCursor;
        if (position.kind === "command") return { kind: "command", tick: position.tick, inputCursor: position.inputCursor, input: parseGameData(definition.inputSchema, position.input, false) };
        const changes = z.array(z.object({ path: z.string(), value: z.unknown() }).strict()).min(1).parse(position.changes) as StatePatch[];
        return { kind: "patch", tick: position.tick, inputCursor: position.inputCursor, changes: cloneGameData(changes) };
      });
      if (envelope.endTick < baseline.tick || assertions.some((assertion) => assertion.tick < baseline.tick || assertion.tick > envelope.endTick)) throw new Error("Scenario duration/assertions are invalid");
      if (envelope.endTick - baseline.tick > 1_000_000) throw new Error("Scenario exceeds the maximum replay tick count");
      // Validate actual reducer/patch behavior before replacing any user session or queued input.
      const saved = snapshot(); const savedTimelines = timelines; const savedBranch = branch; const savedFrozen = frozen;
      const savedAssertions = scenarioAssertions; const savedStagedConfig = nextStartingConfig;
      const savedRecording = recordingSuspended;
      try {
        restoreSnapshot(baseline); branch = "original"; frozen = true; recordingSuspended = true;
        timelines = { original: { checkpoints: [baseline], inputs, headTick: envelope.endTick } };
        seekInternal(envelope.endTick);
      } catch (error) {
        restoreSnapshot(saved); timelines = savedTimelines; branch = savedBranch; frozen = savedFrozen;
        scenarioAssertions = savedAssertions; nextStartingConfig = savedStagedConfig;
        throw error;
      } finally { recordingSuspended = savedRecording; }
      discardPending("Scenario replaced the session before queued input was applied");
      restoreSnapshot(baseline); nextStartingConfig = cloneGameData(baseline.startingConfig); scenarioAssertions = assertions;
      notify(); return snapshot();
    },
    evaluateAssertions(assertions = scenarioAssertions) {
      const checked = checkedAssertions(assertions);
      const saved = snapshot(); const savedFrozen = frozen; const savedRecording = recordingSuspended;
      const results: ScenarioAssertionResult[] = [];
      frozen = true; recordingSuspended = true;
      try {
        for (const assertion of checked) {
          try {
            seekInternal(assertion.tick);
            const actual = readGameStatePath(state, assertion.path);
            let passed: boolean;
            if (assertion.kind === "hash") passed = canonicalGameStateHash(actual) === assertion.value;
            else if (assertion.kind === "equals") passed = canonicalGameStateJson(actual) === canonicalGameStateJson(assertion.value);
            else if (assertion.kind === "closeTo") passed = typeof actual === "number" && Math.abs(actual - assertion.value) <= assertion.tolerance;
            else passed = typeof actual === "number" && actual >= assertion.min && actual <= assertion.max;
            results.push({ assertion, passed, actual: actual as import("./engine-schema.js").JsonValue });
          } catch (error) { results.push({ assertion, passed: false, error: error instanceof Error ? error.message : "Assertion evaluation failed" }); }
        }
      } finally { restoreSnapshot(saved); frozen = savedFrozen; recordingSuspended = savedRecording; }
      notify(); return results;
    },
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    subscribePendingResults(listener) { pendingResultListeners.add(listener); return () => { pendingResultListeners.delete(listener); }; }
  };
  return engine;
}

export function runGameScenario<TState, TConfig, TInput, TResult>(
  definition: GameDefinition<TState, TConfig, TInput, TResult>, scenario: GameScenario<TState, TConfig, TInput>, options: { allowRevisionMismatch?: boolean } = {}
) {
  const engine = createGameEngine(definition, { seed: scenario.initialSnapshot.seed, tickRate: scenario.initialSnapshot.tickRate,
    historySeconds: Math.max(5, (scenario.endTick - scenario.initialSnapshot.tick) / scenario.initialSnapshot.tickRate) });
  engine.loadScenario(scenario, options);
  // Assertions may address the start of a long scenario: evaluate before replay can evict it.
  const assertions = engine.evaluateAssertions(scenario.assertions);
  const finalSnapshot = engine.replay();
  return { passed: assertions.every((entry) => entry.passed), assertions, finalSnapshot };
}
