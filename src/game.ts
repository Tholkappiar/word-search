import { z } from "zod";
import { NormalizedChatEventSchema } from "@repo/protocol";
import { applySharedGameCommand, createInitialSharedGameState, parseRuntimeControlCommand } from "@repo/game-kit";
import { defineGame, createGameEngine, createSharedGameStateSchema, type GameEngineOptions, type SimulationContext } from "@repo/game-kit/engine";
import { THEMES } from "./themes";

// Word Search: a themed letter grid hides words placed in any of eight directions,
// including backwards.
// The first chat message containing a hidden word finds it for its author, who
// scores one point per letter. A round ends when every word is found or time runs
// out. Reset restores initialConfig (the shared reducer default) and clears the
// whole world, including scores.
export const configSchema = z.object({
  roundSeconds: z.number().int().min(60).max(900),
  revealSeconds: z.number().int().min(3).max(20)
}).strict();
export type GameConfig = z.infer<typeof configSchema>;
export const initialConfig: GameConfig = { roundSeconds: 300, revealSeconds: 10 };

export const GRID_SIZE = 12;
export const WORDS_PER_ROUND = 10;
export const MAX_PLAYERS = 100;
const MAX_NAME_LENGTH = 40;
const PLACEMENT_ATTEMPTS = 150;
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
/** Reading directions as [rowStep, columnStep]: forwards (right, down, down-right, up-right) then backwards (left, up, up-left, down-left). */
export const DIRECTIONS = [[0, 1], [1, 0], [1, 1], [-1, 1], [0, -1], [-1, 0], [-1, -1], [1, -1]] as const;

const placedWordSchema = z.object({
  word: z.string().regex(new RegExp(`^[A-Z]{3,${GRID_SIZE}}$`)),
  row: z.number().int().min(0).max(GRID_SIZE - 1),
  column: z.number().int().min(0).max(GRID_SIZE - 1),
  direction: z.number().int().min(0).max(DIRECTIONS.length - 1),
  foundBy: z.string().max(MAX_NAME_LENGTH),
  foundAtMs: z.number().finite().min(0)
}).strict();
export type PlacedWord = z.infer<typeof placedWordSchema>;
const worldSchema = z.object({
  themeIndex: z.number().int().min(0).max(THEMES.length - 1),
  grid: z.string().regex(new RegExp(`^[A-Z]{${GRID_SIZE * GRID_SIZE}}$`)),
  words: z.array(placedWordSchema).min(1).max(WORDS_PER_ROUND),
  phase: z.enum(["playing", "cleared", "timeout"]),
  phaseMsLeft: z.number().finite().min(0),
  phaseAtMs: z.number().finite().min(0),
  elapsedMs: z.number().finite().min(0),
  round: z.number().int().min(1),
  scores: z.array(z.object({ name: z.string().min(1).max(MAX_NAME_LENGTH), points: z.number().int().min(1) }).strict()).max(MAX_PLAYERS)
}).strict();
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
/** Builds a themed grid with up to WORDS_PER_ROUND words, using only engine randomness. */
export function generatePuzzle(context: SimulationContext, excludeTheme?: number): Pick<World, "themeIndex" | "grid" | "words"> {
  const themeIndex = excludeTheme === undefined ? randomInt(context, 0, THEMES.length - 1)
    : (excludeTheme + randomInt(context, 1, THEMES.length - 1)) % THEMES.length;
  const pool: string[] = [...THEMES[themeIndex].words];
  for (let index = pool.length - 1; index > 0; index--) {
    const swap = randomInt(context, 0, index); [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }
  const cells: string[] = Array(GRID_SIZE * GRID_SIZE).fill("");
  const words: PlacedWord[] = [];
  for (const word of pool) {
    if (words.length === WORDS_PER_ROUND) break;
    for (let attempt = 0; attempt < PLACEMENT_ATTEMPTS; attempt++) {
      const direction = randomInt(context, 0, DIRECTIONS.length - 1);
      const [rowStep, columnStep] = DIRECTIONS[direction];
      const span = word.length - 1;
      const row = rowStep === 1 ? randomInt(context, 0, GRID_SIZE - 1 - span) : rowStep === -1 ? randomInt(context, span, GRID_SIZE - 1) : randomInt(context, 0, GRID_SIZE - 1);
      const column = columnStep === 1 ? randomInt(context, 0, GRID_SIZE - 1 - span) : columnStep === -1 ? randomInt(context, span, GRID_SIZE - 1) : randomInt(context, 0, GRID_SIZE - 1);
      const placed = { word, row, column, direction, foundBy: "", foundAtMs: 0 };
      const path = wordCells(placed);
      // Words may cross only where they share the same letter.
      if (!path.every(([r, c], index) => cells[r * GRID_SIZE + c] === "" || cells[r * GRID_SIZE + c] === word[index])) continue;
      path.forEach(([r, c], index) => { cells[r * GRID_SIZE + c] = word[index]; });
      words.push(placed);
      break;
    }
  }
  const grid = cells.map(cell => cell || LETTERS[randomInt(context, 0, LETTERS.length - 1)]).join("");
  return { themeIndex, grid, words };
}
function newRound(world: Pick<World, "elapsedMs" | "round" | "scores">, context: SimulationContext, config: GameConfig, excludeTheme?: number): World {
  return { elapsedMs: world.elapsedMs, round: world.round, scores: world.scores, ...generatePuzzle(context, excludeTheme),
    phase: "playing", phaseMsLeft: config.roundSeconds * 1000, phaseAtMs: world.elapsedMs };
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
  id: "game_f2890037c53ba1969ae994faae65d30eea8f134ada66ee2bb9d764ad49897f40", schemaVersion: "7", simulationRevision: "8", stateSchema, configSchema, inputSchema: z.unknown().transform(parseRuntimeControlCommand),
  // Add bounded inspector metadata only for game variables you want editable.
  initialConfig, inspector: {},
  createInitialState(config, context) {
    return { runtime: createInitialSharedGameState(config), world: newRound({ elapsedMs: 0, round: 1, scores: [] }, context, config) };
  },
  applyCommand(state, command, context) {
    const applied = applySharedGameCommand(state.runtime, command, {
      initialConfig,
      mergeGameConfig: (config, patch) => configSchema.parse({ ...config, ...patch })
    });
    // No celebrations are drawn, so consume their events immediately instead of
    // accumulating an unused queue (including while gameplay is paused).
    const runtime = { ...applied.state, celebrationQueue: [] };
    const next = { ...state, runtime };
    if (applied.result.status !== "applied") return { state: next, result: applied.result };
    if (command.type === "resetGame") {
      return { state: { ...next, world: newRound({ elapsedMs: 0, round: 1, scores: [] }, context, runtime.config) }, result: applied.result };
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
    const cleared = words.every(word => word.foundBy);
    const found: World = { ...world, words, scores: addPoints(world.scores, author, target.word.length),
      ...(cleared ? { phase: "cleared" as const, phaseMsLeft: runtime.config.revealSeconds * 1000, phaseAtMs: world.elapsedMs } : {}) };
    return { state: { ...next, world: found }, result: { ...applied.result, chatCommands: ["find"] } };
  },
  step(state, context): { state: GameState } {
    if (state.runtime.paused) return { state };
    const { runtime } = state;
    const elapsedMs = state.world.elapsedMs + context.deltaMs;
    // Tolerate floating-point leftovers from fractional tick durations (1000 / 60 ms).
    const phaseMsLeft = state.world.phaseMsLeft - context.deltaMs;
    const world = { ...state.world, elapsedMs, phaseMsLeft: Math.max(0, phaseMsLeft) };
    if (phaseMsLeft > 0.001) return { state: { ...state, world } };
    if (world.phase === "playing") {
      return { state: { ...state, world: { ...world, phase: "timeout", phaseMsLeft: runtime.config.revealSeconds * 1000, phaseAtMs: elapsedMs } } };
    }
    return { state: { ...state, world: newRound({ ...world, round: world.round + 1 }, context, runtime.config, world.themeIndex) } };
  }
});
export function createGame(options: GameEngineOptions = {}) { return createGameEngine(gameDefinition, { seed: 1, ...options }); }
