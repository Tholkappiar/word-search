import { z } from "zod";
import { configSchema, initialConfig, type GameConfig } from "./game";

const configurationSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative(),
  values: z.record(z.union([z.string(), z.number().finite(), z.boolean()])),
  media: z.record(z.string()),
  integrations: z.array(z.object({ id: z.string(), available: z.boolean() }))
});

const fields = {
  seconds_per_word: "secondsPerWord",
  celebrate_seconds: "celebrateSeconds",
  reveal_seconds: "revealSeconds",
  final_level: "finalLevel",
  music_volume: "musicVolume",
  sound_volume: "soundVolume",
  voice_volume: "voiceVolume"
} as const;

export function templateGameConfig(input: unknown): GameConfig {
  const { values } = configurationSchema.parse(input);
  const config: Record<string, unknown> = { ...initialConfig };
  for (const [field, key] of Object.entries(fields)) {
    if (values[field] !== undefined) config[key] = values[field];
  }
  return configSchema.parse(config);
}

/** Setup stays in the runtime API, independent of the compiled game bundle. */
export async function loadTemplateGameConfig(request: typeof fetch = fetch): Promise<GameConfig> {
  const response = await request("/__bubble/config", {
    cache: "no-store", credentials: "same-origin", signal: AbortSignal.timeout(10_000)
  });
  // Ordinary games and the local simulator have no template API. Vite serves
  // index.html for this path; older runtimes return 404 instead.
  if (response.status === 404 || (response.ok && response.headers.get("content-type")?.includes("text/html"))) return { ...initialConfig };
  if (!response.ok) throw new Error("Game configuration is unavailable");
  return templateGameConfig(await response.json());
}
