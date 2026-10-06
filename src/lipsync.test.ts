import { describe, expect, it } from "vitest";
import { spokenText, textTrack, VISEME, visemeAt, visemeFromLevel, type LipSyncTrack } from "./lipsync";

describe("lip sync", () => {
  it("finds the mouth pose at any moment of a clip, resting outside it", () => {
    const track: LipSyncTrack = { duration: 1, cues: [[0, VISEME.rest], [0.1, VISEME.ah], [0.4, VISEME.mbp], [0.6, VISEME.oo]] };
    expect(visemeAt(track, -0.1)).toBe(VISEME.rest);
    expect(visemeAt(track, 0.05)).toBe(VISEME.rest);
    expect(visemeAt(track, 0.1)).toBe(VISEME.ah);
    expect(visemeAt(track, 0.39)).toBe(VISEME.ah);
    expect(visemeAt(track, 0.5)).toBe(VISEME.mbp);
    expect(visemeAt(track, 0.99)).toBe(VISEME.oo);
    expect(visemeAt(track, 1)).toBe(VISEME.rest);
  });
  it("opens wider as the voice gets louder, and shuts on quiet gaps with a little hysteresis", () => {
    expect(visemeFromLevel(0.05, false)).toBe(VISEME.rest);
    expect(visemeFromLevel(0.1, false)).toBe(VISEME.rest);
    expect(visemeFromLevel(0.1, true)).toBe(VISEME.ee);
    expect(visemeFromLevel(0.4, false)).toBe(VISEME.eh);
    expect(visemeFromLevel(0.9, false)).toBe(VISEME.ah);
  });
  it("mouths text letter by letter, closing on m/b/p and resting on punctuation", () => {
    const track = textTrack("Mom, wow!", 10);
    expect(track.duration).toBeCloseTo(0.9);
    expect(track.cues.map(([, viseme]) => viseme)).toEqual([VISEME.mbp, VISEME.oh, VISEME.mbp, VISEME.rest, VISEME.eh, VISEME.oo, VISEME.oh, VISEME.oo, VISEME.rest]);
  });
  it("drops Eleven v3 audio tags from the spoken words", () => {
    expect(spokenText("[excited] Hi hi! [giggles] Find the words.")).toBe("Hi hi! Find the words.");
    expect(textTrack("[whispers] Psst").duration).toBeCloseTo(4 / 13);
  });
});
