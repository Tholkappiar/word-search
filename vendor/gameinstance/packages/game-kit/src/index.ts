import { z } from "zod";
import {
  ChatCommandsSchema,
  GameCommandResultSchema,
  GameCommandSchema,
  NormalizedChatEventSchema,
  NormalizedSubscriberEventSchema,
  type GameCommand,
  type GameCommandResult,
  type NormalizedChatEvent
} from "@repo/protocol";

export type ConnectionStatus =
  | "not-configured"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

export type RuntimeWebSocket = {
  readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: Event) => void) | null;
  send(data: string): void;
  close(): void;
};

export type RuntimeWebSocketConstructor = {
  readonly OPEN: number;
  new (url: string): RuntimeWebSocket;
};

export type OverlayPosition =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right";

export type OverlayStyleConfig = {
  position: OverlayPosition;
  width: number;
  backgroundColor: string;
  textColor: string;
  borderColor: string;
  borderWidth: number;
  borderRadius: number;
  accentColor: string;
};

export type SharedOverlayDefaults = {
  gameInfoOverlay: OverlayStyleConfig;
  subscriberOverlay: OverlayStyleConfig;
  superChatOverlay: OverlayStyleConfig;
  celebrationDurationMs: number;
};

export type SubscriberCelebration = {
  kind: "subscriber";
  eventId: string;
  displayName: string;
  profileImageUrl?: string;
};

export type SuperChatCelebration = {
  kind: "superchat";
  eventId: string;
  displayName: string;
  amount: string;
  message: string;
};

export type Celebration = SubscriberCelebration | SuperChatCelebration;

/** Presentation backlog only: keep the newest 100 celebrations, dropping oldest overflow.
 * Latest-message labels and command acknowledgements are preserved independently.
 */
export const MAX_CELEBRATION_QUEUE_LENGTH = 100;

export type SharedGameState<TGameConfig> = {
  paused: boolean;
  overlayVisible: boolean;
  latestCommandLabel: string;
  latestChatMessage: string;
  latestSubscriberMessage: string;
  latestSuperChatMessage: string;
  celebrationQueue: Celebration[];
  resetCount: number;
  config: TGameConfig;
  defaults: SharedOverlayDefaults;
};

export type RuntimeControlCommand = Omit<GameCommand, "type"> & {
  type: string;
};

export type SharedCommandHandler<TGameConfig> = (input: {
  state: SharedGameState<TGameConfig>;
  command: RuntimeControlCommand;
}) => {
  state: SharedGameState<TGameConfig>;
  status?: GameCommandResult["status"];
  error?: string;
};

export type SharedChatEventResult<TGameConfig> = {
  state: SharedGameState<TGameConfig>;
  /** Stable names recognized by the game, not chat text or arguments. */
  commands: string[];
};

export type ApplySharedGameCommandOptions<TGameConfig> = {
  initialConfig: TGameConfig;
  initialDefaults?: PartialSharedOverlayDefaults;
  mergeGameConfig?: (
    config: TGameConfig,
    payload: Record<string, unknown>
  ) => TGameConfig;
  onChatEvent?: (
    state: SharedGameState<TGameConfig>,
    chatEvent: NormalizedChatEvent
  ) => SharedGameState<TGameConfig> | SharedChatEventResult<TGameConfig>;
  additionalCommandHandlers?: Record<string, SharedCommandHandler<TGameConfig>>;
};

export type SharedSetConfigPayload = {
  defaults: PartialSharedOverlayDefaults;
  game: Record<string, unknown>;
};

export type PartialOverlayStyleConfig = Partial<OverlayStyleConfig>;

export type PartialSharedOverlayDefaults = {
  gameInfoOverlay?: PartialOverlayStyleConfig;
  subscriberOverlay?: PartialOverlayStyleConfig;
  superChatOverlay?: PartialOverlayStyleConfig;
  celebrationDurationMs?: number;
};

const runtimeControlCommandSchema = GameCommandSchema.extend({
  type: z.string().min(1)
});

export const defaultOverlayStyleConfig: OverlayStyleConfig = {
  position: "bottom-left",
  width: 320,
  backgroundColor: "rgba(10, 16, 28, 0.78)",
  textColor: "#f8fafc",
  borderColor: "rgba(255, 255, 255, 0.18)",
  borderWidth: 1,
  borderRadius: 18,
  accentColor: "#36d399"
};

export const defaultSharedOverlayDefaults: SharedOverlayDefaults = {
  gameInfoOverlay: { ...defaultOverlayStyleConfig },
  subscriberOverlay: {
    ...defaultOverlayStyleConfig,
    position: "top-left",
    width: 360,
    accentColor: "#60a5fa"
  },
  superChatOverlay: {
    ...defaultOverlayStyleConfig,
    position: "top-left",
    width: 420,
    accentColor: "#f59e0b"
  },
  celebrationDurationMs: 4500
};

const sharedSetConfigKeys = new Set(["defaults", "game"]);

export function parseRuntimeControlCommand(input: unknown): RuntimeControlCommand {
  return runtimeControlCommandSchema.parse(input);
}

export function parseRuntimeCommandResult(input: unknown): GameCommandResult {
  return GameCommandResultSchema.parse(input);
}

export function createInitialSharedGameState<TGameConfig>(
  config: TGameConfig,
  defaults: PartialSharedOverlayDefaults = {}
): SharedGameState<TGameConfig> {
  return {
    paused: false,
    overlayVisible: true,
    latestCommandLabel: "none",
    latestChatMessage: "none",
    latestSubscriberMessage: "none",
    latestSuperChatMessage: "none",
    celebrationQueue: [],
    resetCount: 0,
    config,
    defaults: mergeSharedOverlayDefaults(defaultSharedOverlayDefaults, defaults)
  };
}

export function applySharedGameCommand<TGameConfig>(
  state: SharedGameState<TGameConfig>,
  command: RuntimeControlCommand,
  options: ApplySharedGameCommandOptions<TGameConfig>
): { state: SharedGameState<TGameConfig>; result: GameCommandResult } {
  const commandLabel = `${command.type} (${command.commandId})`;
  let nextState: SharedGameState<TGameConfig> = {
    ...state,
    latestCommandLabel: commandLabel
  };
  let status: GameCommandResult["status"] = "applied";
  let error: string | undefined;
  let chatCommands: string[] | undefined;

  switch (command.type) {
    case "pause":
      nextState = { ...nextState, paused: true };
      break;
    case "resume":
      nextState = { ...nextState, paused: false };
      break;
    case "resetGame":
      nextState = {
        ...createInitialSharedGameState(
          options.initialConfig,
          options.initialDefaults
        ),
        latestCommandLabel: commandLabel,
        resetCount: state.resetCount + 1
      };
      break;
    case "showOverlay":
      nextState = { ...nextState, overlayVisible: true };
      break;
    case "hideOverlay":
      nextState = { ...nextState, overlayVisible: false };
      break;
    case "injectChatEvent": {
      const chatEvent = NormalizedChatEventSchema.safeParse(
        command.payload.chatEvent
      );

      if (!chatEvent.success) {
        status = "rejected";
        error = "injectChatEvent requires payload.chatEvent";
        break;
      }

      const superChatCelebration =
        chatEvent.data.message.type === "superchat"
          ? toSuperChatCelebration(chatEvent.data)
          : undefined;

      nextState = {
        ...nextState,
        latestChatMessage: `${chatEvent.data.author.displayName}: ${chatEvent.data.message.text}`,
        ...(superChatCelebration
          ? {
              latestSuperChatMessage: `${superChatCelebration.displayName} ${superChatCelebration.amount}: ${superChatCelebration.message}`,
              celebrationQueue: [
                ...nextState.celebrationQueue,
                superChatCelebration
              ]
            }
          : {})
      };
      if (options.onChatEvent) {
        const handled = options.onChatEvent(nextState, chatEvent.data);
        if ("state" in handled) {
          chatCommands = ChatCommandsSchema.parse(handled.commands);
          nextState = handled.state;
        } else {
          // Existing state-only handlers remain valid, but do not report
          // whether a message matched a game command.
          nextState = handled;
        }
      }
      break;
    }
    case "injectSubscriberEvent": {
      const subscriberEvent = NormalizedSubscriberEventSchema.safeParse(
        command.payload.subscriberEvent
      );

      if (!subscriberEvent.success) {
        status = "rejected";
        error = "injectSubscriberEvent requires payload.subscriberEvent";
        break;
      }

      nextState = {
        ...nextState,
        latestSubscriberMessage: `${subscriberEvent.data.subscriberDisplayName} subscribed`,
        celebrationQueue: [
          ...nextState.celebrationQueue,
          {
            kind: "subscriber",
            eventId: subscriberEvent.data.eventId,
            displayName: subscriberEvent.data.subscriberDisplayName,
            ...(subscriberEvent.data.subscriberProfileImageUrl
              ? {
                  profileImageUrl:
                    subscriberEvent.data.subscriberProfileImageUrl
                }
              : {})
          }
        ]
      };
      break;
    }
    case "setConfig": {
      const payload = normalizeSetConfigPayload(command.payload);
      nextState = {
        ...nextState,
        defaults: mergeSharedOverlayDefaults(nextState.defaults, payload.defaults),
        config: options.mergeGameConfig
          ? options.mergeGameConfig(nextState.config, payload.game)
          : nextState.config
      };
      break;
    }
    case "reload":
      status = "rejected";
      error = "reload is not supported by the shared game runtime";
      break;
    default: {
      const handler = options.additionalCommandHandlers?.[command.type];

      if (handler) {
        const handled = handler({ state: nextState, command });
        nextState = handled.state;
        status = handled.status ?? status;
        error = handled.error;
        break;
      }

      status = "rejected";
      error = "Unsupported command type";
      break;
    }
  }

  if (nextState.celebrationQueue.length > MAX_CELEBRATION_QUEUE_LENGTH) {
    nextState = { ...nextState, celebrationQueue: nextState.celebrationQueue.slice(-MAX_CELEBRATION_QUEUE_LENGTH) };
  }

  return {
    state: nextState,
    result: {
      ...buildCommandResult(command, status, error, nextState),
      ...(chatCommands !== undefined ? { chatCommands } : {})
    }
  };
}

export function normalizeSetConfigPayload(
  payload: Record<string, unknown>
): SharedSetConfigPayload {
  const defaults = readRecord(payload.defaults);
  const explicitGame = readRecord(payload.game);
  const flatGamePayload =
    explicitGame ??
    Object.fromEntries(
      Object.entries(payload).filter(([key]) => !sharedSetConfigKeys.has(key))
    );

  return {
    defaults: normalizeSharedDefaults(defaults ?? {}),
    game: flatGamePayload
  };
}

export function mergeSharedOverlayDefaults(
  current: SharedOverlayDefaults,
  partial: PartialSharedOverlayDefaults
): SharedOverlayDefaults {
  return {
    gameInfoOverlay: mergeOverlayStyleConfig(
      current.gameInfoOverlay,
      partial.gameInfoOverlay
    ),
    subscriberOverlay: mergeOverlayStyleConfig(
      current.subscriberOverlay,
      partial.subscriberOverlay
    ),
    superChatOverlay: mergeOverlayStyleConfig(
      current.superChatOverlay,
      partial.superChatOverlay
    ),
    celebrationDurationMs:
      typeof partial.celebrationDurationMs === "number" &&
      partial.celebrationDurationMs >= 500
        ? Math.min(partial.celebrationDurationMs, 30000)
        : current.celebrationDurationMs
  };
}

export function buildRejectedCommandResult(
  input: unknown,
  error: string
): GameCommandResult {
  return {
    commandId: stringField(input, "commandId") ?? "unknown-command",
    streamId: stringField(input, "streamId") ?? "unknown-stream",
    deploymentId: stringField(input, "deploymentId") ?? "unknown-deployment",
    runtimeInstanceId:
      stringField(input, "runtimeInstanceId") ?? "unknown-runtime",
    status: "rejected",
    appliedAt: new Date().toISOString(),
    error,
    runtimeState: "unknown"
  };
}

function mergeOverlayStyleConfig(
  current: OverlayStyleConfig,
  partial?: PartialOverlayStyleConfig
): OverlayStyleConfig {
  if (!partial) {
    return current;
  }

  return {
    position: isOverlayPosition(partial.position)
      ? partial.position
      : current.position,
    width:
      typeof partial.width === "number" && partial.width >= 160
        ? Math.min(partial.width, 720)
        : current.width,
    backgroundColor:
      typeof partial.backgroundColor === "string" &&
      partial.backgroundColor.trim().length > 0
        ? partial.backgroundColor
        : current.backgroundColor,
    textColor:
      typeof partial.textColor === "string" && partial.textColor.trim().length > 0
        ? partial.textColor
        : current.textColor,
    borderColor:
      typeof partial.borderColor === "string" &&
      partial.borderColor.trim().length > 0
        ? partial.borderColor
        : current.borderColor,
    borderWidth:
      typeof partial.borderWidth === "number" && partial.borderWidth >= 0
        ? Math.min(partial.borderWidth, 12)
        : current.borderWidth,
    borderRadius:
      typeof partial.borderRadius === "number" && partial.borderRadius >= 0
        ? Math.min(partial.borderRadius, 48)
        : current.borderRadius,
    accentColor:
      typeof partial.accentColor === "string" &&
      partial.accentColor.trim().length > 0
        ? partial.accentColor
        : current.accentColor
  };
}

function normalizeSharedDefaults(
  input: Record<string, unknown>
): PartialSharedOverlayDefaults {
  return {
    gameInfoOverlay: readOverlayStyleConfig(input.gameInfoOverlay),
    subscriberOverlay: readOverlayStyleConfig(input.subscriberOverlay),
    superChatOverlay: readOverlayStyleConfig(input.superChatOverlay),
    ...(typeof input.celebrationDurationMs === "number"
      ? { celebrationDurationMs: input.celebrationDurationMs }
      : {})
  };
}

function readOverlayStyleConfig(input: unknown): PartialOverlayStyleConfig {
  const record = readRecord(input);

  if (!record) {
    return {};
  }

  return {
    ...(isOverlayPosition(record.position) ? { position: record.position } : {}),
    ...(typeof record.width === "number" ? { width: record.width } : {}),
    ...(typeof record.backgroundColor === "string"
      ? { backgroundColor: record.backgroundColor }
      : {}),
    ...(typeof record.textColor === "string" ? { textColor: record.textColor } : {}),
    ...(typeof record.borderColor === "string"
      ? { borderColor: record.borderColor }
      : {}),
    ...(typeof record.borderWidth === "number"
      ? { borderWidth: record.borderWidth }
      : {}),
    ...(typeof record.borderRadius === "number"
      ? { borderRadius: record.borderRadius }
      : {}),
    ...(typeof record.accentColor === "string"
      ? { accentColor: record.accentColor }
      : {})
  };
}

function toSuperChatCelebration(
  chatEvent: NormalizedChatEvent
): SuperChatCelebration {
  return {
    kind: "superchat",
    eventId: chatEvent.eventId,
    displayName: chatEvent.author.displayName,
    amount: formatSuperChatAmount(chatEvent.message),
    message: chatEvent.message.text || "sent a Super Chat"
  };
}

function formatSuperChatAmount(
  message: NormalizedChatEvent["message"]
): string {
  if (message.amountDisplayString) {
    return message.amountDisplayString;
  }

  if (message.currency && message.amountMicros) {
    const amount = Number(message.amountMicros) / 1_000_000;
    if (Number.isFinite(amount)) {
      return `${message.currency} ${amount.toLocaleString("en-US", {
        maximumFractionDigits: 2,
        minimumFractionDigits: amount % 1 === 0 ? 0 : 2
      })}`;
    }
  }

  return message.currency ?? "Super Chat";
}

function buildCommandResult<TGameConfig>(
  command: RuntimeControlCommand,
  status: GameCommandResult["status"],
  error: string | undefined,
  state: SharedGameState<TGameConfig>
): GameCommandResult {
  return {
    commandId: command.commandId,
    streamId: command.streamId,
    deploymentId: command.deploymentId,
    runtimeInstanceId: command.runtimeInstanceId,
    status,
    appliedAt: new Date().toISOString(),
    ...(error ? { error } : {}),
    runtimeState: state.paused ? "paused" : "running"
  };
}

function readRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;
}

function stringField(input: unknown, key: string) {
  const record = readRecord(input);

  if (!record) {
    return undefined;
  }

  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isOverlayPosition(input: unknown): input is OverlayPosition {
  return (
    input === "top-left" ||
    input === "top-right" ||
    input === "bottom-left" ||
    input === "bottom-right"
  );
}
