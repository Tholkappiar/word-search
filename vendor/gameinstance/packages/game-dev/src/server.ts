import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import {
  GameCommandSchema, GameCommandResultSchema, NormalizedChatEventSchema, NormalizedSubscriberEventSchema,
  chatEventToGameCommand, subscriberEventToGameCommand,
  type GameCommand, type GameCommandResult
} from "@repo/protocol";
import { debugOperations, type DebugCapabilities, type DevHistoryEntry, type DevOperation, type DevScenario, type DevStatus, type LocalDevConnection } from "./types.js";

export class DevOperationError extends Error {
  constructor(message: string, readonly statusCode = 400) { super(message); }
}
type Pending = { channel: "game" | "debug"; resolve(value: unknown): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> };
export type GameDevServerOptions = { gameOrigin?: string; port?: number; acknowledgementTimeoutMs?: number; historyLimit?: number; pendingCommandLimit?: number; completedCommandLimit?: number };

/** The development server is a local session, never an orchestrator or persisted stream. */
export class GameDevServer {
  readonly sessionId = randomUUID();
  private readonly token = randomBytes(32).toString("hex");
  private readonly server = createServer((request, response) => { void this.handleHttp(request, response); });
  private readonly sockets = new WebSocketServer({ noServer: true, maxPayload: 1_048_576 });
  private game: WebSocket | undefined;
  private debugger: WebSocket | undefined;
  private capabilities: DebugCapabilities = {};
  private state: unknown = null;
  private readonly pending = new Map<string, Pending>();
  private readonly commands = new Map<string, GameCommand>();
  private readonly results = new Map<string, GameCommandResult>();
  private readonly inflight = new Map<string, Promise<unknown>>();
  private readonly interruptedCommands = new Set<string>();
  private readonly history: DevHistoryEntry[] = [];
  private connection: LocalDevConnection | undefined;
  private closed = false;

  constructor(private readonly options: GameDevServerOptions = {}) {
    if (options.gameOrigin) {
      const origin = new URL(options.gameOrigin);
      if (origin.protocol !== "http:" || !["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname)) throw new Error("Game dev requires a loopback HTTP game origin");
    }
    this.server.on("upgrade", (request, socket, head) => {
      const url = this.requestUrl(request);
      if (!url || !this.validHost(request) || !this.validOrigin(request) || !this.validToken(url.searchParams.get("token")) ||
          ![this.path("game"), this.path("debug")].includes(url.pathname)) { socket.destroy(); return; }
      this.sockets.handleUpgrade(request, socket, head, client => this.attach(client, url.pathname.endsWith("/debug")));
    });
  }

  async start(): Promise<LocalDevConnection> {
    if (this.closed) throw new Error("Game dev session has closed");
    if (this.connection) return this.connection;
    await new Promise<void>((resolve, reject) => { this.server.once("error", reject); this.server.listen(this.options.port ?? 0, "127.0.0.1", () => { this.server.removeListener("error", reject); resolve(); }); });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("Missing game dev listener");
    const origin = `http://127.0.0.1:${address.port}`;
    this.connection = { sessionId: this.sessionId, token: this.token, apiUrl: origin + this.path("operations"),
      controlWsUrl: `${origin.replace("http:", "ws:")}${this.path("game")}?token=${this.token}`,
      debugWsUrl: `${origin.replace("http:", "ws:")}${this.path("debug")}?token=${this.token}` };
    return this.connection;
  }

  status(): DevStatus {
    return { sessionId: this.sessionId, gameConnected: this.game?.readyState === WebSocket.OPEN,
      debugConnected: this.debugger?.readyState === WebSocket.OPEN, capabilities: { ...this.capabilities },
      state: this.state, history: this.history.map(entry => ({ ...entry })) };
  }

  async execute(operation: DevOperation): Promise<unknown> {
    assertOperation(operation);
    if (this.closed) throw new DevOperationError("Session has closed", 410);
    if (operation.op === "status") return this.status();
    if (operation.op === "state") return this.state;
    // Dispatch is ordered by the event loop. Waiting for a queued game's terminal
    // ACK must not block debugger resume/step, which can complete that input.
    return this.perform(operation);
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    this.rejectPending("Game dev session stopped");
    for (const client of this.sockets.clients) client.terminate();
    await new Promise<void>(resolve => this.sockets.close(() => resolve()));
    if (this.server.listening) await new Promise<void>(resolve => this.server.close(() => resolve()));
  }

  private async perform(operation: DevOperation): Promise<unknown> {
    if (operation.op === "scenario" && !operation.input?.action) {
      const scenario = operation.input as unknown as DevScenario;
      if (!scenario || typeof scenario.name !== "string" || !Array.isArray(scenario.steps) || scenario.steps.length > 250) throw new DevOperationError("A scenario needs a name and at most 250 steps");
      const outputs: unknown[] = [];
      for (const [index, step] of scenario.steps.entries()) {
        assertOperation(step);
        if (step.op === "scenario") throw new DevOperationError("Nested scenarios are not supported");
        const result = step.op === "status" ? this.status() : step.op === "state" ? this.state : await this.perform(step);
        outputs.push(result);
        if (["rejected", "failed", "expired"].includes((result as { status?: string } | undefined)?.status ?? "")) throw new DevOperationError(`Scenario ${scenario.name} stopped at step ${index + 1}: game ${(result as { status: string }).status} the operation`, 409);
      }
      return { name: scenario.name, steps: outputs };
    }
    const entry: DevHistoryEntry = { id: randomUUID(), at: new Date().toISOString(), operation, status: "pending" };
    this.history.push(entry);
    this.history.splice(0, Math.max(0, this.history.length - (this.options.historyLimit ?? 200)));
    try {
      const input = operation.input ?? {};
      let result: unknown;
      if (["command", "chat", "subscriber", "superchat"].includes(operation.op)) { const command = this.buildCommand(operation); entry.commandId = command.commandId; result = await this.sendCommand(command); }
      else if (debugOperations.includes(operation.op as typeof debugOperations[number])) {
        if (!this.capabilities[operation.op as typeof debugOperations[number]] || this.debugger?.readyState !== WebSocket.OPEN) throw new DevOperationError(`${operation.op} is unavailable in this game`, 409);
        result = await this.request(this.debugger, entry.id, { type: "dev.operation", requestId: entry.id, op: operation.op, input });
      } else throw new DevOperationError(`Unknown operation: ${operation.op}`);
      entry.result = entry.commandId ? this.results.get(entry.commandId) ?? result : result;
      const status = (entry.result as { status?: string } | undefined)?.status;
      entry.status = status === "accepted" ? "accepted" : status === "rejected" ? "rejected" : status === "failed" || status === "expired" ? "failed" : "applied";
      return result;
    } catch (error) {
      entry.status = error instanceof Error && error.message.includes("disconnected") ? "interrupted" : "failed"; entry.error = error instanceof Error ? error.message : "Operation failed";
      throw error;
    }
  }

  private buildCommand(operation: DevOperation): GameCommand {
    const input = operation.input ?? {};
    const target = { streamId: `dev_${this.sessionId}`, deploymentId: `dev_${this.sessionId}`, runtimeInstanceId: `dev_${this.sessionId}` };
    const now = new Date().toISOString();
    if (operation.op === "command") return GameCommandSchema.parse({ ...target, commandId: typeof input.commandId === "string" ? input.commandId : randomUUID(),
      issuedBy: "local-developer", issuedAt: now, type: input.type, payload: input.payload ?? {}, requireAck: true });
    if (operation.op === "subscriber") return subscriberEventToGameCommand(NormalizedSubscriberEventSchema.parse({
      eventId: input.eventId ?? randomUUID(), ...target, youtubeAccountId: "local-simulator", subscriberDisplayName: input.displayName ?? "Local subscriber", receivedAt: now }), target, now);
    return chatEventToGameCommand(NormalizedChatEventSchema.parse({ eventId: input.eventId ?? randomUUID(), ...target,
      receivedAt: now, author: { displayName: input.displayName ?? "Local player", ...(typeof input.authorId === "string" ? { id: input.authorId } : {}) },
      message: { text: input.text ?? "", type: operation.op === "superchat" ? "superchat" : "text",
        ...(operation.op === "superchat" ? { amountMicros: input.amountMicros ?? "5000000", currency: input.currency ?? "USD", amountDisplayString: input.amountDisplayString ?? "$5.00" } : {}) } }), target, now);
  }

  private async sendCommand(command: GameCommand) {
    if (this.game?.readyState !== WebSocket.OPEN) throw new DevOperationError("Open the game in a browser before sending commands", 409);
    const cached = this.results.get(command.commandId);
    if (cached) return cached;
    const pending = this.inflight.get(command.commandId);
    if (pending) return pending;
    if (this.interruptedCommands.has(command.commandId)) throw new DevOperationError("This command was interrupted; inspect current state before sending a new command ID", 409);
    const unresolved = [...this.commands.keys()].filter(id => !this.results.get(id) || this.results.get(id)?.status === "accepted").length;
    if (unresolved >= (this.options.pendingCommandLimit ?? 500)) throw new DevOperationError("The local session has too many queued or interrupted commands; resume the engine or restart the dev session", 429);
    this.commands.set(command.commandId, command);
    const receipt = this.request(this.game, command.commandId, command);
    this.inflight.set(command.commandId, receipt);
    void receipt.finally(() => this.inflight.delete(command.commandId)).catch(() => undefined);
    return receipt;
  }

  private request(socket: WebSocket, id: string, message: unknown) {
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new DevOperationError("Browser acknowledgement timed out", 504)); }, this.options.acknowledgementTimeoutMs ?? 5000);
      this.pending.set(id, { channel: socket === this.game ? "game" : "debug", resolve, reject, timer });
      socket.send(JSON.stringify(message), error => { if (error) this.complete(id, undefined, error); });
    });
  }

  private attach(client: WebSocket, debug: boolean) {
    // A local session has exactly one game and one debug adapter.
    const existing = debug ? this.debugger : this.game;
    if (existing?.readyState === WebSocket.OPEN) { client.close(1008, "A browser is already connected to this session"); return; }
    if (debug) this.debugger = client; else this.game = client;
    client.on("message", data => {
      try {
        const message = JSON.parse(String(data)) as Record<string, unknown>;
        if (debug) {
          if (message.type === "dev.snapshot") { this.state = message.state; this.capabilities = parseCapabilities(message.capabilities); }
          if (message.type === "dev.result" && typeof message.requestId === "string") {
            if (message.state !== undefined) this.state = message.state;
            this.complete(message.requestId, message.result, typeof message.error === "string" ? new DevOperationError(message.error, 409) : undefined);
          }
        } else {
          const result = GameCommandResultSchema.parse(message);
          const command = this.commands.get(result.commandId);
          if (!command || result.streamId !== command.streamId || result.deploymentId !== command.deploymentId || result.runtimeInstanceId !== command.runtimeInstanceId) { client.close(1008, "Result does not belong to this session"); return; }
          if (this.results.get(result.commandId)?.status !== "accepted" && this.results.has(result.commandId)) return;
          this.results.set(result.commandId, result);
          this.interruptedCommands.delete(result.commandId);
          for (const entry of this.history) if (entry.commandId === result.commandId) {
            entry.status = result.status === "accepted" ? "accepted" : result.status === "applied" ? "applied" : result.status === "rejected" ? "rejected" : "failed";
            entry.result = result;
          }
          // Accepted is an honest receipt, not application. Frozen inputs can
          // remain queued while editing; their later terminal ACK updates history.
          this.complete(result.commandId, result);
          this.pruneCompletedCommands();
        }
      } catch { client.close(1008, "Invalid game dev message"); }
    });
    client.on("close", () => {
      if (debug && this.debugger === client) { this.debugger = undefined; this.capabilities = {}; }
      if (!debug && this.game === client) {
        this.game = undefined;
        for (const [id, command] of this.commands) {
          if (!this.results.get(id) || this.results.get(id)?.status === "accepted") {
            this.results.delete(id); this.interruptedCommands.add(command.commandId);
            for (const entry of this.history) if (entry.commandId === id) { entry.status = "interrupted"; entry.error = "Game connection lost before terminal application was confirmed"; }
          }
        }
      }
      this.rejectPending("Browser disconnected before acknowledging the operation", debug ? "debug" : "game");
    });
    client.on("error", () => undefined);
  }

  private complete(id: string, value?: unknown, error?: Error) {
    const pending = this.pending.get(id); if (!pending) return;
    clearTimeout(pending.timer); this.pending.delete(id); error ? pending.reject(error) : pending.resolve(value);
  }
  private pruneCompletedCommands() {
    const completed = [...this.results].filter(([, result]) => result.status !== "accepted");
    for (const [id] of completed.slice(0, Math.max(0, completed.length - (this.options.completedCommandLimit ?? 500)))) { this.results.delete(id); this.commands.delete(id); }
  }
  private rejectPending(reason: string, channel?: Pending["channel"]) { for (const [id, pending] of this.pending) if (!channel || pending.channel === channel) this.complete(id, undefined, new DevOperationError(reason, 409)); }
  private path(suffix: string) { return `/sessions/${this.sessionId}/${suffix}`; }
  private requestUrl(request: IncomingMessage) { try { return new URL(request.url ?? "/", "http://127.0.0.1"); } catch { return undefined; } }
  private validToken(input: string | null | undefined) { return !!input && Buffer.byteLength(input) === Buffer.byteLength(this.token) && timingSafeEqual(Buffer.from(input), Buffer.from(this.token)); }
  private validHost(request: IncomingMessage) { return !!request.headers.host && /^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(request.headers.host); }
  private validOrigin(request: IncomingMessage) { const origin = request.headers.origin; return !origin || origin === this.options.gameOrigin || origin === this.connection?.apiUrl.split("/sessions/")[0]; }

  private async handleHttp(request: IncomingMessage, response: ServerResponse) {
    const send = (code: number, value: unknown) => { response.writeHead(code, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(value)); };
    if (!this.validHost(request) || !this.validOrigin(request)) { send(403, { error: "Local origin rejected" }); return; }
    if (request.headers.origin && this.validOrigin(request)) response.setHeader("access-control-allow-origin", request.headers.origin);
    if (request.method === "OPTIONS") { response.setHeader("access-control-allow-headers", "authorization,content-type"); response.setHeader("access-control-allow-methods", "POST"); send(204, undefined); return; }
    if (!this.validToken(request.headers.authorization?.replace(/^Bearer /, ""))) { send(401, { error: "Local session credential required" }); return; }
    const url = this.requestUrl(request);
    if (url?.pathname !== this.path("operations")) { send(404, { error: "Session not found" }); return; }
    if (request.method !== "POST") { send(405, { error: "Use POST for session operations" }); return; }
    try {
      const chunks: Buffer[] = []; let bytes = 0;
      for await (const chunk of request) { const buffer = Buffer.from(chunk); chunks.push(buffer); bytes += buffer.length; if (bytes > 1_048_576) throw new DevOperationError("Request is too large", 413); }
      const operation: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8")); assertOperation(operation);
      send(200, { result: await this.execute(operation) });
    } catch (error) { send(error instanceof DevOperationError ? error.statusCode : 400, { error: error instanceof Error ? error.message : "Invalid operation" }); }
  }
}

export function assertOperation(value: unknown): asserts value is DevOperation {
  if (!value || typeof value !== "object" || typeof (value as DevOperation).op !== "string" ||
      !["status", "state", "command", "chat", "subscriber", "superchat", "scenario", ...debugOperations].includes((value as DevOperation).op)) throw new DevOperationError("Unknown local operation");
  const input = (value as DevOperation).input;
  if (input !== undefined && (!input || typeof input !== "object" || Array.isArray(input))) throw new DevOperationError("Operation input must be an object");
}
function parseCapabilities(input: unknown): DebugCapabilities {
  if (!input || typeof input !== "object") return {};
  return Object.fromEntries(debugOperations.map(op => [op, (input as Record<string, unknown>)[op] === true]));
}
