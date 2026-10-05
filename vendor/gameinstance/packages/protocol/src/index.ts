import { z } from "zod";

const isoDateTimeSchema = z.string().datetime({ offset: true });
const metadataSchema = z.record(z.string(), z.unknown());

function urlWithProtocolSchema(protocols: readonly string[]) {
  return z.string().refine((value) => {
    try {
      const url = new URL(value);
      return protocols.includes(url.protocol);
    } catch {
      return false;
    }
  }, { message: `Expected URL protocol: ${protocols.join(", ")}` });
}

const gameUrlSchema = urlWithProtocolSchema(["http:", "https:"]);
const controlWebSocketUrlSchema = urlWithProtocolSchema(["ws:", "wss:"]);
const rtmpUrlSchema = urlWithProtocolSchema(["rtmp:", "rtmps:"]);

export const GameCommandTypeSchema = z.enum([
  "pause",
  "resume",
  "showOverlay",
  "hideOverlay",
  "resetGame",
  "setConfig",
  "injectChatEvent",
  "injectSubscriberEvent",
  "reload"
]);

export const GameCommandSchema = z
  .object({
    commandId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    versionId: z.string().min(1).optional(),
    issuedBy: z.string().min(1),
    issuedAt: isoDateTimeSchema,
    expiresAt: isoDateTimeSchema.optional(),
    type: GameCommandTypeSchema,
    payload: metadataSchema,
    requireAck: z.boolean()
  })
  .strict();

export type GameCommand = z.infer<typeof GameCommandSchema>;

export const GameCommandResultStatusSchema = z.enum([
  "accepted",
  "applied",
  "rejected",
  "failed",
  "expired"
]);

/** Stable game-defined names, never the viewer's message or command arguments. */
export const ChatCommandsSchema = z.array(z.string()
  .regex(/^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/)
  .refine(value => !/[\r\n]/.test(value), "Chat command names cannot contain line breaks"))
  .max(16)
  .refine(commands => new Set(commands).size === commands.length, "Chat command names must be unique");

export const GameCommandResultSchema = z
  .object({
    commandId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    status: GameCommandResultStatusSchema,
    appliedAt: isoDateTimeSchema.optional(),
    error: z.string().min(1).optional(),
    runtimeState: z.string().min(1).optional(),
    // Missing means unreported (including older games); [] means no gameplay
    // command was recognized. The result status still describes the outcome.
    chatCommands: ChatCommandsSchema.optional()
  })
  .strict();

export type GameCommandResult = z.infer<typeof GameCommandResultSchema>;

export const NormalizedChatEventSchema = z
  .object({
    eventId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1).optional(),
    runtimeInstanceId: z.string().min(1).optional(),
    liveChatId: z.string().min(1).optional(),
    youtubeMessageId: z.string().min(1).optional(),
    receivedAt: isoDateTimeSchema,
    youtubePublishedAt: isoDateTimeSchema.optional(),
    author: z
      .object({
        id: z.string().min(1).optional(),
        displayName: z.string().min(1),
        isModerator: z.boolean().optional(),
        isOwner: z.boolean().optional(),
        isMember: z.boolean().optional()
      })
      .strict(),
    message: z
      .object({
        text: z.string(),
        type: z.enum(["text", "superchat", "sticker", "membership", "system"]),
        amountMicros: z.string().regex(/^\d+$/).optional(),
        currency: z.string().min(1).optional(),
        amountDisplayString: z.string().min(1).optional()
      })
      .strict(),
    raw: z.unknown().optional(),
    forwardedAt: isoDateTimeSchema.optional(),
    forwardStatus: z
      .enum(["pending", "forwarded", "not_forwarded", "failed"])
      .optional()
  })
  .strict();

export type NormalizedChatEvent = z.infer<typeof NormalizedChatEventSchema>;

export const NormalizedSubscriberEventSchema = z
  .object({
    eventId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1).optional(),
    runtimeInstanceId: z.string().min(1).optional(),
    youtubeAccountId: z.string().min(1),
    youtubeSubscriptionId: z.string().min(1).optional(),
    subscriberChannelId: z.string().min(1).optional(),
    subscriberDisplayName: z.string().min(1),
    subscriberProfileImageUrl: z.string().url().optional(),
    subscribedAt: isoDateTimeSchema.optional(),
    receivedAt: isoDateTimeSchema,
    raw: z.unknown().optional(),
    forwardedAt: isoDateTimeSchema.optional(),
    forwardStatus: z
      .enum(["pending", "forwarded", "not_forwarded", "failed"])
      .optional()
  })
  .strict();

export type NormalizedSubscriberEvent = z.infer<
  typeof NormalizedSubscriberEventSchema
>;

export const RuntimeStatusSchema = z.enum([
  "starting",
  "running",
  "degraded",
  "stopping",
  "stopped",
  "failed"
]);

export type RuntimeStatus = z.infer<typeof RuntimeStatusSchema>;

export const RuntimeGameHealthSchema = z.enum([
  "starting",
  "healthy",
  "unhealthy",
  "unknown"
]);

export type RuntimeGameHealth = z.infer<typeof RuntimeGameHealthSchema>;

export const RuntimeComponentStatusSchema = z.enum([
  "not_started",
  "placeholder",
  "starting",
  "ready",
  "running",
  "streaming",
  "crashed",
  "stopped",
  "failed",
  "unknown"
]);

export type RuntimeComponentStatus = z.infer<
  typeof RuntimeComponentStatusSchema
>;

export const RuntimeHeartbeatSchema = z
  .object({
    heartbeatId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    workerId: z.string().min(1),
    status: RuntimeStatusSchema,
    gameHealth: RuntimeGameHealthSchema,
    rendererStatus: RuntimeComponentStatusSchema,
    encoderStatus: RuntimeComponentStatusSchema,
    timestamp: isoDateTimeSchema,
    observedAt: isoDateTimeSchema,
    sequence: z.number().int().nonnegative(),
    uptimeMs: z.number().int().nonnegative(),
    details: metadataSchema.optional()
  })
  .strict();

export type RuntimeHeartbeat = z.infer<typeof RuntimeHeartbeatSchema>;

export const WorkerLaunchRequestSchema = z
  .object({
    requestId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    requestedBy: z.string().min(1),
    requestedAt: isoDateTimeSchema,
    gameUrl: gameUrlSchema,
    controlWebSocketUrl: controlWebSocketUrlSchema,
    renderer: z
      .object({
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        fps: z.number().int().positive()
      })
      .strict(),
    streamOutput: z
      .object({
        kind: z.enum(["rtmp"]),
        url: rtmpUrlSchema
      })
      .strict(),
    metadata: metadataSchema.optional()
  })
  .strict();

export type WorkerLaunchRequest = z.infer<typeof WorkerLaunchRequestSchema>;

export const WorkerLaunchResultSchema = z
  .object({
    requestId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    status: z.enum(["accepted", "rejected", "failed"]),
    workerId: z.string().min(1).optional(),
    launchedAt: isoDateTimeSchema.optional(),
    error: z.string().min(1).optional()
  })
  .strict();

export type WorkerLaunchResult = z.infer<typeof WorkerLaunchResultSchema>;

export const RuntimeLogEventSchema = z
  .object({
    eventId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    emittedAt: isoDateTimeSchema,
    level: z.enum(["debug", "info", "warn", "error"]),
    source: z.enum([
      "orchestrator",
      "worker",
      "runtime",
      "game",
      "renderer",
      "encoder",
      "control-agent",
      "xvfb",
      "youtube"
    ]),
    message: z.string().min(1),
    fields: metadataSchema.optional()
  })
  .strict();

export type RuntimeLogEvent = z.infer<typeof RuntimeLogEventSchema>;

export const WorkerStopRequestSchema = z
  .object({
    requestId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    workerId: z.string().min(1).optional(),
    requestedBy: z.string().min(1),
    requestedAt: isoDateTimeSchema,
    reason: z.string().min(1).optional()
  })
  .strict();

export type WorkerStopRequest = z.infer<typeof WorkerStopRequestSchema>;

export const WorkerStopResultSchema = z
  .object({
    requestId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    status: z.enum(["accepted", "stopped", "notFound", "failed"]),
    workerId: z.string().min(1).optional(),
    stoppedAt: isoDateTimeSchema.optional(),
    error: z.string().min(1).optional()
  })
  .strict();

export type WorkerStopResult = z.infer<typeof WorkerStopResultSchema>;

export function parseGameCommand(input: unknown): GameCommand {
  return GameCommandSchema.parse(input);
}

export function parseNormalizedChatEvent(input: unknown): NormalizedChatEvent {
  return NormalizedChatEventSchema.parse(input);
}

export function parseNormalizedSubscriberEvent(
  input: unknown
): NormalizedSubscriberEvent {
  return NormalizedSubscriberEventSchema.parse(input);
}

export function parseRuntimeHeartbeat(input: unknown): RuntimeHeartbeat {
  return RuntimeHeartbeatSchema.parse(input);
}

export function parseWorkerLaunchRequest(input: unknown): WorkerLaunchRequest {
  return WorkerLaunchRequestSchema.parse(input);
}

export const WorkerRegistrationSchema = z
  .object({
    type: z.literal("worker.register"),
    workerId: z.string().min(1),
    hostname: z.string().min(1),
    dockerAvailable: z.boolean(),
    capacity: z
      .object({
        maxRuntimeContainers: z.number().int().nonnegative(),
        activeRuntimeContainers: z.number().int().nonnegative()
      })
      .strict(),
    startedAt: isoDateTimeSchema
  })
  .strict();

export type WorkerRegistration = z.infer<typeof WorkerRegistrationSchema>;

const WorkerRuntimeEnvSchema = z
  .object({
    STREAM_ID: z.string().min(1),
    DEPLOYMENT_ID: z.string().min(1),
      RUNTIME_INSTANCE_ID: z.string().min(1),
      WORKER_ID: z.string().min(1).optional(),
    ORCHESTRATOR_RUNTIME_WS_URL: controlWebSocketUrlSchema,
    RTMP_URL: rtmpUrlSchema,
    STREAM_WIDTH: z.string().regex(/^\d+$/),
    STREAM_HEIGHT: z.string().regex(/^\d+$/),
    STREAM_FPS: z.string().regex(/^\d+$/),
    VIDEO_BITRATE: z.string().min(1),
    VIDEO_CODEC: z.enum(["h264", "hevc", "av1"]).optional(),
    AUDIO_ENABLED: z.enum(["true", "false"]),
    AUDIO_CODEC: z.enum(["aac"]).optional(),
    ADAPTIVE_BITRATE_ENABLED: z.enum(["true", "false"]).optional(),
    MIN_VIDEO_BITRATE: z.string().min(1).optional(),
    ADAPTIVE_BITRATE_STEP_DOWN_RATIO: z.string().min(1).optional(),
    CONGESTION_SPEED_THRESHOLD: z.string().min(1).optional(),
    CONGESTION_SAMPLE_COUNT: z.string().regex(/^\d+$/).optional(),
    GAME_SOURCE_KIND: z.enum(["sample", "github_archive"]).optional(),
    GAME_SOURCE_SAMPLE_ID: z
      .enum(["sample-game", "sample-game-unity"])
      .optional(),
    GAME_SOURCE_ARCHIVE_URL: z.string().url().optional(),
    GAME_SOURCE_REPOSITORY: z.string().min(1).optional(),
    GAME_SOURCE_REF: z.string().min(1).optional(),
    GAME_SOURCE_COMMIT_SHA: z.string().min(1).optional()
  })
  .strict();

const WorkerRuntimeGameSourceSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("sample"),
      sampleGameId: z.enum(["sample-game", "sample-game-unity"]).optional(),
      contractVersion: z.string().min(1)
    })
    .strict(),
  z
    .object({
      kind: z.literal("github_archive"),
      repositoryFullName: z.string().min(1),
      ref: z.string().min(1),
      commitSha: z.string().min(1)
    })
    .strict()
]);

export const WorkerLaunchRuntimeRequestSchema = z
  .object({
    type: z.literal("worker.launchRuntime"),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    runtimeImage: z.string().min(1),
    // Scoped to this runtime; never forward the node credential to containers.
    runtimeAuthToken: z.string().min(32).max(256).optional(),
    containerName: z.string().min(1),
    dockerNetwork: z.string().min(1),
    resources: z
      .object({
        cpuLimit: z.string().min(1),
        memoryLimitMb: z.number().int().positive()
      })
      .strict(),
    env: WorkerRuntimeEnvSchema,
    gameSource: WorkerRuntimeGameSourceSchema.optional(),
    labels: z.record(z.string(), z.string())
  })
  .strict();

export type WorkerLaunchRuntimeRequest = z.infer<
  typeof WorkerLaunchRuntimeRequestSchema
>;

const metricValue = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const metricIdentity = z.string().min(1).max(160).regex(/^[A-Za-z0-9_-]+$/);
export const HostResourceMetricsSchema = z.object({
  sampledAt: isoDateTimeSchema,
  cpuPercent: z.number().finite().min(0).max(100).optional(),
  iowaitPercent: z.number().finite().min(0).max(100).optional(),
  loadAverage: z.tuple([metricValue, metricValue, metricValue]),
  memoryUsedBytes: metricValue,
  memoryAvailableBytes: metricValue,
  memoryTotalBytes: metricValue,
  networkRxBytesPerSecond: metricValue.optional(),
  networkTxBytesPerSecond: metricValue.optional()
}).strict();
export type HostResourceMetrics = z.infer<typeof HostResourceMetricsSchema>;
export const RuntimeResourceMetricsSchema = z.object({
  sampledAt: isoDateTimeSchema,
  runtimeInstanceId: metricIdentity,
  streamId: metricIdentity,
  deploymentId: metricIdentity,
  cpuCores: z.number().finite().min(0).max(65536).optional(),
  cpuThrottledPercent: z.number().finite().min(0).max(100).optional(),
  memoryUsedBytes: metricValue.optional(),
  memoryLimitBytes: metricValue.optional(),
  networkRxBytesPerSecond: metricValue.optional(),
  networkTxBytesPerSecond: metricValue.optional(),
  restartCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional()
}).strict();
export type RuntimeResourceMetrics = z.infer<typeof RuntimeResourceMetricsSchema>;
export const WorkerTelemetrySchema = z.object({
  host: HostResourceMetricsSchema.optional(),
  runtimes: z.array(RuntimeResourceMetricsSchema).max(100)
}).strict().refine(value => new Set(value.runtimes.map(item => item.runtimeInstanceId)).size === value.runtimes.length);
export type WorkerTelemetry = z.infer<typeof WorkerTelemetrySchema>;

export const WorkerReportSchema = z.object({
  dockerAvailable: z.boolean(),
  imageAvailable: z.boolean(),
  networkAvailable: z.boolean(),
  cpuCount: z.number().int().nonnegative(),
  totalMemoryMb: z.number().int().nonnegative(),
  activeRuntimes: z.array(z.object({
    runtimeInstanceId: z.string().min(1).max(160),
    streamId: z.string().min(1).max(160),
    deploymentId: z.string().min(1).max(160),
    containerId: z.string().min(1).max(160),
    containerName: z.string().min(1).max(160)
  }).strict()).max(100),
  version: z.string().min(1).max(80),
  telemetry: WorkerTelemetrySchema.optional()
}).strict();
export type WorkerReport = z.infer<typeof WorkerReportSchema>;

export const WorkerLaunchRuntimeResultSchema = z
  .object({
    type: z.literal("worker.launchResult"),
    workerId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    status: z.enum(["started", "failed"]),
    containerId: z.string().min(1).optional(),
    containerName: z.string().min(1).optional(),
    error: z.string().min(1).optional(),
    startedAt: isoDateTimeSchema.optional()
  })
  .strict();

export type WorkerLaunchRuntimeResult = z.infer<
  typeof WorkerLaunchRuntimeResultSchema
>;

export const WorkerStopRuntimeRequestSchema = z
  .object({
    type: z.literal("worker.stopRuntime"),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    containerId: z.string().min(1).optional(),
    containerName: z.string().min(1).optional(),
    gracePeriodSeconds: z.number().int().nonnegative()
  })
  .strict();

export type WorkerStopRuntimeRequest = z.infer<
  typeof WorkerStopRuntimeRequestSchema
>;

export const WorkerStopRuntimeResultSchema = z
  .object({
    type: z.literal("worker.stopResult"),
    workerId: z.string().min(1),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    status: z.enum(["stopped", "not_found", "failed"]),
    error: z.string().min(1).optional(),
    stoppedAt: isoDateTimeSchema.optional()
  })
  .strict();

export type WorkerStopRuntimeResult = z.infer<
  typeof WorkerStopRuntimeResultSchema
>;

export const RuntimeRegistrationSchema = z
  .object({
    type: z.literal("runtime.register"),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    workerId: z.string().min(1).optional(),
    containerId: z.string().min(1).optional(),
    runtimeVersion: z.string().min(1),
    startedAt: isoDateTimeSchema
  })
  .strict();

export type RuntimeRegistration = z.infer<typeof RuntimeRegistrationSchema>;

export const RuntimeAgentHeartbeatSchema = z
  .object({
    type: z.literal("runtime.heartbeat"),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    timestamp: isoDateTimeSchema,
    status: z.enum([
      "provisioning",
      "starting_game_server",
      "starting_renderer",
      "starting_encoder",
      "waiting_for_youtube_ingest",
      "healthy",
      "degraded",
      "crashed",
      "stopping",
      "stopped"
    ]),
    game: z
      .object({
        status: z.enum([
          "not_started",
          "starting",
          "healthy",
          "unhealthy",
          "stopped"
        ]),
        healthUrl: z.string().url().optional(),
        lastError: z.string().min(1).optional()
      })
      .strict(),
    renderer: z
      .object({
        status: z.enum(["not_started", "starting", "ready", "crashed", "stopped"]),
        lastError: z.string().min(1).optional()
      })
      .strict(),
    encoder: z
      .object({
        status: z.enum([
          "not_started",
          "starting",
          "streaming",
          "failed",
          "stopped"
        ]),
        fps: z.number().nonnegative().optional(),
        bitrateKbps: z.number().nonnegative().optional(),
        currentBitrateKbps: z.number().nonnegative().optional(),
        targetBitrateKbps: z.number().nonnegative().optional(),
        droppedFrames: z.number().int().nonnegative().optional(),
        speed: z.number().nonnegative().optional(),
        sampledAt: isoDateTimeSchema.optional(),
        lastError: z.string().min(1).optional()
      })
      .strict(),
    controlAgent: z
      .object({
        status: z.enum(["starting", "connected", "disconnected", "stopping"])
      })
      .strict()
  })
  .strict();

export type RuntimeAgentHeartbeat = z.infer<
  typeof RuntimeAgentHeartbeatSchema
>;

export const RuntimeCommandMessageSchema = z
  .object({
    type: z.literal("runtime.command"),
    command: GameCommandSchema
  })
  .strict();

export const RuntimeChatMessageSchema = z
  .object({
    type: z.literal("runtime.chat"),
    event: NormalizedChatEventSchema
  })
  .strict();

export const RuntimeSubscriberMessageSchema = z
  .object({
    type: z.literal("runtime.subscriber"),
    event: NormalizedSubscriberEventSchema
  })
  .strict();

export const RuntimeCommandResultMessageSchema = z
  .object({
    type: z.literal("runtime.commandResult"),
    result: GameCommandResultSchema
  })
  .strict();

export const RuntimeAgentLogEventSchema = z
  .object({
    type: z.literal("runtime.log"),
    streamId: z.string().min(1),
    deploymentId: z.string().min(1),
    runtimeInstanceId: z.string().min(1),
    source: z.enum([
      "runtime",
      "game",
      "renderer",
      "encoder",
      "control-agent",
      "xvfb"
    ]),
    level: z.enum(["debug", "info", "warn", "error"]),
    message: z.string().min(1),
    timestamp: isoDateTimeSchema
  })
  .strict();

export type RuntimeCommandMessage = z.infer<
  typeof RuntimeCommandMessageSchema
>;
export type RuntimeChatMessage = z.infer<typeof RuntimeChatMessageSchema>;
export type RuntimeSubscriberMessage = z.infer<
  typeof RuntimeSubscriberMessageSchema
>;
export type RuntimeCommandResultMessage = z.infer<
  typeof RuntimeCommandResultMessageSchema
>;
export type RuntimeAgentLogEvent = z.infer<typeof RuntimeAgentLogEventSchema>;

export { chatEventToGameCommand, subscriberEventToGameCommand, type GameCommandTarget } from './game-events.js';
