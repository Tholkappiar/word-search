import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { spawn } from "node:child_process";

const root = process.cwd();
const args = process.argv.slice(2);
let image;
let check = false;
let prepareOnly = false;
let directory;
let child;
let interrupted = false;
const interrupt = () => { interrupted = true; child?.kill("SIGINT"); };
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
try {
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--check") check = true;
    else if (args[index] === "--prepare-only") prepareOnly = true;
    else if (args[index] === "--image" && args[index + 1]) image = args[++index];
    else throw new Error("Usage: pnpm runtime:build [--image NAME] [--check | --prepare-only]");
  }
  const bundle = JSON.parse(readFileSync(join(root, "runtime/gameinstance-runtime.json"), "utf8"));
  if (bundle.schemaVersion !== 1 || bundle.gameContractVersion !== "1.0.0" || !bundle.files || typeof bundle.files !== "object" || Array.isArray(bundle.files)) throw new Error("Invalid runtime build bundle");
  const files = Object.fromEntries(Object.entries(bundle.files).sort(([a], [b]) => a.localeCompare(b)));
  for (const [path, content] of Object.entries(files)) {
    if (typeof content !== "string" || path.split("/").some(part => !part || part === "." || part === ".." || !/^[a-zA-Z0-9._-]+$/.test(part))) throw new Error("Invalid runtime source path");
    if (!/^(?:package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig\.base\.json|\.dockerignore|packages\/(?:protocol|game-kit|game-dev)\/(?:package\.json|tsconfig[^/]*\.json|src\/.+)|services\/stream-runtime\/(?:Dockerfile|package\.json|tsconfig[^/]*\.json|src\/.+)|apps\/sample-game\/(?:package\.json|tsconfig\.json|vite\.config\.ts|index\.html|public\/healthz|src\/.+))$/.test(path)) throw new Error("Unexpected runtime source path: " + path);
  }
  for (const path of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "tsconfig.base.json", "services/stream-runtime/Dockerfile", "services/stream-runtime/src/conformance-cli.ts"]) if (!(path in files)) throw new Error("Incomplete runtime bundle: " + path);
  const identity = "sha256:" + createHash("sha256").update(JSON.stringify(files)).digest("hex");
  if (identity !== bundle.identity) throw new Error("Runtime source identity mismatch; restore the committed bundle");
  image ??= "gameinstance-runtime:" + identity.slice(7, 23);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:-]*$/.test(image)) throw new Error("Invalid runtime image name");
  if (check) { console.log(JSON.stringify({ identity, sdkIdentity: bundle.sdkIdentity, image, fileCount: Object.keys(files).length })); }
  else {
    const local = join(root, ".gameinstance");
    try { if (!lstatSync(local).isDirectory()) throw new Error(".gameinstance must be a regular directory"); }
    catch (error) { if (error.code === "ENOENT") mkdirSync(local); else throw error; }
    directory = mkdtempSync(join(local, "runtime-build-"));
    for (const [path, content] of Object.entries(files)) {
      const target = resolve(directory, path);
      if (!target.startsWith(resolve(directory) + sep)) throw new Error("Runtime path escapes build directory");
      mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, content, { flag: "wx" });
    }
    if (prepareOnly) { console.log(JSON.stringify({ identity, directory, image })); directory = undefined; }
    else {
      const docker = (args, capture = false) => new Promise((resolve, reject) => {
        if (interrupted) return reject(new Error("Runtime build interrupted"));
        child = spawn("docker", args, { cwd: directory, stdio: capture ? ["ignore", "pipe", "inherit"] : "inherit", windowsHide: true });
        let output = "";
        child.stdout?.on("data", chunk => { output += String(chunk); });
        child.once("error", reject);
        child.once("exit", code => code === 0 && !interrupted ? resolve(output.trim()) : reject(new Error("Docker failed or was interrupted")));
      });
      await docker(["build", "-t", image, "-f", "services/stream-runtime/Dockerfile", "."]);
      const imageId = await docker(["image", "inspect", "--format", "{{.Id}}", image], true);
      if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("Docker did not return an immutable image ID");
      const savedImage = join(local, "runtime-image.json");
      try { if (!lstatSync(savedImage).isFile()) throw new Error("runtime-image.json must be a regular file"); }
      catch (error) { if (error.code !== "ENOENT") throw error; }
      const temporaryImage = join(directory, "runtime-image.json");
      writeFileSync(temporaryImage, JSON.stringify({ schemaVersion: 1, image, imageId, sourceIdentity: identity }, null, 2) + "\n", { flag: "wx" });
      renameSync(temporaryImage, savedImage);
      console.log(JSON.stringify({ image, imageId, sourceIdentity: identity, next: "corepack pnpm check:runtime --committed" }));
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
  process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
}
