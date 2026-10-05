import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";

window.__STREAM_READY__ = false;

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

declare global {
  interface Window {
    __STREAM_READY__?: boolean;
  }
}
