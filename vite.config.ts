import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { healthzPlugin } from "@bubbleportal/sdk/vite";

/**
 * Local dev session only: the session accepts the game from 127.0.0.1, so a page opened at
 * localhost cannot reach it ("Failed to fetch"). Send localhost visits to 127.0.0.1.
 */
function loopbackRedirect(): Plugin {
  return {
    name: "dev-session-loopback-redirect",
    configureServer(server) {
      if (process.env.VITE_GAMEINSTANCE_DEV_ENABLED !== "true") return;
      server.middlewares.use((request, response, next) => {
        const host = request.headers.host ?? "";
        if (!host.startsWith("localhost:")) return next();
        response.statusCode = 302;
        response.setHeader("Location", `http://127.0.0.1:${host.slice("localhost:".length)}${request.url ?? "/"}`);
        response.end();
      });
    }
  };
}

export default defineConfig({
  plugins: [healthzPlugin({ app: "streamforge-game" }), loopbackRedirect(), react()],
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
