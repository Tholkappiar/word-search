import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { verifySdk } from "./verify-sdk.mjs";

const root = process.cwd();
const sdk = resolve(root, "vendor/gameinstance");
const doctor = process.argv.includes("--check");
function fail(message) { console.error(message); process.exit(1); }
function run(binary, args) {
  const result = spawnSync(binary, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) fail(binary + " failed. Check the output above; no mutable install fallback was used.");
}
if (Number(process.versions.node.split(".")[0]) < 22) fail("Install Node 22 or newer.");
let sdkInfo;
try { sdkInfo = verifySdk(root); }
catch (error) { fail(error.message); }
const pnpm = spawnSync("corepack", ["pnpm", "--version"], { cwd: root, encoding: "utf8", shell: process.platform === "win32" });
if (pnpm.status !== 0 || pnpm.stdout.trim() !== "10.12.1") fail("Install/activate pnpm 10.12.1 with corepack prepare pnpm@10.12.1 --activate.");
if (doctor) {
  const built = ["protocol/dist/index.js", "game-kit/dist/engine.js", "game-dev/dist/cli.js"].every(path => existsSync(resolve(sdk, "packages", path)));
  console.log("Node " + process.versions.node + "; pnpm 10.12.1; verified SDK " + sdkInfo.sdkVersion + " (" + sdkInfo.sdkIdentity + ")");
  if (!existsSync(resolve(root, "node_modules")) || !built) fail("SDK source is valid, but dependencies/builds are missing. Run corepack pnpm bootstrap.");
  console.log("Dependencies and SDK builds are present. Run corepack pnpm dev.");
  process.exit(0);
}
run("corepack", ["pnpm", "install", "--frozen-lockfile"]);
run("corepack", ["pnpm", "--filter", "@repo/protocol", "build"]);
run("corepack", ["pnpm", "--filter", "@repo/game-kit", "build"]);
run("corepack", ["pnpm", "--filter", "@repo/game-dev", "build"]);
// Workspace binaries are linked only after the cold-built CLI exists.
run("corepack", ["pnpm", "install", "--frozen-lockfile"]);
console.log("Ready. Run corepack pnpm dev, test, lint or build.");
