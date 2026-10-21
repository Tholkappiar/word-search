import { describe, expect, it, vi } from "vitest";
import manifest from "../bubble.config.json";
import { createGame, initialConfig } from "./game";
import { loadTemplateGameConfig, templateGameConfig } from "./template";

const configuration = (values: Record<string, unknown>) => ({ schemaVersion: 1, revision: 1, values, media: {}, integrations: [] });

describe("marketplace configuration", () => {
  it("uses wizard defaults consistent with ordinary gameplay", () => {
    const values = Object.fromEntries(manifest.steps.flatMap(step => step.fields.map(field => [field.id, field.default])));
    expect(templateGameConfig(configuration(values))).toEqual(initialConfig);
  });

  it("applies saved settings before the first round, including zero volumes and endless play", () => {
    const config = templateGameConfig(configuration({ seconds_per_word: 60, celebrate_seconds: 8, reveal_seconds: 12, final_level: 0, music_volume: 0, sound_volume: 30, voice_volume: 0 }));
    const game = createGame({ recordHistory: false });
    game.restart({ config });
    expect(game.getState().runtime.config).toMatchObject({ secondsPerWord: 60, celebrateSeconds: 8, revealSeconds: 12, finalLevel: 0, musicVolume: 0, soundVolume: 30, voiceVolume: 0 });
    expect(game.getState().world.phaseMsLeft).toBe(60_000);
    expect(game.isHistoryRecording()).toBe(false);
  });

  it.each([121, 14, 40.5, "40"])("rejects invalid round timing %s", value => {
    expect(() => templateGameConfig(configuration({ seconds_per_word: value }))).toThrow();
  });

  it("loads installation values from the same-origin runtime API", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(configuration({ seconds_per_word: 75 })));
    expect((await loadTemplateGameConfig(request)).secondsPerWord).toBe(75);
    expect(request).toHaveBeenCalledWith("/__bubble/config", expect.objectContaining({ cache: "no-store", credentials: "same-origin" }));
  });

  it.each([new Response(null, { status: 404 }), new Response("<html></html>", { headers: { "content-type": "text/html" } })])("preserves local/ordinary game defaults when the template API is absent", async response => {
    expect(await loadTemplateGameConfig(vi.fn<typeof fetch>().mockResolvedValue(response))).toEqual(initialConfig);
  });

  it("does not silently replace a failed or invalid installation with defaults", async () => {
    for (const response of [new Response(null, { status: 503 }), Response.json({}), Response.json(configuration({ music_volume: -1 }))]) {
      await expect(loadTemplateGameConfig(vi.fn<typeof fetch>().mockResolvedValue(response))).rejects.toThrow();
    }
    await expect(loadTemplateGameConfig(vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")))).rejects.toThrow();
  });
});
