import { describe, expect, it } from "vitest";
import { runGameScenario } from "@bubbleportal/sdk/engine";
import { appearsInGrid, createGame, DIRECTIONS, findMentionedWord, gameDefinition, GRID_SIZE, initialConfig, MAX_PLAYERS, wordCells, WORDS_PER_ROUND } from "./game";
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
function clearBoard(game: Game, name = "Player One") {
  hidden(game).forEach((word, index) => game.dispatch(chatCommand(word, `clear-${game.getState().world.round}-${index}`, "text", name)));
}

describe("word search puzzles", () => {
  it("hides ten distinct theme words that read correctly in the grid", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { world } = createGame({ seed }).getState();
      expect(world.grid).toMatch(new RegExp(`^[A-Z]{${GRID_SIZE * GRID_SIZE}}$`));
      expect(world.words).toHaveLength(WORDS_PER_ROUND);
      expect(new Set(world.words.map(word => word.word)).size).toBe(WORDS_PER_ROUND);
      for (const word of world.words) {
        expect(THEMES[world.themeIndex].words).toContain(word.word);
        const letters = wordCells(word).map(([row, column]) => {
          expect(row).toBeGreaterThanOrEqual(0); expect(row).toBeLessThan(GRID_SIZE);
          expect(column).toBeGreaterThanOrEqual(0); expect(column).toBeLessThan(GRID_SIZE);
          return world.grid[row * GRID_SIZE + column];
        });
        expect(letters.join("")).toBe(word.word);
      }
    }
  });
  it("uses all eight directions across puzzles, including backwards words", () => {
    const used = new Set<number>();
    for (let seed = 1; seed <= 25; seed++) for (const word of createGame({ seed }).getState().world.words) used.add(word.direction);
    expect([...used].sort()).toEqual(DIRECTIONS.map((_, index) => index));
  });
  it("keeps category words simple and never nested inside each other", () => {
    for (const theme of THEMES) {
      expect(theme.words.length).toBeGreaterThan(WORDS_PER_ROUND + 4);
      for (const word of theme.words) {
        expect(word).toMatch(/^[A-Z]{4,8}$/);
        for (const other of theme.words) if (other !== word) expect(other.includes(word) || other.includes([...word].reverse().join("")), `${word} in ${other}`).toBe(false);
      }
    }
  });
  it("never shows a category word by accident that is not one of the hidden words", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { world } = createGame({ seed }).getState();
      const hidden = new Set(world.words.map(word => word.word));
      for (const word of THEMES[world.themeIndex].words) if (!hidden.has(word)) expect(appearsInGrid(world.grid, word), `${word} (seed ${seed})`).toBe(false);
      for (const word of world.words) expect(appearsInGrid(world.grid, word.word)).toBe(true);
    }
  });
  it("mostly places words reading forwards", () => {
    let forwards = 0, total = 0;
    for (let seed = 1; seed <= 40; seed++) for (const word of createGame({ seed }).getState().world.words) { total++; if (word.direction < 4) forwards++; }
    expect(forwards / total).toBeGreaterThan(0.6);
  });
  it("finds a hidden word anywhere in a chat message, as a whole word", () => {
    const { world } = createGame().getState(); const target = world.words[0].word;
    expect(findMentionedWord(world.words, `found ${target.toLowerCase()}!!`)?.word).toBe(target);
    expect(findMentionedWord(world.words, `${target}xyz`)).toBeUndefined();
    expect(findMentionedWord(world.words, "hello chat")).toBeUndefined();
  });
});

describe("word search gameplay", () => {
  it("starts a playing round with nothing found, a full timer and an empty leaderboard", () => {
    const game = createGame(); const { world, runtime } = game.getState();
    expect(runtime.config).toEqual(initialConfig);
    expect(world).toMatchObject({ phase: "playing", phaseMsLeft: 300_000, round: 1, scores: [] });
    expect(world.words.every(word => word.foundBy === "" && word.foundAtMs === 0)).toBe(true);
  });
  it("credits the first finder with one point per letter and ignores repeats and chatter", () => {
    const game = createGame(); game.advance(30);
    const target = hidden(game)[0];
    expect(game.dispatch(chatCommand("hello everyone", "talk"))).toMatchObject({ result: { status: "applied", chatCommands: [] } });
    expect(game.dispatch(chatCommand(`I see ${target.toLowerCase()}!`, "find", "superchat", "Finder"))).toMatchObject({ result: { status: "applied", chatCommands: ["find"] } });
    expect(game.dispatch(chatCommand(target, "late", "text", "Too Late"))).toMatchObject({ result: { chatCommands: [] } });
    const world = game.getState().world;
    const found = world.words.find(word => word.word === target)!;
    expect(found.foundBy).toBe("Finder"); expect(found.foundAtMs).toBeCloseTo(500);
    expect(world.scores).toEqual([{ name: "Finder", points: target.length }]);
    expect(world.phase).toBe("playing");
  });
  it("clearing the board celebrates, then starts a new theme with scores kept", () => {
    const game = createGame(); const first = game.getState().world;
    clearBoard(game);
    const total = first.words.reduce((sum, word) => sum + word.word.length, 0);
    expect(game.getState().world).toMatchObject({ phase: "cleared", phaseMsLeft: 15_000, scores: [{ name: "Player One", points: total }] });
    game.advance(15 * TICKS_PER_SECOND);
    const world = game.getState().world;
    expect(world).toMatchObject({ phase: "playing", round: 2, phaseMsLeft: 300_000, scores: [{ name: "Player One", points: total }] });
    expect(world.themeIndex).not.toBe(first.themeIndex);
    expect(world.words.every(word => word.foundBy === "")).toBe(true);
  });
  it("reveals missed words when time runs out, then moves on", () => {
    const game = createGame();
    game.advance(300 * TICKS_PER_SECOND - 1);
    expect(game.getState().world.phase).toBe("playing");
    game.advance(1);
    expect(game.getState().world).toMatchObject({ phase: "timeout", round: 1 });
    expect(game.dispatch(chatCommand(hidden(game)[0], "too-late"))).toMatchObject({ result: { chatCommands: [] } });
    game.advance(15 * TICKS_PER_SECOND);
    expect(game.getState().world).toMatchObject({ phase: "playing", round: 2 });
  });
  it("ranks players and keeps the leaderboard bounded", () => {
    const game = createGame();
    game.dispatch(command("setConfig", { game: { revealSeconds: 3 } }));
    let championPoints = 0;
    for (let index = 0; index < MAX_PLAYERS + 5; index++) {
      if (hidden(game).length === 0) game.advance(3 * TICKS_PER_SECOND);
      const word = hidden(game)[0]; const name = index < 3 ? "Champion" : "Player " + index;
      if (name === "Champion") championPoints += word.length;
      expect(game.dispatch(chatCommand(word, "find-" + index, "text", name))).toMatchObject({ result: { chatCommands: ["find"] } });
    }
    const scores = game.getState().world.scores;
    expect(scores).toHaveLength(MAX_PLAYERS);
    expect(scores[0]).toEqual({ name: "Champion", points: championPoints });
    expect(scores.map(entry => entry.name)).toContain("Player " + (MAX_PLAYERS + 4));
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
  it("reset builds a fresh puzzle, clears scores and restores the default config", () => {
    const game = createGame();
    clearBoard(game); game.advance(16 * TICKS_PER_SECOND);
    game.dispatch(chatCommand(hidden(game)[0], "find"));
    game.dispatch(command("setConfig", { game: { roundSeconds: 60 } }));
    game.dispatch(command("pause"));
    const before = game.getState().world;
    expect(before.round).toBe(2);
    expect(game.dispatch(command("resetGame"))).toMatchObject({ result: { status: "applied" } });
    const { runtime, world } = game.getState();
    expect(runtime).toMatchObject({ resetCount: 1, paused: false, config: initialConfig });
    expect(world).toMatchObject({ phase: "playing", phaseMsLeft: 300_000, phaseAtMs: 0, elapsedMs: 0, round: 1, scores: [] });
    expect(world.words.every(word => word.foundBy === "" && word.foundAtMs === 0)).toBe(true);
    expect(world.grid).not.toBe(before.grid);
    expect(game.getSnapshot().tick).toBe(16 * TICKS_PER_SECOND); // A command reset is not an engine restart.
  });
  it("applies valid config from the next round and rejects invalid config without changes", () => {
    const game = createGame();
    expect(game.dispatch(command("setConfig", { game: { roundSeconds: 60 } }))).toMatchObject({ result: { status: "applied" } });
    expect(game.getState().world.phaseMsLeft).toBe(300_000);
    game.advance(315 * TICKS_PER_SECOND);
    expect(game.getState().world).toMatchObject({ round: 2, phaseMsLeft: 60_000 });
    const original = game.getState();
    for (const patch of [{ roundSeconds: 5 }, { revealSeconds: 0 }, { roundSeconds: 90.5 }, { unregistered: true }]) {
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
    const game = createGame(); const completions: unknown[] = [];
    game.subscribePendingResults(result => completions.push(result));
    game.advance(10); game.freeze();
    const [first, second] = hidden(game);
    expect(game.dispatch(chatCommand(first))).toMatchObject({ status: "queued" });
    expect(hidden(game)).toContain(first);
    game.resume({ pending: "apply" });
    expect(completions).toMatchObject([{ status: "applied", result: { commandId: "chat", status: "applied", chatCommands: ["find"] } }]);
    game.advance(10); game.dispatch(chatCommand(second, "second-chat", "text", "Player Two")); game.advance(10);
    const expected = game.getState(); game.freeze(); game.seek(15);
    expect(hidden(game)).toContain(second);
    game.replay(30); expect(game.getState()).toEqual(expected);
    expect(runGameScenario(gameDefinition, game.exportScenario({ regression: true })).passed).toBe(true);
  });
});
