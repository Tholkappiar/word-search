import { describe, expect, it } from "vitest";
import type { RuntimeControlCommand } from "@repo/game-kit";
import { createGame } from "./game";

const scope = { streamId: "contract-stream", deploymentId: "contract-deployment", runtimeInstanceId: "contract-runtime" };
function command(type: string, payload: Record<string, unknown> = {}, commandId = type): RuntimeControlCommand {
  return { ...scope, commandId, type, payload, issuedBy: "test", issuedAt: "2026-10-03T00:00:00.000Z", requireAck: true };
}

// Keep these integration invariants when replacing blank-starter assertions.
// Add game-specific tests proving pause stops gameplay and reset clears world state;
// successful ACKs and runtime flags alone cannot establish those behaviors.
describe("authored game contract", () => {
  it("applies scoped pause/resume results without losing configuration", () => {
    const game = createGame(); const config = game.getState().runtime.config;
    for (const [type, paused] of [["pause", true], ["resume", false]] as const) {
      expect(game.dispatch(command(type))).toMatchObject({ status: "applied", result: { ...scope, commandId: type, status: "applied" } });
      expect(game.getState().runtime.paused).toBe(paused);
      expect(game.getState().runtime.config).toEqual(config);
    }
  });

  it("rejects unsupported commands and malformed events without changing gameplay", () => {
    const game = createGame();
    const { runtime: beforeRuntime, ...beforeWorld } = game.getState();
    for (const type of ["unsupported-contract-command", "injectChatEvent", "injectSubscriberEvent"]) {
      const receipt = game.dispatch(command(type));
      expect(receipt).toMatchObject({ status: "applied", result: { ...scope, commandId: type, status: "rejected" } });
    }
    const { runtime, ...world } = game.getState();
    expect(world).toEqual(beforeWorld);
    expect(runtime.config).toEqual(beforeRuntime.config);
  });

});
