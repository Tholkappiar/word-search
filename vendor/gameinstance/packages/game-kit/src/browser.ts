import {
  buildRejectedCommandResult,
  parseRuntimeControlCommand,
  type ConnectionStatus,
  type RuntimeControlCommand,
  type RuntimeWebSocket,
  type RuntimeWebSocketConstructor
} from "./index";

import { GameCommandResultSchema, type GameCommandResult } from "@repo/protocol";

export type RuntimeCommandClientOptions = {
  controlWsUrl?: string | undefined;
  WebSocketCtor?: RuntimeWebSocketConstructor | undefined;
  applyCommand(command: RuntimeControlCommand): GameCommandResult;
  onConnectionStatusChange?(status: ConnectionStatus): void;
  reconnectMs?: number | undefined;
  loggerName?: string | undefined;
  markStreamReady?: (() => void) | undefined;
  autoStart?: boolean | undefined;
  /** Maximum accepted commands plus terminal acknowledgements waiting for reconnect. */
  maxPendingCommands?: number | undefined;
  /** Completed command IDs remembered for deduplication, in completion order. */
  maxCompletedCommands?: number | undefined;
  /** Completed IDs expire after this many milliseconds; pending results never expire. */
  completedRetentionMs?: number | undefined;
};

export type RuntimeCommandClient = {
  start(): void;
  stop(): void;
  getConnectionStatus(): ConnectionStatus;
  /** Complete an accepted asynchronous/queued command without applying it twice. */
  reportResult(result: GameCommandResult): boolean;
};

export function configuredControlWsUrl(explicitUrl?: string) {
  const envUrl = import.meta.env.VITE_CONTROL_WS_URL ?? "";

  return (explicitUrl ?? envUrl).trim();
}

export function createRuntimeCommandClient({
  controlWsUrl,
  WebSocketCtor = globalThis.WebSocket as unknown as RuntimeWebSocketConstructor,
  applyCommand,
  onConnectionStatusChange,
  reconnectMs = 1000,
  loggerName = "game-kit",
  markStreamReady = markWindowStreamReady,
  autoStart = true,
  maxPendingCommands = 256,
  maxCompletedCommands = 2048,
  completedRetentionMs = 10 * 60 * 1000
}: RuntimeCommandClientOptions): RuntimeCommandClient {
  for (const [name, value] of Object.entries({ maxPendingCommands, maxCompletedCommands, completedRetentionMs })) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive safe integer`);
  }
  let socket: RuntimeWebSocket | null = null;
  let reconnectTimer: number | undefined;
  let active = false;
  let connectionStatus: ConnectionStatus = "connecting";
  const pendingCommands = new Map<string, { command: RuntimeControlCommand; result: GameCommandResult }>();
  const completedResults = new Map<string, { result: GameCommandResult; completedAt: number }>();
  const unsentResults = new Map<string, GameCommandResult>();

  const pruneCompleted = () => {
    const oldestAllowed = Date.now() - completedRetentionMs;
    for (const [id, entry] of completedResults) {
      if (completedResults.size <= maxCompletedCommands && entry.completedAt > oldestAllowed) break;
      completedResults.delete(id);
    }
  };

  const rememberCompleted = (result: GameCommandResult) => {
    completedResults.delete(result.commandId);
    completedResults.set(result.commandId, { result, completedAt: Date.now() });
    pruneCompleted();
  };

  const protectedCommandCount = () => {
    let count = pendingCommands.size;
    for (const result of unsentResults.values()) if (result.status !== "accepted") count++;
    return count;
  };

  const scopeMatches = (first: GameCommandResult, second: RuntimeControlCommand | GameCommandResult) =>
    first.streamId === second.streamId && first.deploymentId === second.deploymentId && first.runtimeInstanceId === second.runtimeInstanceId;

  const sendResult = (result: GameCommandResult) => {
    const queued = unsentResults.get(result.commandId);
    if (active && socket?.readyState === WebSocketCtor.OPEN) {
      try {
        socket.send(JSON.stringify(result));
        if (!queued || scopeMatches(queued, result)) unsentResults.delete(result.commandId);
        return;
      } catch {
        // A socket can close between readyState and send. Keep the final ACK for reconnect.
      }
    }
    // New work reserved a pending slot before execution. Overflow rejections do
    // not execute and cannot reserve unbounded extra ACKs while disconnected.
    const known = pendingCommands.get(result.commandId)?.result ?? queued ?? completedResults.get(result.commandId)?.result;
    if (known && !scopeMatches(known, result)) return;
    if (pendingCommands.has(result.commandId) || unsentResults.has(result.commandId) || protectedCommandCount() < maxPendingCommands) {
      unsentResults.set(result.commandId, result);
    }
  };

  const updateConnectionStatus = (status: ConnectionStatus) => {
    connectionStatus = status;
    onConnectionStatusChange?.(status);
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const applyIncomingCommand = (input: unknown) => {
    const command = parseRuntimeControlCommand(input);
    pruneCompleted();
    const cachedResult = pendingCommands.get(command.commandId)?.result ?? unsentResults.get(command.commandId) ?? completedResults.get(command.commandId)?.result;

    if (cachedResult) {
      return {
        result: scopeMatches(cachedResult, command) ? cachedResult : buildRejectedCommandResult(command, "Command ID is already in use in another runtime scope"),
        shouldAck: command.requireAck
      };
    }

    if (protectedCommandCount() >= maxPendingCommands) {
      const result = buildRejectedCommandResult(command, "Runtime command queue is full; complete pending commands before sending new commands");
      rememberCompleted(result);
      return { result, shouldAck: command.requireAck };
    }
    let result: GameCommandResult;
    try {
      result = GameCommandResultSchema.parse(applyCommand(command));
      if (result.commandId !== command.commandId || result.streamId !== command.streamId || result.deploymentId !== command.deploymentId || result.runtimeInstanceId !== command.runtimeInstanceId) throw new Error("Game returned an acknowledgement for a different command");
    } catch (error) {
      result = buildRejectedCommandResult(command, error instanceof Error ? error.message : "Game command failed");
    }
    if (result.status === "accepted") pendingCommands.set(command.commandId, { command, result });
    else rememberCompleted(result);

    console.info(`[${loggerName}] command applied`, {
      commandId: command.commandId,
      type: command.type,
      status: result.status
    });

    return {
      result,
      shouldAck: command.requireAck
    };
  };

  const connect = () => {
    const url = configuredControlWsUrl(controlWsUrl);
    clearReconnectTimer();

    if (!active) {
      return;
    }

    if (!url) {
      updateConnectionStatus("not-configured");
      markStreamReady();
      return;
    }

    updateConnectionStatus("connecting");

    try {
      const nextSocket = new WebSocketCtor(url);
      socket = nextSocket;

      nextSocket.onopen = () => {
        if (!active || socket !== nextSocket) {
          return;
        }

        updateConnectionStatus("connected");
        for (const result of unsentResults.values()) sendResult(result);
        markStreamReady();
      };

      nextSocket.onmessage = (event) => {
        if (!active || socket !== nextSocket) return;
        let application;
        let input: unknown;

        try {
          if (typeof event.data !== "string") {
            throw new Error("Expected WebSocket message data to be a string");
          }

          input = JSON.parse(event.data);
          application = applyIncomingCommand(input);
        } catch (error) {
          application = {
            result: buildRejectedCommandResult(
              input,
              error instanceof Error ? error.message : "Unknown command error"
            ),
            shouldAck: true
          };
        }

        if (application.shouldAck) sendResult(application.result);
      };

      nextSocket.onerror = () => {
        if (active && socket === nextSocket) {
          updateConnectionStatus("error");
          markStreamReady();
        }
      };

      nextSocket.onclose = () => {
        if (!active || socket !== nextSocket) {
          return;
        }

        updateConnectionStatus("disconnected");
        markStreamReady();
        reconnectTimer = window.setTimeout(connect, reconnectMs);
      };
    } catch (error) {
      console.error(`[${loggerName}] control WebSocket failed to initialize`, error);
      updateConnectionStatus("error");
      markStreamReady();
      reconnectTimer = window.setTimeout(connect, reconnectMs);
    }
  };

  const client: RuntimeCommandClient = {
    start() {
      if (active) {
        return;
      }

      active = true;
      connect();
    },
    stop() {
      active = false;
      clearReconnectTimer();
      socket?.close();
      socket = null;
    },
    getConnectionStatus() {
      return connectionStatus;
    },
    reportResult(input) {
      const result = GameCommandResultSchema.parse(input);
      const pending = pendingCommands.get(result.commandId);
      if (!pending || result.status === "accepted") return false;
      if (!scopeMatches(result, pending.command)) throw new Error("Command result scope does not match the queued command");
      pendingCommands.delete(result.commandId);
      rememberCompleted(result);
      if (pending.command.requireAck) sendResult(result);
      return true;
    }
  };

  if (autoStart) {
    client.start();
  }

  return client;
}

function markWindowStreamReady() {
  window.__STREAM_READY__ = true;
}

declare global {
  interface ImportMetaEnv {
    readonly VITE_CONTROL_WS_URL?: string;
  }

  interface ImportMeta {
    readonly env: ImportMetaEnv;
  }

  interface Window {
    __STREAM_READY__?: boolean;
  }
}
