import { z } from "zod";
import type { SharedGameState } from "./index.js";

const overlaySchema = z.object({
  position: z.enum(["top-left", "top-right", "bottom-left", "bottom-right"]),
  width: z.number().finite(), backgroundColor: z.string(), textColor: z.string(),
  borderColor: z.string(), borderWidth: z.number().finite(), borderRadius: z.number().finite(), accentColor: z.string()
}).strict();

/** Register the complete shared runtime state alongside a game's own schema. */
export function createSharedGameStateSchema<TConfig>(configSchema: z.ZodType<TConfig, z.ZodTypeDef, unknown>): z.ZodType<SharedGameState<TConfig>> {
  return z.object({
    paused: z.boolean(), overlayVisible: z.boolean(), latestCommandLabel: z.string(), latestChatMessage: z.string(),
    latestSubscriberMessage: z.string(), latestSuperChatMessage: z.string(), resetCount: z.number().int().nonnegative(), config: configSchema,
    defaults: z.object({ gameInfoOverlay: overlaySchema, subscriberOverlay: overlaySchema, superChatOverlay: overlaySchema, celebrationDurationMs: z.number().finite().nonnegative() }).strict(),
    celebrationQueue: z.array(z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("subscriber"), eventId: z.string(), displayName: z.string(), profileImageUrl: z.string().optional() }).strict(),
      z.object({ kind: z.literal("superchat"), eventId: z.string(), displayName: z.string(), amount: z.string(), message: z.string() }).strict()
    ]))
  }).strict() as unknown as z.ZodType<SharedGameState<TConfig>>;
}
