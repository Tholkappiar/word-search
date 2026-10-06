import { z } from "zod";
import { NormalizedChatEventSchema } from "@bubbleportal/sdk";
import { applySharedGameCommand, createInitialSharedGameState, parseRuntimeControlCommand } from "@bubbleportal/sdk";
import { defineGame, createGameEngine, createSharedGameStateSchema, type GameEngineOptions, type SimulationContext } from "@bubbleportal/sdk/engine";
import { THEMES } from "./themes";

// Word Search with levels: a themed letter grid hides everyday words, starting with
// one 3-letter word in a 3x3 grid and growing to an 8x8 grid with words in all
// eight directions. The first chat message containing a hidden word finds it for
// its author, who scores the level's points per word (fewer on easy levels).
// Finding every word clears the level and the next one starts after a short
// celebration; running out of time reveals the missed words and replays the same
// level with new words. Clearing finalLevel ends the game on a results screen that
// stays until reset. The stopGame config ends the game immediately; turning it off
// again starts a fresh game from level 1 with scores cleared.
// Reset restores initialConfig (the shared reducer default, including finalLevel)
// and clears the whole world back to level 1, including scores.
export const configSchema = z.object({
  /** Round time per hidden word, so bigger levels get proportionally longer. */
  secondsPerWord: z.number().int().min(15).max(120),
  /** Celebration after a level is cleared, before the next level starts. */
  celebrateSeconds: z.number().int().min(3).max(20),
  /** How long missed words stay revealed after time runs out. */
  revealSeconds: z.number().int().min(3).max(20),
  /** Clearing this level ends the game; 0 plays forever. Read when a level is cleared. */
  finalLevel: z.number().int().min(0).max(50),
  /** Manual stop: true ends the game now on the results screen; false again starts a new game. */
  stopGame: z.boolean(),
  /** Background music, sound effect and Sobo's voice loudness, 0 (off) to 100. Presentation only. */
  musicVolume: z.number().int().min(0).max(100),
  soundVolume: z.number().int().min(0).max(100),
  voiceVolume: z.number().int().min(0).max(100)
}).strict();
export type GameConfig = z.infer<typeof configSchema>;
export const initialConfig: GameConfig = { secondsPerWord: 40, celebrateSeconds: 6, revealSeconds: 15, finalLevel: 10, stopGame: false, musicVolume: 50, soundVolume: 70, voiceVolume: 80 };

/** Reading directions as [rowStep, columnStep]: forwards (right, down, down-right, up-right) then backwards (left, up, up-left, down-left). */
export const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]] as const;
const ALL_DIRECTIONS = [0, 1, 2, 3, 4, 5, 6, 7];
/**
 * Difficulty tiers, easiest first; levels past the end repeat the last tier.
 * Directions index DIRECTIONS; points are what each found word is worth.
 */
export const LEVELS: readonly { size: number; words: number; lengths: readonly number[]; directions: readonly number[]; points: number }[] = [
  { size: 3, words: 1, lengths: [3], directions: [0], points: 1 },
  { size: 3, words: 2, lengths: [3], directions: [0, 1], points: 1 },
  { size: 4, words: 2, lengths: [3], directions: [0, 1], points: 1 },
  { size: 4, words: 3, lengths: [3, 4], directions: [0, 1], points: 2 },
  { size: 5, words: 3, lengths: [3, 4], directions: [0, 1, 2], points: 2 },
  { size: 5, words: 4, lengths: [3, 4], directions: [0, 1, 2], points: 2 },
  { size: 6, words: 4, lengths: [4], directions: [0, 1, 2, 3], points: 3 },
  { size: 6, words: 5, lengths: [4], directions: [0, 1, 2, 3], points: 3 },
  { size: 7, words: 5, lengths: [4], directions: ALL_DIRECTIONS, points: 4 },
  { size: 8, words: 6, lengths: [4], directions: ALL_DIRECTIONS, points: 5 }
];
export const MAX_SIZE = 8, MAX_WORDS = 6;
export const MAX_PLAYERS = 100;
const MAX_NAME_LENGTH = 40;
const PLACEMENT_ATTEMPTS = 150;
const PUZZLE_ATTEMPTS = 40, FILL_ATTEMPTS = 8;
/** Chance a word reads forwards when a level also allows backwards words. */
const FORWARD_CHANCE = 0.75;
/** Random filler letters. No Q: the grid font draws its tail across the next tile, and no word uses it. */
const LETTERS = "ABCDEFGHIJKLMNOPRSTUVWXYZ";

export function levelSpec(level: number) { return LEVELS[Math.min(level, LEVELS.length) - 1]; }
/** Whether clearing this level ends the game under the given config. */
export function isFinalLevel(level: number, config: Pick<GameConfig, "finalLevel">): boolean { return config.finalLevel > 0 && level >= config.finalLevel; }

const placedWordSchema = z.object({
  word: z.string().regex(/^[A-Z]{3,8}$/),
  row: z.number().int().min(0).max(MAX_SIZE - 1),
  column: z.number().int().min(0).max(MAX_SIZE - 1),
  direction: z.number().int().min(0).max(DIRECTIONS.length - 1),
  foundBy: z.string().max(MAX_NAME_LENGTH),
  foundAtMs: z.number().finite().min(0)
}).strict();
export type PlacedWord = z.infer<typeof placedWordSchema>;
const worldSchema = z.object({
  level: z.number().int().min(1),
  size: z.number().int().min(LEVELS[0].size).max(MAX_SIZE),
  themeIndex: z.number().int().min(0).max(THEMES.length - 1),
  grid: z.string().regex(new RegExp(`^[A-Z]{${LEVELS[0].size ** 2},${MAX_SIZE ** 2}}$`)),
  words: z.array(placedWordSchema).min(1).max(MAX_WORDS),
  /** "finished" is the end-of-game results screen after the final level. */
  phase: z.enum(["playing", "cleared", "timeout", "finished"]),
  /** Full length of the current phase, for the timer bar. */
  phaseMs: z.number().finite().min(0),
  phaseMsLeft: z.number().finite().min(0),
  phaseAtMs: z.number().finite().min(0),
  elapsedMs: z.number().finite().min(0),
  scores: z.array(z.object({ name: z.string().min(1).max(MAX_NAME_LENGTH), points: z.number().int().min(1) }).strict()).max(MAX_PLAYERS)
}).strict().refine(world => world.grid.length === world.size ** 2, "grid must have size x size letters");
export type World = z.infer<typeof worldSchema>;
// Register every authoritative game variable here so inspection and replay work.
const stateSchema = z.object({
  runtime: createSharedGameStateSchema(configSchema),
  world: worldSchema
}).strict();
export type GameState = z.infer<typeof stateSchema>;

/** Grid cells covered by a placed word, as [row, column] pairs. */
export function wordCells(word: Pick<PlacedWord, "word" | "row" | "column" | "direction">): [number, number][] {
  const [rowStep, columnStep] = DIRECTIONS[word.direction];
  return [...word.word].map((_, index) => [word.row + rowStep * index, word.column + columnStep * index]);
}
function randomInt(context: SimulationContext, min: number, max: number): number {
  return min + Math.floor(context.random() * (max - min + 1));
}
function shuffle<T>(context: SimulationContext, items: T[]): T[] {
  for (let index = items.length - 1; index > 0; index--) {
    const swap = randomInt(context, 0, index); [items[index], items[swap]] = [items[swap], items[index]];
  }
  return items;
}
/** Whether a word can be read anywhere in a size x size grid, in any direction. */
export function appearsInGrid(grid: string, size: number, word: string): boolean {
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      if (grid[row * size + column] !== word[0]) continue;
      for (const [rowStep, columnStep] of DIRECTIONS) {
        const endRow = row + rowStep * (word.length - 1), endColumn = column + columnStep * (word.length - 1);
        if (endRow < 0 || endRow >= size || endColumn < 0 || endColumn >= size) continue;
        if ([...word].every((letter, index) => grid[(row + rowStep * index) * size + column + columnStep * index] === letter)) return true;
      }
    }
  }
  return false;
}
/** Places up to the level's word count from the pool into empty cells, crossing only on shared letters. */
function placeWords(context: SimulationContext, pool: readonly string[], cells: string[], level: number): PlacedWord[] {
  const { size, words: count, directions } = levelSpec(level);
  const forwards = directions.filter(direction => direction < 4), backwards = directions.filter(direction => direction >= 4);
  const words: PlacedWord[] = [];
  for (const word of pool) {
    if (words.length === count) break;
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      // Favour forwards so words are easier to spot when backwards ones are allowed.
      const choices = backwards.length && context.random() >= FORWARD_CHANCE ? backwards : forwards;
      const direction = choices[randomInt(context, 0, choices.length - 1)];
      const [rowStep, columnStep] = DIRECTIONS[direction];
      const span = word.length - 1;
      if (span >= size) break;
      const row = rowStep === 1 ? randomInt(context, 0, size - 1 - span) : rowStep === -1 ? randomInt(context, span, size - 1) : randomInt(context, 0, size - 1);
      const column = columnStep === 1 ? randomInt(context, 0, size - 1 - span) : columnStep === -1 ? randomInt(context, span, size - 1) : randomInt(context, 0, size - 1);
      const placed = { word, row, column, direction, foundBy: "", foundAtMs: 0 };
      const path = wordCells(placed);
      if (!path.every(([r, c], index) => cells[r * size + c] === "" || cells[r * size + c] === word[index])) continue;
      path.forEach(([r, c], index) => { cells[r * size + c] = word[index]; });
      words.push(placed);
      break;
    }
  }
  return words;
}
/** Builds a themed grid for a level, using only engine randomness. */
export function generatePuzzle(context: SimulationContext, level: number, excludeTheme?: number): Pick<World, "size" | "themeIndex" | "grid" | "words"> {
  const { size, words: count, lengths } = levelSpec(level);
  const themeIndex = excludeTheme === undefined ? randomInt(context, 0, THEMES.length - 1)
    : (excludeTheme + randomInt(context, 1, THEMES.length - 1)) % THEMES.length;
  const themeWords: readonly string[] = THEMES[themeIndex].words;
  const pool = themeWords.filter(word => lengths.includes(word.length));
  // Rebuild until every word fits and no other category word appears by accident
  // (viewers would type it and nothing would happen). Refilling random letters fixes
  // most accidents; a word formed by crossing hidden words needs a fresh placement.
  let best = { grid: "", words: [] as PlacedWord[] };
  for (let attempt = 0; attempt < PUZZLE_ATTEMPTS; attempt++) {
    const cells: string[] = Array(size * size).fill("");
    const words = placeWords(context, shuffle(context, [...pool]), cells, level);
    const hidden = new Set(words.map(word => word.word));
    const others = themeWords.filter(word => !hidden.has(word));
    for (let fill = 0; fill < FILL_ATTEMPTS; fill++) {
      const puzzle = { grid: cells.map(cell => cell || LETTERS[randomInt(context, 0, LETTERS.length - 1)]).join(""), words };
      if (words.length >= best.words.length) best = puzzle;
      if (words.length === count && !others.some(word => appearsInGrid(puzzle.grid, size, word))) return { size, themeIndex, ...puzzle };
    }
  }
  return { size, themeIndex, ...best };
}
function newRound(world: Pick<World, "elapsedMs" | "scores">, context: SimulationContext, config: GameConfig, level: number, excludeTheme?: number): World {
  const puzzle = generatePuzzle(context, level, excludeTheme);
  const phaseMs = puzzle.words.length * config.secondsPerWord * 1000;
  return { level, elapsedMs: world.elapsedMs, scores: world.scores, ...puzzle, phase: "playing", phaseMs, phaseMsLeft: phaseMs, phaseAtMs: world.elapsedMs };
}
/** The end-of-game results screen, which stays until reset or stopGame is turned off. */
function finish(world: World): World { return { ...world, phase: "finished", phaseMs: 0, phaseMsLeft: 0, phaseAtMs: world.elapsedMs }; }
function startPhase(world: World, phase: "cleared" | "timeout", seconds: number): World {
  return { ...world, phase, phaseMs: seconds * 1000, phaseMsLeft: seconds * 1000, phaseAtMs: world.elapsedMs };
}
function addPoints(scores: World["scores"], name: string, points: number): World["scores"] {
  const existing = scores.find(entry => entry.name === name);
  let next = existing ? scores.map(entry => entry === existing ? { ...entry, points: entry.points + points } : entry) : [...scores];
  if (!existing) {
    // Bounded leaderboard: a new scorer replaces the lowest-ranked player when full.
    if (next.length >= MAX_PLAYERS) next = next.slice(0, MAX_PLAYERS - 1);
    next.push({ name, points });
  }
  return next.sort((left, right) => right.points - left.points);
}
/** The first still-hidden word mentioned anywhere in a chat message, if any. */
export function findMentionedWord(words: readonly PlacedWord[], text: string): PlacedWord | undefined {
  const tokens = new Set(text.toUpperCase().split(/[^A-Z]+/));
  return words.find(word => !word.foundBy && tokens.has(word.word));
}

export const gameDefinition = defineGame({
  id: "game_f2890037c53ba1969ae994faae65d30eea8f134ada66ee2bb9d764ad49897f40", schemaVersion: "13", simulationRevision: "12", stateSchema, configSchema, inputSchema: z.unknown().transform(parseRuntimeControlCommand),
  // Add bounded inspector metadata only for game variables you want editable.
  initialConfig, inspector: {},
  createInitialState(config, context) {
    const world = newRound({ elapsedMs: 0, scores: [] }, context, config, 1);
    return { runtime: createInitialSharedGameState(config), world: config.stopGame ? finish(world) : world };
  },
  applyCommand(state, command, context) {
    const applied = applySharedGameCommand(state.runtime, command, {
      initialConfig,
      mergeGameConfig: (config, patch) => configSchema.parse({ ...config, ...patch })
    });
    // No subscriber celebrations are drawn, so consume their events immediately instead
    // of accumulating an unused queue (including while gameplay is paused).
    const runtime = { ...applied.state, celebrationQueue: [] };
    const next = { ...state, runtime };
    if (applied.result.status !== "applied") return { state: next, result: applied.result };
    if (command.type === "resetGame") {
      return { state: { ...next, world: newRound({ elapsedMs: 0, scores: [] }, context, runtime.config, 1) }, result: applied.result };
    }
    if (command.type === "setConfig" && runtime.config.stopGame !== state.runtime.config.stopGame) {
      // Stopping ends the game where it stands; un-stopping starts a new game with the current config.
      const world = runtime.config.stopGame ? finish(next.world) : newRound({ elapsedMs: next.world.elapsedMs, scores: [] }, context, runtime.config, 1);
      return { state: { ...next, world }, result: applied.result };
    }
    if (command.type !== "injectChatEvent") return { state: next, result: applied.result };

    // Chat only finds words while a round is playing and gameplay is not paused.
    const event = NormalizedChatEventSchema.parse(command.payload.chatEvent);
    const isGuessMessage = event.message.type === "text" || event.message.type === "superchat";
    const world = next.world;
    const target = !runtime.paused && world.phase === "playing" && isGuessMessage ? findMentionedWord(world.words, event.message.text) : undefined;
    if (!target) return { state: next, result: { ...applied.result, chatCommands: [] } };
    const author = event.author.displayName.slice(0, MAX_NAME_LENGTH);
    const words = world.words.map(word => word === target ? { ...word, foundBy: author, foundAtMs: world.elapsedMs } : word);
    const found: World = { ...world, words, scores: addPoints(world.scores, author, levelSpec(world.level).points) };
    const cleared = words.every(word => word.foundBy);
    return { state: { ...next, world: cleared ? startPhase(found, "cleared", runtime.config.celebrateSeconds) : found }, result: { ...applied.result, chatCommands: ["find"] } };
  },
  step(state, context): { state: GameState } {
    if (state.runtime.paused) return { state };
    const { runtime } = state;
    const elapsedMs = state.world.elapsedMs + context.deltaMs;
    // The finished screen only keeps its clock running for animation, until reset.
    if (state.world.phase === "finished") return { state: { ...state, world: { ...state.world, elapsedMs } } };
    // Tolerate floating-point leftovers from fractional tick durations (1000 / 60 ms).
    const phaseMsLeft = state.world.phaseMsLeft - context.deltaMs;
    const world = { ...state.world, elapsedMs, phaseMsLeft: Math.max(0, phaseMsLeft) };
    if (phaseMsLeft > 0.001) return { state: { ...state, world } };
    if (world.phase === "playing") return { state: { ...state, world: startPhase(world, "timeout", runtime.config.revealSeconds) } };
    if (world.phase === "cleared" && isFinalLevel(world.level, runtime.config)) {
      return { state: { ...state, world: finish(world) } };
    }
    // A cleared level moves up; a timed-out level is replayed with new words.
    const level = world.phase === "cleared" ? world.level + 1 : world.level;
    return { state: { ...state, world: newRound(world, context, runtime.config, level, world.themeIndex) } };
  }
});
export function createGame(options: GameEngineOptions = {}) { return createGameEngine(gameDefinition, { seed: 1, ...options }); }
