// Developer tool: works out Sobo's mouth shapes for every voice clip with Rhubarb Lip
// Sync (free, offline) and saves them beside the clip as src/assets/voice/<id>.json,
// which the game plays in time with the audio.
//
//   corepack pnpm voice:lipsync           clips without mouth timings yet
//   corepack pnpm voice:lipsync --force   redo every clip
//   corepack pnpm voice:lipsync --only=id redo one clip
//
// Needs Rhubarb (https://github.com/DanielSWolf/rhubarb-lip-sync/releases): on PATH, in
// RHUBARB, or unzipped into tools/. Uses macOS afconvert (or ffmpeg) to read the mp3s.
import { execFile } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const root = process.cwd(), voiceDir = resolve(root, "src/assets/voice");
// Rhubarb's shapes, in the order of the `viseme` numbers in sobo.riv.
const VISEMES = { X: 0, A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8 };

const rhubarb = findRhubarb();
if (!rhubarb) {
  console.error("Rhubarb Lip Sync not found. Download it from https://github.com/DanielSWolf/rhubarb-lip-sync/releases\nand unzip it into tools/ (or put `rhubarb` on your PATH, or set RHUBARB=/path/to/rhubarb).");
  process.exit(1);
}
const lines = Object.fromEntries(Object.values(JSON.parse(readFileSync(resolve(root, "src/voice-lines.json"), "utf8"))).flat().map(line => [line.id, line.say]));
const force = process.argv.includes("--force");
const only = process.argv.find(arg => arg.startsWith("--only="))?.slice(7);
const clips = existsSync(voiceDir) ? readdirSync(voiceDir).filter(file => file.endsWith(".mp3")).map(file => file.slice(0, -4)) : [];
const todo = clips.filter(id => only ? id === only : force || !existsSync(join(voiceDir, `${id}.json`)));
if (!clips.length) { console.log("No voice clips yet. Run corepack pnpm voice:generate first."); process.exit(0); }
console.log(`Lip sync: ${todo.length} of ${clips.length} clips (Rhubarb takes a few seconds each)…`);
const work = mkdtempSync(join(tmpdir(), "lipsync-"));
try {
  // A few at a time: Rhubarb is single-threaded.
  for (let index = 0; index < todo.length; index += 3) await Promise.all(todo.slice(index, index + 3).map(sync));
} finally { rmSync(work, { recursive: true, force: true }); }
console.log("Done.");

async function sync(id) {
  const wav = join(work, `${id}.wav`), dialog = join(work, `${id}.txt`);
  await toWav(join(voiceDir, `${id}.mp3`), wav);
  // The spoken words (without Eleven v3 [tags]) help Rhubarb recognise the sounds.
  writeFileSync(dialog, (lines[id] ?? "").replace(/\[[^\]]*\]\s*/g, "").trim());
  const { stdout } = await run(rhubarb, ["-f", "json", "-q", "--dialogFile", dialog, wav], { maxBuffer: 16 * 1024 * 1024 });
  const result = JSON.parse(stdout);
  const track = { duration: Number(result.metadata.duration.toFixed(3)),
    cues: result.mouthCues.map(cue => [Number(cue.start.toFixed(3)), VISEMES[cue.value] ?? 0]) };
  writeFileSync(join(voiceDir, `${id}.json`), JSON.stringify(track) + "\n");
  console.log(`  ✓ ${id} (${track.cues.length} mouth shapes)`);
}
async function toWav(input, output) {
  try { await run("afconvert", ["-f", "WAVE", "-d", "LEI16@22050", input, output]); }
  catch { await run("ffmpeg", ["-y", "-loglevel", "error", "-i", input, "-ac", "1", "-ar", "22050", output]); }
}
function findRhubarb() {
  if (process.env.RHUBARB && existsSync(process.env.RHUBARB)) return process.env.RHUBARB;
  const tools = resolve(root, "tools");
  if (existsSync(tools)) {
    for (const entry of readdirSync(tools)) {
      const candidate = join(tools, entry, "rhubarb");
      if (entry.toLowerCase().startsWith("rhubarb") && existsSync(candidate)) return candidate;
    }
  }
  for (const dir of (process.env.PATH ?? "").split(":")) if (dir && existsSync(join(dir, "rhubarb"))) return join(dir, "rhubarb");
  return undefined;
}
