// Developer tool: turns Sobo's lines (src/voice-lines.json) into mp3 clips with
// ElevenLabs, saved to src/assets/voice/<id>.mp3 and bundled with the game, then works
// out the mouth shapes for each new clip (scripts/lipsync-voice.mjs).
// The API key never reaches the game: it is read from ELEVENLABS_API_KEY or the
// gitignored .env.local, used only here, and never printed.
//
//   corepack pnpm voice:generate                 generate clips that are missing
//   corepack pnpm voice:generate --force         regenerate every clip
//   corepack pnpm voice:generate --only=praise_1 regenerate one clip
//   corepack pnpm voice:generate --voices        list the voices on your account
//
// Pick the voice with ELEVENLABS_VOICE (a voice name or id) in .env.local. Lines use
// Eleven v3 audio tags such as [excited] or [giggles]; with another model
// (ELEVENLABS_MODEL) the tags are removed so they are not read out. v3 voice stability is
// 0 (creative), 0.5 (natural, the default) or 1 (robust): ELEVENLABS_STABILITY.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const env = { ...readEnvFile(resolve(root, ".env.local")), ...process.env };
const key = env.ELEVENLABS_API_KEY;
if (!key) {
  console.error("Missing ELEVENLABS_API_KEY. Put it in .env.local (gitignored), e.g.\n  ELEVENLABS_API_KEY=your-key\n  ELEVENLABS_VOICE=Jessica");
  process.exit(1);
}
const MODEL = env.ELEVENLABS_MODEL || "eleven_v3";
const V3 = MODEL.startsWith("eleven_v3");
const STABILITY = Number(env.ELEVENLABS_STABILITY ?? (V3 ? 0.5 : 0.35));
const args = process.argv.slice(2);
const api = (path, init = {}) => fetch(`https://api.elevenlabs.io${path}`, { ...init, headers: { "xi-api-key": key, ...init.headers } });

const wanted = env.ELEVENLABS_VOICE || "Jessica";
const isId = /^[A-Za-z0-9]{20}$/.test(wanted);
// Listing voices needs the key's voices_read permission; a voice id works without it.
let voices = [];
if (args.includes("--voices") || !isId) {
  const voicesResponse = await api("/v1/voices");
  if (!voicesResponse.ok) await fail("Could not list voices (set ELEVENLABS_VOICE to a voice id to skip this)", voicesResponse);
  voices = (await voicesResponse.json()).voices;
}
if (args.includes("--voices")) {
  for (const voice of voices) console.log(`${voice.name.padEnd(28)} ${voice.voice_id}  ${Object.values(voice.labels ?? {}).join(", ")}`);
  process.exit(0);
}
// A Voice Library voice may not be listed under the account's own voices; use its id directly.
const voice = voices.find(entry => entry.voice_id === wanted) ?? voices.find(entry => entry.name.toLowerCase().startsWith(wanted.toLowerCase()))
  ?? (isId ? { voice_id: wanted, name: wanted } : undefined);
if (!voice) { console.error(`Voice "${wanted}" not found. Run with --voices to see the options.`); process.exit(1); }

const groups = JSON.parse(readFileSync(resolve(root, "src/voice-lines.json"), "utf8"));
const only = args.find(arg => arg.startsWith("--only="))?.slice(7);
const force = args.includes("--force") || Boolean(only);
const outDir = resolve(root, "src/assets/voice");
mkdirSync(outDir, { recursive: true });
const lines = Object.values(groups).flat().filter(line => !only || line.id === only);
let made = 0, skipped = 0, characters = 0;
console.log(`Voice: ${voice.name} · model: ${MODEL} · stability: ${STABILITY}`);
for (const line of lines) {
  const file = resolve(outDir, `${line.id}.mp3`);
  if (existsSync(file) && !force) { skipped++; continue; }
  const response = await api(`/v1/text-to-speech/${voice.voice_id}?output_format=mp3_44100_128`, {
    method: "POST", headers: { "content-type": "application/json", accept: "audio/mpeg" },
    body: JSON.stringify({ text: V3 ? line.say : line.say.replace(/\[[^\]]*\]\s*/g, ""), model_id: MODEL,
      voice_settings: V3 ? { stability: STABILITY, similarity_boost: 0.8 } : { stability: STABILITY, similarity_boost: 0.8, style: 0.45, use_speaker_boost: true } })
  });
  if (!response.ok) {
    if (V3 && [400, 401, 403, 422].includes(response.status)) console.error("If your plan does not include Eleven v3, set ELEVENLABS_MODEL=eleven_multilingual_v2 in .env.local (the [tags] are then dropped).");
    await fail(`Failed on ${line.id}`, response);
  }
  writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  made++; characters += line.say.length;
  console.log(`  ✓ ${line.id}  "${line.say}"`);
}
console.log(`Done: ${made} generated (${characters} characters), ${skipped} already existed.`);
// Mouth shapes for the new clips (skipped with a hint if Rhubarb is not installed).
try { execFileSync(process.execPath, [resolve(root, "scripts/lipsync-voice.mjs"), ...(only ? [`--only=${only}`] : force ? ["--force"] : [])], { stdio: "inherit" }); }
catch { console.error("Lip sync did not finish; run corepack pnpm voice:lipsync once Rhubarb is set up."); }

function readEnvFile(path) {
  if (!existsSync(path)) return {};
  return Object.fromEntries(readFileSync(path, "utf8").split(/\r?\n/)
    .map(line => line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)).filter(Boolean)
    .map(([, name, value]) => [name, value.replace(/^["']|["']$/g, "")]));
}
async function fail(message, response) {
  const detail = await response.text().catch(() => "");
  console.error(`${message}: HTTP ${response.status} ${detail.slice(0, 300)}`);
  process.exit(1);
}
