import type { z } from "zod";
import type { InspectorField, InspectorMetadata, JsonValue } from "./engine-schema.js";

export type SimulationContext = {
  tick: number;
  timeMs: number;
  deltaMs: number;
  deltaSeconds: number;
  replaying: boolean;
  random(): number;
};

export type GameTransition<TState> = { state: TState; effects?: JsonValue[] };
export type GameCommandTransition<TState, TResult> = GameTransition<TState> & { result: TResult };

export type GameDefinition<TState, TConfig, TInput, TResult> = {
  id: string;
  schemaVersion: string;
  simulationRevision: string;
  stateSchema: z.ZodType<TState, z.ZodTypeDef, unknown>;
  configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>;
  inputSchema: z.ZodType<TInput, z.ZodTypeDef, unknown>;
  initialConfig: TConfig;
  inspector?: Record<string, InspectorMetadata>;
  createInitialState(config: TConfig, context: SimulationContext): TState;
  applyCommand(state: TState, input: TInput, context: SimulationContext): GameCommandTransition<TState, TResult>;
  step(state: TState, context: SimulationContext): GameTransition<TState>;
};

export type GameEngineOptions = {
  seed?: number | string;
  tickRate?: number;
  historySeconds?: number;
  checkpointIntervalTicks?: number;
  memoryLimitBytes?: number;
  pendingInputLimit?: number;
  onEffect?(effect: JsonValue): void;
};

export type TimelinePosition = { tick: number; inputCursor: number };
export type GameSnapshot<TState, TConfig> = TimelinePosition & {
  formatVersion: 1;
  gameId: string;
  schemaVersion: string;
  simulationRevision: string;
  rngAlgorithm: "mulberry32-v1";
  seed: number;
  rngState: number;
  tickRate: number;
  timeMs: number;
  state: TState;
  startingConfig: TConfig;
};

export type StatePatch = { path: string; value: JsonValue };
export type RecordedGameInput<TInput> = TimelinePosition & (
  | { kind: "command"; input: TInput }
  | { kind: "patch"; changes: StatePatch[] }
);

export type CommandReceipt<TResult> =
  | { status: "applied"; result: TResult; position: TimelinePosition }
  | { status: "queued"; pendingId: number };

export type PendingInputResult<TInput, TResult> = {
  pendingId: number;
  input: TInput;
  status: "applied" | "rejected" | "discarded";
  position: TimelinePosition;
  result?: TResult;
  error?: string;
};

export type GameHistoryStatus = {
  earliestTick: number;
  headTick: number;
  currentTick: number;
  inputCursor: number;
  branch: "original" | "edited";
  branches: ("original" | "edited")[];
  frozen: boolean;
  pendingInputs: number;
  retainedSeconds: number;
  bytes: number;
  memoryLimitBytes: number;
  memoryLimited: boolean;
  timeScale: number;
};

export type ScenarioAssertion = { tick: number; path: string } & (
  | { kind: "equals"; value: JsonValue }
  | { kind: "closeTo"; value: number; tolerance: number }
  | { kind: "between"; min: number; max: number }
  | { kind: "hash"; value: string }
);

export type GameScenario<TState, TConfig, TInput> = {
  formatVersion: 1;
  gameId: string;
  schemaVersion: string;
  simulationRevision: string;
  rngAlgorithm: "mulberry32-v1";
  initialSnapshot: GameSnapshot<TState, TConfig>;
  inputs: RecordedGameInput<TInput>[];
  endTick: number;
  assertions: ScenarioAssertion[];
};

export type ScenarioAssertionResult = { assertion: ScenarioAssertion; passed: boolean; actual?: JsonValue; error?: string };

export type GameEngine<TState, TConfig, TInput, TResult> = {
  readonly definition: GameDefinition<TState, TConfig, TInput, TResult>;
  getState(): TState;
  getStartingConfig(): TConfig;
  getTimeScale(): number;
  setTimeScale(timeScale: number): void;
  setStartingConfig(config: unknown): void;
  getSnapshot(): GameSnapshot<TState, TConfig>;
  getInspectorFields(): InspectorField[];
  getHistory(): GameHistoryStatus;
  getJournal(): RecordedGameInput<TInput>[];
  dispatch(input: unknown, options?: { whileFrozen?: "queue" | "apply" }): CommandReceipt<TResult>;
  patch(changes: StatePatch[]): GameSnapshot<TState, TConfig>;
  advance(ticks?: number): GameSnapshot<TState, TConfig>;
  step(ticks?: number): GameSnapshot<TState, TConfig>;
  freeze(): void;
  resume(options?: { pending?: "apply" | "discard" | "keep" }): void;
  seek(tick: number): GameSnapshot<TState, TConfig>;
  replay(toTick?: number): GameSnapshot<TState, TConfig>;
  selectBranch(branch: "original" | "edited"): GameSnapshot<TState, TConfig>;
  discardBranch(): GameSnapshot<TState, TConfig>;
  keepBranch(): GameSnapshot<TState, TConfig>;
  restore(snapshot: unknown, options?: { allowRevisionMismatch?: boolean }): GameSnapshot<TState, TConfig>;
  restart(options?: { config?: TConfig; seed?: number | string }): GameSnapshot<TState, TConfig>;
  exportScenario(options?: { assertions?: ScenarioAssertion[]; regression?: boolean }): GameScenario<TState, TConfig, TInput>;
  loadScenario(scenario: unknown, options?: { allowRevisionMismatch?: boolean }): GameSnapshot<TState, TConfig>;
  evaluateAssertions(assertions?: ScenarioAssertion[]): ScenarioAssertionResult[];
  subscribe(listener: () => void): () => void;
  subscribePendingResults(listener: (completion: PendingInputResult<TInput, TResult>) => void): () => void;
};
