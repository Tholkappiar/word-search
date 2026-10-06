import type { Cue } from "./cues";
import type { GameState } from "./game";
import { spokenText } from "./lipsync";
import voiceLines from "./voice-lines.json";

// What Sobo, the forest-sprout host, says. Each moment maps to a group of lines in
// voice-lines.json; `say` is what the voice clip speaks, with Eleven v3 audio tags such
// as [excited] steering the delivery, and `show` (optional) is a richer bubble text
// with the player's name or points filled in. Tags never reach the bubble. Presentation only:
// randomness here picks a line and never touches gameplay.
type Line = { id: string; say: string; show?: string };
const GROUPS = voiceLines as Record<string, Line[]>;

export type Speech = { id: string; text: string; priority: number };

/** Higher interrupts lower; the big moments win when several happen at once. */
export const PRIORITY = { idle: 1, praise: 2, hint: 3, hurry: 3, streak: 3, firstFind: 3, newLeader: 3, levelStart: 4, roundEnd: 5, gameOver: 6 } as const;
/** Gap after a line ends before Sobo volunteers a low-priority one (praise, idle). */
const CHATTER_GAP_MS = 4000;

export class Host {
  private lastIds = new Map<string, string>();
  constructor(private readonly random: () => number = Math.random) {}

  /** The most important thing worth saying about these cues, if any. */
  respond(cues: readonly Cue[], state: GameState): Speech | undefined {
    const options: Speech[] = [];
    const champion = state.world.scores[0];
    for (const cue of cues) {
      if (cue.kind === "gameOver") {
        // "You were all amazing" only fits when more than one person played.
        const groups = state.runtime.config.stopGame ? ["stopped"] : state.world.scores.length >= 2 ? ["gameOver", "gameOverTeam"] : ["gameOver"];
        options.push(this.line(groups, PRIORITY.gameOver, champion ? { name: champion.name, points: champion.points } : {}));
      }
      if (cue.kind === "levelClear") {
        // Teamwork lines only when two or more people found words this round; a solo clear gets its own praise.
        const finders = [...new Set(state.world.words.filter(word => word.foundBy).map(word => word.foundBy))];
        options.push(this.line(finders.length >= 2 ? ["clear", "clearTeam"] : ["clear", "clearSolo"], PRIORITY.roundEnd, { name: finders[0] ?? "" }));
      }
      if (cue.kind === "timeUp") options.push(this.line("timeUp", PRIORITY.roundEnd));
      if (cue.kind === "levelStart") {
        const group = cue.retry ? "retry" : cue.level === 1 && state.world.scores.length === 0 ? "welcome" : GROUPS[`level_${cue.level}`] ? `level_${cue.level}` : "level_more";
        options.push(this.line(group, PRIORITY.levelStart));
      }
      if (cue.kind === "newLeader") options.push(this.line("newLeader", PRIORITY.newLeader, { name: cue.name, points: cue.points }));
      if (cue.kind === "find") {
        if (cue.first) options.push(this.line("firstFind", PRIORITY.firstFind, { name: cue.by }));
        else if (cue.streak >= 2) options.push(this.line("streak", PRIORITY.streak, { name: cue.by }));
        else options.push(this.line("praise", PRIORITY.praise, { name: cue.by, word: cue.word }));
      }
      if (cue.kind === "tick" && cue.secondsLeft === 10) options.push(this.line("hurry", PRIORITY.hurry));
      if (cue.kind === "hint") options.push(this.line("hint", PRIORITY.hint));
    }
    // Highest priority wins; among equals, the first one listed above.
    return options.reduce<Speech | undefined>((best, option) => !best || option.priority > best.priority ? option : best, undefined);
  }

  /** Something to fill a quiet stretch. */
  idle(): Speech { return this.line("idle", PRIORITY.idle); }

  /** Whether a low-priority line may interrupt the silence yet. */
  static mayChatter(priority: number, msSinceLastLine: number): boolean {
    return priority > PRIORITY.praise || msSinceLastLine >= CHATTER_GAP_MS;
  }

  /** A random line from one group, or from several groups pooled together. */
  private line(group: string | string[], priority: number, values: Record<string, string | number> = {}): Speech {
    const groups = typeof group === "string" ? [group] : group, key = groups.join("+");
    const lines = groups.flatMap(name => GROUPS[name]);
    // Never the same line twice in a row from one pool.
    const choices = lines.length > 1 ? lines.filter(line => line.id !== this.lastIds.get(key)) : lines;
    const line = choices[Math.floor(this.random() * choices.length)];
    this.lastIds.set(key, line.id);
    return { id: line.id, text: fill(line, values), priority };
  }
}

/** The bubble text: `show` with its {placeholders} filled, or the spoken words if a value is missing. */
function fill(line: Line, values: Record<string, string | number>): string {
  if (!line.show) return spokenText(line.say);
  let missing = false;
  const text = line.show.replace(/\{(\w+)\}/g, (_, key: string) => {
    if (values[key] === undefined) { missing = true; return ""; }
    return String(values[key]);
  });
  return missing ? spokenText(line.say) : text;
}
