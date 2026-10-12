import { useEffect, useRef, useState } from "react";
import { createRuntimeCommandClient, type RuntimeCommandClient } from "@bubbleportal/sdk/browser";
import { buildRejectedCommandResult } from "@bubbleportal/sdk";
import { createGame, gameDefinition } from "./game";
import { renderGame } from "./render";
import { GameAudio } from "./audio";
import { Mascot } from "./mascot";
import "./styles.css";

// `build:play` builds in Vite's "play" mode for streaming: no engine history and no development inspector.
const PLAY = import.meta.env.MODE === "play";
const createAppGame = () => createGame({ recordHistory: !PLAY });

export function App() {
  const [engine, setEngine] = useState(createAppGame);
  const [state, setState] = useState(() => engine.getState());
  const canvas = useRef<HTMLCanvasElement>(null);
  const transport = useRef<{ engine: ReturnType<typeof createGame>; url: string | undefined; client: RuntimeCommandClient } | undefined>(undefined);
  useEffect(() => {
    // Renderer refresh preserves simulation; a simulation edit gets a new history.
    if (engine.definition !== gameDefinition) { engine.resume({ pending: "discard" }); setEngine(createAppGame()); }
  }, [engine, gameDefinition]);
  useEffect(() => { setState(engine.getState()); return engine.subscribe(() => setState(engine.getState())); }, [engine]);
  useEffect(() => {
    const url = import.meta.env.VITE_CONTROL_WS_URL;
    const previous = transport.current;
    const client = previous?.engine === engine && previous.url === url ? previous.client : createRuntimeCommandClient({ controlWsUrl: url, autoStart: false,
      applyCommand(command) {
        const outcome = engine.dispatch(command);
        if (outcome.status === "queued") return { commandId: command.commandId, streamId: command.streamId, deploymentId: command.deploymentId, runtimeInstanceId: command.runtimeInstanceId, status: "accepted" };
        return outcome.result;
      } });
    transport.current = { engine, url, client };
    const unsubscribe = engine.subscribePendingResults(event => {
      client.reportResult(event.status === "applied" && event.result ? event.result : buildRejectedCommandResult(event.input, event.error ?? "Queued command discarded by restart or seek"));
    });
    client.start();
    return () => { unsubscribe(); client.stop(); };
  }, [engine]);
  useEffect(() => {
    const context = canvas.current?.getContext("2d");
    if (context) { renderGame(context, state); mascot.current?.draw(context, state); }
  }, [state, renderGame]);
  // Music, sound effects and Sobo the host follow the state like the renderer does;
  // they never affect gameplay.
  const audio = useRef<GameAudio | undefined>(undefined);
  const mascot = useRef<Mascot | undefined>(undefined);
  useEffect(() => {
    const player = new GameAudio(); player.start(); audio.current = player;
    const host = new Mascot(player); host.start(); mascot.current = host;
    return () => {
      host.dispose(); player.dispose();
      if (mascot.current === host) mascot.current = undefined;
      if (audio.current === player) audio.current = undefined;
    };
  }, []);
  useEffect(() => { audio.current?.update(state); mascot.current?.update(state); }, [state]);
  useEffect(() => {
    // Loaded only for local development, so the play build never contains the inspector.
    if (PLAY || import.meta.env.VITE_GAMEINSTANCE_DEV_ENABLED !== "true") return;
    let unregister: (() => void) | undefined;
    let disposed = false;
    void import("@bubbleportal/devtools/browser").then(({ engineDevAdapter, registerGameDev }) => {
      if (!disposed) unregister = registerGameDev(engineDevAdapter(engine));
    });
    return () => { disposed = true; unregister?.(); };
  }, [engine]);
  useEffect(() => {
    let frame = 0; let last = performance.now(); let accumulator = 0;
    function tick(now: number) {
      accumulator += Math.min(now - last, 100) * engine.getTimeScale(); last = now;
      while (accumulator >= 1000 / 60) { engine.advance(1); accumulator -= 1000 / 60; }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick); return () => cancelAnimationFrame(frame);
  }, [engine]);
  return <main className="game-shell"><canvas ref={canvas} className="game-canvas" width={1080} height={1920} aria-label="Game canvas" /></main>;
}
