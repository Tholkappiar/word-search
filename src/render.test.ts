import { describe, expect, it } from "vitest";
import { createGame, LEVELS, levelSpec } from "./game";
import { gridLayout, renderGame } from "./render";
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
let chatId = 0;
function chat(text: string, displayName = "Player One") {
  const id = `chat-${chatId++}`;
  return command("injectChatEvent", { chatEvent: { eventId: id, streamId: "local", receivedAt: "2026-10-03T00:00:00.000Z",
    author: { displayName }, message: { type: "text", text } } }, id);
}
type Game = ReturnType<typeof createGame>;
function draw(state: ReturnType<Game["getState"]>) {
  const { context, texts } = fakeContext(); renderGame(context, state); return texts;
}
function values(texts: { value: string }[]) { return texts.map(entry => entry.value); }
function clearLevel(game: Game, name = "Player One") {
  for (const word of game.getState().world.words) if (!word.foundBy) game.dispatch(chat(word.word, name));
}
function reachLevel(game: Game, level: number) {
  while (game.getState().world.level < level) { clearLevel(game); game.advance(6 * 60); }
}
/** Letters on the tiles: drawn above the slot row. */
function tileLetters(texts: { value: string; y: number }[]) { return texts.filter(entry => /^[A-Z]$/.test(entry.value) && entry.y < 1030); }
/** Letters in the hidden-word slots, between the tiles and the bottom of the page. */
function slotLetters(texts: { value: string; y: number }[]) { return texts.filter(entry => entry.y > 1030 && entry.y < 1216).map(entry => entry.value).join(""); }

describe("enchanted forest rendering", () => {
  it("explains the game at a glance: level, task, how to answer, timer, and the tiles in the 25-60% band", () => {
    const game = createGame(); game.advance(120);
    const state = game.getState(); const original = structuredClone(state);
    const texts = draw(state);
    const header = ["Enchanted Words", `Find 1 ${THEMES[state.world.themeIndex].one}`, "Type the words you see in chat!", "Words go", "0:38"];
    expect(values(texts)).toEqual(expect.arrayContaining(header));
    const letters = tileLetters(texts);
    expect(letters).toHaveLength(9);
    for (const entry of letters) { expect(entry.y).toBeGreaterThan(PUZZLE_TOP); expect(entry.y).toBeLessThan(PUZZLE_BOTTOM); }
    const gridTop = Math.min(...letters.map(entry => entry.y));
    for (const entry of texts.filter(item => header.slice(0, 3).includes(item.value))) expect(entry.y).toBeLessThan(gridTop);
    // The level badge sits below the board, out of the way.
    const level = texts.find(entry => entry.value === "LEVEL 1")!;
    expect(level.y).toBeGreaterThan(Math.max(...texts.filter(entry => /^[A-Z]$/.test(entry.value)).map(entry => entry.y)));
    expect(state).toEqual(original);
  });
  it("keeps every level's grid inside the 25-60% band", () => {
    for (let level = 1; level <= LEVELS.length; level++) {
      const { tile, y } = gridLayout(levelSpec(level).size);
      expect(y).toBeGreaterThan(PUZZLE_TOP); expect(y + tile * levelSpec(level).size).toBeLessThan(PUZZLE_BOTTOM);
    }
  });
  it("zooms in the level number as a level starts, then drops the tiles in", () => {
    const game = createGame(); game.advance(30);
    expect(values(draw(game.getState()))).toEqual(expect.arrayContaining(["Level 1", "Let's start easy!"]));
    game.advance(120);
    expect(values(draw(game.getState()))).not.toContain("Level 1");
  });
  it("never shows unfound words, only empty slots", () => {
    const game = createGame(); reachLevel(game, 4); game.advance(120);
    const { world } = game.getState();
    const texts = draw(game.getState());
    for (const word of world.words) expect(values(texts)).not.toContain(word.word);
    expect(tileLetters(texts)).toHaveLength(world.size ** 2);
    expect(slotLetters(texts)).toBe("");
  });
  it("puts the finder's name in the spotlight with the word, points, and the word filling its slot", () => {
    const game = createGame(); reachLevel(game, 2); game.advance(120);
    const [word, other] = game.getState().world.words.map(entry => entry.word);
    game.dispatch(chat(word, "Wordsmith")); game.advance(60);
    const texts = draw(game.getState());
    expect(values(texts)).toEqual(expect.arrayContaining(["Wordsmith", `found ${word}!`, `+${levelSpec(2).points}`]));
    // The spotlight takes the task's place on the sky, then gives it back.
    expect(values(texts)).not.toContain("Type the words you see in chat!");
    game.advance(4 * 60);
    expect(values(draw(game.getState()))).toEqual(expect.arrayContaining(["Type the words you see in chat!"]));
    expect(values(draw(game.getState()))).not.toContain("Wordsmith");
    expect(values(texts)).not.toContain(other);
    expect(slotLetters(texts)).toBe(word);
  });
  it("shows a hint late in the round", () => {
    const game = createGame(); game.advance(25 * 60);
    expect(values(draw(game.getState()))).toContain("Hint: words start at the glowing letters!");
  });
  it("shows the level-complete result above the grid when every word is found", () => {
    const game = createGame(); game.advance(120);
    clearLevel(game, "Solver"); game.advance(30);
    expect(values(draw(game.getState()))).toContain("Solver"); // The last finder gets the spotlight first.
    game.advance(120);
    const total = game.getState().world.words.length * levelSpec(1).points;
    const texts = draw(game.getState());
    const gridTop = Math.min(...tileLetters(texts).map(entry => entry.y));
    const result = texts.filter(entry => ["Level 1 Complete!", "Solo clear by Solver!", `Top finder: Solver  +${total}`, "Level 2 starts in 4s"].includes(entry.value));
    expect(result).toHaveLength(4);
    expect(values(texts)).not.toContain("Great teamwork, chat!");
    // Two finders in one round: that is teamwork.
    game.advance(6 * 60);
    const [first, second] = game.getState().world.words;
    game.dispatch(chat(first.word, "Ava")); game.dispatch(chat(second.word, "Ben")); game.advance(150);
    expect(values(draw(game.getState()))).toEqual(expect.arrayContaining(["Level 2 Complete!", "Great teamwork, chat!"]));
    for (const entry of result) expect(entry.y).toBeLessThan(gridTop);
  });
  it("shows a top-5 leaderboard below the board at the end of each round, with this round's gains", () => {
    const game = createGame(); game.advance(120);
    // Seven players score across two levels; only the top five are listed, highest first.
    const players = ["Ava", "Ben", "Cleo", "Dev", "Eli", "Fay", "Gus"];
    let index = 0;
    while (game.getState().world.level < 4) {
      for (const word of game.getState().world.words) game.dispatch(chat(word.word, players[index++ % players.length]));
      game.advance(6 * 60);
    }
    game.advance(120);
    expect(values(draw(game.getState()))).not.toContain("LEADERBOARD"); // Hidden while playing.
    const round = game.getState().world.words;
    for (const word of round) game.dispatch(chat(word.word, "Ava"));
    game.advance(200); // After the spotlight, once every row has slid in.
    const { scores } = game.getState().world;
    const texts = draw(game.getState());
    const board = texts.find(entry => entry.value === "LEADERBOARD")!;
    const gridBottom = Math.max(...tileLetters(texts).map(entry => entry.y));
    expect(board.y).toBeGreaterThan(gridBottom);
    expect(values(texts)).not.toContain("LEVEL 4"); // The leaderboard takes the badge's place.
    const listed = texts.filter(entry => entry.y > board.y && scores.some(score => score.name === entry.value));
    expect(listed.map(entry => entry.value)).toEqual(scores.slice(0, 5).map(score => score.name));
    expect(values(texts)).toEqual(expect.arrayContaining([String(scores[0].points), `+${round.length * levelSpec(4).points}`]));
  });
  it("swaps the board for a winner podium and final leaderboard when the game ends", () => {
    const game = createGame();
    game.dispatch(command("setConfig", { game: { finalLevel: 2 } }));
    clearLevel(game, "Ava"); game.advance(6 * 60);
    const [first, second] = game.getState().world.words;
    game.dispatch(chat(first.word, "Ben")); game.dispatch(chat(second.word, "Ben"));
    game.advance(6 * 60);
    expect(game.getState().world.phase).toBe("finished");
    game.advance(3 * 60); // Podium blocks have risen.
    const texts = values(draw(game.getState()));
    expect(texts).toEqual(expect.arrayContaining(["Game Complete!", "Champion: Ben · 2 pts", "CHAMPIONS", "FINAL LEADERBOARD", "Ben", "Ava", "2 pts", "1 pts"]));
    expect(texts.filter(value => /^[A-Z]$/.test(value)).length).toBeLessThan(5); // No letter grid, only podium initials and ranks.
  });
  it("says Game Over with the level reached when stopped manually", () => {
    const game = createGame(); reachLevel(game, 2);
    game.dispatch(chat(game.getState().world.words[0].word, "Ava"));
    game.dispatch(command("setConfig", { game: { stopGame: true } }));
    game.advance(3 * 60);
    expect(values(draw(game.getState()))).toEqual(expect.arrayContaining(["Game Over!", "You reached level 2. Thanks for playing, chat!", "CHAMPIONS", "FINAL LEADERBOARD"]));
  });
  it("on time up lists the missed words above the grid and in the slots, and draws a paused overlay", () => {
    const game = createGame(); reachLevel(game, 3);
    const [first, ...rest] = game.getState().world.words.map(word => word.word);
    game.dispatch(chat(first, "Finder")); game.advance(game.getState().world.phaseMs / 1000 * 60 + 60);
    const texts = draw(game.getState());
    expect(values(texts)).toEqual(expect.arrayContaining(["Time's Up!", `You found 1 of ${rest.length + 1} · missed words in red`,
      `Missed: ${rest.join("  ·  ")}`, "Try level 3 again in 14s"]));
    expect(slotLetters(texts)).toBe([first, ...rest].join(""));
    game.dispatch(command("pause"));
    expect(values(draw(game.getState()))).toContain("Paused");
  });
});
