import { describe, it } from "vitest";
import { canonicalGameStateHash, runGameScenario, type GameScenario } from "@bubbleportal/sdk/engine";
import { gameDefinition } from "./game";

type Scenario = GameScenario<ReturnType<typeof gameDefinition.createInitialState>, typeof gameDefinition.initialConfig, Parameters<typeof gameDefinition.applyCommand>[1]>;
const fixtures = import.meta.glob<unknown>("../scenarios/**/*.scenario.json", { eager: true, import: "default" });
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseFixture(raw: unknown): { scenario: Scenario; allowRevisionMismatch: boolean } {
  let scenario = raw;
  let allowRevisionMismatch = false;
  if (isObject(raw) && "scenario" in raw) {
    const unexpected = Object.keys(raw).filter(key => key !== "scenario" && key !== "allowRevisionMismatch");
    if (unexpected.length || (raw.allowRevisionMismatch !== undefined && typeof raw.allowRevisionMismatch !== "boolean")) {
      throw new Error("Fixture wrapper supports only scenario and optional boolean allowRevisionMismatch");
    }
    scenario = raw.scenario;
    allowRevisionMismatch = raw.allowRevisionMismatch === true;
  }
  if (!isObject(scenario) || !Array.isArray(scenario.assertions) || scenario.assertions.length === 0) {
    throw new Error("Regression fixture needs at least one assertion. Use Capture regression or bubbleportal scenario record.");
  }
  // The engine validates the full capture, game/schema identity and revision.
  return { scenario: scenario as Scenario, allowRevisionMismatch };
}

describe("captured game regressions", () => {
  const entries = Object.entries(fixtures).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) {
    it.skip("No captured regressions: save scenarios/<name>.scenario.json with Capture regression or scenario record", () => {});
  }
  for (const [file, raw] of entries) {
    it(file.replace(/^\.\.\//, ""), () => {
      try {
        const { scenario, allowRevisionMismatch } = parseFixture(raw);
        const outcome = runGameScenario(gameDefinition, scenario, { allowRevisionMismatch });
        const failures = outcome.assertions.filter(result => !result.passed).map(result => {
          const assertion = result.assertion;
          const expected = assertion.kind === "between" ? { min: assertion.min, max: assertion.max }
            : assertion.kind === "closeTo" ? { value: assertion.value, tolerance: assertion.tolerance } : assertion.value;
          const actual = assertion.kind === "hash" && result.actual !== undefined ? canonicalGameStateHash(result.actual) : result.actual;
          return "tick " + assertion.tick + " path " + JSON.stringify(assertion.path || "<root>") + " (" + assertion.kind + ")"
            + "\n  expected: " + JSON.stringify(expected) + "\n  actual: " + JSON.stringify(actual)
            + (result.error ? "\n  error: " + result.error : "");
        });
        if (failures.length) throw new Error("Regression assertions failed:\n" + failures.join("\n"));
      } catch (error) {
        throw new Error(file + ": " + (error instanceof Error ? error.message : String(error)), { cause: error });
      }
    });
  }
});
