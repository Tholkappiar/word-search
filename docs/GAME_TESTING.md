# Optional local game testing integration

Use this reference with the [game-testing skill](../.agents/skills/bubbleportal-game/SKILL.md)
when the user asks for the variable panel, editable state, freeze/step/rewind,
deterministic replay or regression capture. These are **not** prerequisites for
the [platform game contract](GAME_AUTHORING.md). Do not redesign an existing game
or remove working runtime integration merely to add debugging tools.

## Choose the smallest appropriate integration

### A game already using the installed SDK engine

1. Inspect `src/game.ts`, the App/driver and package scripts. Reuse the **same engine
   instance** used for live rendering and runtime commands; a second debug-only
   engine would show/edit the wrong state. Generated games may already have the
   adapter, launcher and command bridge: verify them instead of installing twice.
2. Check the state and config schemas against all mutable gameplay data. Add missing
   fields and initial values. Keep finite JSON state, bounded arrays/queues and
   immutable assets outside the simulation. Use `createSharedGameStateSchema` for
   shared controls rather than inventing a competing runtime state representation.
3. Add only the requested editable paths to `gameDefinition.inspector`, e.g.
   `"world.score": { editable: true, min: 0, max: 1000 }`. Unmarked fields remain
   visible but read-only. Wildcards such as `entities.*.health` support arrays.
   Bounds and the full state schema validate the patch atomically. Keep runtime
   flags/config read-only; use commands or the starting-config editor instead.
4. Reuse/import `engineDevAdapter` and `registerGameDev` from
   `@bubbleportal/devtools/browser`. Register `engineDevAdapter(engine)` inside the App's
   lifecycle and return its cleanup function when that engine is replaced/unmounted.
   Keep the explicit `VITE_GAMEINSTANCE_DEV_ENABLED === "true"` guard. The helper
   also needs the launcher's `VITE_GAMEINSTANCE_DEBUG_WS_URL`; do not hardcode it.
5. Verify `dev` runs `bubbleportal dev` and `dev:game` runs Vite. Bootstrap installs
   the pinned, prebuilt SDK and developer tools using the frozen lockfile. Preserve the pnpm
   lockfile and existing runtime entrypoint. `dev:container` must not launch the
   debugger or expose it based on Vite's generic development mode: production
   containers also use Vite. Keep `.gameinstance/` ignored and credentials private.
6. Preserve the command bridge described below. Add focused tests for the capabilities
   you enabled, then open the local variable panel to verify edits affect the actual
   renderer and invalid edits produce useful errors without partially applying.

### A compatible game that does not use the engine

Choose with the user whether they need observation only or full editable timelines.
Do not claim that registering an adapter alone makes a game rewindable.

- For observation, `registerGameDev` accepts a `GameDevAdapter` exposing
  `getSnapshot()` and `getCapabilities()`. Return a detached, JSON-safe snapshot
  and `{}` for unsupported debug capabilities. An optional `subscribe(listener)`
  should return cleanup. The toolkit can show snapshots without offering fake
  freeze/edit/replay operations; the existing runtime command client stays intact.
- For full engine features, first inventory simulation state, timers, RNG, event
  queues and asynchronous mutations. Move authoritative data into Zod schemas;
  implement `createInitialState`, `applyCommand`, and fixed-tick `step` with
  `defineGame`/`createGameEngine`. Preserve current gameplay and the supported
  runtime commands, use the returned engine snapshots in the existing renderer,
  then integrate the adapter as above. Add tests around current behavior before
  migrating so the tooling work does not silently change game rules.
- If retaining a custom engine, an adapter must truthfully implement every advertised
  operation and its atomic validation/queue/history semantics. A read-only adapter
  is preferable to implementing superficial no-op operations. Offer the bundled
  deterministic engine as an option, not a platform compatibility requirement.

## Determinism and identity before time travel

Use `context.random()`, `context.timeMs`, `context.deltaMs`/`deltaSeconds` for
simulation behavior. Do not use `Math.random`, wall clocks, timers, React callbacks
or asynchronous completions to mutate authoritative state. Dispatch normalized
inputs for external events, preserving their recorded order. Return JSON effects
for audio/network/browser work and consume them through the engine's `onEffect`;
effects are suppressed during seek, replay, manual stepping and edited branches.
Never change simulation results according to `context.replaying`.

Keep the existing game ID stable. A genuinely copied/new game gets a different ID.
Bump `schemaVersion` for incompatible state/config/input schemas and
`simulationRevision` for changed initialization/command/step behavior. A renderer-only
change can preserve the engine; gameplay HMR must not claim old history was produced
by new behavior. `restore` is an explicit compatible handoff with a fresh history
baseline, not a way to disguise a schema mismatch.

## Debugger semantics that the integration must preserve

- Gameplay `pause` is a game command/flag; debugger `freeze` stops `advance` without
  changing that flag. `step(n)` executes fixed ticks while remaining frozen, so
  genuinely paused gameplay can still choose not to move. Slow motion changes
  the driver's wall-time pacing, not fixed simulation deltas.
- Inputs received while frozen queue. The runtime socket callback must return a
  scoped `accepted` result for the engine's `queued` receipt, then forward
  `subscribePendingResults` through the client's `reportResult`. Preserve all IDs
  and scope. Use the actual inner command result; discarded/rejected inputs need
  terminal rejection, not an `applied` guess. Restart, restore and scenario
  replacement discard pending inputs with notifications. Keep one live subscription
  and clean it up with the client to avoid duplicate terminal ACKs.
- Direct `engine.resume({ pending: "apply" | "discard" | "keep" })` explicitly
  chooses queued disposition; omitting the option keeps inputs queued. The local
  adapter's unfreeze operation defaults to applying them. Transport deduplication
  stays in the runtime client; replay never resends commands through that socket.
- `setConfig` changes the current game's config. `setStartingConfig` validates and
  stages the next `restart`, surviving seek; it does not change the current run.
  `getStartingConfig()` reports staged values. The engine snapshot's
  `startingConfig` records how the run began; the debug adapter exposes staged
  values in its starting-config editor. `resetGame` remains a game command with
  its documented world/config policy, not a synonym for debugger restart.
- `seek(tick)` freezes at a retained point; `replay()` advances to the recorded head.
  Same-tick inputs retain `inputCursor` order. Editing past state creates one edited
  branch while preserving the original and its future input journal. Later recorded
  config commands may supersede an earlier edit. Use select/keep/discard branch
  operations consciously; do not silently overwrite the original to hide a failure.
- Default history retains five simulation seconds, with a 16 MiB **soft** serialized
  budget. Checkpoints are coarsened before sacrificing the minimum retained history
  or accepted-input journal. Inspect `getHistory().memoryLimited`/`bytes`, keep state
  compact and bound collections. This is not unlimited history or a hard memory cap.

## Try the capabilities locally

Run `corepack pnpm dev` and open its printed game URL. The inspector's edge tab,
Alt+I and Pin controls open/keep the variable panel visible. Verify real data first:

```sh
corepack pnpm exec bubbleportal status
corepack pnpm exec bubbleportal state
corepack pnpm exec bubbleportal freeze
corepack pnpm exec bubbleportal step 5
corepack pnpm exec bubbleportal seek 10
corepack pnpm exec bubbleportal replay
```

Seek requires a tick inside the retained history; choose an actual available tick,
not necessarily 10. Use `--help` for typed patch/input commands. Test an allowed
edit and a rejected out-of-bounds edit, then check keep/discard and queued input
behavior. Debug controls do not require a stream or external account.

### Example: src/game-testing.test.ts

These optional tests extend the illustrative game in [Game authoring](GAME_AUTHORING.md).
Adapt paths and expected values to the real game; don't replace its definition
with this example. The bounded inspector metadata below is local to the test;
add appropriate metadata to the real definition only when requested.

```ts
import { expect, it } from "vitest";
import { createGameEngine, defineGame, runGameScenario } from "@bubbleportal/sdk/engine";
import { createGame, gameDefinition } from "./game";

function command(type: string, payload: Record<string, unknown> = {}) {
  return { commandId: type, streamId: "local", deploymentId: "local", runtimeInstanceId: "local", issuedBy: "test",
    issuedAt: "2026-10-03T00:00:00.000Z", requireAck: true, type, payload };
}
function jump() {
  return command("injectChatEvent", { chatEvent: { eventId: "chat-1", streamId: "local",
    receivedAt: "2026-10-03T00:00:00.000Z", author: { displayName: "Player" }, message: { type: "text", text: "jump" } } });
}
it("stages restart config and validates bounded state edits atomically", () => {
  const definition = defineGame({ ...gameDefinition, inspector: { "world.score": { editable: true, min: 0, max: 1000 } } });
  const game = createGameEngine(definition, { seed: 1 });
  game.setStartingConfig({ speed: 300 });
  expect(game.getStartingConfig().speed).toBe(300);
  expect(game.getSnapshot().startingConfig.speed).toBe(60);
  expect(game.getState().runtime.config.speed).toBe(60);
  game.freeze(); game.patch([{ path: "world.score", value: 3 }]);
  expect(game.getState().world.score).toBe(3); const before = game.getState();
  expect(() => game.patch([{ path: "world.score", value: 1001 }])).toThrow();
  expect(() => game.patch([{ path: "runtime.config.speed", value: 50 }])).toThrow();
  expect(game.getState()).toEqual(before);
  game.restart(); expect(game.getState().runtime.config.speed).toBe(300);
  expect(game.getState().world.score).toBe(0);
});
it("reports actual queued outcomes and discards pending inputs on restart", () => {
  const game = createGame(); const completions: unknown[] = [];
  game.subscribePendingResults(result => completions.push(result)); game.freeze();
  expect(game.dispatch(jump())).toMatchObject({ status: "queued" }); expect(game.getState().world.score).toBe(0);
  game.resume({ pending: "apply" }); expect(game.getState().world.score).toBe(1);
  expect(completions).toMatchObject([{ status: "applied", result: { status: "applied", streamId: "local", runtimeInstanceId: "local" } }]);
  game.freeze(); game.dispatch(command("pause")); game.restart();
  expect(completions).toMatchObject([{ status: "applied" }, { status: "discarded", error: expect.any(String) }]);
});
it("rewinds/replays recorded behavior and scenarios without repeating effects", () => {
  const effects: unknown[] = []; const game = createGame({ seed: "repeatable", onEffect: effect => effects.push(effect) });
  game.advance(10); game.dispatch(command("setConfig", { game: { speed: 120 } }));
  game.dispatch(jump()); game.advance(10); const expected = game.getState();
  expect(effects).toHaveLength(1);
  game.seek(5); game.replay(20); expect(game.getState()).toEqual(expected); expect(effects).toHaveLength(1);
  const scenario = game.exportScenario({ assertions: [{ tick: 20, path: "world.score", kind: "equals", value: 1 }] });
  const replay = runGameScenario(gameDefinition, scenario);
  expect(replay.passed).toBe(true); expect(replay.finalSnapshot.state).toEqual(expected);
});
```

## Capture a reviewed regression, when useful

After reproducing and verifying the intended behavior, use the inspector's
**Capture regression** / **Download JSON**, or run
`corepack pnpm exec bubbleportal scenario record scenarios/name.scenario.json`.
Recording freezes and captures only through the selected tick/input cursor, with
an expected state hash; a rewound capture excludes its future. Review the observed
state before accepting that hash. Use focused equals/range/tolerance assertions
when unrelated fields should be allowed to differ. Never regenerate captures just
to hide failing expectations; captures cannot test events before their baseline.

If the repository includes the scenario runner, `corepack pnpm test:scenarios`
discovers `scenarios/**/*.scenario.json` without a browser. If missing, adapt the
supplied SDK scenario-runner template into `src/scenarios.test.ts` and add that
script as part of this optional integration. Require at least one assertion per
fixture; an empty fixture directory should skip clearly rather than claim coverage.
See the existing [scenario guide](../scenarios/README.md) for the fixture format.

Keep game/schema/revision compatibility strict. A deliberate cross-revision
comparison can wrap a fixture as `{ "scenario": <capture>, "allowRevisionMismatch": true }`;
that does not bypass game/schema identity or change expected results. Review
fixtures for private chat/state before sharing them. Scenario replay proves
simulation behavior, not rendering or network delivery: inspect the real browser
and preserve separate platform contract tests.
