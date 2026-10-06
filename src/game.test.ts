import { describe, expect, it } from "vitest";
import { runGameScenario } from "@bubbleportal/sdk/engine";
import { appearsInGrid, createGame, findMentionedWord, gameDefinition, initialConfig, LEVELS, levelSpec, MAX_PLAYERS, MAX_WORDS, wordCells } from "./game";
import { THEMES } from "./themes";

const TICKS_PER_SECOND = 60;
function command(type: string, payload: Record<string, unknown> = {}, commandId = type) {
  return { commandId, streamId: "local", deploymentId: "local", runtimeInstanceId: "local", issuedBy: "test",
    issuedAt: "2026-10-03T00:00:00.000Z", requireAck: true, type, payload };
}
function chatCommand(text: string, commandId = "chat", type: "text" | "superchat" = "text", displayName = "Player One") {
  return command("injectChatEvent", { chatEvent: { eventId: "chat-" + commandId, streamId: "local",
    receivedAt: "2026-10-03T00:00:00.000Z", author: { displayName }, message: { type, text } } }, commandId);
}
type Game = ReturnType<typeof createGame>;
function hidden(game: Game) { return game.getState().world.words.filter(word => !word.foundBy).map(word => word.word); }
let chatId = 0;
function clearBoard(game: Game, name = "Player One") {
  hidden(game).forEach(word => game.dispatch(chatCommand(word, `clear-${chatId++}`, "text", name)));
}
/** Plays forever instead of ending after the default final level. */
function endless(game: Game) { game.dispatch(command("setConfig", { game: { finalLevel: 0 } }, "endless")); return game; }
/** Clears levels until the given level is playing. */
function reachLevel(game: Game, level: number) {
  while (game.getState().world.level < level) { clearBoard(game); game.advance(initialConfig.celebrateSeconds * TICKS_PER_SECOND); }
}

describe("word search puzzles", () => {
  it("starts at level 1 with one 3-letter word reading left to right in a 3x3 grid", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = createGame({ seed }).getState();
      expect(world).toMatchObject({ level: 1, size: 3 });
      expect(world.words).toHaveLength(1);
      expect(world.words[0]).toMatchObject({ direction: 0 });
      expect(world.words[0].word).toHaveLength(3);
    }
  });
  it("builds every level's grid with its word count, lengths and directions, all reading correctly", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const game = endless(createGame({ seed }));
      for (let level = 1; level <= LEVELS.length + 2; level++) {
        reachLevel(game, level);
        const spec = levelSpec(level), { world } = game.getState();
        expect(world.level).toBe(level);
        expect(world.size).toBe(spec.size);
        expect(world.grid).toMatch(new RegExp(`^[A-Z]{${spec.size ** 2}}$`));
        expect(world.words).toHaveLength(spec.words);
        expect(new Set(world.words.map(word => word.word)).size).toBe(spec.words);
        for (const word of world.words) {
          expect(THEMES[world.themeIndex].words).toContain(word.word);
          expect(spec.lengths).toContain(word.word.length);
          expect(spec.directions).toContain(word.direction);
          const letters = wordCells(word).map(([row, column]) => {
            expect(Math.min(row, column)).toBeGreaterThanOrEqual(0); expect(Math.max(row, column)).toBeLessThan(spec.size);
            return world.grid[row * spec.size + column];
          });
          expect(letters.join("")).toBe(word.word);
        }
        // No other category word appears by accident, so nothing typed in chat is ignored unfairly.
        const words = new Set(world.words.map(word => word.word));
        for (const word of THEMES[world.themeIndex].words) expect(appearsInGrid(world.grid, world.size, word), `${word} level ${level} seed ${seed}`).toBe(words.has(word));
      }
    }
  }, 20_000);
  it("grows from small and simple to bigger grids, longer words and every direction", () => {
    for (let level = 2; level <= LEVELS.length; level++) {
      const [easier, harder] = [levelSpec(level - 1), levelSpec(level)];
      expect(harder.size).toBeGreaterThanOrEqual(easier.size);
      expect(harder.words).toBeGreaterThanOrEqual(easier.words);
      expect(harder.size * 10 + harder.words).toBeGreaterThan(easier.size * 10 + easier.words);
      expect(Math.min(...harder.lengths)).toBeGreaterThanOrEqual(Math.min(...easier.lengths));
      expect(harder.directions).toEqual(expect.arrayContaining([...easier.directions]));
    }
    expect(levelSpec(1)).toMatchObject({ size: 3, words: 1, lengths: [3] });
    expect(levelSpec(LEVELS.length)).toMatchObject({ size: 8, words: MAX_WORDS, lengths: [4], directions: [0, 1, 2, 3, 4, 5, 6, 7] });
    expect(levelSpec(50)).toBe(levelSpec(LEVELS.length));
    // Easy levels are worth less: points per word never drop as levels get harder.
    expect(LEVELS.map(spec => spec.points)).toEqual([1, 1, 1, 2, 2, 2, 3, 3, 4, 5]);
  });
  it("keeps category words short, everyday, and never nested inside each other", () => {
    for (const theme of THEMES) {
      expect(theme.words.filter(word => word.length === 3).length).toBeGreaterThanOrEqual(4);
      expect(theme.words.filter(word => word.length === 4).length).toBeGreaterThanOrEqual(MAX_WORDS + 2);
      for (const word of theme.words) {
        expect(word).toMatch(/^[A-Z]{3,4}$/);
        for (const other of theme.words) if (other !== word) expect(other.includes(word) || other.includes([...word].reverse().join("")), `${word} in ${other}`).toBe(false);
      }
    }
  });
  it("mostly places words reading forwards even when backwards is allowed", () => {
    let forwards = 0, total = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const game = createGame({ seed }); reachLevel(game, LEVELS.length);
      for (const word of game.getState().world.words) { total++; if (word.direction < 4) forwards++; }
    }
    expect(forwards / total).toBeGreaterThan(0.6);
    expect(forwards).toBeLessThan(total);
  });
  it("finds a hidden word anywhere in a chat message, as a whole word", () => {
    const { world } = createGame().getState(); const target = world.words[0].word;
    expect(findMentionedWord(world.words, `found ${target.toLowerCase()}!!`)?.word).toBe(target);
    expect(findMentionedWord(world.words, `${target}xyz`)).toBeUndefined();
    expect(findMentionedWord(world.words, "hello chat")).toBeUndefined();
  });
});

describe("word search gameplay", () => {
  it("starts level 1 with nothing found, a timer sized to the words and an empty leaderboard", () => {
    const game = createGame(); const { world, runtime } = game.getState();
    expect(runtime.config).toEqual(initialConfig);
    expect(world).toMatchObject({ level: 1, phase: "playing", phaseMs: 40_000, phaseMsLeft: 40_000, scores: [] });
    expect(world.words.every(word => word.foundBy === "" && word.foundAtMs === 0)).toBe(true);
  });
  it("credits the first finder with one point per letter and ignores repeats and chatter", () => {
    const game = createGame(); reachLevel(game, 2); game.advance(30);
    const target = hidden(game)[0];
    expect(game.dispatch(chatCommand("hello everyone", "talk"))).toMatchObject({ result: { status: "applied", chatCommands: [] } });
    expect(game.dispatch(chatCommand(`I see ${target.toLowerCase()}!`, "find", "superchat", "Finder"))).toMatchObject({ result: { status: "applied", chatCommands: ["find"] } });
    expect(game.dispatch(chatCommand(target, "late", "text", "Too Late"))).toMatchObject({ result: { chatCommands: [] } });
    const world = game.getState().world;
    const found = world.words.find(word => word.word === target)!;
    expect(found.foundBy).toBe("Finder"); expect(found.foundAtMs).toBeCloseTo(world.phaseAtMs + 500);
    expect(world.scores.find(entry => entry.name === "Finder")).toEqual({ name: "Finder", points: levelSpec(2).points });
    expect(world.phase).toBe("playing");
  });
  it("clearing a level celebrates, then starts the next level with a new theme and scores kept", () => {
    const game = createGame(); const first = game.getState().world;
    clearBoard(game);
    const total = first.words.length * levelSpec(1).points;
    expect(game.getState().world).toMatchObject({ level: 1, phase: "cleared", phaseMsLeft: 6_000, scores: [{ name: "Player One", points: total }] });
    game.advance(6 * TICKS_PER_SECOND - 1);
    expect(game.getState().world.phase).toBe("cleared");
    game.advance(1);
    const world = game.getState().world;
    expect(world).toMatchObject({ level: 2, size: 3, phase: "playing", phaseMs: 80_000, scores: [{ name: "Player One", points: total }] });
    expect(world.words).toHaveLength(2);
    expect(world.themeIndex).not.toBe(first.themeIndex);
    expect(world.words.every(word => word.foundBy === "")).toBe(true);
  });
  it("reveals missed words when time runs out, then replays the same level with new words", () => {
    const game = createGame(); reachLevel(game, 3);
    const before = game.getState().world;
    game.dispatch(chatCommand(hidden(game)[0], "one"));
    game.advance(before.phaseMs / 1000 * TICKS_PER_SECOND - 1);
    expect(game.getState().world.phase).toBe("playing");
    game.advance(1);
    expect(game.getState().world).toMatchObject({ phase: "timeout", level: 3, phaseMsLeft: 15_000 });
    expect(game.dispatch(chatCommand(hidden(game)[0], "too-late"))).toMatchObject({ result: { chatCommands: [] } });
    game.advance(15 * TICKS_PER_SECOND);
    const world = game.getState().world;
    expect(world).toMatchObject({ phase: "playing", level: 3, size: before.size });
    expect(world.themeIndex).not.toBe(before.themeIndex);
  });
  it("keeps the hardest level going past the last tier", () => {
    const game = endless(createGame()); reachLevel(game, LEVELS.length + 3);
    expect(game.getState().world).toMatchObject({ level: LEVELS.length + 3, size: 8 });
    expect(game.getState().world.words).toHaveLength(MAX_WORDS);
  });
  it("gives fewer points per word on easy levels and more on hard ones", () => {
    const game = endless(createGame());
    for (const level of [1, 4, 7, 10]) {
      reachLevel(game, level);
      const before = game.getState().world.scores.find(entry => entry.name === "Scorer")?.points ?? 0;
      game.dispatch(chatCommand(hidden(game)[0], `score-${level}`, "text", "Scorer"));
      expect(game.getState().world.scores.find(entry => entry.name === "Scorer")!.points - before).toBe(levelSpec(level).points);
    }
  });
  it("ends the game after clearing finalLevel and stays on the results until reset", () => {
    const game = createGame();
    expect(game.dispatch(command("setConfig", { game: { finalLevel: 2 } }))).toMatchObject({ result: { status: "applied" } });
    reachLevel(game, 2);
    clearBoard(game, "Winner");
    expect(game.getState().world).toMatchObject({ level: 2, phase: "cleared" });
    game.advance(6 * TICKS_PER_SECOND);
    const finished = game.getState().world;
    expect(finished).toMatchObject({ level: 2, phase: "finished" });
    expect(finished.scores[0].name).toBe("Winner");
    // Nothing moves on: no new level, and chat can no longer score.
    game.advance(120 * TICKS_PER_SECOND);
    expect(game.dispatch(chatCommand("CAT DOG", "after-end"))).toMatchObject({ result: { chatCommands: [] } });
    expect(game.getState().world).toMatchObject({ level: 2, phase: "finished", scores: finished.scores, words: finished.words });
    game.dispatch(command("resetGame"));
    expect(game.getState().world).toMatchObject({ level: 1, phase: "playing", scores: [] });
    expect(game.getState().runtime.config).toEqual(initialConfig);
  });
  it("ends at level 10 by default, and a timed-out final level is replayed rather than ending", () => {
    const game = createGame(); reachLevel(game, 10);
    game.advance(game.getState().world.phaseMs / 1000 * TICKS_PER_SECOND + 15 * TICKS_PER_SECOND);
    expect(game.getState().world).toMatchObject({ level: 10, phase: "playing" });
    clearBoard(game); game.advance(6 * TICKS_PER_SECOND);
    expect(game.getState().world).toMatchObject({ level: 10, phase: "finished" });
  });
  it("stopGame ends the game immediately, and turning it off starts a fresh game", () => {
    const game = createGame(); reachLevel(game, 3);
    game.dispatch(chatCommand(hidden(game)[0], "before-stop", "text", "Early Bird"));
    const before = game.getState().world;
    expect(game.dispatch(command("setConfig", { game: { stopGame: true } }, "stop"))).toMatchObject({ result: { status: "applied" } });
    const stopped = game.getState().world;
    expect(stopped).toMatchObject({ phase: "finished", level: 3, scores: before.scores, words: before.words });
    // Other config changes while stopped leave the results alone, and chat cannot score.
    game.dispatch(command("setConfig", { game: { secondsPerWord: 20 } }, "tweak"));
    game.advance(60 * TICKS_PER_SECOND);
    expect(game.dispatch(chatCommand(hidden(game)[0] ?? "CAT", "after-stop"))).toMatchObject({ result: { chatCommands: [] } });
    expect(game.getState().world).toMatchObject({ phase: "finished", level: 3, scores: before.scores });
    expect(game.dispatch(command("setConfig", { game: { stopGame: false } }, "restart"))).toMatchObject({ result: { status: "applied" } });
    expect(game.getState().world).toMatchObject({ phase: "playing", level: 1, scores: [], phaseMs: 20_000 });
  });
  it("starts on the results screen when the starting config is stopped", () => {
    const game = createGame(); game.setStartingConfig({ ...initialConfig, stopGame: true }); game.restart();
    expect(game.getState().world.phase).toBe("finished");
  });
  it("ranks players and keeps the leaderboard bounded", () => {
    const game = endless(createGame());
    game.dispatch(command("setConfig", { game: { celebrateSeconds: 3 } }));
    let championPoints = 0;
    // The champion finds every fifth word; everyone else finds one, overflowing the leaderboard.
    const finds = MAX_PLAYERS + 30;
    for (let index = 0; index < finds; index++) {
      if (hidden(game).length === 0) game.advance(3 * TICKS_PER_SECOND);
      const word = hidden(game)[0]; const name = index % 5 === 0 ? "Champion" : "Player " + index;
      if (name === "Champion") championPoints += levelSpec(game.getState().world.level).points;
      expect(game.dispatch(chatCommand(word, "find-" + index, "text", name))).toMatchObject({ result: { chatCommands: ["find"] } });
    }
    const scores = game.getState().world.scores;
    expect(scores).toHaveLength(MAX_PLAYERS);
    expect(scores[0]).toEqual({ name: "Champion", points: championPoints });
    expect(scores.map(entry => entry.name)).toContain("Player " + (finds - 1));
  });
  it("pause freezes the timer and ignores finds; resume continues", () => {
    const game = createGame(); game.advance(10); game.dispatch(command("pause"));
    const paused = game.getState().world;
    game.advance(600);
    expect(game.dispatch(chatCommand(hidden(game)[0]))).toMatchObject({ result: { status: "applied", chatCommands: [] } });
    expect(game.getState().world).toEqual(paused);
    game.dispatch(command("resume")); game.advance(1);
    expect(game.getState().world.phaseMsLeft).toBeLessThan(paused.phaseMsLeft);
    expect(game.getState().world.elapsedMs).toBeGreaterThan(paused.elapsedMs);
  });
  it("reset returns to level 1 with a fresh puzzle, clears scores and restores the default config", () => {
    const game = createGame();
    reachLevel(game, 4);
    game.dispatch(chatCommand(hidden(game)[0], "find"));
    game.dispatch(command("setConfig", { game: { secondsPerWord: 20 } }));
    game.dispatch(command("pause"));
    const before = game.getState().world;
    const tick = game.getSnapshot().tick;
    expect(before.level).toBe(4);
    expect(game.dispatch(command("resetGame"))).toMatchObject({ result: { status: "applied" } });
    const { runtime, world } = game.getState();
    expect(runtime).toMatchObject({ resetCount: 1, paused: false, config: initialConfig });
    expect(world).toMatchObject({ level: 1, size: 3, phase: "playing", phaseMsLeft: 40_000, phaseAtMs: 0, elapsedMs: 0, scores: [] });
    expect(world.words.every(word => word.foundBy === "" && word.foundAtMs === 0)).toBe(true);
    expect(game.getSnapshot().tick).toBe(tick); // A command reset is not an engine restart.
  });
  it("applies valid config from the next round and rejects invalid config without changes", () => {
    const game = createGame();
    expect(game.dispatch(command("setConfig", { game: { secondsPerWord: 20, celebrateSeconds: 4 } }))).toMatchObject({ result: { status: "applied" } });
    expect(game.getState().world.phaseMsLeft).toBe(40_000);
    clearBoard(game);
    expect(game.getState().world.phaseMsLeft).toBe(4_000);
    game.advance(4 * TICKS_PER_SECOND);
    expect(game.getState().world).toMatchObject({ level: 2, phaseMsLeft: 40_000 });
    const original = game.getState();
    for (const patch of [{ secondsPerWord: 5 }, { celebrateSeconds: 0 }, { revealSeconds: 60 }, { secondsPerWord: 30.5 }, { finalLevel: -1 }, { finalLevel: 51 }, { stopGame: "yes" }, { unregistered: true }]) {
      expect(() => game.dispatch(command("setConfig", { game: patch }))).toThrow();
      expect(game.getState()).toEqual(original);
    }
    expect(() => game.setStartingConfig({ ...initialConfig, unregistered: true })).toThrow();
    expect(game.getStartingConfig()).toEqual(initialConfig);
  });
  it("acknowledges shared controls with scoped results", () => {
    const game = createGame();
    for (const [type, key, value] of [["pause", "paused", true], ["resume", "paused", false], ["hideOverlay", "overlayVisible", false], ["showOverlay", "overlayVisible", true]] as const) {
      expect(game.dispatch(command(type))).toMatchObject({ status: "applied", result: { commandId: type, streamId: "local", deploymentId: "local", runtimeInstanceId: "local", status: "applied" } });
      expect(game.getState().runtime[key]).toBe(value);
    }
    const original = createGame().getState();
    game.dispatch(chatCommand("hello")); game.setStartingConfig(initialConfig); game.restart();
    expect(game.getState()).toEqual(original);
  });
  it("consumes unused subscriber and paid-message celebrations even while paused", () => {
    const game = createGame(); game.dispatch(command("pause"));
    for (let index = 0; index < 20; index++) {
      expect(game.dispatch(chatCommand("hello", "paid-" + index, "superchat"))).toMatchObject({ result: { status: "applied" } });
      expect(game.dispatch(command("injectSubscriberEvent", { subscriberEvent: { eventId: "sub-" + index, streamId: "local",
        youtubeAccountId: "local-account", subscriberDisplayName: "Player Two", receivedAt: "2026-10-03T00:00:00.000Z" } }, "sub-" + index))).toMatchObject({ result: { status: "applied" } });
      expect(game.getState().runtime.celebrationQueue).toEqual([]);
    }
    expect(game.getState().runtime.latestSubscriberMessage).toBe("Player Two subscribed");
    expect(game.getState().runtime.paused).toBe(true);
  });
  it("rejects unsupported commands and malformed events without gameplay or RNG changes", () => {
    const game = createGame(); const before = game.getSnapshot();
    for (const type of ["unsupported", "injectChatEvent", "injectSubscriberEvent", "reload"]) {
      expect(game.dispatch(command(type))).toMatchObject({ status: "applied", result: { commandId: type, status: "rejected" } });
    }
    expect(game.getState().world).toEqual(before.state.world);
    expect(game.getSnapshot().rngState).toBe(before.rngState);
    expect(game.getState().runtime.celebrationQueue).toEqual([]);
  });
  it("queues frozen input, reports its terminal ACK, and replays captures deterministically", () => {
    const game = createGame(); reachLevel(game, 2); const completions: unknown[] = [];
    game.subscribePendingResults(result => completions.push(result));
    game.advance(10); game.freeze();
    const [first, second] = hidden(game);
    const start = game.getSnapshot().tick;
    expect(game.dispatch(chatCommand(first))).toMatchObject({ status: "queued" });
    expect(hidden(game)).toContain(first);
    game.resume({ pending: "apply" });
    expect(completions).toMatchObject([{ status: "applied", result: { commandId: "chat", status: "applied", chatCommands: ["find"] } }]);
    game.advance(10); game.dispatch(chatCommand(second, "second-chat", "text", "Player Two")); game.advance(10);
    const expected = game.getState(); game.freeze(); game.seek(start + 5);
    expect(hidden(game)).toContain(second);
    game.replay(start + 20); expect(game.getState()).toEqual(expected);
    expect(runGameScenario(gameDefinition, game.exportScenario({ regression: true })).passed).toBe(true);
  });
});
