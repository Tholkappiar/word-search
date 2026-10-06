import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import type { Cue } from "./cues";
import { createGame, LEVELS } from "./game";
import { Host, PRIORITY } from "./host";
import { spokenText } from "./lipsync";
import voiceLines from "./voice-lines.json";

const state = () => createGame().getState();
const find = (overrides: Partial<Extract<Cue, { kind: "find" }>> = {}): Cue =>
  ({ kind: "find", found: 1, total: 3, by: "Ava", word: "CAT", streak: 1, first: false, ...overrides });

describe("Sobo's lines", () => {
  it("has a unique, short, speakable line for every moment and level", () => {
    const groups = voiceLines as Record<string, { id: string; say: string; show?: string }[]>;
    for (let level = 1; level <= LEVELS.length; level++) expect(groups[`level_${level}`]?.length).toBeGreaterThan(0);
    for (const group of ["welcome", "level_more", "retry", "firstFind", "praise", "streak", "newLeader", "hint", "hurry", "clear", "timeUp", "idle", "gameOver", "stopped"]) {
      expect(groups[group]?.length, group).toBeGreaterThan(0);
    }
    const lines = Object.values(groups).flat();
    expect(new Set(lines.map(line => line.id)).size).toBe(lines.length);
    for (const line of lines) {
      expect(line.id).toMatch(/^[a-z0-9_]+$/);
      expect(spokenText(line.say).length).toBeLessThanOrEqual(90);
      // Eleven v3 audio tags: short lowercase directions in square brackets, none in the bubble text.
      for (const tag of line.say.match(/\[[^\]]*\]/g) ?? []) expect(tag).toMatch(/^\[[a-z ]+\]$/);
      expect(line.show ?? "").not.toMatch(/[[\]]/);
    }
    // Within the ElevenLabs free tier's monthly allowance, with room to regenerate.
    expect(lines.reduce((sum, line) => sum + line.say.length, 0)).toBeLessThan(5000);
  });
  it("only references voice clips that exist when any have been generated", () => {
    const lines = Object.values(voiceLines as Record<string, { id: string }[]>).flat();
    const generated = lines.filter(line => existsSync(`src/assets/voice/${line.id}.mp3`));
    expect(generated.length === 0 || generated.length === lines.length).toBe(true);
  });
});

describe("what Sobo says", () => {
  it("welcomes a new game, introduces each level, and cheers up a retry", () => {
    const host = new Host(() => 0);
    expect(host.respond([{ kind: "levelStart", level: 1, retry: false }], state())?.id).toMatch(/^welcome_/);
    const playing = createGame(); playing.dispatch({ commandId: "c", streamId: "l", deploymentId: "l", runtimeInstanceId: "l", issuedBy: "t", issuedAt: "2026-10-03T00:00:00.000Z",
      requireAck: true, type: "injectChatEvent", payload: { chatEvent: { eventId: "e", streamId: "l", receivedAt: "2026-10-03T00:00:00.000Z", author: { displayName: "Ava" }, message: { type: "text", text: playing.getState().world.words[0].word } } } });
    expect(host.respond([{ kind: "levelStart", level: 3, retry: false }], playing.getState())?.id).toBe("level_3");
    expect(host.respond([{ kind: "levelStart", level: 14, retry: false }], playing.getState())?.id).toBe("level_more");
    expect(host.respond([{ kind: "levelStart", level: 3, retry: true }], playing.getState())?.id).toMatch(/^retry_/);
  });
  it("picks the biggest moment when several happen at once, with names filled in", () => {
    const host = new Host(() => 0);
    expect(host.respond([find({ found: 3, total: 3 }), { kind: "levelClear", level: 2 }], state())).toMatchObject({ priority: PRIORITY.roundEnd });
    expect(host.respond([find(), { kind: "newLeader", name: "Ava", points: 7 }], state())?.text).toBe("New leader: Ava with 7 pts!");
    expect(host.respond([find({ streak: 3 })], state())?.text).toMatch(/Ava/);
    expect(host.respond([find({ first: true, by: "Ben" })], state())?.text).toBe("First word goes to Ben!");
    expect(host.respond([find()], state())?.priority).toBe(PRIORITY.praise);
    // The bubble never shows the voice's audio tags.
    for (let index = 0; index < 12; index++) expect(host.respond([find()], state())?.text).not.toMatch(/[[\]]/);
  });
  it("speaks up for the hint and the final ten seconds only", () => {
    const host = new Host(() => 0);
    expect(host.respond([{ kind: "hint" }], state())?.id).toMatch(/^hint_/);
    expect(host.respond([{ kind: "tick", secondsLeft: 10 }], state())?.id).toMatch(/^hurry_/);
    expect(host.respond([{ kind: "tick", secondsLeft: 9 }], state())).toBeUndefined();
  });
  it("names the champion at the end, or says goodbye after a manual stop", () => {
    const host = new Host(() => 0.99);
    const ended = createGame(); ended.dispatch({ commandId: "c", streamId: "l", deploymentId: "l", runtimeInstanceId: "l", issuedBy: "t", issuedAt: "2026-10-03T00:00:00.000Z",
      requireAck: true, type: "injectChatEvent", payload: { chatEvent: { eventId: "e", streamId: "l", receivedAt: "2026-10-03T00:00:00.000Z", author: { displayName: "Ava" }, message: { type: "text", text: ended.getState().world.words[0].word } } } });
    expect(host.respond([{ kind: "gameOver" }], ended.getState())?.text).toMatch(/Champion: Ava with 1 pts!/);
    const stopped = createGame(); stopped.dispatch({ commandId: "s", streamId: "l", deploymentId: "l", runtimeInstanceId: "l", issuedBy: "t", issuedAt: "2026-10-03T00:00:00.000Z",
      requireAck: true, type: "setConfig", payload: { game: { stopGame: true } } });
    expect(host.respond([{ kind: "gameOver" }], stopped.getState())?.id).toBe("stopped_1");
    // No champion yet: the spoken line is shown instead of a template with blanks.
    expect(host.respond([{ kind: "gameOver" }], state())?.text).not.toMatch(/\{|Champion: {2}/);
  });
  it("never repeats the same line twice in a row, and keeps praise from crowding the voice", () => {
    const host = new Host(() => 0);
    const ids = Array.from({ length: 6 }, () => host.respond([find()], state())!.id);
    for (let index = 1; index < ids.length; index++) expect(ids[index]).not.toBe(ids[index - 1]);
    expect(Host.mayChatter(PRIORITY.praise, 1000)).toBe(false);
    expect(Host.mayChatter(PRIORITY.praise, 5000)).toBe(true);
    expect(Host.mayChatter(PRIORITY.roundEnd, 0)).toBe(true);
  });
});
