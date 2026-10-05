import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const digest = value => createHash("sha256").update(value).digest("hex");
export function verifySdk(root = process.cwd()) {
  const manifest = JSON.parse(readFileSync(join(root, ".streamforge-submodules.json"), "utf8"));
  if (manifest.schemaVersion !== 3 || !Array.isArray(manifest.submodules) || manifest.submodules.length !== 1) throw new Error("Expected one version 3 bundled SDK distribution.");
  const expected = manifest.submodules[0];
  if (expected.distribution !== "bundled" || expected.path !== "vendor/gameinstance" || expected.gameContractVersion !== "1.0.0" || typeof expected.sdkVersion !== "string" || !/^sha256:[a-f0-9]{64}$/.test(expected.sdkIdentity || "")) throw new Error("Invalid bundled SDK declaration.");
  if (!Array.isArray(expected.packages) || [...expected.packages].sort().join(",") !== "game-dev,game-kit,protocol") throw new Error("The SDK bundle must contain protocol, game-kit and game-dev exactly once.");
  const sdkRoot = join(root, expected.path);
  for (const directory of [join(root, "vendor"), sdkRoot, join(sdkRoot, "packages")]) if (!lstatSync(directory).isDirectory()) throw new Error("SDK directories must not be symbolic links: " + directory);
  const files = {};
  const add = file => {
    if (!lstatSync(file).isFile()) throw new Error("SDK source must be regular files: " + file);
    files[relative(sdkRoot, file).replaceAll("\\", "/")] = digest(readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
  };
  const visit = directory => {
    if (!lstatSync(directory).isDirectory()) throw new Error("SDK directories must not be symbolic links: " + directory);
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error("SDK source must not contain symbolic links.");
      if (entry.isDirectory()) visit(join(directory, entry.name));
      else if (!/\.(test|spec)\./.test(entry.name)) add(join(directory, entry.name));
    }
  };
  add(join(sdkRoot, "tsconfig.base.json"));
  for (const name of [...expected.packages].sort()) {
    const folder = join(sdkRoot, "packages", name);
    if (!lstatSync(folder).isDirectory()) throw new Error("SDK package directories must not be symbolic links.");
    add(join(folder, "package.json"));
    for (const file of readdirSync(folder).filter(file => /^tsconfig.*\.json$/.test(file)).sort()) add(join(folder, file));
    visit(join(folder, "src"));
  }
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  const actual = "sha256:" + digest(JSON.stringify(ordered));
  if (actual !== expected.sdkIdentity) throw new Error("Bundled SDK content identity mismatch. Restore the committed SDK bundle or install a complete verified SDK upgrade.");
  const distribution = JSON.parse(readFileSync(join(sdkRoot, "SDK.json"), "utf8"));
  if (distribution.sdkIdentity !== actual || distribution.sdkVersion !== expected.sdkVersion || distribution.gameContractVersion !== expected.gameContractVersion || JSON.stringify(distribution.files) !== JSON.stringify(ordered)) throw new Error("SDK distribution metadata does not match its source and manifest.");
  return { sdkVersion: expected.sdkVersion, sdkIdentity: actual };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(verifySdk(), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
