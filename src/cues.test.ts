import { describe, expect, it } from "vitest";
import { detectCues, type Cue } from "./cues";
import { createGame } from "./game";

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
/** Every cue heard while acting and then running some ticks, comparing frame by frame like the app does. */
function listen(game: Game, act: () => void, ticks = 0): Cue[] {
  const cues: Cue[] = []; let previous = game.getState();
  const hear = () => { const next = game.getState(); cues.push(...detectCues(previous, next)); previous = next; };
  act(); hear();
  for (let tick = 0; tick < ticks; tick++) { game.advance(1); hear(); }
  return cues;
}
function clear(game: Game) { for (const word of game.getState().world.words) if (!word.foundBy) game.dispatch(chat(word.word)); }

describe("sound cues", () => {
  it("announces a level when the game first appears, and nothing else", () => {
    expect(detectCues(undefined, createGame().getState())).toEqual([{ kind: "levelStart", level: 1, retry: false }]);
    const game = createGame();
    expect(listen(game, () => undefined, 60)).toEqual([]);
  });
  it("chimes each find with its count so streaks climb, then celebrates the clear", () => {
    const game = createGame(); clear(game); game.advance(6 * 60);
    const words = game.getState().world.words;
    expect(listen(game, () => game.dispatch(chat(words[0].word)))).toEqual([{ kind: "find", found: 1, total: 2, by: "Player One", word: words[0].word, streak: 1, first: false }]);
    expect(listen(game, () => game.dispatch(chat(words[1].word)))).toEqual([{ kind: "find", found: 2, total: 2, by: "Player One", word: words[1].word, streak: 2, first: false },
      { kind: "levelClear", level: 2 }]);
    expect(listen(game, () => undefined, 6 * 60)).toEqual([{ kind: "levelStart", level: 3, retry: false }]);
  });
  it("reports the first find of the game, streaks broken by another player, and a new leader", () => {
    const fresh = createGame();
    const [first] = fresh.getState().world.words;
    expect(listen(fresh, () => fresh.dispatch(chat(first.word, "Ava")))).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "find", by: "Ava", first: true, streak: 1 })]));
    // Level 2 has two words: Ben scores twice and overtakes Ava, who scored once on level 1.
    const opener = createGame(); opener.dispatch(chat(opener.getState().world.words[0].word, "Ava")); opener.advance(6 * 60);
    const [one, two] = opener.getState().world.words;
    expect(listen(opener, () => opener.dispatch(chat(one.word, "Ben")))).toEqual([expect.objectContaining({ kind: "find", by: "Ben", streak: 1, first: false })]);
    const cues = listen(opener, () => opener.dispatch(chat(two.word, "Ben")));
    expect(cues).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "find", by: "Ben", streak: 2 }), { kind: "newLeader", name: "Ben", points: 2 }]));
  });
  it("announces the hint once, when the last 40% of the round begins", () => {
    const game = createGame();
    const cues = listen(game, () => undefined, 30 * 60);
    expect(cues.filter(cue => cue.kind === "hint")).toHaveLength(1);
  });
  it("marks a level replayed after time ran out as a retry", () => {
    const game = createGame(); game.advance(40 * 60 + 60);
    expect(listen(game, () => undefined, 15 * 60)).toEqual([{ kind: "levelStart", level: 1, retry: true }]);
  });
  it("ticks once per second over the last ten seconds, then sounds time up", () => {
    const game = createGame(); game.advance(25 * 60);
    const cues = listen(game, () => undefined, 15 * 60 + 30);
    expect(cues.filter(cue => cue.kind === "tick").map(cue => cue.kind === "tick" && cue.secondsLeft)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
    expect(cues.at(-1)).toEqual({ kind: "timeUp" });
  });
  it("plays the fanfare when the game ends, by final level or manual stop", () => {
    const ended = createGame();
    ended.dispatch(command("setConfig", { game: { finalLevel: 1 } }));
    clear(ended);
    expect(listen(ended, () => undefined, 6 * 60)).toEqual([{ kind: "gameOver" }]);
    const stopped = createGame();
    expect(listen(stopped, () => stopped.dispatch(command("setConfig", { game: { stopGame: true } })))).toEqual([{ kind: "gameOver" }]);
    expect(listen(stopped, () => stopped.dispatch(command("setConfig", { game: { stopGame: false } })))).toEqual([{ kind: "levelStart", level: 1, retry: false }]);
  });
  it("stays quiet while paused and after a rewind", () => {
    const game = createGame(); game.dispatch(command("pause"));
    expect(listen(game, () => game.dispatch(chat(game.getState().world.words[0].word)), 60 * 60)).toEqual([]);
    const later = createGame(); later.advance(600);
    const rewound = createGame().getState();
    expect(detectCues(later.getState(), rewound)).toEqual([{ kind: "levelStart", level: 1, retry: false }]);
  });
});
