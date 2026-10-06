import { Rive, RuntimeLoader, type ViewModelInstanceNumber } from "@rive-app/canvas";
import riveWasmUrl from "@rive-app/canvas/rive.wasm?url";
import soboUrl from "./assets/mascot/sobo.riv?url";
import { LETTER_FONT } from "./assets";
import type { GameAudio } from "./audio";
import { detectCues } from "./cues";
import type { GameState } from "./game";
import { Host, type Speech } from "./host";
import { textTrack, VISEME, visemeAt, visemeFromLevel, type LipSyncTrack } from "./lipsync";

// Sobo, the forest-sprout host: a Rive character (assets/mascot/sobo.riv, artboard
// SOBO-Motion-V02) who stands bottom-left under the board and comments on the game.
// Lines play as ElevenLabs clips (src/assets/voice, made by `corepack pnpm
// voice:generate`) and his mouth moves through nine poses (lips, teeth, tongue) on
// Rhubarb's timings for each clip (scripts/lipsync-voice.mjs); without timings it
// follows the voice's loudness, and before any clip exists it mouths the bubble's
// letters. Each line also picks a gesture.
// Presentation only: Sobo reads state and never changes it.

// Serve the Rive runtime from our own bundle rather than a CDN.
RuntimeLoader.setWasmUrl(riveWasmUrl);
const CLIPS = import.meta.glob("./assets/voice/*.mp3", { eager: true, query: "?url", import: "default" }) as Record<string, string>;
const TRACKS = import.meta.glob("./assets/voice/*.json", { eager: true, import: "default" }) as Record<string, LipSyncTrack>;

/** Sobo's square artboard renders at half size; this crop around him is drawn bottom-left on the forest. */
const ARTBOARD = 540, CROP = { x: 90, y: 70, width: 360, height: 380 };
const SPOT = { x: -16, y: 1352, width: 290, height: 306 };
/** The file's numState values: 0 idle, 1 hello wave, 2 happy nod, 3 excited bounce, 4 talking gestures, 5 listening. */
const GESTURE = { idle: 0, hello: 1, yes: 2, excited: 3, talk: 4, listen: 5 } as const;
/** Which gesture goes with each kind of line, by its id prefix. */
const GESTURE_FOR: [RegExp, number][] = [
  [/^(welcome|level|retry)/, GESTURE.hello], [/^(praise|first)/, GESTURE.yes], [/^(streak|leader|clear|gameover)/, GESTURE.excited],
  [/^(timeup|stopped)/, GESTURE.listen]
];
/** Speech bubble above the leaderboard / level badge, its tail pointing down at Sobo. */
const BUBBLE = { left: 230, maxRight: 934, centerY: 1282, minWidth: 540, minHeight: 92 };
const IDLE_AFTER_MS = 25_000, IDLE_REPEAT_MS = 22_000, HOLD_MS = 1600, FADE_MS = 300;
/** How long a voiced line waits for the browser to allow sound before it is shown silently. */
const SOUND_WAIT_MS = 10_000;

/** A line being said: its mouth track (none while following a clip's loudness instead). */
type Talk = Speech & { startedAt: number; durationMs: number; voiced: boolean; track?: LipSyncTrack };

export class Mascot {
  // Offscreen: Rive skips drawing to a canvas that has no on-page size, and this
  // one is only ever copied into the game canvas.
  private readonly canvas = new OffscreenCanvas(ARTBOARD, ARTBOARD);
  private readonly host = new Host();
  private rive?: Rive;
  private viseme?: ViewModelInstanceNumber | null;
  private gesture?: ViewModelInstanceNumber | null;
  private playGesture?: () => void;
  /** The gesture Sobo should be doing, and the one last sent to the file. */
  private wantedGesture: number = GESTURE.idle;
  private sentGesture = -1;
  private previous?: GameState;
  private talk?: Talk;
  private queued?: Speech;
  /** A voiced line held until the browser allows sound (it plays once the page is clicked). */
  private waiting?: Speech & { since: number };
  private lastLineEndedAt = 0;
  private lastActivityAt = performance.now();
  private mouthPose: number = VISEME.rest;

  constructor(private readonly audio?: GameAudio) {}

  start(): void {
    const rive = new Rive({
      canvas: this.canvas, src: soboUrl, artboard: "SOBO-Motion-V02", stateMachine: "State Machine", autoplay: true, autoBind: true, shouldDisableRiveListeners: true,
      onLoad: () => {
        const model = rive.viewModelInstance;
        this.viseme = model?.number("viseme"); this.gesture = model?.number("numState");
        const trigger = model?.trigger("trigState");
        this.playGesture = () => trigger?.trigger();
        // Send the current gesture right away: a line may already be playing, and the
        // file's body animation only starts once its state trigger fires.
        this.applyGesture();
      }
    });
    this.rive = rive;
  }

  dispose(): void {
    this.rive?.cleanup();
    this.rive = undefined;
  }

  /** Reacts to what just happened in the game. */
  update(state: GameState): void {
    const cues = detectCues(this.previous, state);
    this.previous = state;
    if (state.runtime.paused) return;
    const now = performance.now();
    if (cues.some(cue => cue.kind === "find" || cue.kind === "levelStart")) this.lastActivityAt = now;
    const speech = this.host.respond(cues, state);
    if (speech) this.offer(speech, now);
    // Fill long quiet stretches during play with a little banter.
    if (state.world.phase === "playing" && !this.talk && now - this.lastActivityAt > IDLE_AFTER_MS && now - this.lastLineEndedAt > IDLE_REPEAT_MS) {
      this.say(this.host.idle(), now);
    }
  }

  /** Draws Sobo and his speech bubble on top of the game frame. */
  draw(ctx: CanvasRenderingContext2D, state: GameState): void {
    const now = performance.now();
    this.animate(now);
    if (state.runtime.paused) return;
    ctx.drawImage(this.canvas, CROP.x, CROP.y, CROP.width, CROP.height, SPOT.x, SPOT.y, SPOT.width, SPOT.height);
    if (this.talk) this.drawBubble(ctx, this.talk, now);
  }

  private offer(speech: Speech, now: number): void {
    const talk = this.talk;
    // While a line waits for sound, say() keeps the most important one in its spot.
    if (!talk) { if (this.waiting || Host.mayChatter(speech.priority, now - this.lastLineEndedAt)) this.say(speech, now); return; }
    // A bigger moment cuts in; anything else worth saying waits its turn.
    if (speech.priority > talk.priority) this.say(speech, now);
    else if (speech.priority >= 3 && (!this.queued || speech.priority >= this.queued.priority)) this.queued = speech;
  }

  private say(speech: Speech, now: number): void {
    // Browsers hold sound until the first click: keep a voiced line until then rather than
    // miming it silently (the welcome would otherwise be lost before anyone hears it).
    if (this.waiting) { if (speech.priority >= this.waiting.priority) this.waiting = { ...speech, since: this.waiting.since }; return; }
    if (this.audio && !this.audio.running && CLIPS[`./assets/voice/${speech.id}.mp3`]) {
      this.waiting = { ...speech, since: now };
      return;
    }
    this.sayNow(speech, now);
  }

  private sayNow(speech: Speech, now: number): void {
    // Until a clip plays, mouth the bubble's letters at a natural pace.
    const track = textTrack(speech.text);
    const talk: Talk = { ...speech, startedAt: now, durationMs: track.duration * 1000 + 200, voiced: false, track };
    this.talk = talk;
    this.setGesture(GESTURE_FOR.find(([pattern]) => pattern.test(speech.id))?.[1] ?? GESTURE.talk);
    if (this.queued && this.queued.priority <= speech.priority) this.queued = undefined;
    const url = CLIPS[`./assets/voice/${speech.id}.mp3`];
    if (!url || !this.audio) return;
    void this.audio.speak(url).then(seconds => {
      if (seconds === undefined || this.talk !== talk) return;
      talk.voiced = true; talk.startedAt = performance.now(); talk.durationMs = seconds * 1000 + 100;
      talk.track = TRACKS[`./assets/voice/${speech.id}.json`];
    });
  }

  /** Drives the mouth and the line queue every frame. */
  private animate(now: number): void {
    const waiting = this.waiting;
    if (waiting && (this.audio?.running || now - waiting.since > SOUND_WAIT_MS)) {
      // Sound is allowed now, or it is not coming: say the line (silently if still blocked).
      this.waiting = undefined;
      this.talk = undefined;
      this.sayNow(waiting, now);
    }
    const talk = this.talk;
    if (talk && now - talk.startedAt > talk.durationMs + HOLD_MS + FADE_MS) {
      this.talk = undefined; this.lastLineEndedAt = now; this.setGesture(GESTURE.idle);
      if (this.queued) { const next = this.queued; this.queued = undefined; this.say(next, now); }
    }
    const speaking = talk !== undefined && now - talk.startedAt < talk.durationMs;
    let pose: number = VISEME.rest;
    if (speaking && talk.track) pose = visemeAt(talk.track, (now - talk.startedAt) / 1000);
    else if (speaking) pose = visemeFromLevel(this.audio?.voiceLevel() ?? 0, this.mouthPose !== VISEME.rest);
    this.mouthPose = pose;
    if (this.viseme) this.viseme.value = pose;
  }

  private setGesture(gesture: number): void {
    this.wantedGesture = gesture;
    this.applyGesture();
  }
  private applyGesture(): void {
    if (!this.gesture || this.wantedGesture === this.sentGesture) return;
    this.sentGesture = this.wantedGesture; this.gesture.value = this.wantedGesture; this.playGesture?.();
  }

  private drawBubble(ctx: CanvasRenderingContext2D, talk: Talk, now: number): void {
    const age = now - talk.startedAt;
    const fade = Math.min(1, Math.max(0, (talk.durationMs + HOLD_MS + FADE_MS - age) / FADE_MS));
    const pop = 1 - (1 - Math.min(1, age / 260)) ** 3;
    let size = 36;
    let lines = wrap(ctx, talk.text, size, BUBBLE.maxRight - BUBBLE.left - 64);
    if (lines.length > 2) { size = 30; lines = wrap(ctx, talk.text, size, BUBBLE.maxRight - BUBBLE.left - 64); }
    ctx.font = `400 ${size}px ${LETTER_FONT}`;
    const textWidth = Math.max(...lines.map(line => ctx.measureText(line).width));
    const width = Math.max(BUBBLE.minWidth, Math.min(BUBBLE.maxRight - BUBBLE.left, textWidth + 64));
    const height = Math.max(BUBBLE.minHeight, lines.length * size * 1.15 + 34);
    const top = BUBBLE.centerY - height / 2, left = BUBBLE.left;
    // Pop in from the tail, near Sobo.
    ctx.save(); ctx.globalAlpha = fade * Math.min(1, age / 120);
    ctx.translate(left + 24, top + height); ctx.scale(0.85 + 0.15 * pop, 0.85 + 0.15 * pop); ctx.translate(-(left + 24), -(top + height));
    const paper = ctx.createLinearGradient(0, top, 0, top + height);
    paper.addColorStop(0, "#fff7e2"); paper.addColorStop(1, "#f1ddb0");
    ctx.shadowColor = "rgba(0, 0, 0, 0.55)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 8;
    ctx.beginPath(); ctx.roundRect(left, top, width, height, 24);
    // Tail down to Sobo's hat.
    ctx.moveTo(left + 6, top + height - 2); ctx.lineTo(left - 56, top + height + 72); ctx.lineTo(left + 48, top + height - 2);
    ctx.fillStyle = paper; ctx.fill();
    ctx.shadowColor = "transparent";
    ctx.strokeStyle = "#a57a24"; ctx.lineWidth = 3; ctx.stroke();
    // Typewriter reveal paced to the voice.
    const total = lines.reduce((sum, line) => sum + line.length, 0);
    let shown = Math.ceil(total * Math.min(1, age / Math.max(1, talk.durationMs * 0.85)));
    ctx.fillStyle = "#24160c"; ctx.textAlign = "left"; ctx.textBaseline = "middle";
    lines.forEach((line, index) => {
      const visible = line.slice(0, Math.max(0, shown)); shown -= line.length;
      ctx.fillText(visible, left + 32, top + 17 + size * 0.6 + index * size * 1.15);
    });
    ctx.restore();
  }
}

/** Greedy word wrap to a pixel width in the bubble font. */
function wrap(ctx: CanvasRenderingContext2D, text: string, size: number, maxWidth: number): string[] {
  ctx.font = `400 ${size}px ${LETTER_FONT}`;
  const lines: string[] = [];
  for (const word of text.split(" ")) {
    const last = lines[lines.length - 1];
    if (last !== undefined && ctx.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(word);
  }
  return lines;
}
