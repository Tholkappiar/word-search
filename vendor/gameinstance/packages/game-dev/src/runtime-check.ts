import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

export type RuntimeCheckOptions = { cwd?: string; image?: string; output?: string; config?: string; committed?: boolean };

/** A generated game's runtime:build records an immutable image for subsequent checks. */
export async function selectedRuntimeImage(cwd: string, explicit?: string): Promise<string> {
  if (explicit) return explicit;
  let saved;
  try {
    saved = JSON.parse(await readFile(path.join(cwd, ".gameinstance/runtime-image.json"), "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "stream-runtime:local";
    throw error;
  }
  const invalid = () => new Error("Invalid saved runtime image. Rebuild with pnpm runtime:build or pass --image explicitly.");
  if (saved.schemaVersion !== 1 || typeof saved.imageId !== "string" || !/^sha256:[a-f0-9]{64}$/.test(saved.imageId)) throw invalid();
  let bundle;
  try { bundle = JSON.parse(await readFile(path.join(cwd, "runtime/gameinstance-runtime.json"), "utf8")); }
  catch { throw invalid(); }
  if (typeof saved.sourceIdentity !== "string" || !/^sha256:[a-f0-9]{64}$/.test(saved.sourceIdentity) || saved.sourceIdentity !== bundle.identity) {
    throw new Error("Saved runtime image does not match this runtime bundle. Run pnpm runtime:build again or pass --image explicitly.");
  }
  return saved.imageId;
}

export function runtimeCheckArguments(input: { gameDirectory: string; outputDirectory: string; imageId: string; configFile?: string; gameCommit?: string }) {
  if (!/^sha256:[a-f0-9]{64}$/.test(input.imageId)) throw new Error("Docker did not return an immutable image ID");
  const mount = (source: string, target: string, readOnly: boolean) => {
    if (source.includes(",") || source.includes("\n")) throw new Error("Docker mount paths cannot contain commas or newlines");
    return `type=bind,source=${source},target=${target}${readOnly ? ",readonly" : ""}`;
  };
  return ["run", "--rm", "--pull=never", "--mount", mount(input.gameDirectory, "/input", true),
    "--mount", mount(input.outputDirectory, "/output", false),
    ...(input.configFile ? ["--mount", mount(input.configFile, "/starting-config.json", true)] : []),
    input.imageId, "node", "services/stream-runtime/dist/conformance-cli.js", "--repo-root", "/workspace",
    ...(input.gameCommit ? ["--archive-file", "/input/game.tar.gz", "--game-commit", input.gameCommit] : ["--game-dir", "/input"]),
    "--output", "/output", "--runtime-image", input.imageId,
    ...(input.configFile ? ["--config", "/starting-config.json"] : [])];
}

/** git archive reads the immutable tree, so dirty/untracked files never enter a recorded version check. */
export async function prepareCommittedGameArchive(cwd: string) {
  const git = (args: string[]) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", windowsHide: true });
    if (result.error || result.status !== 0) throw new Error("Cannot export the committed game. Run this from a Git game repository with a commit.");
    return result.stdout.trim();
  };
  const root = await realpath(git(["rev-parse", "--show-toplevel"]));
  if (root !== await realpath(cwd)) throw new Error("Run --committed from the game repository root");
  const gameCommit = git(["rev-parse", "--verify", "HEAD"]);
  if (!/^[a-f0-9]{40}$/i.test(gameCommit)) throw new Error("Git did not return an immutable game commit");
  const directory = await mkdtemp(path.join(tmpdir(), "gameinstance-committed-"));
  const cleanup = () => rm(directory, { recursive: true, force: true });
  try {
    const dirty = git(["status", "--porcelain"]).length > 0;
    git(["archive", "--format=tar.gz", "--prefix=game/", "--output", path.join(directory, "game.tar.gz"), gameCommit]);
    return { directory, gameCommit, dirty, cleanup };
  } catch (error) { await cleanup(); throw error; }
}

/** Uses the selected production image's own runtime components, without a dashboard or encoder. */
export async function runRuntimeCheck(options: RuntimeCheckOptions = {}): Promise<number> {
  const cwd = await realpath(options.cwd ?? process.cwd());
  const outputDirectory = path.resolve(cwd, options.output ?? "artifacts/game-conformance");
  const image = await selectedRuntimeImage(cwd, options.image);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._/:@-]*$/.test(image)) throw new Error("Invalid runtime image name");
  const inspected = spawnSync("docker", ["image", "inspect", "--format", "{{.Id}}", image], { encoding: "utf8", windowsHide: true });
  if (inspected.error || inspected.status !== 0) throw new Error(`Runtime image ${image} is unavailable. Start Docker and build or pull the matching stream-runtime image first.`);
  const imageId = inspected.stdout.trim();
  let configFile: string | undefined;
  if (options.config) {
    configFile = await realpath(path.resolve(cwd, options.config));
    if (!(await stat(configFile)).isFile()) throw new Error("Configuration must be a JSON file");
  }
  await mkdir(outputDirectory, { recursive: true });
  const snapshot = options.committed ? await prepareCommittedGameArchive(cwd) : undefined;
  try {
    const args = runtimeCheckArguments({ gameDirectory: snapshot?.directory ?? cwd, outputDirectory, imageId,
      ...(snapshot ? { gameCommit: snapshot.gameCommit } : {}), ...(configFile ? { configFile } : {}) });
    console.log(JSON.stringify({ runtimeImage: image, runtimeImageId: imageId, reportDirectory: outputDirectory,
      ...(snapshot ? { gameCommit: snapshot.gameCommit, workingCopyChangesExcluded: snapshot.dirty } : {}) }));
    const child = spawn("docker", args, { stdio: "inherit", windowsHide: true });
    return await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
  } finally { await snapshot?.cleanup(); }
}
