import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { healthzPlugin } from "@repo/game-kit/vite";

export default defineConfig({
  plugins: [healthzPlugin({ app: "streamforge-game" }), react()],
  server: {
    host: "127.0.0.1",
    port: 5173
  }
});
