# Game authoring contract

Read the sections relevant to your change; this reference describes the bundled
JavaScript SDK, not a replacement game design. Follow [AGENTS.md](../AGENTS.md)
for repository-wide rules. The goal is a game that runs locally and honors the
platform runtime contract. Preserve the starter's working browser transport and
runtime integration; do not add development tooling merely to complete a game.
Optional variable-panel and timeline tooling is covered separately in
[game-testing](../.agents/skills/game-testing/SKILL.md), only when the user chooses
to adopt or extend it.

## Working with the existing starter engine

The generated starter already uses `@repo/game-kit/engine`. These conventions
keep that implementation correct; the platform wire contract does not require
every independently authored game to adopt this engine or its debugging features.

- Register every mutable gameplay value in the Zod state schema and initializer.
  Use finite JSON data: no `undefined` fields, `NaN`, `Infinity`, dates, classes,
  functions, cycles, DOM objects or assets. Bound growing collections, including
  celebration queues, even when paused. Render snapshots without mutating them.
- Use `context.random()`, `context.timeMs`, `context.deltaSeconds` and fixed ticks
  for gameplay. Browser time is only for driving/rendering frames; `Math.random`,
  timers and wall-clock timestamps must not determine authoritative outcomes.
- Return JSON `effects` from transitions for audio/network/browser work and
  consume them through `createGameEngine(..., { onEffect })`. External effects
  cannot replace authoritative state. ACK timestamps are not simulation clocks.
- Convert DOM events and asynchronous completions into validated inputs;
  never mutate state from callbacks. Preserve the existing runtime command schema
  if adding local input variants. No editable variable-panel metadata is required
  to implement gameplay.
- Preserve the existing game identity;
  incompatible schemas require `schemaVersion`, changed behavior requires
  `simulationRevision`. Test intended behavior, not merely the last observed output.

## Commands and configuration

`applySharedGameCommand` handles pause/resume, overlay visibility, configuration,
chat and subscriber bookkeeping. It does not implement your game's movement,
scoring, reset or visual overlays. `reload` is rejected by the shared reducer;
unknown commands are rejected unless you deliberately implement a handler.
The production wire accepts only `pause`, `resume`, `resetGame`, `showOverlay`,
`hideOverlay`, `injectChatEvent`, `injectSubscriberEvent`, `setConfig` and `reload`
(`GameCommandTypeSchema` in `@repo/protocol`). A local custom handler does not
extend that allowlist; use normalized chat/config for game-specific behavior.

- Gameplay pause sets `state.runtime.paused`; your world systems must obey it.
  Decide and test whether chat can change gameplay while paused.
- `resetGame` resets shared state to the reducer's `initialConfig`/`initialDefaults`
  and increments `resetCount`. Explicitly reset every added world field while
  retaining that returned runtime state. It does not restart the engine clock/RNG.
- `setConfig` changes current `runtime.config`; validate the merged config with its
  schema. Choose and document reset's config policy; the shared reducer defaults
  to its supplied `initialConfig`, not the most recent `setConfig` payload.
- Keep the schema, `initialConfig` and `package.json`'s nonempty
  `gameInstance.setConfigPayload` consistent. Prefer `{ "game": { ... } }`, with
  optional `defaults` for shared overlays. The blank starter accepts `{ "game": {} }`;
  register fields before using them. The platform sends this payload through
  `setConfig`; it is not automatically a local engine starting configuration.
- Chat and paid chat arrive as `injectChatEvent` with `payload.chatEvent`
  (`message.type` distinguishes `text`/`superchat`). Subscribers use
  `injectSubscriberEvent` with `payload.subscriberEvent`. Use the protocol schemas;
  do not infer validity from command type or cast the unvalidated payload.
- Check the shared **result** before reacting. An engine receipt's outer
  `status: "applied"` means the handler ran; `result.status` can still be `rejected`.
  Invalid config can throw; the socket adapter turns that into a rejected ACK.
  A rejected event must not award points, consume RNG or emit gameplay effects.
- Keep command IDs and stream/deployment/runtime scope intact. Preserve the starter's
  socket deduplication and final result reporting. `accepted` is not a terminal
  success: deferred work must later report its actual result. Do not acknowledge
  success optimistically. Keep existing deferred-result plumbing when present.
- Actual subscriber polling requires `gameInstance.orchestrator.pollSubscribers: true`
  in package metadata. Injected local subscriber events work without that flag;
  they do not prove production polling. Enable it only for a game that uses it.

## Optional chat-command reporting

To identify which chat inputs actually selected gameplay commands, attach
`chatCommands` to that input's `GameCommandResult`. Use stable names such as
`["jump"]` or `["setColor"]`, not the message text, arguments, author or secrets.
Names start with a letter and contain only letters, digits, `_`, `.`, `:` or `-`
(64 characters maximum; up to 16 unique names). This is optional telemetry;
it does not add control command types or change gameplay execution.

Report names where the game recognizes the action, alongside its actual result
status. `applied` and `rejected` remain different outcomes. Use `[]` only when
the game has checked the input and no gameplay command matched. An absent field
means **not reported**, not “no command.” Merely receiving/forwarding a message,
updating a chat label, or displaying a paid-message celebration is not a trigger.

For `applySharedGameCommand`'s `onChatEvent` callback, return
`{ state: nextState, commands: ["setColor"] }` (or `commands: []`) to report the
match. Existing state-only callbacks still work and leave reporting unavailable.
If gameplay is handled after the shared reducer, attach `chatCommands` directly
to the final result, as in the example below. Preserve the original command ID
and stream/deployment/runtime binding. For queued work, include this information
on the actual completion result, not a second result after completion.

This requires a runtime with the matching updated SDK/protocol. Older receiving
runtimes reject unknown result fields; run compatibility checks before using a
new SDK with a previously deployed runtime. Unreported historical inputs cannot
be retroactively classified from their text or a transport acknowledgement.

## Worked example

This **illustrative** simulation moves a point; chat `jump` relocates it and earns
a point. It is not an instruction to replace an existing game or its ID. Adapt the
pattern to the requested design; keep the generated App/transport and renderer.
If adopting its config, set package `gameInstance.setConfigPayload` to
`{ "game": { "speed": 60 } }` and deliberately update schema/revision identifiers.
Reset here uses compiled defaults. Paused chat updates
shared diagnostics but cannot move/score. Unused celebrations are consumed immediately.

### Example: src/game.ts

```ts
import { z } from "zod";
import { NormalizedChatEventSchema } from "@repo/protocol";
import { applySharedGameCommand, createInitialSharedGameState, parseRuntimeControlCommand } from "@repo/game-kit";
import { createGameEngine, createSharedGameStateSchema, defineGame, type GameEngineOptions, type SimulationContext } from "@repo/game-kit/engine";

export const configSchema = z.object({ speed: z.number().finite().min(0).max(600) }).strict();
export const initialConfig = { speed: 60 };
const worldSchema = z.object({
  x: z.number().finite().min(0).max(1080), score: z.number().int().min(0).max(1000),
  elapsedMs: z.number().finite().nonnegative(), lastJumpAtMs: z.number().finite().nonnegative()
}).strict();
const stateSchema = z.object({ runtime: createSharedGameStateSchema(configSchema), world: worldSchema }).strict();
export type GameState = z.infer<typeof stateSchema>;
function initialWorld(context: SimulationContext) {
  return { x: context.random() * 1080, score: 0, elapsedMs: 0, lastJumpAtMs: 0 };
}
export const gameDefinition = defineGame({
  id: "authoring-example-only", schemaVersion: "1", simulationRevision: "1",
  stateSchema, configSchema, inputSchema: z.unknown().transform(parseRuntimeControlCommand), initialConfig,
  createInitialState(config, context) {
    return { runtime: createInitialSharedGameState(config), world: initialWorld(context) };
  },
  applyCommand(state, command, context) {
    const shared = applySharedGameCommand(state.runtime, command, {
      initialConfig, mergeGameConfig: (config, patch) => configSchema.parse({ ...config, ...patch })
    });
    // No celebration UI in this example: never let its unused queue grow.
    const runtime = { ...shared.state, celebrationQueue: [] };
    const next = { ...state, runtime };
    if (shared.result.status !== "applied") return { state: next, result: shared.result };
    if (command.type === "resetGame") {
      return { state: { ...next, world: initialWorld(context) }, result: shared.result };
    }
    if (command.type === "injectChatEvent" && !runtime.paused) {
      const event = NormalizedChatEventSchema.parse(command.payload.chatEvent);
      if (event.message.text.trim().toLowerCase() === "jump") {
        const world = { ...next.world, x: context.random() * 1080,
          score: Math.min(1000, next.world.score + 1), lastJumpAtMs: context.timeMs };
        return { state: { ...next, world }, result: { ...shared.result, chatCommands: ["jump"] }, effects: [{ type: "jump", x: world.x }] };
      }
    }
    return { state: next, result: command.type === "injectChatEvent" ? { ...shared.result, chatCommands: [] } : shared.result };
  },
  step(state, context) {
    if (state.runtime.paused) return { state };
    return { state: { ...state, world: { ...state.world,
      x: (state.world.x + state.runtime.config.speed * context.deltaSeconds) % 1080,
      elapsedMs: state.world.elapsedMs + context.deltaMs } } };
  }
});
export function createGame(options: GameEngineOptions = {}) {
  return createGameEngine(gameDefinition, { seed: 1, ...options });
}
```

### Example: src/game.test.ts

These tests execute against the SDK. Extend them with your game's actual rules;
the platform also executes these documented code blocks to detect stale examples.

```ts
import { expect, it } from "vitest";
import { createGame } from "./game";

function command(type: string, payload: Record<string, unknown> = {}, commandId = type) {
  return { commandId, streamId: "local", deploymentId: "local", runtimeInstanceId: "local", issuedBy: "test",
    issuedAt: "2026-10-03T00:00:00.000Z", requireAck: true, type, payload };
}
function jump() {
  return command("injectChatEvent", { chatEvent: { eventId: "chat-1", streamId: "local",
    receivedAt: "2026-10-03T00:00:00.000Z", author: { displayName: "Player" }, message: { type: "text", text: "jump" } } });
}
it("pauses actual world behavior, not just the status flag", () => {
  const game = createGame(); game.advance(10); game.dispatch(command("pause"));
  const paused = game.getState().world;
  game.advance(20); expect(game.dispatch(jump())).toMatchObject({ result: { chatCommands: [] } }); expect(game.getState().world).toEqual(paused);
  game.dispatch(command("resume")); game.advance(1);
  expect(game.getState().world.elapsedMs).toBeGreaterThan(paused.elapsedMs);
});
it("applies current config and resets every added world field", () => {
  const game = createGame(); game.dispatch(command("setConfig", { game: { speed: 120 } }));
  expect(game.getState().runtime.config.speed).toBe(120);
  const initialX = game.getState().world.x;
  game.advance(10); expect(game.getState().world.x).toBeCloseTo((initialX + 20) % 1080);
  game.dispatch(jump()); expect(game.getState().world.score).toBe(1);
  game.dispatch(command("resetGame"));
  expect(game.getState()).toMatchObject({ runtime: { resetCount: 1, paused: false, config: { speed: 60 } },
    world: { score: 0, elapsedMs: 0, lastJumpAtMs: 0 } });
  expect(game.getSnapshot().tick).toBe(10); // A command reset is not an engine restart.
});
it("rejects malformed events/config without gameplay or RNG side effects", () => {
  const effects: unknown[] = []; const game = createGame({ onEffect: effect => effects.push(effect) });
  const before = game.getSnapshot();
  expect(game.dispatch(command("injectChatEvent"))).toMatchObject({ status: "applied", result: { status: "rejected" } });
  expect(game.getState().world).toEqual(before.state.world);
  expect(game.getSnapshot().rngState).toBe(before.rngState); expect(effects).toEqual([]);
  const state = game.getState();
  expect(() => game.dispatch(command("setConfig", { game: { speed: -1 } }))).toThrow();
  expect(game.getState()).toEqual(state);
  expect(game.dispatch(command("unknown"))).toMatchObject({ result: { status: "rejected" } });
});
it("uses valid chat to change gameplay and emits an effect after applying it", () => {
  const effects: unknown[] = []; const game = createGame({ seed: "repeatable", onEffect: effect => effects.push(effect) });
  game.advance(10);
  expect(game.dispatch(jump())).toMatchObject({ result: { status: "applied", chatCommands: ["jump"] } });
  const world = game.getState().world;
  expect(world.score).toBe(1); expect(world.lastJumpAtMs).toBeCloseTo(10 * 1000 / 60);
  expect(world.x).toBeGreaterThanOrEqual(0); expect(world.x).toBeLessThan(1080);
  expect(effects).toEqual([{ type: "jump", x: world.x }]);
});
```

## Preserve the production integration

- Keep `src/main.tsx`, the pinned pnpm package manager and committed lockfile;
  runtime installs use the frozen lockfile. Keep React, React DOM, Vite and
  TypeScript dependencies and `build`/`dev:container` scripts. Container startup
  must serve Vite on `0.0.0.0` at `SAMPLE_GAME_PORT` (default 5173), without the
  local inspector launcher. Retain bootstrap/SDK verification and workspace wiring.
- Keep `gameInstance.gameContractVersion: "1.0.0"` and a nonempty `setConfigPayload`.
  Preserve `VITE_CONTROL_WS_URL`, `createRuntimeCommandClient`, engine dispatch,
  existing deferred-result forwarding and cleanup. The SDK owns socket reconnection and
  scoped command deduplication; the simulation alone does not deduplicate inputs.
- Keep readiness initialization in `src/main.tsx` (`window.__STREAM_READY__ = false`)
  and the SDK readiness lifecycle; don't set true early to bypass startup checks.
  Keep `healthzPlugin` in Vite so `/healthz` can be probed. Health/readiness and
  working control transport are distinct checks; a rendered canvas proves neither.
- Source inspection follows relative JS/TS imports from `src/main.tsx` and
  `src/App.*`, not package aliases or vendor code. If relocating the integration,
  declare `gameInstance.integrationEntry` as a small repository-relative JS/TS file
  outside `vendor`/`node_modules`. Preserve real integration, not token comments
  added merely to make static validation pass.
- Do not put provider/database/admin credentials in game source, scripts or browser
  environment. `VITE_*` values are public. Keep `.gameinstance/` private and ignored;
  any existing inspector exposure remains development-only. No provider SDK is needed to react
  to normalized stream events.

## Acceptance checklist for a changed game

1. Test actual movement/scoring/timers, paused behavior, resume, and resetting every
   added world field. Test live configuration changes. Cover
   invalid config/events and unsupported commands without gameplay mutation.
2. Check valid chat/paid/subscriber behavior that your game uses, bounded queues
   under bursts and while paused, and scoped ACKs with actual final results.
   If rendering overlays, test `hideOverlay`/`showOverlay` on those visuals.
3. Run `corepack pnpm test`, `corepack pnpm lint`, `corepack pnpm build`. Keep the
   reusable `src/contract.test.ts` invariant suite running against your actual game;
   it complements, not replaces, world-specific pause/reset/gameplay tests. Replace
   blank-starter assertions such as "only runtime state", "empty config" or
   "ticks do nothing" when adding gameplay. Preserve their underlying contract
   checks: validation, shared controls, queue bounds and actual ACKs. Use meaningful
   expected-state assertions; regression scenarios are optional tooling, not a
   requirement to build a compatible game.
4. Open the game locally and inspect the real canvas at its 1080 x 1920 output
   size and a normal browser size. Check readability, clipping, commands, pause,
   configuration, overlays and error console. Tests/typechecks do not prove visuals.
5. When local container compatibility is in scope, run `corepack pnpm runtime:build`
   then `corepack pnpm check:runtime`. Report exactly which checks passed;
   synthetic events do not prove YouTube delivery or real subscriber polling.
   No account connection, stream launch or publishing workflow is needed to build
   and test the game locally.
