import { spawnSync } from "node:child_process";
const port = Number(process.env.SAMPLE_GAME_PORT || "5173");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid SAMPLE_GAME_PORT");
const env = { ...process.env, VITE_GAMEINSTANCE_DEV_ENABLED: "false" };
function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: process.cwd(), stdio: "inherit", env, shell: process.platform === "win32" });
  if (result.status !== 0) process.exit(result.status || 1);
}
// Verify the committed bundle, then compile before Vite resolves package exports.
run("node", ["scripts/verify-sdk.mjs"]);
for (const name of ["@repo/protocol", "@repo/game-kit", "@repo/game-dev"]) run("corepack", ["pnpm", "--filter", name, "build"]);
run("corepack", ["pnpm", "exec", "vite", "--host", "0.0.0.0", "--port", String(port), "--strictPort"]);
