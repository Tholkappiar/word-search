import type { DebugCapabilities, DevOperation, DevStatus } from "./types.js";

type InspectorOptions = { operate(operation: DevOperation): Promise<unknown>; getSnapshot(): unknown; getCapabilities(): DebugCapabilities };
type Field = { path: string; label?: string; type?: string; value?: unknown; editable?: boolean; min?: number; max?: number; step?: number };

function fieldKind(field: Field): string {
  return field.type ?? (field.value === null ? "null" : Array.isArray(field.value) ? "array" : typeof field.value);
}

function readFieldValue(field: Field, input: HTMLInputElement | HTMLTextAreaElement): unknown {
  const kind = fieldKind(field);
  if (kind === "boolean") return (input as HTMLInputElement).checked;
  if (kind === "string") return input.value;
  if (kind === "number") {
    if (!input.value.trim() || !Number.isFinite(Number(input.value))) throw new Error("Enter a finite number");
    return Number(input.value);
  }
  try { return JSON.parse(input.value); }
  catch { throw new Error('Enter valid JSON, for example {"score":3}, [1,2], or null'); }
}

export function installInspector(options: InspectorOptions): () => void {
  document.querySelector("gameinstance-inspector")?.remove();
  const host = document.createElement("gameinstance-inspector");
  host.setAttribute("data-gameinstance-devtools", "");
  const root = host.attachShadow({ mode: "open" });
  root.innerHTML = `<style>
  :host{position:fixed;right:0;top:20%;z-index:2147483646;font:13px/1.45 system-ui;color:#e9edf5}
  *{box-sizing:border-box}button,input,textarea,select{font:inherit}button{cursor:pointer;border:1px solid #475569;border-radius:5px;background:#27354a;color:#fff;padding:5px 8px}button:disabled{opacity:.4;cursor:default}button:hover:not(:disabled){background:#3b4e6b}
  .tab{writing-mode:vertical-rl;position:absolute;right:0;top:0;border-radius:7px 0 0 7px;padding:10px 5px;background:#15243a} .panel{display:none;width:min(390px,95vw);max-height:76vh;overflow:auto;background:#101925f2;border:1px solid #52637c;border-radius:9px 0 0 9px;padding:12px;box-shadow:0 10px 30px #0008} :host([open]) .panel{display:block}:host([open]) .tab{right:100%}
  h2{font-size:15px;margin:0}h3{font-size:12px;text-transform:uppercase;color:#91b7e9;margin:14px 0 6px}.row{display:flex;gap:5px;align-items:center;flex-wrap:wrap}.head{justify-content:space-between}input,textarea,select{background:#182437;color:#fff;border:1px solid #52637c;border-radius:4px;padding:5px;max-width:100%}input[type=number]{width:88px}textarea{width:100%;min-height:65px}pre{white-space:pre-wrap;word-break:break-word;font:11px/1.5 ui-monospace,monospace;max-height:140px;overflow:auto;margin:4px 0}.status{color:#c1d8f5;font-size:11px}.error{color:#ffb4b4}.fields{display:grid;gap:5px}.field{display:grid;grid-template-columns:1fr 90px 35px;gap:4px;align-items:center}.field label{overflow-wrap:anywhere}.pin{font-size:11px;border:1px solid #475569;padding:4px;border-radius:4px}.spark{height:22px;display:flex;align-items:end;gap:1px}.spark i{background:#69adff;flex:1;min-height:2px}details{margin:5px 0}summary{cursor:pointer}
  .field-json{grid-template-columns:1fr 35px}.field-json textarea{grid-column:1/-1;grid-row:2}
  </style><button class="tab" aria-label="Open game inspector" aria-expanded="false" title="Game inspector · Alt+I">Inspect</button>
  <section class="panel" role="region" aria-label="Local game inspector"><div class="row head"><h2>Game inspector</h2><div class="row"><button data-action="pin" aria-pressed="false">Pin</button><button data-action="close" aria-label="Close inspector">×</button></div></div>
  <p class="status" id="status">Connecting to local session…</p><p class="status" id="outcome" role="status" aria-live="polite"></p>
  <h3>Game commands</h3><div class="row"><button data-command="pause">Pause</button><button data-command="resume">Resume</button><button data-command="resetGame">Reset</button><button data-command="showOverlay">Overlay on</button><button data-command="hideOverlay">Overlay off</button></div>
  <h3>Timeline</h3><div class="row"><button data-action="freeze">Freeze</button><button data-action="unfreeze">Resume clock</button><button data-action="step">Step tick</button><button data-action="rewind">Rewind 5s</button><button data-action="replay">Replay</button></div><div class="row" style="margin-top:6px"><label>Tick <input id="seek-tick" type="number" min="0" value="0"></label><select id="branch" aria-label="History branch"><option value="original">Original</option><option value="edited">Edited</option></select><button data-action="seek">Seek</button></div><div class="row" style="margin-top:6px"><button data-action="branch-keep">Keep edits</button><button data-action="branch-discard">Discard edits</button><label>Speed <select id="time-scale" aria-label="Simulation speed"><option value="0.25">¼×</option><option value="0.5">½×</option><option value="1" selected>1×</option><option value="2">2×</option></select></label></div><p class="status" id="timeline"></p>
  <h3>Simulated events</h3><div class="row"><input id="author" value="Local player" aria-label="Author" size="14"><select id="event-type" aria-label="Event type"><option value="chat">Chat</option><option value="superchat">Super Chat</option><option value="subscriber">Subscriber</option></select></div><div class="row" style="margin-top:6px"><input id="message" placeholder="Message" aria-label="Message" size="22"><button data-action="event">Send</button></div>
  <h3>Current state</h3><div class="fields" id="fields"></div><details><summary>State JSON</summary><pre id="state"></pre></details><div id="pins"></div>
  <h3>Starting configuration</h3><p class="status">Applies to the next restart; current state is separate.</p><textarea id="config" aria-label="Starting configuration JSON"></textarea><div class="row"><button data-action="config">Save starting config</button><button data-action="restart">Restart from config</button></div>
  <h3>Actual command results</h3><pre id="history"></pre><details><summary>Scenario capture and replay</summary><p class="status">Capture regression freezes at the selected tick and records an expected state. Save the JSON in scenarios/ and run pnpm test:scenarios to check future edits. Import validates game/schema/simulation versions.</p><div class="row"><button data-action="scenario-record">Capture regression</button><button data-action="scenario-export">Capture history</button></div><textarea id="scenario-data" aria-label="Scenario JSON"></textarea><div class="row"><input id="scenario-name" aria-label="Scenario filename" value="regression.scenario.json" size="26" maxlength="128"><button data-action="scenario-download" disabled>Download JSON</button></div><div class="row" style="margin-top:6px"><button data-action="scenario-import">Import</button><button data-action="scenario-replay">Replay scenario</button></div><p class="status">A capture checks the recorded behavior. Capture the intended outcome after fixing a bug, or edit its assertions to describe the expected result.</p></details></section>`;
  document.body.append(host);
  let pinned = false;
  let stopped = false;
  let lastConfig = "";
  const downloads = new Map<string, ReturnType<typeof setTimeout>>();
  const pins = new Map<string, number[]>();
  const element = <T extends HTMLElement = HTMLElement>(id: string) => root.getElementById(id) as T;
  const tab = root.querySelector<HTMLButtonElement>(".tab")!;
  const setOpen = (open: boolean) => { host.toggleAttribute("open", open); tab.setAttribute("aria-expanded", String(open)); };
  // Pointer hover can open the panel before click arrives. Click still means open.
  tab.addEventListener("click", () => setOpen(true));
  host.addEventListener("mouseenter", () => setOpen(true));
  host.addEventListener("mouseleave", () => { if (!pinned && !root.activeElement) setOpen(false); });
  const shortcut = (event: KeyboardEvent) => { if (event.altKey && event.key.toLowerCase() === "i") { event.preventDefault(); setOpen(!host.hasAttribute("open")); if (host.hasAttribute("open")) tab.focus(); } if (event.key === "Escape" && !pinned) setOpen(false); };
  window.addEventListener("keydown", shortcut);

  const run = async (operation: DevOperation, before?: DevOperation, context?: string) => {
    element("outcome").className = "status"; element("outcome").textContent = "Waiting for the browser result…";
    try {
      if (before) await options.operate(before);
      const result = await options.operate(operation);
      if (operation.op === "scenario" && ["export", "record"].includes(String(operation.input?.action))) element<HTMLTextAreaElement>("scenario-data").value = JSON.stringify(result, null, 2);
      const status = (result as { status?: string })?.status;
      const assertions = (result as { assertions?: Array<{ passed?: boolean; assertion?: { tick?: number; path?: string }; actual?: unknown; error?: string }> })?.assertions;
      const failures = assertions?.filter(assertion => assertion.passed === false);
      element("outcome").textContent = `${operation.op}: ${status ?? "completed"}${failures?.length ? ` · ${failures.map(result => `${result.assertion?.path || "state"} at tick ${result.assertion?.tick ?? "?"}: ${result.error ?? `actual ${JSON.stringify(result.actual)}`}`).join("; ")}` : ""}`;
      if (status === "rejected" || status === "failed" || status === "expired") element("outcome").className = "status error";
      await refresh();
    } catch (error) { element("outcome").className = "status error"; element("outcome").textContent = `${context ? `${context}: ` : ""}${error instanceof Error ? error.message : "Operation failed"}`; }
  };
  root.addEventListener("click", event => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.dataset.command) { void run({ op: "command", input: { type: button.dataset.command } }); return; }
    const action = button.dataset.action;
    if (action === "close") { pinned = false; setOpen(false); return; }
    if (action === "pin") { pinned = !pinned; button.setAttribute("aria-pressed", String(pinned)); button.textContent = pinned ? "Unpin" : "Pin"; return; }
    if (action === "freeze" || action === "unfreeze") void run({ op: "freeze", input: { frozen: action === "freeze", pending: "apply" } });
    if (action === "step") void run({ op: "step", input: { ticks: 1 } });
    if (action === "replay") void run({ op: "replay" });
    if (action === "restart") void run({ op: "restart" });
    if (action === "seek") void run({ op: "seek", input: { tick: Number(element<HTMLInputElement>("seek-tick").value), branch: element<HTMLSelectElement>("branch").value } });
    if (action === "rewind") {
      const snapshot = options.getSnapshot() as { tickRate?: number; history?: { currentTick?: number; earliestTick?: number } };
      const rate = snapshot.tickRate, history = snapshot.history;
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0 && history?.currentTick !== undefined) {
        const tick = Math.max(history.earliestTick ?? 0, history.currentTick - Math.round(5 * rate));
        element<HTMLInputElement>("seek-tick").value = String(tick);
        void run({ op: "seek", input: { tick } }, { op: "freeze", input: { frozen: true } });
      }
    }
    if (action === "branch-keep" || action === "branch-discard") void run({ op: "seek", input: { action: action === "branch-keep" ? "keep" : "discard" } });
    if (action === "event") void run({ op: element<HTMLSelectElement>("event-type").value as "chat", input: { displayName: element<HTMLInputElement>("author").value, text: element<HTMLInputElement>("message").value } });
    if (action === "config") {
      try { void run({ op: "patch", input: { target: "startingConfig", config: JSON.parse(element<HTMLTextAreaElement>("config").value) } }); }
      catch { element("outcome").textContent = "Starting config must be valid JSON"; element("outcome").className = "status error"; }
    }
    if (action === "scenario-export") void run({ op: "scenario", input: { action: "export" } });
    if (action === "scenario-record") void run({ op: "scenario", input: { action: "record" } });
    if (action === "scenario-download") {
      try {
        const name = element<HTMLInputElement>("scenario-name").value.trim();
        if (name.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.scenario\.json$/.test(name)) throw new Error("Use a filename such as missed-bounce.scenario.json (letters, numbers, dots, dashes or underscores).");
        const capture = JSON.parse(element<HTMLTextAreaElement>("scenario-data").value);
        if (capture?.formatVersion !== 1 || !Array.isArray(capture.assertions) || !capture.assertions.length) throw new Error("Use Capture regression or add an assertion before downloading a test.");
        const url = URL.createObjectURL(new Blob([JSON.stringify(capture, null, 2) + "\n"], { type: "application/json" }));
        const link = document.createElement("a"); link.href = url; link.download = name; root.append(link); link.click(); link.remove();
        downloads.set(url, setTimeout(() => { URL.revokeObjectURL(url); downloads.delete(url); }, 1000));
        element("outcome").className = "status";
        element("outcome").textContent = `Downloaded ${name}. Save it in scenarios/ and run pnpm test:scenarios.`;
      } catch (error) { element("outcome").className = "status error"; element("outcome").textContent = error instanceof SyntaxError ? "Scenario must be valid JSON" : error instanceof Error ? error.message : "Download failed"; }
    }
    if (action === "scenario-import" || action === "scenario-replay") {
      try { void run({ op: "scenario", input: { action: action === "scenario-import" ? "import" : "replay", data: JSON.parse(element<HTMLTextAreaElement>("scenario-data").value) } }); }
      catch { element("outcome").textContent = "Scenario must be valid JSON"; element("outcome").className = "status error"; }
    }
  });
  element<HTMLSelectElement>("time-scale").addEventListener("change", () => { void run({ op: "slowmotion", input: { timeScale: Number(element<HTMLSelectElement>("time-scale").value) } }); });

  const refresh = async () => {
    if (stopped) return;
    const status = await options.operate({ op: "status" }) as DevStatus;
    if (stopped) return;
    const awaiting = status.history.filter(entry => entry.status === "accepted").length;
    element("status").textContent = `${status.gameConnected ? "Game connected" : "Game disconnected"} · ${status.debugConnected ? "Engine connected" : "Engine unavailable"}${awaiting ? ` · ${awaiting} accepted, awaiting application` : ""}`;
    const snapshot = options.getSnapshot() as { state?: unknown; startingConfig?: unknown; inspector?: Field[]; tickRate?: number; history?: { currentTick?: number; headTick?: number; earliestTick?: number; branch?: string; frozen?: boolean; pendingInputs?: unknown[]; memoryLimited?: boolean; timeScale?: number } };
    element("state").textContent = JSON.stringify(snapshot?.state ?? snapshot, null, 2);
    const config = JSON.stringify(snapshot?.startingConfig ?? {}, null, 2);
    if (config !== lastConfig && root.activeElement !== element("config")) { element<HTMLTextAreaElement>("config").value = config; lastConfig = config; }
    const history = snapshot?.history;
    const rate = snapshot?.tickRate;
    const seconds = typeof rate === "number" && rate > 0 && history?.currentTick !== undefined ? ` · ${(history.currentTick / rate).toFixed(2)}s` : "";
    element("timeline").textContent = history ? `Tick ${history.currentTick} / ${history.headTick}${seconds} · retained from ${history.earliestTick} · ${history.branch} · ${history.frozen ? "frozen" : "running"}${history.memoryLimited ? " · history memory cap reached" : ""}` : "Timeline unavailable for this game";
    const capabilities = options.getCapabilities();
    for (const [action, capability] of [["freeze", "freeze"], ["unfreeze", "freeze"], ["step", "step"], ["seek", "seek"], ["replay", "replay"], ["config", "patch"]] as const) root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.disabled = !capabilities[capability];
    for (const action of ["scenario-record", "scenario-export", "scenario-import", "scenario-replay"]) root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.disabled = !capabilities.scenario;
    root.querySelector<HTMLButtonElement>('[data-action="scenario-download"]')!.disabled = !element<HTMLTextAreaElement>("scenario-data").value.trim();
    for (const action of ["branch-keep", "branch-discard"]) root.querySelector<HTMLButtonElement>(`[data-action="${action}"]`)!.disabled = !capabilities.seek;
    element<HTMLSelectElement>("time-scale").disabled = !capabilities.slowmotion;
    if (history?.timeScale !== undefined && root.activeElement !== element("time-scale")) element<HTMLSelectElement>("time-scale").value = String(history.timeScale);
    root.querySelector<HTMLButtonElement>('[data-action="rewind"]')!.disabled = !capabilities.freeze || !capabilities.seek || typeof rate !== "number" || rate <= 0;
    root.querySelector<HTMLButtonElement>('[data-action="restart"]')!.disabled = !capabilities.restart;
    element("history").textContent = status.history.slice(-8).map(entry => `${entry.operation.op} · ${entry.status}\n${JSON.stringify(entry.result ?? entry.error ?? "pending")}`).join("\n\n") || "No local commands sent yet.";
    const fields = Array.isArray(snapshot?.inspector) ? snapshot.inspector : [];
    if (!element("fields").contains(root.activeElement)) {
      element("fields").replaceChildren();
      for (const field of fields) {
        const row = document.createElement("div"); row.className = "field";
        const label = document.createElement("label"); label.textContent = field.label ?? field.path;
        const kind = fieldKind(field);
        const json = !["number", "string", "boolean"].includes(kind);
        if (json) row.classList.add("field-json");
        const input = json ? document.createElement("textarea") : document.createElement("input");
        input.setAttribute("aria-label", `${label.textContent} current value`);
        input.value = kind === "string" ? String(field.value ?? "") : JSON.stringify(field.value) ?? "";
        if (input instanceof HTMLInputElement) {
          input.type = kind === "boolean" ? "checkbox" : kind === "number" ? "number" : "text";
          if (kind === "boolean") input.checked = field.value === true;
          if (field.min !== undefined) input.min = String(field.min); if (field.max !== undefined) input.max = String(field.max); if (field.step !== undefined) input.step = String(field.step);
        }
        if (json) input.title = "JSON value; the registered state schema validates this edit";
        input.disabled = !field.editable || !capabilities.patch;
        input.addEventListener("change", () => {
          try {
            const value = readFieldValue(field, input);
            input.setAttribute("aria-invalid", "false");
            void run({ op: "patch", input: { changes: [{ path: field.path, value }] } }, undefined, label.textContent ?? field.path);
          } catch (error) {
            input.setAttribute("aria-invalid", "true");
            element("outcome").className = "status error";
            element("outcome").textContent = `${label.textContent}: ${error instanceof Error ? error.message : "Invalid value"}`;
          }
        });
        const pin = document.createElement("button"); pin.textContent = pins.has(field.path) ? "●" : "+"; pin.setAttribute("aria-label", `Pin ${label.textContent} chart`); pin.disabled = typeof field.value !== "number";
        pin.addEventListener("click", () => { pins.has(field.path) ? pins.delete(field.path) : pins.set(field.path, []); void refresh(); });
        row.append(label, input, pin); element("fields").append(row);
      }
    }
    element("pins").replaceChildren();
    for (const [path, values] of pins) {
      const value = fields.find(field => field.path === path)?.value;
      if (typeof value !== "number") continue;
      values.push(value); if (values.length > 50) values.shift();
      const pin = document.createElement("div"); pin.className = "pin"; pin.textContent = `${path}: ${value}`;
      const spark = document.createElement("div"); spark.className = "spark"; spark.setAttribute("role", "img"); spark.setAttribute("aria-label", `${path} recent values`);
      const min = Math.min(...values), range = Math.max(...values) - min || 1;
      for (const sample of values) { const bar = document.createElement("i"); bar.style.height = `${2 + 20 * (sample - min) / range}px`; spark.append(bar); }
      pin.append(spark); element("pins").append(pin);
    }
  };
  const timer = setInterval(() => { void refresh().catch(() => { element("status").textContent = "Local session unavailable"; }); }, 500);
  void refresh().catch(() => undefined);
  return () => { stopped = true; clearInterval(timer); for (const [url, timeout] of downloads) { clearTimeout(timeout); URL.revokeObjectURL(url); } downloads.clear(); window.removeEventListener("keydown", shortcut); host.remove(); };
}
