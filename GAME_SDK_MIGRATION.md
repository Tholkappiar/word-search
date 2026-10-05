# Adopt the JavaScript game SDK

This is a source bundle for JavaScript/TypeScript browser games. It includes
protocol, game-kit, the local simulator and inspector. It works without access
to the platform repository. Installing it does not automatically make an
existing game's state rewindable.

## Install the source bundle

New starters already include the SDK; skip installation for those games. When
adopting the provided SDK bundle into an existing game, keep its JSON and installer
together. From the existing game's root, first inspect the dry run:

```sh
node /path/to/install-sdk-bundle.mjs /path/to/game-sdk-bundle.json
node /path/to/install-sdk-bundle.mjs /path/to/game-sdk-bundle.json --apply
```

The installer creates only SDK, bootstrap and authoring files. It preserves
existing AGENTS.md, both skill instructions and authoring/testing/scenario guides,
and refuses other differing files. It
does not modify package.json, workspace configuration, lockfile or game logic.
Review the SDK version and identity, and keep the changes on a Git branch.

Read the bundled [authoring contract](docs/GAME_AUTHORING.md) for simulation API
examples, production requirements and behavioral acceptance checks. Existing
custom guidance is never overwritten. If these files already exist, compare
their contents with the corresponding entries in the downloaded bundle JSON and
merge relevant updates manually; reinstalling does not refresh customized docs.
Link your AGENTS.md and skill to the reference so future agents can discover it.

If the old game uses a Git submodule at vendor/gameinstance, the importer
refuses to change it. First commit a backup branch, remove the Git link and its
.gitmodules entry using Git, and review that change. Do not delete or overwrite
an SDK checkout containing uncommitted work. Then rerun the dry run and install.
For an SDK upgrade with existing bundled files, review the replacement bundle
as a dependency upgrade; the importer intentionally refuses silent replacement.

## Connect the existing package

Use Node 22+ and pnpm 10.12.1. Add these entries to your existing
pnpm-workspace.yaml, preserving any other workspace packages:

```yaml
packages:
  - "vendor/gameinstance/packages/protocol"
  - "vendor/gameinstance/packages/game-kit"
  - "vendor/gameinstance/packages/game-dev"
```

Add @repo/protocol and @repo/game-kit as workspace:* dependencies and
@repo/game-dev as a workspace:* devDependency. Keep zod ^3.25.67, TypeScript
^5.8.3, @types/node ^22.15.30 and your browser framework/build dependencies. The supplied adapter uses
Vite; adapt scripts/runtime-start.mjs and the game launch script deliberately
if your game uses another build system. Add these package scripts, merging with
your own test/build/lint scripts:

```json
{
  "bootstrap": "node scripts/bootstrap.mjs",
  "doctor": "node scripts/bootstrap.mjs --check",
  "dev": "gameinstance-dev dev",
  "dev:game": "vite",
  "dev:container": "node scripts/runtime-start.mjs",
  "runtime:build": "node scripts/build-runtime.mjs",
  "check:runtime": "gameinstance-dev runtime-check"
}
```

Set packageManager to pnpm@10.12.1. Run `corepack pnpm install --lockfile-only`
once to generate the reviewed migration lockfile, commit it, and then run
`corepack pnpm bootstrap`. Regular bootstrap/runtime installs stay frozen.
Add .gameinstance/, artifacts/, node_modules/ and dist/ to .gitignore. Configure
game tests to exclude vendor/**. Bootstrap verifies source identity before
installation or compilation; `corepack pnpm run doctor` also verifies it.

The bundle includes the production runtime source and Dockerfile as a verified
portable build context. Run `corepack pnpm runtime:build` with Docker running to
build a compatible image without access to the platform repository. It records
the immutable image ID in ignored `.gameinstance/runtime-image.json`; subsequent
`corepack pnpm check:runtime` uses that image automatically. Explicit
`--image` overrides the local selection when testing a deployed image. Public
base-image, OS-package and JavaScript-dependency downloads need network access.
This builds a local compatibility image; it does not deploy it to a worker.

## Preserve basic runtime compatibility

Keep the incoming command contract. Use parseRuntimeControlCommand,
applySharedGameCommand and createRuntimeCommandClient from the bundled SDK;
do not copy or redefine protocol types. Keep /healthz and
window.__STREAM_READY__, use VITE_CONTROL_WS_URL and honor SAMPLE_GAME_PORT in
the container script. A game must render locally without a control URL.

Retain gameInstance.gameContractVersion: "1.0.0", a valid nonempty
gameInstance.setConfigPayload and gameInstance.orchestrator.pollSubscribers.
The [basic authoring reference](docs/GAME_AUTHORING.md) describes required
startup, control/result, configuration and event behavior. Keep pause/resume,
world reset, invalid-input handling and actual game behavior covered by tests.

The supplied starter uses defineGame/createGameEngine and already connects its
runtime. Keep that implementation when extending it. Another implementation can
satisfy the runtime contract without adding an inspector or rewind.

## Optional advanced testing

Only when the user chooses to integrate variable editing, freeze, rewind/replay
or recorded scenarios, use the [game-testing skill](.agents/skills/game-testing/SKILL.md)
and [testing integration reference](docs/GAME_TESTING.md). They cover state-model
adoption, adapter wiring, deterministic inputs/effects and verification.
Installing SDK source alone does not make incomplete state snapshots rewindable.
Do not advertise testing capabilities until they have been implemented and verified.

New starters already include a scenario runner. For an existing game adopting
scenarios, the bundle provides templates/scenarios.test.ts; review it and adapt
its gameDefinition import before adding it to the game's tests.

## Verify locally

Run bootstrap, doctor, test, lint and build. Start corepack pnpm dev and exercise
the actual game, input validation, pause, reset and configuration.
Check the working copy with corepack pnpm check:runtime and keep its local logs
and screenshots. Static validation, rendering tests and execution in the runtime
are different checks; report which were performed.
