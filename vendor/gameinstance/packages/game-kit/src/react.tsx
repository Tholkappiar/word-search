import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  type Celebration,
  type ConnectionStatus,
  type OverlayStyleConfig,
  type RuntimeControlCommand,
  type RuntimeWebSocketConstructor
} from "./index";
import {
  configuredControlWsUrl,
  createRuntimeCommandClient
} from "./browser";

import type { GameCommandResult } from "@repo/protocol";

export type UseRuntimeCommandSocketOptions = {
  controlWsUrl?: string | undefined;
  WebSocketCtor?: RuntimeWebSocketConstructor | undefined;
  applyCommand(command: RuntimeControlCommand): GameCommandResult;
  onConnectionStatusChange?(status: ConnectionStatus): void;
  reconnectMs?: number | undefined;
  loggerName?: string | undefined;
};

export type GameInfoOverlayItem = {
  label: string;
  value: string;
  testId?: string;
};

export type GameInfoOverlayProps = {
  items: GameInfoOverlayItem[];
  config: OverlayStyleConfig;
  className?: string;
};

export type CelebrationOverlayProps = {
  celebration: Celebration;
  config: OverlayStyleConfig;
  className?: string;
};

const defaultConnectionStatus: ConnectionStatus = "connecting";

export { configuredControlWsUrl };

export function useRuntimeCommandSocket({
  controlWsUrl,
  WebSocketCtor = globalThis.WebSocket as unknown as RuntimeWebSocketConstructor,
  applyCommand,
  onConnectionStatusChange,
  reconnectMs = 1000,
  loggerName = "game-kit"
}: UseRuntimeCommandSocketOptions): ConnectionStatus {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>(
    defaultConnectionStatus
  );
  const applyCommandRef = useRef(applyCommand);
  const readyRef = useRef(false);

  useEffect(() => {
    applyCommandRef.current = applyCommand;
  }, [applyCommand]);

  const updateConnectionStatus = useCallback(
    (status: ConnectionStatus) => {
      setConnectionStatus(status);
      onConnectionStatusChange?.(status);
    },
    [onConnectionStatusChange]
  );

  const markStreamReady = useCallback(() => {
    if (!readyRef.current) {
      window.__STREAM_READY__ = true;
      readyRef.current = true;
    }
  }, []);

  useEffect(() => {
    const client = createRuntimeCommandClient({
      controlWsUrl,
      WebSocketCtor,
      applyCommand: (command) => applyCommandRef.current(command),
      onConnectionStatusChange: updateConnectionStatus,
      reconnectMs,
      loggerName,
      markStreamReady
    });

    return () => {
      client.stop();
    };
  }, [
    WebSocketCtor,
    controlWsUrl,
    loggerName,
    markStreamReady,
    reconnectMs,
    updateConnectionStatus
  ]);

  return connectionStatus;
}

export function useCelebrationQueue(
  celebrationQueue: Celebration[],
  dequeueCelebration: () => void,
  durationMs: number
) {
  const [activeCelebration, setActiveCelebration] = useState<
    Celebration | undefined
  >();

  useEffect(() => {
    if (activeCelebration || celebrationQueue.length === 0) {
      return undefined;
    }

    const nextCelebration = celebrationQueue[0];

    if (!nextCelebration) {
      return undefined;
    }

    setActiveCelebration(nextCelebration);
    dequeueCelebration();

    return undefined;
  }, [activeCelebration, celebrationQueue, dequeueCelebration]);

  useEffect(() => {
    if (!activeCelebration) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      setActiveCelebration(undefined);
    }, durationMs);

    return () => window.clearTimeout(timeout);
  }, [activeCelebration, durationMs]);

  return activeCelebration;
}

export function DefaultGameInfoOverlay({
  items,
  config,
  className
}: GameInfoOverlayProps) {
  return (
    <aside
      className={className}
      style={overlayStyle(config)}
      aria-label="Runtime overlay"
    >
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong data-testid={item.testId}>{item.value}</strong>
        </div>
      ))}
    </aside>
  );
}

export function DefaultSubscriberCelebration({
  celebration,
  config,
  className
}: CelebrationOverlayProps) {
  if (celebration.kind !== "subscriber") {
    return null;
  }

  return (
    <div
      className={className}
      data-testid="subscriber-celebration"
      style={overlayStyle(config)}
    >
      {celebration.profileImageUrl ? (
        <img alt="" src={celebration.profileImageUrl} referrerPolicy="no-referrer" />
      ) : (
        <span className="subscriber-avatar-fallback">
          {celebration.displayName.slice(0, 1).toUpperCase()}
        </span>
      )}
      <div>
        <span>New subscriber</span>
        <strong>{celebration.displayName}</strong>
      </div>
    </div>
  );
}

export function DefaultSuperChatCelebration({
  celebration,
  config,
  className
}: CelebrationOverlayProps) {
  if (celebration.kind !== "superchat") {
    return null;
  }

  return (
    <div
      className={className}
      data-testid="superchat-celebration"
      style={overlayStyle(config)}
    >
      <div className="superchat-amount">{celebration.amount}</div>
      <div className="superchat-copy">
        <span>Super Chat</span>
        <strong>{celebration.displayName}</strong>
        <p>{celebration.message}</p>
      </div>
    </div>
  );
}

function overlayStyle(config: OverlayStyleConfig): CSSProperties {
  return {
    ...positionStyle(config.position),
    width: `${config.width}px`,
    backgroundColor: config.backgroundColor,
    color: config.textColor,
    borderStyle: "solid",
    borderColor: config.borderColor,
    borderWidth: `${config.borderWidth}px`,
    borderRadius: `${config.borderRadius}px`,
    ["--overlay-text-color" as string]: config.textColor,
    ["--accent-color" as string]: config.accentColor
  };
}

function positionStyle(position: OverlayStyleConfig["position"]): CSSProperties {
  switch (position) {
    case "top-left":
      return { top: "32px", right: "auto", bottom: "auto", left: "32px" };
    case "top-right":
      return { top: "32px", right: "32px", bottom: "auto", left: "auto" };
    case "bottom-right":
      return { top: "auto", right: "32px", bottom: "32px", left: "auto" };
    case "bottom-left":
    default:
      return { top: "auto", right: "auto", bottom: "32px", left: "32px" };
  }
}

declare global {
  interface Window {
    __STREAM_READY__?: boolean;
  }
}
