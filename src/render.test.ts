import { describe, expect, it } from "vitest";
import { createGame } from "./game";
import { renderGame } from "./render";
import { THEMES } from "./themes";

// The puzzle grid must sit inside the 25%-60% band of the 1920px-tall stream.
const PUZZLE_TOP = 1920 * 0.25, PUZZLE_BOTTOM = 1920 * 0.6;
function fakeContext() {
  const texts: { value: string; y: number }[] = [];
  const gradient = { addColorStop() {} };
  // Track translate() so text drawn inside transformed groups reports its real height.
  let offsetY = 0; const stack: number[] = [];
  const target: Record<string, unknown> = {
    canvas: { width: 1080, height: 1920 },
    createLinearGradient: () => gradient, createRadialGradient: () => gradient,
    measureText: (value: string) => ({ width: value.length * 20 }),
    save: () => stack.push(offsetY), restore: () => { offsetY = stack.pop() ?? 0; },
    translate: (_x: number, y: number) => { offsetY += y; },
    fillText: (value: string, _x: number, y: number) => texts.push({ value, y: y + offsetY })
  };
  const context = new Proxy(target, { get: (object, key: string) => key in object ? object[key] : () => {}, set: () => true });
  return { context: context as unknown as CanvasRenderingContext2D, texts };
}
function command(type: string, payload: Record<string, unknown> = {}, commandId = type) {
  return { commandId, streamId: "local", deploymentId: "local", runtimeInstanceId: "local", issuedBy: "test",
    issuedAt: "2026-10-03T00:00:00.000Z", requireAck: true, type, payload };
}
function chat(text: string, displayName = "Player One") {
  return command("injectChatEvent", { chatEvent: { eventId: "chat-" + text, streamId: "local", receivedAt: "2026-10-03T00:00:00.000Z",
    author: { displayName }, message: { type: "text", text } } }, "chat-" + text);
}
function draw(state: ReturnType<ReturnType<typeof createGame>["getState"]>) {
  const { context, texts } = fakeContext(); renderGame(context, state); return texts;
}
function values(texts: { value: string }[]) { return texts.map(entry => entry.value); }

describe("enchanted forest rendering", () => {
  it("draws the full grid in the 25-60% band with the title, chapter, counter and timer above it", () => {
    const game = createGame(); const state = game.getState(); const original = structuredClone(state);
    const texts = draw(state);
    const header = ["Enchanted Words", `Find 10 ${THEMES[state.world.themeIndex].label} · Round 1`, "0/10", "5:00"];
    expect(values(texts)).toEqual(expect.arrayContaining(header));
    const letters = texts.filter(entry => /^[A-Z]$/.test(entry.value));
    expect(letters).toHaveLength(144);
    for (const entry of letters) { expect(entry.y).toBeGreaterThan(PUZZLE_TOP); expect(entry.y).toBeLessThan(PUZZLE_BOTTOM); }
    const gridTop = Math.min(...letters.map(entry => entry.y));
    for (const entry of texts.filter(item => header.includes(item.value))) expect(entry.y).toBeLessThan(gridTop);
    expect(state).toEqual(original);
  });
  it("never shows a word list or leaderboard, so unfound words stay secret", () => {
    const game = createGame(); const state = game.getState();
    const texts = values(draw(state));
    for (const word of state.world.words) expect(texts).not.toContain(word.word);
    expect(texts.join(" ")).not.toMatch(/LEADERBOARD|pts/);
  });
  it("announces who found a word, and only that word", () => {
    const game = createGame(); const [word, ...others] = game.getState().world.words.map(entry => entry.word);
    game.dispatch(chat(word, "Wordsmith")); game.advance(30);
    const texts = values(draw(game.getState()));
    expect(texts).toEqual(expect.arrayContaining(["1/10", "Wordsmith", "found", word]));
    for (const other of others) expect(texts).not.toContain(other);
  });
  it("shows the round result above the grid when every word is found", () => {
    const game = createGame();
    for (const word of game.getState().world.words) game.dispatch(chat(word.word, "Solver"));
    game.advance(30);
    const total = game.getState().world.words.reduce((sum, word) => sum + word.word.length, 0);
    const texts = draw(game.getState());
    const gridTop = Math.min(...texts.filter(entry => /^[A-Z]$/.test(entry.value)).map(entry => entry.y));
    const result = texts.filter(entry => ["All Words Found!", `Top finder: Solver  +${total}`, "Next round in 15s"].includes(entry.value));
    expect(result).toHaveLength(3);
    for (const entry of result) expect(entry.y).toBeLessThan(gridTop);
  });
  it("on time up lists the missed words above the grid, and draws a paused overlay", () => {
    const game = createGame(); const [first, ...rest] = game.getState().world.words.map(word => word.word);
    game.dispatch(chat(first, "Finder")); game.advance(300 * 60);
    const texts = draw(game.getState());
    expect(values(texts)).toEqual(expect.arrayContaining(["The Candle Burns Out", "Time's up · 1 of 10 words found", "You missed (shown in red):"]));
    const gridTop = Math.min(...texts.filter(entry => /^[A-Z]$/.test(entry.value)).map(entry => entry.y));
    const missedLines = texts.filter(entry => entry.y < gridTop && rest.some(word => entry.value.split("  ·  ").includes(word)));
    expect(missedLines.flatMap(entry => entry.value.split("  ·  ")).sort()).toEqual([...rest].sort());
    game.dispatch(command("pause"));
    expect(values(draw(game.getState()))).toContain("Paused");
  });
});
