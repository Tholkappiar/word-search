import { detectCues, type Cue } from "./cues";
import type { GameState } from "./game";
import { RESULT_DELAY_MS } from "./render";

// Enchanted-forest soundtrack and sound effects, synthesized live with Web Audio so
// there are no audio files to license or load. The music is generative: a slow, warm
// lo-fi lullaby (harp arpeggios, music-box melody, soft pads, round bass and a gentle
// pulse) that keeps reshuffling its chords and phrases, so it never loops noticeably
// over long streams. Each level moves to a new key, and every sound effect is played
// in the current key so it blends with the music.
// Presentation only: sounds react to state changes and never touch gameplay, so
// Math.random is fine here.

const STEP = 60 / 72 / 2; // Eighth notes at 72 BPM.
const STEPS_PER_CHORD = 16; // Two bars per chord.
const LOOKAHEAD = 0.4, SCHEDULE_MS = 100;
const PENTATONIC = [0, 2, 4, 7, 9];
/** Tonic (MIDI) for each level, cycling; all sit comfortably in the middle register. */
const LEVEL_KEYS = [62, 65, 60, 64, 57, 63, 59, 61, 66, 58];
/** Chord progressions as semitone offsets from the tonic; the first tone is the bass. */
const IMAJ9 = [0, 4, 7, 11, 14], VI7 = [-3, 0, 4, 7], IVMAJ7 = [5, 9, 12, 16], VSUS = [7, 12, 14, 17], III7 = [4, 7, 11, 14], II9 = [2, 5, 9, 12, 16];
const PROGRESSIONS = [[IMAJ9, VI7, IVMAJ7, VSUS], [IVMAJ7, III7, VI7, II9], [IMAJ9, IVMAJ7, IMAJ9, IVMAJ7], [VI7, IVMAJ7, IMAJ9, VSUS]];
const ARP_PATTERNS = [[0, 1, 2, 3, 4, 3, 2, 1], [0, 2, 1, 3, 2, 4, 3, 1], [0, 1, 2, 4, 3, 2, 1, 2], [0, 2, 4, 2, 1, 3, 5, 3]];

/** Gestures browsers accept for starting audio; different browsers honour different ones. */
const UNLOCK_EVENTS = ["pointerdown", "pointerup", "mousedown", "click", "keydown", "touchend"];

function hz(midi: number): number { return 440 * 2 ** ((midi - 69) / 12); }
/** A note of the major pentatonic scale; degree 5 is the next octave's tonic. */
function scale(root: number, degree: number): number { return root + PENTATONIC[((degree % 5) + 5) % 5] + 12 * Math.floor(degree / 5); }
function pick<T>(items: readonly T[]): T { return items[Math.floor(Math.random() * items.length)]; }

type Bus = { input: GainNode; volume: GainNode };

export class GameAudio {
  private ctx?: AudioContext;
  private music?: Bus;
  private sfx?: Bus;
  private echo?: GainNode;
  /** Sobo's voice: its own volume, a meter for lip sync, and a dip in the music while he talks. */
  private voice?: Bus & { meter: AnalyserNode };
  private duck?: GainNode;
  private voiceClips = new Map<string, Promise<AudioBuffer | undefined>>();
  private voiceSource?: AudioBufferSourceNode;
  private meterData = new Float32Array(1024);
  private noise?: AudioBuffer;
  private previous?: GameState;
  private timer?: ReturnType<typeof setInterval>;
  private unlock?: () => void;
  private wake?: () => void;
  private nextTime = 0;
  private step = 0;
  private root = LEVEL_KEYS[0];
  private targetRoot = LEVEL_KEYS[0];
  private progression = PROGRESSIONS[0];
  private pattern = ARP_PATTERNS[0];
  private melodyDegree = 7;
  private melodyBars = 0;

  /** Starts the soundtrack. Browsers may hold audio until the first click or key press. */
  start(): void {
    if (this.ctx || typeof AudioContext === "undefined") return;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18; compressor.ratio.value = 3; compressor.attack.value = 0.01; compressor.release.value = 0.25;
    compressor.connect(ctx.destination);
    const impulse = this.createImpulse(3.2);
    this.duck = ctx.createGain(); this.duck.connect(compressor);
    this.music = this.createBus(impulse, 0.38, this.duck);
    this.sfx = this.createBus(impulse, 0.28, compressor);
    const voiceIn = ctx.createGain(), voiceVolume = ctx.createGain(), meter = ctx.createAnalyser();
    voiceVolume.gain.value = 0; meter.fftSize = this.meterData.length;
    voiceIn.connect(voiceVolume); voiceIn.connect(meter); voiceVolume.connect(compressor);
    this.voice = { input: voiceIn, volume: voiceVolume, meter };
    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const samples = this.noise.getChannelData(0);
    for (let index = 0; index < samples.length; index++) samples[index] = Math.random() * 2 - 1;
    // A soft dotted-eighth echo on the harp makes it shimmer.
    this.echo = ctx.createGain();
    const delay = ctx.createDelay(1), feedback = ctx.createGain(), tone = ctx.createBiquadFilter();
    delay.delayTime.value = STEP * 1.5; feedback.gain.value = 0.32; tone.type = "lowpass"; tone.frequency.value = 2200;
    this.echo.connect(delay); delay.connect(tone); tone.connect(feedback); feedback.connect(delay);
    const echoOut = ctx.createGain(); echoOut.gain.value = 0.35;
    tone.connect(echoOut); echoOut.connect(this.music.input);
    // Browsers hold audio until the page gets a click or key press, and can suspend it
    // again later (Safari "interrupts" it in background tabs). Keep retrying on every
    // gesture until it really runs, re-arm whenever it stops, and wake it on tab return.
    ctx.onstatechange = () => this.syncUnlock();
    this.wake = () => { if (document.visibilityState === "visible") this.resume(); };
    document.addEventListener("visibilitychange", this.wake);
    this.syncUnlock();
    this.resume();
    this.nextTime = ctx.currentTime + 0.3;
    this.timer = setInterval(() => this.schedule(), SCHEDULE_MS);
  }

  /** Follows the game: volumes, pause and level key, plus one-shot effects for what just happened. */
  update(state: GameState): void {
    const { ctx, music, sfx } = this;
    if (!ctx || !music || !sfx) return;
    const { config, paused } = state.runtime;
    // Squared for a natural-feeling volume knob; pausing drops the music to a murmur.
    const musicLevel = (config.musicVolume / 100) ** 2 * 1.8 * (paused ? 0.25 : 1);
    const sfxLevel = (config.soundVolume / 100) ** 2;
    music.volume.gain.setTargetAtTime(musicLevel, ctx.currentTime, 0.4);
    sfx.volume.gain.setTargetAtTime(sfxLevel, ctx.currentTime, 0.05);
    this.voice?.volume.gain.setTargetAtTime((config.voiceVolume / 100) ** 2 * 1.2, ctx.currentTime, 0.05);
    this.targetRoot = LEVEL_KEYS[(state.world.level - 1) % LEVEL_KEYS.length];
    const cues = detectCues(this.previous, state);
    this.previous = state;
    if (ctx.state !== "running" || paused) return;
    for (const cue of cues) this.play(cue);
  }

  /**
   * Plays one of Sobo's voice clips, interrupting any line still playing, and dips the
   * music under it. Resolves to the clip's length in seconds, or undefined when it
   * cannot play (audio still blocked, or the clip is missing).
   */
  async speak(url: string): Promise<number | undefined> {
    const ctx = this.ctx, voice = this.voice, duck = this.duck;
    if (!ctx || !voice || !duck || ctx.state !== "running") return undefined;
    if (!this.voiceClips.has(url)) {
      this.voiceClips.set(url, fetch(url).then(response => response.ok ? response.arrayBuffer() : Promise.reject(new Error(url)))
        .then(data => ctx.decodeAudioData(data)).catch(() => undefined));
    }
    const buffer = await this.voiceClips.get(url);
    if (!buffer || this.ctx !== ctx) return undefined;
    this.voiceSource?.stop();
    const source = ctx.createBufferSource(), start = ctx.currentTime + 0.02;
    source.buffer = buffer; source.connect(voice.input); source.start(start);
    this.voiceSource = source;
    duck.gain.cancelScheduledValues(start);
    duck.gain.setTargetAtTime(0.45, start, 0.08);
    duck.gain.setTargetAtTime(1, start + buffer.duration + 0.15, 0.4);
    return buffer.duration;
  }

  /** How loud Sobo's voice is right now, 0..1, for his mouth. */
  voiceLevel(): number {
    const meter = this.voice?.meter;
    if (!meter || this.ctx?.state !== "running") return 0;
    meter.getFloatTimeDomainData(this.meterData);
    let sum = 0;
    for (const sample of this.meterData) sum += sample * sample;
    return Math.min(1, Math.max(0, (Math.sqrt(sum / this.meterData.length) - 0.015) * 7));
  }

  /** Tries to start audio now; it works when called from a click or key press. */
  resume(): void {
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running" && ctx.state !== "closed") void ctx.resume().then(() => this.syncUnlock(), () => undefined);
  }

  dispose(): void {
    clearInterval(this.timer);
    this.disarmUnlock();
    if (this.wake) document.removeEventListener("visibilitychange", this.wake);
    if (this.ctx) this.ctx.onstatechange = null;
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
  }

  private syncUnlock(): void {
    const state = this.ctx?.state;
    if (state === "running" || state === "closed" || !state) this.disarmUnlock();
    else if (!this.unlock) {
      this.unlock = () => this.resume();
      for (const name of UNLOCK_EVENTS) window.addEventListener(name, this.unlock, { capture: true });
    }
  }
  private disarmUnlock(): void {
    if (!this.unlock) return;
    for (const name of UNLOCK_EVENTS) window.removeEventListener(name, this.unlock, { capture: true });
    this.unlock = undefined;
  }

  private createBus(impulse: AudioBuffer, wet: number, output: AudioNode): Bus {
    const ctx = this.ctx!;
    const input = ctx.createGain(), volume = ctx.createGain(), send = ctx.createGain(), reverb = ctx.createConvolver();
    volume.gain.value = 0; send.gain.value = wet; reverb.buffer = impulse;
    input.connect(volume); input.connect(send); send.connect(reverb); reverb.connect(volume); volume.connect(output);
    return { input, volume };
  }
  /** A soft, dark hall: stereo noise with a smooth exponential tail, darkened by averaging. */
  private createImpulse(seconds: number): AudioBuffer {
    const ctx = this.ctx!, length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      let smooth = 0;
      for (let index = 0; index < length; index++) {
        smooth = smooth * 0.6 + (Math.random() * 2 - 1) * 0.4;
        data[index] = smooth * (1 - index / length) ** 3.2;
      }
    }
    return buffer;
  }

  // ---- Instruments ----------------------------------------------------------

  /** FM voice: ratio 2 gives a harp/kalimba pluck, 3.5 a music-box bell. */
  private fm(time: number, midi: number, velocity: number, destination: AudioNode, ratio: number, index: number, decay: number): void {
    const ctx = this.ctx!, frequency = hz(midi);
    const carrier = ctx.createOscillator(), modulator = ctx.createOscillator(), depth = ctx.createGain(), amp = ctx.createGain();
    carrier.frequency.value = frequency; modulator.frequency.value = frequency * ratio;
    depth.gain.setValueAtTime(frequency * index, time);
    depth.gain.exponentialRampToValueAtTime(frequency * 0.02 + 0.01, time + decay * 0.35);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(velocity, time + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + decay);
    modulator.connect(depth); depth.connect(carrier.frequency); carrier.connect(amp); amp.connect(destination);
    carrier.start(time); modulator.start(time); carrier.stop(time + decay + 0.05); modulator.stop(time + decay + 0.05);
  }
  private harp(time: number, midi: number, velocity: number, bus: Bus, echo = false): void {
    this.fm(time, midi, velocity, bus.input, 2, 1.6, 1.8);
    if (echo && this.echo) this.fm(time, midi, velocity * 0.6, this.echo, 2, 1.6, 1.2);
  }
  private bell(time: number, midi: number, velocity: number, bus: Bus): void { this.fm(time, midi, velocity, bus.input, 3.5, 2.2, 2.6); }
  /** Warm pad: detuned saws through a slowly breathing low-pass filter. */
  private pad(time: number, notes: number[], duration: number, level: number, bus: Bus): void {
    const ctx = this.ctx!;
    const filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    filter.type = "lowpass"; filter.Q.value = 0.4;
    filter.frequency.setValueAtTime(500, time);
    filter.frequency.linearRampToValueAtTime(1100, time + duration * 0.5);
    filter.frequency.linearRampToValueAtTime(650, time + duration + 2.5);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(level, time + 1.8);
    amp.gain.setValueAtTime(level, time + duration);
    amp.gain.linearRampToValueAtTime(0.0001, time + duration + 2.5);
    filter.connect(amp); amp.connect(bus.input);
    for (const midi of notes) {
      for (const detune of [-7, 7]) {
        const oscillator = ctx.createOscillator(), voice = ctx.createGain();
        oscillator.type = "sawtooth"; oscillator.frequency.value = hz(midi); oscillator.detune.value = detune;
        voice.gain.value = 0.5 / notes.length;
        oscillator.connect(voice); voice.connect(filter);
        oscillator.start(time); oscillator.stop(time + duration + 2.6);
      }
    }
  }
  private bass(time: number, midi: number, duration: number, level: number): void {
    const ctx = this.ctx!, oscillator = ctx.createOscillator(), amp = ctx.createGain();
    oscillator.type = "sine"; oscillator.frequency.value = hz(midi);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(level, time + 0.08);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    oscillator.connect(amp); amp.connect(this.music!.input);
    oscillator.start(time); oscillator.stop(time + duration + 0.05);
  }
  /** Low sine drop: a soft kick in the music, a "pop" in effects. */
  private thump(time: number, level: number, bus: Bus, from = 90, to = 45): void {
    const ctx = this.ctx!, oscillator = ctx.createOscillator(), amp = ctx.createGain();
    oscillator.frequency.setValueAtTime(from, time); oscillator.frequency.exponentialRampToValueAtTime(to, time + 0.18);
    amp.gain.setValueAtTime(level, time); amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.32);
    oscillator.connect(amp); amp.connect(bus.input);
    oscillator.start(time); oscillator.stop(time + 0.35);
  }
  /** Filtered noise: shakers, sparkles and whooshes. The band can sweep from one frequency to another. */
  private hiss(time: number, duration: number, level: number, bus: Bus, type: BiquadFilterType, from: number, to = from, attack = 0.005): void {
    const ctx = this.ctx!, source = ctx.createBufferSource(), filter = ctx.createBiquadFilter(), amp = ctx.createGain();
    source.buffer = this.noise!;
    filter.type = type; filter.Q.value = type === "bandpass" ? 1.4 : 0.7;
    filter.frequency.setValueAtTime(from, time); filter.frequency.exponentialRampToValueAtTime(to, time + duration);
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(level, time + attack);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter); filter.connect(amp); amp.connect(bus.input);
    source.start(time, Math.random() * 1.5); source.stop(time + duration + 0.05);
  }

  // ---- Generative music -----------------------------------------------------

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    // After a stall (hidden tab), skip ahead instead of playing a burst of old notes.
    if (this.nextTime < ctx.currentTime) this.nextTime = ctx.currentTime + 0.05;
    while (this.nextTime < ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.nextTime, this.step);
      this.nextTime += STEP; this.step++;
    }
  }

  private playStep(time: number, step: number): void {
    const music = this.music!;
    const inChord = step % STEPS_PER_CHORD, chordIndex = Math.floor(step / STEPS_PER_CHORD) % 4;
    if (inChord === 0) {
      if (chordIndex === 0) {
        // New cycle: settle into the current level's key and reshuffle the progression.
        this.root = this.targetRoot;
        this.progression = pick(PROGRESSIONS);
      }
      this.pattern = pick(ARP_PATTERNS);
      const chord = this.progression[chordIndex].map(tone => this.root + tone);
      this.pad(time, chord.slice(0, 4).map(midi => midi - 12), STEP * STEPS_PER_CHORD, 0.055, music);
      this.bass(time, chord[0] - 24 + (chord[0] - this.root < 0 ? 12 : 0), STEP * 7, 0.22);
    }
    const chord = this.progression[chordIndex].map(tone => this.root + tone);
    const beat = step % 8;
    // Harp arpeggio over the chord, with a little human variation.
    const ladder = [...chord, ...chord.map(midi => midi + 12)];
    if (Math.random() < (beat % 2 === 0 ? 0.92 : 0.7)) {
      const midi = ladder[this.pattern[beat] % ladder.length];
      this.harp(time + (Math.random() - 0.5) * 0.012, midi, (beat === 0 ? 0.16 : 0.1) + Math.random() * 0.05, music, true);
    }
    if (beat === 4 && inChord >= 8) this.bass(time, chord[0] - 17, STEP * 3, 0.12);
    // Music-box melody in phrases: a few bars of tune, then a few bars of rest.
    // melodyBars counts down a phrase (positive) or up through a rest (negative); at zero, choose again.
    if (beat === 0) {
      if (this.melodyBars > 0) this.melodyBars--;
      else if (this.melodyBars < 0) this.melodyBars++;
      else this.melodyBars = Math.random() < 0.6 ? 4 : -(2 + Math.floor(Math.random() * 3));
    }
    if (this.melodyBars > 0 && Math.random() < (beat % 2 === 0 ? 0.45 : 0.18)) {
      this.melodyDegree = Math.max(5, Math.min(12, this.melodyDegree + pick([-2, -1, -1, 1, 1, 2, 0])));
      this.bell(time, scale(this.root, this.melodyDegree), 0.07 + Math.random() * 0.04, music);
    }
    // A gentle pulse: soft kick on beats one and three, a hushed shaker on the off-beats.
    if (beat === 0 || beat === 4) this.thump(time, 0.16, music, 75, 42);
    if (beat % 2 === 1 && Math.random() < 0.75) this.hiss(time, 0.07, 0.018, music, "highpass", 7000);
    // Rare high twinkles, like the fireflies on screen.
    if (Math.random() < 0.035) this.bell(time + Math.random() * STEP, scale(this.root, 15 + Math.floor(Math.random() * 4)), 0.03, music);
  }

  // ---- Sound effects --------------------------------------------------------

  private play(cue: Cue): void {
    const ctx = this.ctx!, sfx = this.sfx!, root = this.targetRoot, time = ctx.currentTime + 0.02;
    switch (cue.kind) {
      case "levelStart": {
        // A rising swoosh, then soft plinks as the tiles drop in, landing on a bell.
        this.hiss(time, 0.8, 0.07, sfx, "bandpass", 300, 2600, 0.6);
        [0, 1, 2, 3, 4].forEach((degree, index) => this.harp(time + 0.35 + index * 0.09, scale(root, degree + 5), 0.12, sfx));
        this.bell(time + 0.85, root + 12, 0.16, sfx); this.bell(time + 0.85, root + 19, 0.1, sfx);
        break;
      }
      case "find": {
        // Each find in a round starts a step higher, so a hot streak climbs like a melody.
        const start = Math.min(2 * (cue.found - 1), 7) + 5, last = cue.found === cue.total;
        this.thump(time, 0.22, sfx, 200, 90);
        this.hiss(time, 0.4, 0.05, sfx, "bandpass", 500, 3500, 0.15);
        const notes = last ? 5 : 3;
        for (let index = 0; index < notes; index++) {
          const at = time + 0.06 + index * 0.075, midi = scale(root, start + index);
          this.bell(at, midi, 0.2, sfx); this.harp(at, midi, 0.16, sfx);
        }
        this.bell(time + 0.1 + notes * 0.075, scale(root, start + notes + 3), 0.08, sfx);
        this.hiss(time + 0.08, 0.6, 0.03, sfx, "highpass", 8000);
        break;
      }
      case "levelClear": {
        // Lines up with the confetti cannons: two pops, a harp glissando, then a shimmering chord.
        const at = time + RESULT_DELAY_MS / 1000;
        this.thump(at, 0.3, sfx, 160, 60); this.thump(at + 0.05, 0.25, sfx, 140, 55);
        this.hiss(at, 0.25, 0.08, sfx, "bandpass", 1800, 900);
        for (let index = 0; index < 12; index++) this.harp(at + 0.15 + index * 0.045, scale(root, index), 0.14, sfx);
        const chord = IMAJ9.map(tone => root + 12 + tone);
        chord.forEach(midi => this.bell(at + 0.75, midi, 0.08, sfx));
        this.pad(at + 0.6, IMAJ9.slice(0, 4).map(tone => root + tone), 1.6, 0.06, sfx);
        for (let index = 0; index < 8; index++) this.bell(at + 0.9 + Math.random() * 1.4, scale(root, 12 + Math.floor(Math.random() * 6)), 0.04, sfx);
        break;
      }
      case "timeUp": {
        // Gentle, not harsh: a falling two-note bell over a soft low swell.
        this.bell(time, root + 19, 0.16, sfx);
        this.bell(time + 0.4, root + 12, 0.16, sfx);
        this.harp(time + 0.8, root, 0.12, sfx);
        this.pad(time, [root - 12, root - 5], 1.2, 0.05, sfx);
        break;
      }
      case "tick": {
        // Soft wood tick; the last three seconds sit a little higher and brighter.
        const final = cue.secondsLeft <= 3;
        const oscillator = ctx.createOscillator(), amp = ctx.createGain();
        oscillator.frequency.value = final ? 1320 : 990;
        amp.gain.setValueAtTime(final ? 0.14 : 0.08, time); amp.gain.exponentialRampToValueAtTime(0.0001, time + 0.07);
        oscillator.connect(amp); amp.connect(sfx.input); oscillator.start(time); oscillator.stop(time + 0.08);
        this.hiss(time, 0.03, final ? 0.04 : 0.025, sfx, "highpass", 3000);
        break;
      }
      case "gameOver": {
        // Fanfare timed to the podium: blocks thump up, the champion's crown sparkles in.
        this.thump(time, 0.3, sfx, 160, 60); this.hiss(time, 0.3, 0.08, sfx, "bandpass", 1600, 800);
        [0.2, 0.5, 0.8].forEach(delay => this.thump(time + delay + 0.3, 0.2, sfx, 120, 50));
        const arpeggio = [0, 4, 7, 12, 16, 19, 24];
        arpeggio.forEach((tone, index) => { this.harp(time + 0.2 + index * 0.1, root + tone, 0.16, sfx); this.bell(time + 0.2 + index * 0.1, root + 12 + tone, 0.06, sfx); });
        this.pad(time + 0.9, IMAJ9.slice(0, 4).map(tone => root + tone), 2.4, 0.07, sfx);
        for (let index = 0; index < 18; index++) this.bell(time + 1.7 + Math.random() * 2.2, scale(root, 10 + Math.floor(Math.random() * 8)), 0.05, sfx);
        break;
      }
    }
  }
}
