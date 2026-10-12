# Game development

Read [README.md](README.md), the [game-development skill](.agents/skills/game-development/SKILL.md)
and the [basic compatibility contract](docs/GAME_AUTHORING.md). The task here is
to build the requested game and keep it compatible with the platform runtime.
Use Node 22+ and pnpm 10.12.1. Bootstrap: corepack pnpm bootstrap. Run: corepack
pnpm dev. Checks: corepack pnpm test, corepack pnpm lint, corepack pnpm build.

## Basic runtime contract

Preserve gameInstance.gameContractVersion, package dependencies, frozen lockfile,
build/dev:container scripts, src/main.tsx, /healthz, __STREAM_READY__ lifecycle,
SAMPLE_GAME_PORT and VITE_CONTROL_WS_URL integration. Keep developer-only tooling
out of the production browser. Do not edit installed packages or expose credentials.

Keep createRuntimeCommandClient and the existing command/result plumbing.
Chat/paid input is injectChatEvent payload.chatEvent; subscribers are
injectSubscriberEvent payload.subscriberEvent. Validate before reacting. Preserve
scoped IDs and truthful terminal ACKs; receipt is not application. Do not invent
production wire command types. Use normalized chat/config for game-specific input.

Keep applySharedGameCommand, but implement pause and reset for your actual game:
runtime.paused must stop the intended gameplay systems; resetGame must reset
added world fields, not only shared runtime state. Define and test reset's config
policy. Rejected events/config must not change gameplay. Keep growing queues bounded.

Register config fields before use. Keep initialConfig and package.json
gameInstance.setConfigPayload consistent. Enable
gameInstance.orchestrator.pollSubscribers=true only for games using subscriber
events; synthetic events alone do not prove live polling.

## Extending this starter

Keep gameplay logic/state in src/game.ts and snapshot drawing in src/render.ts.
This starter uses the installed SDK engine: register its state in a JSON-safe schema
and initializer, use context.random()/the engine clock for gameplay, and return
external work as effects. Do not move authoritative state into render callbacks.
Preserve the existing integration rather than rebuilding it for routine changes.
Keep the generated game ID stable, and maintain schemaVersion and
simulationRevision as schemas/behavior change.

Replace obsolete blank-starter assertions with meaningful gameplay tests. Verify
actual pause/resume, full-world reset, valid/invalid config and event behavior,
not just successful ACKs. Check visual changes in the browser at the stream size.

## Optional advanced testing

Variable-panel editing, freeze, rewind/replay and scenario capture are optional
development tools, not platform compatibility requirements. Do not make their
integration a prerequisite for completing ordinary game work. When the user asks
to add or configure them, use the [game-testing skill](.agents/skills/game-testing/SKILL.md).
Keep any existing working tooling/tests intact; do not force a redesign merely
to add testing features. Report checks not run and remaining compatibility limits.

Keep SDK dependencies pinned to exact versions and preserve .gamego/sdk.json and
the frozen lockfile. For an explicitly requested SDK upgrade or bundled-to-npm
migration, use the [sdk-upgrade skill](.agents/skills/sdk-upgrade/SKILL.md).

## Project rules

- SDK upgrades: preview the migration with the exact target release's CLI and review the plan with
  the user before applying it. Report a manual merge instead of forcing an unsupported migration.
- Uploading a new source version, publishing and live streaming each need the user's separate go-ahead.
