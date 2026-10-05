# StreamForge Web Game

An empty 2D canvas, ready for your own game.

This folder is ready for local game development. The GameInstance SDK is bundled
in vendor/gameinstance. No account, stream, database or provider credentials are
needed to make and test the game.

## Run locally

Open the extracted game folder in your editor. Use Node 22+ and pnpm 10.12.1:

    corepack prepare pnpm@10.12.1 --activate
    corepack pnpm bootstrap
    corepack pnpm dev

Bootstrap verifies the bundled SDK, performs a frozen install and builds its
packages. The local launcher prints the game URL. To choose a fixed port, use
corepack pnpm dev --game-port 5173. Use corepack pnpm run doctor for prerequisite
checks. These commands work on Windows and Unix.

## Build your game

Read [AGENTS.md](AGENTS.md), the [game-development skill](.agents/skills/game-development/SKILL.md)
and the [basic compatibility contract](docs/GAME_AUTHORING.md).

The starter draws a blank 1080 x 1920 canvas. Add gameplay state, configuration,
commands and stepping in src/game.ts, and drawing in src/render.ts. src/App.tsx
already connects the renderer and runtime command transport; preserve that wiring.
The strict initial config is empty. Register fields before using them and keep
initialConfig and package.json gameInstance.setConfigPayload aligned.

The shared helper sets the pause flag and resets shared runtime state. Your
gameplay must obey pause and reset its own added world fields. Chat and subscriber
events have no built-in gameplay meaning; implement the reactions your game needs.
Enable gameInstance.orchestrator.pollSubscribers only if the game uses subscribers.

Keep the generated game ID stable through edits and repository renames. Preserve
the SDK's identity/version fields and update schemaVersion/simulationRevision
appropriately when changing its schemas or behavior.

## Check compatibility

    corepack pnpm test
    corepack pnpm lint
    corepack pnpm build

Replace blank-starter assertions with meaningful gameplay tests while retaining
command validation, pause/resume, reset and configuration coverage. Visually check
the actual canvas; successful builds and ACKs do not prove gameplay works.

For startup or transport changes, Docker-based compatibility checks are available:

    corepack pnpm runtime:build
    corepack pnpm check:runtime

These check the local working copy with the included runtime. Preserve
dev:container, SAMPLE_GAME_PORT, /healthz, readiness and control connection
requirements described in the compatibility reference.

## Optional testing tools, when you want them

The starter includes testing infrastructure, but using the variable panel,
editable fields, freeze, rewind or scenario capture is not required to make a
platform-compatible game. After building your game, ask to use the
[game-testing skill](.agents/skills/game-testing/SKILL.md) to integrate or configure
those tools for its variables and behavior. Leave the existing plumbing intact;
there is no need to configure every advanced feature before making the game.
