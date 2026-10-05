import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

export type SdkIdentity = { identity: string; packages: string[]; files: Record<string, string> };
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

/** Content identity is independent of checkout location, timestamps and Windows newlines. */
export function sdkIdentityForPackages(repoRoot: string, names: string[]): SdkIdentity {
  const packages = [...new Set(names)].sort();
  if (!packages.length || packages.some(name => !/^[a-z][a-z0-9-]*$/.test(name))) throw new Error("Invalid SDK package name");
  const files: Record<string, string> = {};
  const add = (file: string) => {
    files[relative(repoRoot, file).replaceAll("\\", "/")] = digest(readFileSync(file, "utf8").replaceAll("\r\n", "\n"));
  };
  add(join(repoRoot, "tsconfig.base.json"));
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) throw new Error("SDK source must not contain symbolic links");
      if (entry.isDirectory()) visit(join(directory, entry.name));
      else if (!/\.(test|spec)\./.test(entry.name)) add(join(directory, entry.name));
    }
  };
  for (const name of packages) {
    const folder = join(repoRoot, "packages", name);
    add(join(folder, "package.json"));
    for (const file of readdirSync(folder).filter(file => /^tsconfig.*\.json$/.test(file)).sort()) add(join(folder, file));
    visit(join(folder, "src"));
  }
  const ordered = Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
  return { identity: `sha256:${digest(JSON.stringify(ordered))}`, packages, files: ordered };
}
