import type { GameState, World } from "./game";

// Sound cues: what just happened in the game, worked out by comparing two
// snapshots. Kept separate from audio playback so it stays testable and never
// influences gameplay.
export type Cue =
  /** retry: the same level again after time ran out. */
  | { kind: "levelStart"; level: number; retry: boolean }
  /**
   * found = words found so far this round, so each find can sound a little higher.
   * streak = how many of this round's latest finds in a row are by the same player;
   * first = the first word of the whole game.
   */
  | { kind: "find"; found: number; total: number; by: string; word: string; streak: number; first: boolean }
  /** The hint (glowing first letters) just switched on. */
  | { kind: "hint" }
  /** Someone else is now top of the leaderboard. */
  | { kind: "newLeader"; name: string; points: number }
  | { kind: "levelClear"; level: number }
  | { kind: "timeUp" }
  /** One soft tick per second over the last ten seconds of a round. */
  | { kind: "tick"; secondsLeft: number }
  | { kind: "gameOver" };

const TICK_SECONDS = 10;

function secondsLeft(ms: number): number { return Math.ceil(ms / 1000 - 1e-6); }
function foundCount(world: World): number { return world.words.filter(word => word.foundBy).length; }
function sameRound(before: World, now: World): boolean { return before.level === now.level && before.grid === now.grid; }
/** Matches the renderer's hint: the last 40% of a round. */
function hinting(world: World): boolean { return world.phase === "playing" && world.phaseMsLeft <= world.phaseMs * 0.4; }

export function detectCues(previous: GameState | undefined, current: GameState): Cue[] {
  const now = current.world, before = previous?.world;
  // First frame, or time went backwards (a dev-tools rewind or restart): only announce a fresh round.
  if (!before || now.elapsedMs < before.elapsedMs) return now.phase === "playing" ? [{ kind: "levelStart", level: now.level, retry: false }] : [];
  const cues: Cue[] = [];
  if (now.phase === "playing" && (before.phase !== "playing" || !sameRound(before, now))) cues.push({ kind: "levelStart", level: now.level, retry: before.phase === "timeout" });
  if (sameRound(before, now) && foundCount(now) > foundCount(before)) {
    // The new find is whichever word was hidden in the previous snapshot (finds can share a tick).
    const fresh = now.words.filter((word, index) => word.foundBy && !before.words[index]?.foundBy);
    const latest = fresh[fresh.length - 1];
    const finds = [latest, ...now.words.filter(word => word.foundBy && word !== latest).sort((left, right) => right.foundAtMs - left.foundAtMs)];
    const streak = finds.findIndex(word => word.foundBy !== latest.foundBy);
    cues.push({ kind: "find", found: finds.length, total: now.words.length, by: latest.foundBy, word: latest.word,
      streak: streak === -1 ? finds.length : streak, first: before.scores.length === 0 });
  }
  const leader = now.scores[0];
  if (leader && before.scores.length > 0 && before.scores[0].name !== leader.name) cues.push({ kind: "newLeader", name: leader.name, points: leader.points });
  if (sameRound(before, now) && hinting(now) && !hinting(before)) cues.push({ kind: "hint" });
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
