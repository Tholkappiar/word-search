# Captured regression tests

Files matching **/*.scenario.json run automatically as individual tests in
src/scenarios.test.ts. Run corepack pnpm test:scenarios for only these tests or
corepack pnpm test for all game tests. No browser, server or stream is needed.
Until you save a fixture, the scenario suite is visibly skipped.

1. Run the game locally and reproduce behavior that should remain stable.
2. Check that the observed behavior is correct, then freeze at the desired point.
3. Run corepack pnpm exec gameinstance-dev scenario record
   scenarios/my-behavior.scenario.json. Alternatively use inspector Capture
   regression, Download JSON, and save with the .scenario.json suffix here.
4. Run corepack pnpm test:scenarios, review the capture and commit it with the
   game change. Do not regenerate expectations only to silence a regression.

Capture regression preserves retained history up to the selected tick/input
cursor and adds a hash assertion for the complete state at that point. The
rolling history may start partway through a session; use a separate test for
behavior before that starting snapshot. Queued inputs that have not applied are
not captured. Browser rendering and transport need their own integration checks.

Each fixture must have at least one assertion. You can replace the complete-state
hash with targeted equals, closeTo, between or hash assertions using registered
state paths. For example, an assertion { "tick": 120, "path": "runtime.paused",
"kind": "equals", "value": true } checks a specific behavior. Tick values must
fall within the capture's initialSnapshot.tick through endTick. The empty path
means the complete state. Failure output names the fixture, tick, path, expected
value and actual value (or actual hash).

Game ID, schemaVersion and simulationRevision must match the current definition.
When simulation behavior changes, increment simulationRevision. To deliberately
compare a compatible old fixture with the new revision, review its assertions
and wrap that fixture as:

```json
{
  "scenario": { "...": "the complete, unchanged capture goes here" },
  "allowRevisionMismatch": true
}
```

The wrapper applies only to that fixture and only permits a simulation revision
mismatch. Game and schema checks remain strict. Record a new fixture for an
incompatible schema; never silently rewrite capture identity. Fixtures are
reviewable game data and may contain simulated chat text: remove private input
before committing them.
