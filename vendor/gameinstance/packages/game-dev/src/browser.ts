import { debugOperations, type DebugCapabilities, type GameDevAdapter, type DevOperation, type DevStatus } from "./types.js";
import { installInspector } from "./inspector.js";

export type EngineDebugSurface = {
  getSnapshot(): unknown;
  getInspectorFields(): unknown;
  getHistory(): unknown;
  getStartingConfig(): unknown;
  setStartingConfig(config: unknown): unknown;
  patch(changes: { path: string; value: unknown }[]): unknown;
  freeze(): unknown;
  resume(options: { pending: "apply" | "discard" | "keep" }): unknown;
  seek(tick: number): unknown;
  step(ticks?: number): unknown;
  replay(toTick?: number): unknown;
  selectBranch(branch: "original" | "edited"): unknown;
  keepBranch?(): unknown;
  discardBranch?(): unknown;
  getTimeScale?(): number;
  setTimeScale?(timeScale: number): unknown;
  restart?(): unknown;
  exportScenario?(options?: { regression?: boolean }): unknown;
  loadScenario?(scenario: unknown): unknown;
  evaluateAssertions?(assertions?: unknown): unknown;
  subscribe(listener: () => void): () => void;
};

/** Adapter for the deterministic engine. No browser introspection or guessed state. */
export function engineDevAdapter(engine: EngineDebugSurface): GameDevAdapter {
  return {
    getSnapshot: () => ({ ...(engine.getSnapshot() as object), startingConfig: engine.getStartingConfig(), inspector: engine.getInspectorFields(), history: engine.getHistory() }),
    getCapabilities: () => Object.fromEntries(debugOperations.map(op => [op, op === "scenario" ? !!engine.exportScenario && !!engine.loadScenario : op === "slowmotion" ? !!engine.setTimeScale : op === "restart" ? !!engine.restart : true])),
    patch(input) {
      if (input.target === "startingConfig") return engine.setStartingConfig(input.config);
      if (!Array.isArray(input.changes) || input.changes.some(change => !change || typeof change !== "object" || typeof change.path !== "string")) throw new Error("patch needs changes: [{path, value}]");
      return engine.patch(input.changes as { path: string; value: unknown }[]);
    },
    freeze(input) {
      if (input.frozen === false) {
        if (input.pending !== undefined && !["apply", "discard", "keep"].includes(String(input.pending))) throw new Error("pending must be apply, discard, or keep");
        return engine.resume({ pending: input.pending as "apply" | "discard" | "keep" ?? "apply" });
      }
      return engine.freeze();
    },
    seek(input) {
      if (input.action === "keep") { if (!engine.keepBranch) throw new Error("Keeping branches is unavailable"); return engine.keepBranch(); }
      if (input.action === "discard") { if (!engine.discardBranch) throw new Error("Discarding branches is unavailable"); return engine.discardBranch(); }
      const tick = integer(input.tick, "tick", 0);
      if (input.branch !== undefined) {
        if (input.branch !== "original" && input.branch !== "edited") throw new Error("Unknown history branch");
        engine.selectBranch(input.branch);
      }
      return engine.seek(tick);
    },
    step: input => engine.step(integer(input.ticks ?? 1, "ticks", 1)),
    replay: input => engine.replay(input.toTick === undefined ? undefined : integer(input.toTick, "toTick", 0)),
    restart() { if (!engine.restart) throw new Error("Restart is unavailable in this game"); return engine.restart(); },
    slowmotion(input) {
      if (!engine.setTimeScale) throw new Error("Slow motion is unavailable in this game");
      if (typeof input.timeScale !== "number" || !Number.isFinite(input.timeScale) || input.timeScale < 0.1 || input.timeScale > 4) throw new Error("timeScale must be between 0.1 and 4");
      return engine.setTimeScale(input.timeScale);
    },
    scenario(input) {
      if (!engine.exportScenario || !engine.loadScenario) throw new Error("Scenario capture is unavailable in this game");
      if (input.action === "export" || input.action === "capture") return engine.exportScenario();
      if (input.action === "record") {
        engine.freeze();
        const snapshot = engine.getSnapshot() as { tick?: number; inputCursor?: number };
        const capture = engine.exportScenario({ regression: true }) as { endTick?: number; inputs?: Array<{ tick?: number; inputCursor?: number }>; assertions?: Array<{ tick?: number; path?: string; kind?: string; value?: unknown }> } | undefined;
        if (!capture || !Number.isSafeInteger(snapshot.tick) || !Number.isSafeInteger(snapshot.inputCursor) || capture.endTick !== snapshot.tick ||
            !Array.isArray(capture.inputs) || capture.inputs.some(input => !Number.isSafeInteger(input?.tick) || !Number.isSafeInteger(input?.inputCursor) || input.tick! > snapshot.tick! || input.inputCursor! > snapshot.inputCursor!) ||
            !Array.isArray(capture.assertions) || !capture.assertions.some(assertion => assertion?.kind === "hash" && assertion.path === "" && assertion.tick === snapshot.tick && typeof assertion.value === "string")) {
          throw new Error("The game engine did not provide regression assertions for the selected state. Update its SDK before recording a regression.");
        }
        return capture;
      }
      if (input.action === "import") return engine.loadScenario(input.data);
      if (input.action === "replay") {
        if (input.data !== undefined) engine.loadScenario(input.data);
        // Imported scenarios can span more than the rolling history window.
        // Assertions inspect that baseline before replay is allowed to prune it.
        const assertions = engine.evaluateAssertions?.() ?? [];
        const snapshot = engine.replay();
        const passed = !Array.isArray(assertions) || assertions.every(assertion => assertion.passed !== false);
        // Keep each expected/actual value and tick available to the inspector,
        // HTTP clients and CLI, whose failure exit code uses this status.
        return { status: passed ? "applied" : "failed", passed, snapshot, assertions };
      }
      throw new Error("Scenario action must be export, record, import, or replay");
    },
    subscribe: listener => engine.subscribe(listener)
  };
}

export type RegisterGameDevOptions = { enabled?: boolean; debugWsUrl?: string; inspector?: boolean; reconnectMs?: number };
export function registerGameDev(adapter: GameDevAdapter, options: RegisterGameDevOptions = {}): () => void {
  // Runtime containers also run Vite in development mode. An explicit launcher flag is essential.
  // Keep the property access on import.meta so Vite can replace it in browser output.
  const environment = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
  const enabled = options.enabled ?? environment.VITE_GAMEINSTANCE_DEV_ENABLED === "true";
  const urlString = options.debugWsUrl ?? environment.VITE_GAMEINSTANCE_DEBUG_WS_URL;
  if (!enabled || !urlString) return () => undefined;
  const url = new URL(urlString);
  if (url.protocol !== "ws:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) throw new Error("Game dev connection must be local");
  const token = url.searchParams.get("token");
  if (!token || !url.pathname.endsWith("/debug")) throw new Error("Missing local game dev session");
  const apiUrl = `${url.origin.replace("ws:", "http:")}${url.pathname.replace(/\/debug$/, "/operations")}`;
  const operate = async (operation: DevOperation) => {
    const response = await fetch(apiUrl, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(operation) });
    const value = await response.json() as { result?: unknown; error?: string };
    if (!response.ok) throw new Error(value.error ?? "Local operation failed");
    return value.result;
  };
  let socket: WebSocket | undefined;
  let stopped = false;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let snapshotTimer: ReturnType<typeof setTimeout> | undefined;
  const sendSnapshot = () => {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "dev.snapshot", state: adapter.getSnapshot(), capabilities: adapter.getCapabilities() }));
  };
  const scheduleSnapshot = () => {
    if (!snapshotTimer) snapshotTimer = setTimeout(() => { snapshotTimer = undefined; sendSnapshot(); }, 100);
  };
  const connect = () => {
    if (stopped) return;
    const connectedSocket = new WebSocket(urlString);
    socket = connectedSocket;
    connectedSocket.onopen = sendSnapshot;
    connectedSocket.onmessage = event => {
      void (async () => {
        const message = JSON.parse(String(event.data)) as { type?: string; requestId?: string; op?: string; input?: Record<string, unknown> };
        if (message.type !== "dev.operation" || !message.requestId || !debugOperations.includes(message.op as typeof debugOperations[number])) return;
        const op = message.op as typeof debugOperations[number];
        try {
          if (!adapter.getCapabilities()[op] || !adapter[op]) throw new Error(`${op} is unavailable in this game`);
          const result = await adapter[op]!(message.input ?? {});
          if (connectedSocket.readyState === WebSocket.OPEN) connectedSocket.send(JSON.stringify({ type: "dev.result", requestId: message.requestId, result: result ?? null, state: adapter.getSnapshot() }));
        } catch (error) { if (connectedSocket.readyState === WebSocket.OPEN) connectedSocket.send(JSON.stringify({ type: "dev.result", requestId: message.requestId, error: error instanceof Error ? error.message : "Debug operation failed" })); }
      })().catch(() => undefined);
    };
    connectedSocket.onclose = () => { if (!stopped && socket === connectedSocket) reconnect = setTimeout(connect, options.reconnectMs ?? 1000); };
    connectedSocket.onerror = () => undefined;
  };
  connect();
  const unsubscribe = adapter.subscribe?.(scheduleSnapshot);
  // Adapters without notifications still expose current state.
  const poll = setInterval(sendSnapshot, 1000);
  const cleanupInspector = options.inspector === false ? undefined : installInspector({ operate, getSnapshot: () => adapter.getSnapshot(), getCapabilities: () => adapter.getCapabilities() });
  const cleanup = () => {
    stopped = true; clearTimeout(reconnect); clearTimeout(snapshotTimer); clearInterval(poll);
    socket?.close(); unsubscribe?.(); cleanupInspector?.();
  };
  (import.meta as unknown as { hot?: { dispose(callback: () => void): void } }).hot?.dispose(cleanup);
  return cleanup;
}

function integer(value: unknown, label: string, minimum: number) {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > 10_000_000) throw new Error(`${label} must be an integer between ${minimum} and 10000000`);
  return value;
}
export type { GameDevAdapter, DebugCapabilities, DevOperation, DevStatus };
