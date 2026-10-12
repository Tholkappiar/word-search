---
name: game-development
description: Build or change the downloaded GameInstance game while preserving its basic platform runtime contract. Advanced variable-panel and rewind integration belongs to the optional game-testing skill.
---

For an investigation, inspect and report without changing code. For game creation
or changes, focus on the requested gameplay and platform compatibility.

1. Read [AGENTS.md](../../../AGENTS.md), [README.md](../../../README.md),
   src/game.ts, src/render.ts and package.json. Read the
   [basic compatibility reference](../../../docs/GAME_AUTHORING.md) for runtime
   requirements, exact normalized inputs and a worked gameplay example.
2. Bootstrap if needed, then run corepack pnpm dev and open the printed game URL.
   No running stream or provider account is needed.
3. Implement the requested gameplay and rendering using the existing starter
   structure. Keep command transport/readiness intact. Validate events before
   reacting, make pause and reset affect actual gameplay, bound growing state,
   and align config schema/defaults/payload and subscriber opt-in.
   For optional chat-command reporting, use the basic reference's result metadata
   contract; never infer a gameplay trigger from chat delivery alone.
4. Add direct gameplay regression tests. Replace blank-starter assumptions as
   the game grows; retain command validation and meaningful pause/reset/config
   coverage. Do not require editable variables or advanced testing integration.
5. Run corepack pnpm test, corepack pnpm lint and corepack pnpm build. Open the
   game to exercise changed behavior and check the 1080 x 1920 composition and
   console errors. Report visual verification as unperformed if unavailable.
6. For startup/transport changes, run corepack pnpm runtime:build followed by
   corepack pnpm check:runtime when Docker is available. These test the working
   copy's runtime compatibility; report any missing checks or prerequisites.
7. Summarize the game behavior and compatibility evidence. Leave existing SDK
   plumbing and credentials untouched. Do not add advanced testing integration
   as extra scope. When the user chooses that work, use the optional
   [game-testing skill](../game-testing/SKILL.md) instead.
