import { useEffect, useRef, useState } from "react";
import { createRuntimeCommandClient, type RuntimeCommandClient } from "@bubbleportal/sdk/browser";
import { buildRejectedCommandResult } from "@bubbleportal/sdk";
import { engineDevAdapter, registerGameDev } from "@bubbleportal/devtools/browser";
import { createGame, gameDefinition } from "./game";
import { renderGame } from "./render";
import { GameAudio } from "./audio";
import "./styles.css";

export function App() {
  const [engine, setEngine] = useState(createGame);
  const [state, setState] = useState(() => engine.getState());
  const canvas = useRef<HTMLCanvasElement>(null);
  const transport = useRef<{ engine: ReturnType<typeof createGame>; url: string | undefined; client: RuntimeCommandClient } | undefined>(undefined);
  useEffect(() => {
    // Renderer refresh preserves simulation; a simulation edit gets a new history.
    if (engine.definition !== gameDefinition) { engine.resume({ pending: "discard" }); setEngine(createGame()); }
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
    if (context) renderGame(context, state);
  }, [state, renderGame]);
  // Music and sound effects follow the state like the renderer does; they never affect gameplay.
  const audio = useRef<GameAudio | undefined>(undefined);
  useEffect(() => {
    const player = new GameAudio(); player.start(); audio.current = player;
    return () => { player.dispose(); if (audio.current === player) audio.current = undefined; };
  }, []);
  useEffect(() => { audio.current?.update(state); }, [state]);
  useEffect(() => {
    if (import.meta.env.VITE_GAMEINSTANCE_DEV_ENABLED !== "true") return;
    return registerGameDev(engineDevAdapter(engine));
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
