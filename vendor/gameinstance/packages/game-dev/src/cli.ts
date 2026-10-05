#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { GameDevServer } from "./server.js";
import { runRuntimeCheck } from "./runtime-check.js";
import type { DevOperation, LocalDevConnection } from "./types.js";

export const sessionFileName = path.join(".gameinstance", "dev-session.json");
export function parseCliOperation(args: string[]): DevOperation {
  const [op, ...rest] = args;
  const json = (input: string | undefined) => {
    const value: unknown = JSON.parse(input ?? "{}");
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Input JSON must be an object");
    return value as Record<string, unknown>;
  };
  switch (op) {
    case "status": case "state": case "replay": case "restart": return { op, input: json(rest[0]) };
    case "command": return { op, input: { type: rest[0], ...(rest[1] ? json(rest[1]) : {}) } };
    case "chat": case "superchat": return { op, input: rest[0]?.startsWith("{") ? json(rest[0]) : { text: rest.join(" ") } };
    case "subscriber": return { op, input: rest[0]?.startsWith("{") ? json(rest[0]) : { displayName: rest.join(" ") || "Local subscriber" } };
    case "patch": return { op, input: json(rest[0]) };
    case "freeze": return { op, input: rest[0]?.startsWith("{") ? json(rest[0]) : { frozen: rest[0] !== "false" } };
    case "seek": return { op, input: rest[0]?.startsWith("{") ? json(rest[0]) : { tick: Number(rest[0]) } };
    case "step": return { op, input: rest[0]?.startsWith("{") ? json(rest[0]) : { ticks: Number(rest[0] ?? 1) } };
    case "slowmotion": return { op, input: rest[0]?.startsWith("{") ? json(rest[0]) : { timeScale: Number(rest[0] ?? 1) } };
    case "scenario": return { op, input: rest[0]?.startsWith("{") ? json(rest[0]) : { action: rest[0] ?? "export" } };
    default: throw new Error("Use dev, status, state, command, chat, subscriber, superchat, patch, freeze, seek, step, replay, restart, slowmotion, or scenario");
  }
}

export async function executeLocalOperation(connection: LocalDevConnection, operation: DevOperation): Promise<unknown> {
  const url = new URL(connection.apiUrl);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.pathname !== `/sessions/${connection.sessionId}/operations`) throw new Error("Session file must name a loopback game dev session");
  const response = await fetch(connection.apiUrl, { method: "POST", headers: { authorization: `Bearer ${connection.token}`, "content-type": "application/json" }, body: JSON.stringify(operation), signal: AbortSignal.timeout(operation.op === "scenario" ? 120_000 : 10_000), redirect: "error" });
  const value = await response.json() as { result?: unknown; error?: string };
  if (!response.ok) throw new Error(value.error ?? "Local game operation failed");
  return value.result;
}

export async function launchGameDev(options: { cwd?: string; gamePort?: number; simulatorPort?: number; launchGame?: boolean } = {}) {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const sessionPath = path.join(cwd, sessionFileName);
  await mkdir(path.dirname(sessionPath), { recursive: true, mode: 0o700 });
  const releaseLock = await acquireSessionLock(`${sessionPath}.lock`);
  let server: GameDevServer | undefined;
  let connection: LocalDevConnection;
  let gamePort: number;
  try {
    try {
      const existing = JSON.parse(await readFile(sessionPath, "utf8")) as LocalDevConnection;
      try { await executeLocalOperation(existing, { op: "status" }); throw new Error("A game dev session is already running in this repository"); }
      catch (error) { if (error instanceof Error && error.message.includes("already running")) throw error; }
    } catch (error) { if (error instanceof Error && error.message.includes("already running")) throw error; }
    gamePort = options.gamePort ?? await unusedPort();
    server = new GameDevServer({ gameOrigin: `http://127.0.0.1:${gamePort}`, ...(options.simulatorPort !== undefined ? { port: options.simulatorPort } : {}) });
    connection = await server.start();
    await writeFile(sessionPath, `${JSON.stringify(connection, null, 2)}\n`, { mode: 0o600 });
  } catch (error) { await server?.close(); await releaseLock(); throw error; }
  let child: ReturnType<typeof spawn> | undefined;
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      if (process.platform === "win32" && child.pid) {
        // Limit process-tree shutdown to the child created by this launcher.
        await new Promise<void>(resolve => {
          const killer = spawn("taskkill", ["/pid", String(child!.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
          killer.once("error", () => resolve()); killer.once("exit", () => resolve());
        });
      } else if (child.pid) { try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); } }
    }
    await server!.close();
    try { const saved = JSON.parse(await readFile(sessionPath, "utf8")) as LocalDevConnection; if (saved.sessionId === connection.sessionId) await rm(sessionPath); } catch { /* Another session or removed file is not ours to remove. */ }
    await releaseLock();
  })();
  if (options.launchGame !== false) {
    child = spawn(process.platform === "win32" ? "corepack.cmd" : "corepack", ["pnpm", "run", "dev:game", "--host", "127.0.0.1", "--port", String(gamePort), "--strictPort"], {
      cwd, stdio: "inherit", shell: process.platform === "win32", windowsHide: true, detached: process.platform !== "win32",
      env: { ...gameDevProcessEnv(process.env), VITE_CONTROL_WS_URL: connection.controlWsUrl, VITE_GAMEINSTANCE_DEBUG_WS_URL: connection.debugWsUrl, VITE_GAMEINSTANCE_DEV_ENABLED: "true" }
    });
    child.once("error", () => { if (!closing) process.exitCode = 1; void close(); });
    child.once("exit", code => { if (!closing && code) process.exitCode = code; void close(); });
  }
  return { server, connection, gameUrl: `http://127.0.0.1:${gamePort}`, close, child };
}

async function acquireSessionLock(lockPath: string) {
  const owner = { pid: process.pid, id: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const handle = await open(lockPath, "wx", 0o600);
      try { await handle.writeFile(JSON.stringify(owner)); } finally { await handle.close(); }
      return async () => { try { const saved = JSON.parse(await readFile(lockPath, "utf8")); if (saved.id === owner.id) await rm(lockPath); } catch { /* Never remove another launcher's lock. */ } };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let previous: { pid?: unknown; id?: unknown };
      try { previous = JSON.parse(await readFile(lockPath, "utf8")); } catch { throw new Error("A game dev session lock exists and cannot be verified"); }
      if (typeof previous.pid !== "number" || !Number.isSafeInteger(previous.pid) || previous.pid <= 0) throw new Error("A game dev session lock exists and cannot be verified");
      try { process.kill(previous.pid, 0); throw new Error("A game dev session is already running in this repository"); }
      catch (status) { if ((status as NodeJS.ErrnoException).code !== "ESRCH") throw new Error("A game dev session is already running in this repository"); }
      const current = JSON.parse(await readFile(lockPath, "utf8"));
      if (current.id !== previous.id) throw new Error("Another game dev launcher owns this repository");
      await rm(lockPath);
    }
  }
  throw new Error("Another game dev launcher owns this repository");
}

export function gameDevProcessEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const allowed = new Set(["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "HOME", "USER", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "TERM", "COLORTERM", "FORCE_COLOR", "CI", "COREPACK_HOME", "NODE_ENV"]);
  return Object.fromEntries(Object.entries(source).filter(([key, value]) => value !== undefined && allowed.has(key.toUpperCase())));
}

async function unusedPort() {
  const listener = createServer();
  await new Promise<void>((resolve, reject) => { listener.once("error", reject); listener.listen(0, "127.0.0.1", resolve); });
  const address = listener.address();
  const port = address && typeof address === "object" ? address.port : 5173;
  await new Promise<void>(resolve => listener.close(() => resolve()));
  return port;
}

export async function main(args = process.argv.slice(2)) {
  if (args[0] === "--help" || args[0] === "help" || !args.length) {
    console.log("gameinstance-dev dev [--game-port PORT]\ngameinstance-dev status|state\ngameinstance-dev command pause\ngameinstance-dev chat hello | subscriber name | superchat '{...}'\ngameinstance-dev patch '{\"changes\":[{\"path\":\"score\",\"value\":3}]}'\ngameinstance-dev freeze [false] | step [ticks] | seek tick | replay | restart\ngameinstance-dev slowmotion 0.25\ngameinstance-dev scenario steps.json\ngameinstance-dev scenario export|import|replay [capture.json]\ngameinstance-dev scenario record scenarios/name.scenario.json\ngameinstance-dev runtime-check [--committed] [--image stream-runtime:local] [--output DIR] [--config FILE]\nOperations return JSON. Debug operations require the game's declared capabilities.");
    return;
  }
  if (args[0] === "runtime-check") {
    const options: { cwd: string; image?: string; output?: string; config?: string; committed?: boolean } = { cwd: process.cwd() };
    for (let index = 1; index < args.length; index += 1) {
      const flag = args[index], value = args[index + 1];
      if (flag === "--committed") { options.committed = true; continue; }
      if (!["--image", "--output", "--config"].includes(flag ?? "") || !value || value.startsWith("--")) throw new Error("runtime-check accepts --committed, --image NAME, --output DIR and --config FILE");
      options[flag!.slice(2) as "image" | "output" | "config"] = value;
      index += 1;
    }
    process.exitCode = await runRuntimeCheck(options);
    return;
  }
  if (args[0] === "dev") {
    const index = args.indexOf("--game-port");
    const gamePort = index >= 0 ? Number(args[index + 1]) : undefined;
    if (gamePort !== undefined && (!Number.isSafeInteger(gamePort) || gamePort < 1 || gamePort > 65535)) throw new Error("--game-port must be between 1 and 65535");
    const session = await launchGameDev(gamePort === undefined ? {} : { gamePort });
    console.log(JSON.stringify({ gameUrl: session.gameUrl, sessionId: session.connection.sessionId, inspectorShortcut: "Alt+I" }));
    const stop = () => { void session.close().then(() => { process.exitCode = 0; }); };
    process.once("SIGINT", stop); process.once("SIGTERM", stop);
    return;
  }
  const connection = JSON.parse(await readFile(path.join(process.cwd(), sessionFileName), "utf8")) as LocalDevConnection;
  let operation: DevOperation;
  let outputPath: string | undefined;
  let exclusiveCapture = false;
  if (args[0] === "scenario" && args[1] && !args[1].startsWith("{")) {
    if (args[1] === "record") {
      if (!args[2]?.endsWith(".scenario.json") || args.length !== 3) throw new Error("Use scenario record scenarios/name.scenario.json; existing captures are never overwritten");
      operation = { op: "scenario", input: { action: "record" } }; outputPath = args[2]; exclusiveCapture = true;
    }
    else if (["export", "capture"].includes(args[1])) { operation = { op: "scenario", input: { action: "export" } }; outputPath = args[2]; }
    else if (["import", "replay"].includes(args[1])) {
      operation = { op: "scenario", input: { action: args[1], ...(args[2] ? { data: JSON.parse(await readFile(path.resolve(args[2]), "utf8")) } : {}) } };
    } else operation = { op: "scenario", input: JSON.parse(await readFile(path.resolve(args[1]), "utf8")) };
  } else operation = parseCliOperation(args);
  const result = await executeLocalOperation(connection, operation);
  if (outputPath) {
    if (exclusiveCapture) {
      if (!result || typeof result !== "object" || !Array.isArray((result as { assertions?: unknown }).assertions) || !(result as { assertions: unknown[] }).assertions.length) throw new Error("Regression capture must include an assertion; update the game SDK and record again");
      await mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
    }
    try { await writeFile(path.resolve(outputPath), `${JSON.stringify(result, null, 2)}\n`, exclusiveCapture ? { flag: "wx" } : undefined); }
    catch (error) { if (exclusiveCapture && (error as NodeJS.ErrnoException).code === "EEXIST") throw new Error("Capture already exists. Choose a new filename; the existing regression was preserved."); throw error; }
  }
  console.log(JSON.stringify({ result }));
  const status = (result as { status?: string } | undefined)?.status;
  if (status === "rejected" || status === "failed" || status === "expired") process.exitCode = 1;
}

function isEntrypoint() {
  if (!process.argv[1]) return false;
  // pnpm's bin shim names a workspace link; Node resolves the module to its real file.
  try { return import.meta.url === pathToFileURL(realpathSync(path.resolve(process.argv[1]))).href; }
  catch { return false; }
}

if (isEntrypoint()) {
  void main().catch(error => { console.error(JSON.stringify({ error: error instanceof Error ? error.message : "Game dev failed" })); process.exitCode = 1; });
}
