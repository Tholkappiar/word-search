import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
const root = process.cwd();
if (Number(process.versions.node.split(".")[0]) < 22) throw new Error("Install Node 22 or newer.");
const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) => value !== undefined && ["PATH", "PATHEXT", "SYSTEMROOT", "WINDIR", "COMSPEC", "HOME", "USER", "USERPROFILE", "APPDATA", "LOCALAPPDATA", "TEMP", "TMP", "TMPDIR", "TERM", "COLORTERM", "FORCE_COLOR", "CI", "COREPACK_HOME", "NODE_ENV"].includes(key.toUpperCase())));
if (existsSync(resolve(root, ".npmrc"))) throw new Error("Review project .npmrc manually; the public SDK bootstrap does not consume registry credentials.");
if (process.argv.includes("--check")) {
  const require = createRequire(resolve(root, "package.json"));
  const { doctorProject } = await import(pathToFileURL(require.resolve("@bubbleportal/devtools/projects")).href);
  const report = await doctorProject(root); console.log(JSON.stringify(report, null, 2));
  if (!report.ok || report.diagnostics.some(item => item.code === "dependencies_missing")) process.exitCode = 1;
} else {
  let command = "corepack", args = ["pnpm", "install", "--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--registry=https://registry.npmjs.org"];
  if (process.platform === "win32") {
    const candidates = [dirname(process.execPath), ...(process.env.PATH || "").split(";")].map(base => resolve(base, "node_modules/corepack/dist/corepack.js"));
    const cli = candidates.find(file => existsSync(file));
    if (!cli) throw new Error("Corepack's Node entrypoint is missing; install Corepack for Node 22.");
    command = process.execPath; args = [cli, ...args];
  }
  const configDirectory = mkdtempSync(join(tmpdir(), "bubbleportal-bootstrap-")), config = join(configDirectory, "empty-npmrc");
  writeFileSync(config, "", { flag: "wx", mode: 0o600 });
  let result;
  try { result = spawnSync(command, args, { cwd: root, env: { ...env, npm_config_userconfig: config, npm_config_globalconfig: config, npm_config_registry: "https://registry.npmjs.org", COREPACK_ENABLE_DOWNLOAD_PROMPT: "0" }, stdio: "inherit", shell: false, windowsHide: true }); }
  finally { rmSync(configDirectory, { recursive: true, force: true }); }
  if (result.error || result.status !== 0) throw new Error("Frozen dependency installation failed; no mutable fallback was used.");
  const require = createRequire(resolve(root, "package.json"));
  const { doctorProject } = await import(pathToFileURL(require.resolve("@bubbleportal/devtools/projects")).href);
  const report = await doctorProject(root); if (!report.ok || report.diagnostics.some(item => item.code === "dependencies_missing")) throw new Error("Installed SDK validation failed. Run bubbleportal doctor.");
  console.log("Ready. Run corepack pnpm dev, test, lint or build.");
}
