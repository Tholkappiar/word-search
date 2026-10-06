// Lip sync for Sobo: which of his nine mouth poses to show at each moment of a line.
// The numbers match the `viseme` view model property in sobo.riv (mascot/sobo-game.py)
// and Rhubarb Lip Sync's shapes: X rest, A M/B/P, B EE/S/T, C EH, D AH, E OH, F OO/W,
// G F/V, H L. Clips get exact timings from Rhubarb (scripts/lipsync-voice.mjs); without
// one, the mouth follows the voice's loudness, or the line's letters before any audio.
export const VISEME = { rest: 0, mbp: 1, ee: 2, eh: 3, ah: 4, oh: 5, oo: 6, fv: 7, l: 8 } as const;

/** A clip's mouth track: its length in seconds and [start seconds, viseme] cues in order. */
export type LipSyncTrack = { duration: number; cues: [number, number][] };

/** The pose at a moment of the track; rest before the first cue and after the end. */
export function visemeAt(track: LipSyncTrack, seconds: number): number {
  if (seconds < 0 || seconds >= track.duration) return VISEME.rest;
  let low = 0, high = track.cues.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (track.cues[middle][0] <= seconds) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found === -1 ? VISEME.rest : track.cues[found][1];
}

/** Without a track: shut on quiet gaps, and open wider as the voice gets louder. */
export function visemeFromLevel(level: number, wasOpen: boolean): number {
  if (level < (wasOpen ? 0.08 : 0.14)) return VISEME.rest;
  if (level < 0.3) return VISEME.ee;
  if (level < 0.55) return VISEME.eh;
  return VISEME.ah;
}

/** Letters to poses, for mouthing a line's text when there is no audio yet. */
const LETTERS: Record<string, number> = {
  m: VISEME.mbp, b: VISEME.mbp, p: VISEME.mbp, f: VISEME.fv, v: VISEME.fv, l: VISEME.l,
  o: VISEME.oh, u: VISEME.oo, w: VISEME.oo, q: VISEME.oo, a: VISEME.ah, e: VISEME.eh, i: VISEME.ee, y: VISEME.ee
};
/** A track that mouths the text at a natural speaking pace, resting on spaces and punctuation. */
export function textTrack(text: string, charsPerSecond = 13): LipSyncTrack {
  const cues: [number, number][] = [];
  const letters = spokenText(text).toLowerCase();
  for (let index = 0; index < letters.length; index++) {
    const char = letters[index];
    const viseme = /[a-z]/.test(char) ? LETTERS[char] ?? VISEME.ee : /[.,!?…]/.test(char) ? VISEME.rest : VISEME.ee;
    // Spaces barely pause; punctuation holds the mouth shut a beat longer.
    const pose = char === " " ? VISEME.eh : viseme;
    if (cues.length === 0 || cues[cues.length - 1][1] !== pose) cues.push([index / charsPerSecond, pose]);
  }
  return { duration: letters.length / charsPerSecond, cues };
}

/** The words actually spoken: Eleven v3 audio tags like [excited] or [giggles] removed. */
export function spokenText(text: string): string {
  return text.replace(/\[[^\]]*\]\s*/g, "").replace(/\s{2,}/g, " ").trim();
}
