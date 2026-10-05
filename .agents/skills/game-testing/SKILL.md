---
name: game-testing
description: Integrate or configure optional GameInstance testing tools when requested, including the variable panel, state editing, freeze, rewind/replay and regression scenarios. Not required for basic game creation or platform compatibility.
---

Use this skill when the user chooses to add, configure or use advanced testing
for their game. Do not require this step to finish ordinary gameplay work.
Preserve the game design and basic runtime contract. An investigation is read-only.

1. Read [AGENTS.md](../../../AGENTS.md), the current game and its tests, and the
   [testing integration reference](../../../docs/GAME_TESTING.md). Inspect existing
   engine/adapter wiring before changing anything; a downloaded starter already
   provides it, so only register/configure the game's missing fields and behavior.
2. Identify the authoritative variables, mutable collections, timers, randomness,
   external inputs and effects needed for complete snapshots. For an engine-based
   game, extend schemas/initializers and bounded inspector metadata. For another
   compatible implementation, use the reference's adoption path; do not claim
   rewind works by attaching a panel to incomplete snapshots. Explain substantial
   state-model changes before making them; do not rewrite unrelated gameplay.
3. Preserve the runtime command connection and real results while wiring the local
   development adapter. Keep debug access gated to the local session. Distinguish
   gameplay pause from debugger freeze and current config from staged starting config.
   Check queued input's terminal apply/reject/discard results, not only receipt.
4. Run corepack pnpm dev. Inspect the variable panel or run corepack pnpm exec
   gameinstance-dev status and corepack pnpm exec gameinstance-dev state. Use
   --help for input, patch and history operations.
   Reproduce with a fixed seed; freeze, edit a bounded field, seek and replay, then
   compare original/edited outcomes. Verify replay reproduces the expected gameplay,
   RNG and clock state, and that external effects do not repeat during replay.
5. If saved regression scenarios are requested or useful for the chosen testing
   work, capture a known-correct regression with corepack pnpm exec gameinstance-dev
   scenario record scenarios/<name>.scenario.json, or inspector Capture regression.
   Review expected state and run corepack pnpm test:scenarios. Each fixture needs
   meaningful assertions. Follow [scenario guidance](../../../scenarios/README.md)
   for strict identity checks and deliberate revision comparisons; never regenerate
   expectations just to hide a regression.
6. Run the game's tests, lint and build. Check the real local panel's edit bounds,
   frozen input completion, rewind range and branch behavior. If startup/transport
   changed, rerun local runtime compatibility checks too. Report exactly what was
   verified and any unsupported capabilities; synthetic inputs do not prove provider
   ingestion. Keep session credentials private and vendor SDK source unchanged.
