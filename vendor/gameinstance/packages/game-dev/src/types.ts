export const debugOperations = ["patch", "freeze", "seek", "step", "replay", "scenario", "slowmotion", "restart"] as const;
export type DebugOperation = typeof debugOperations[number];
export type DebugCapabilities = Partial<Record<DebugOperation, boolean>>;
export type DevOperation = {
  op: "status" | "state" | "command" | "chat" | "subscriber" | "superchat" | DebugOperation | "scenario";
  input?: Record<string, unknown>;
};
export type DevScenario = { name: string; steps: DevOperation[] };
export interface GameDevAdapter {
  getSnapshot(): unknown;
  getCapabilities(): DebugCapabilities;
  patch?(input: Record<string, unknown>): unknown | Promise<unknown>;
  freeze?(input: Record<string, unknown>): unknown | Promise<unknown>;
  seek?(input: Record<string, unknown>): unknown | Promise<unknown>;
  step?(input: Record<string, unknown>): unknown | Promise<unknown>;
  replay?(input: Record<string, unknown>): unknown | Promise<unknown>;
  scenario?(input: Record<string, unknown>): unknown | Promise<unknown>;
  slowmotion?(input: Record<string, unknown>): unknown | Promise<unknown>;
  restart?(input: Record<string, unknown>): unknown | Promise<unknown>;
  subscribe?(listener: () => void): () => void;
}
export type DevHistoryEntry = { id: string; commandId?: string; at: string; operation: DevOperation; status: "pending" | "accepted" | "applied" | "rejected" | "failed" | "interrupted"; result?: unknown; error?: string };
export type DevStatus = {
  sessionId: string;
  gameConnected: boolean;
  debugConnected: boolean;
  capabilities: DebugCapabilities;
  state: unknown;
  history: DevHistoryEntry[];
};
export type LocalDevConnection = { sessionId: string; apiUrl: string; token: string; controlWsUrl: string; debugWsUrl: string };
