import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { loadTemplateGameConfig } from "./template";

window.__STREAM_READY__ = false;

const root = createRoot(document.getElementById("root")!);
root.render(<main className="startup-message" role="status">Getting your game ready…</main>);

void loadTemplateGameConfig().then(config => {
  root.render(<React.StrictMode><App startingConfig={config} /></React.StrictMode>);
}).catch(() => {
  window.__STREAM_READY__ = false;
  root.render(<main className="startup-message" role="alert">
    <h1>Your game couldn’t start</h1>
    <p>We couldn’t load your game settings. Check your saved configuration in BubblePortal, then try again.</p>
    <button type="button" onClick={() => window.location.reload()}>Try again</button>
  </main>);
});

declare global {
  interface Window {
    __STREAM_READY__?: boolean;
  }
}
