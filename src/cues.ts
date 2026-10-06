import type { GameState, World } from "./game";

// Sound cues: what just happened in the game, worked out by comparing two
// snapshots. Kept separate from audio playback so it stays testable and never
// influences gameplay.
export type Cue =
  | { kind: "levelStart"; level: number }
  /** found = words found so far this round, so each find can sound a little higher. */
  | { kind: "find"; found: number; total: number }
  | { kind: "levelClear"; level: number }
  | { kind: "timeUp" }
  /** One soft tick per second over the last ten seconds of a round. */
  | { kind: "tick"; secondsLeft: number }
  | { kind: "gameOver" };

const TICK_SECONDS = 10;

function secondsLeft(ms: number): number { return Math.ceil(ms / 1000 - 1e-6); }
function foundCount(world: World): number { return world.words.filter(word => word.foundBy).length; }
function sameRound(before: World, now: World): boolean { return before.level === now.level && before.grid === now.grid; }

export function detectCues(previous: GameState | undefined, current: GameState): Cue[] {
  const now = current.world, before = previous?.world;
  // First frame, or time went backwards (a dev-tools rewind or restart): only announce a fresh round.
  if (!before || now.elapsedMs < before.elapsedMs) return now.phase === "playing" ? [{ kind: "levelStart", level: now.level }] : [];
  const cues: Cue[] = [];
  if (now.phase === "playing" && (before.phase !== "playing" || !sameRound(before, now))) cues.push({ kind: "levelStart", level: now.level });
  if (sameRound(before, now) && foundCount(now) > foundCount(before)) cues.push({ kind: "find", found: foundCount(now), total: now.words.length });
  if (before.phase !== now.phase) {
    if (now.phase === "cleared") cues.push({ kind: "levelClear", level: now.level });
    if (now.phase === "timeout") cues.push({ kind: "timeUp" });
    if (now.phase === "finished") cues.push({ kind: "gameOver" });
  }
  if (now.phase === "playing" && before.phase === "playing" && sameRound(before, now)) {
    const left = secondsLeft(now.phaseMsLeft);
    if (left < secondsLeft(before.phaseMsLeft) && left >= 1 && left <= TICK_SECONDS) cues.push({ kind: "tick", secondsLeft: left });
  }
  return cues;
}
