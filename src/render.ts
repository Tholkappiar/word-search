import { artImage, FLAVOR_FONT, goldStagImage, LETTER_FONT, TITLE_FONT } from "./assets";
import { THEMES } from "./themes";
import { GRID_SIZE, wordCells, type GameState, type PlacedWord } from "./game";

// Enchanted Forest grimoire. The title, chapter and announcements float on the night
// sky above a parchment page whose letter grid sits in the 25%-60% band of the
// 1080x1920 canvas; the painted forest is shifted down so its moon and stag show below.
type Ctx = CanvasRenderingContext2D;
const INK = "#24160c", SEPIA = "#6b4423", GOLD = "#f3d27c", RED_INK = "#9b1c1c", NIGHT = "#091510";
/** Translucent magical inks for found words. No reds: red marks missed words when time runs out. */
const INKS = ["rgba(212, 160, 23, 0.5)", "rgba(16, 150, 100, 0.42)", "rgba(6, 160, 200, 0.4)", "rgba(37, 99, 235, 0.34)", "rgba(126, 34, 206, 0.36)",
  "rgba(234, 140, 10, 0.42)", "rgba(13, 128, 118, 0.42)", "rgba(146, 90, 30, 0.38)", "rgba(67, 56, 202, 0.36)", "rgba(77, 124, 15, 0.42)"];
const PAGE = { x: 40, y: 432, width: 1000, height: 752 };
const CELL_W = 74, CELL_H = 52, GRID_X = 96, GRID_Y = 516;
const EMBLEM_Y = 88, TITLE_Y = 218, CHAPTER_Y = 284, TOAST_Y = 362, STATUS_Y = 478;
/** How far the painting is pushed down; the gap above is filled with its night-sky colour. */
const ART_SHIFT = 380;
const HIGHLIGHT_MS = 450, TOAST_MS = 5000;

/** Deterministic 0..1 noise so decorations never flicker or touch game randomness. */
function noise(seed: number): number { const value = Math.sin(seed * 12.9898) * 43758.5453; return value - Math.floor(value); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function easeOutBack(t: number): number { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }
function easeOutCubic(t: number): number { return 1 - (1 - t) ** 3; }

function text(ctx: Ctx, value: string, x: number, y: number, size: number, color: string, font: string, align: CanvasTextAlign = "center", weight = 400): void {
  ctx.font = `${font === FLAVOR_FONT ? "italic " : ""}${weight} ${size}px ${font}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}
function rounded(ctx: Ctx, x: number, y: number, width: number, height: number, radius: number, fill: string | CanvasGradient, stroke?: string, lineWidth = 2): void {
  ctx.beginPath(); ctx.roundRect(x, y, width, height, radius);
  ctx.fillStyle = fill; ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lineWidth; ctx.stroke(); }
}
function star(ctx: Ctx, x: number, y: number, size: number, color: string): void {
  ctx.fillStyle = color; ctx.beginPath();
  for (let point = 0; point < 8; point++) {
    const angle = point * Math.PI / 4, radius = point % 2 === 0 ? size : size * 0.3;
    ctx.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
  }
  ctx.closePath(); ctx.fill();
}
function shorten(name: string, max: number): string { return name.length > max ? name.slice(0, max - 1) + "…" : name; }
function cellCenter(row: number, column: number): [number, number] { return [GRID_X + column * CELL_W + CELL_W / 2, GRID_Y + row * CELL_H + CELL_H / 2]; }
function clock(ms: number): string { const seconds = Math.ceil(ms / 1000); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }

function drawBackground(ctx: Ctx, timeMs: number): void {
  const forest = artImage("forest");
  ctx.fillStyle = NIGHT; ctx.fillRect(0, 0, 1080, 1920);
  if (forest) {
    ctx.drawImage(forest, 0, ART_SHIFT, 1080, 1920);
    // Fade the painting's top edge into the night sky so there is no seam.
    const blend = ctx.createLinearGradient(0, ART_SHIFT, 0, ART_SHIFT + 320);
    blend.addColorStop(0, NIGHT); blend.addColorStop(1, "rgba(9, 21, 16, 0)");
    ctx.fillStyle = blend; ctx.fillRect(0, ART_SHIFT, 1080, 320);
  }
  const aura = ctx.createRadialGradient(540, 260, 0, 540, 260, 620);
  aura.addColorStop(0, "rgba(40, 90, 60, 0.28)"); aura.addColorStop(1, "rgba(40, 90, 60, 0)");
  ctx.fillStyle = aura; ctx.fillRect(0, 0, 1080, 900);
  // Drifting fireflies bring the painting to life.
  for (let index = 0; index < 46; index++) {
    const speed = 9000 + noise(index) * 9000;
    const life = (timeMs / speed + noise(index + 1)) % 1;
    const x = noise(index + 2) * 1080 + Math.sin(timeMs / (1400 + noise(index + 3) * 1200) + index) * 40;
    const y = 1900 - life * 650;
    const alpha = Math.sin(life * Math.PI) * (0.55 + 0.45 * Math.sin(timeMs / 300 + index * 3));
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 16);
    glow.addColorStop(0, `rgba(255, 214, 120, ${0.9 * alpha})`); glow.addColorStop(1, "rgba(255, 214, 120, 0)");
    ctx.fillStyle = glow; ctx.fillRect(x - 16, y - 16, 32, 32);
  }
}

function drawPage(ctx: Ctx): void {
  const { x, y, width, height } = PAGE;
  ctx.save(); ctx.shadowColor = "rgba(0, 0, 0, 0.75)"; ctx.shadowBlur = 50; ctx.shadowOffsetY = 14;
  rounded(ctx, x - 10, y - 6, width + 20, height + 14, 18, "#1f140b");
  ctx.restore();
  const paper = ctx.createLinearGradient(x, y, x + width, y + height);
  paper.addColorStop(0, "#f2e4c2"); paper.addColorStop(0.5, "#ead7a9"); paper.addColorStop(1, "#dcc08a");
  rounded(ctx, x, y, width, height, 10, paper);
  const aged = ctx.createRadialGradient(x + width / 2, y + height / 2, height * 0.35, x + width / 2, y + height / 2, width * 0.66);
  aged.addColorStop(0, "rgba(110, 66, 20, 0)"); aged.addColorStop(1, "rgba(110, 66, 20, 0.42)");
  rounded(ctx, x, y, width, height, 10, aged);
  for (let index = 0; index < 110; index++) {
    ctx.fillStyle = `rgba(100, 62, 25, ${0.04 + noise(index + 70) * 0.08})`;
    ctx.beginPath(); ctx.arc(x + noise(index + 20) * width, y + noise(index + 40) * height, 1 + noise(index) * 3, 0, Math.PI * 2); ctx.fill();
  }
  // Double gold rule with corner brackets.
  rounded(ctx, x + 10, y + 10, width - 20, height - 20, 6, "rgba(0, 0, 0, 0)", "rgba(150, 105, 35, 0.75)", 2);
  rounded(ctx, x + 16, y + 16, width - 32, height - 32, 4, "rgba(0, 0, 0, 0)", "rgba(150, 105, 35, 0.35)", 1);
  ctx.strokeStyle = "#a57a24"; ctx.lineWidth = 4;
  for (const [cx, cy, dx, dy] of [[x + 10, y + 10, 1, 1], [x + width - 10, y + 10, -1, 1], [x + 10, y + height - 10, 1, -1], [x + width - 10, y + height - 10, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(cx, cy + dy * 40); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * 40, cy); ctx.stroke();
    star(ctx, cx + dx * 16, cy + dy * 16, 7, "#a57a24");
  }
}

/** Gold stag emblem, title and chapter line on the night sky above the page. */
function drawTitle(ctx: Ctx, state: GameState): void {
  const { world } = state;
  const stag = goldStagImage();
  ctx.save(); ctx.shadowColor = "rgba(243, 210, 124, 0.55)"; ctx.shadowBlur = 24;
  if (stag) ctx.drawImage(stag, 540 - 78, EMBLEM_Y - 78, 156, 156);
  const title = ctx.createLinearGradient(0, TITLE_Y - 45, 0, TITLE_Y + 45);
  title.addColorStop(0, "#fbe9b4"); title.addColorStop(1, "#d6a548");
  ctx.font = `400 88px ${TITLE_FONT}`; ctx.fillStyle = title; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowBlur = 18; ctx.fillText("Enchanted Words", 540, TITLE_Y);
  ctx.restore();
  // Chapter line with ornamental rules.
  const chapter = `Find ${world.words.length} ${THEMES[world.themeIndex].label} · Round ${world.round}`;
  text(ctx, chapter, 540, CHAPTER_Y, 36, "#e8d6a8", FLAVOR_FONT);
  const half = ctx.measureText(chapter).width / 2;
  ctx.strokeStyle = "rgba(232, 214, 168, 0.5)"; ctx.lineWidth = 2;
  for (const side of [-1, 1]) {
    const inner = 540 + side * (half + 26), outer = 540 + side * (half + 170);
    ctx.beginPath(); ctx.moveTo(inner, CHAPTER_Y + 1); ctx.lineTo(outer, CHAPTER_Y + 1); ctx.stroke();
    star(ctx, inner - side * 4, CHAPTER_Y + 1, 8, GOLD);
  }
}

/** Found counter and timer in a slim row at the top of the page. */
function drawStatus(ctx: Ctx, state: GameState): void {
  const { world } = state;
  const found = world.words.filter(word => word.foundBy).length;
  text(ctx, `${found}/${world.words.length}`, 92, STATUS_Y, 40, INK, LETTER_FONT, "left");
  text(ctx, "found", 102 + ctx.measureText(`${found}/${world.words.length}`).width, STATUS_Y + 3, 26, SEPIA, FLAVOR_FONT, "left");
  const playing = world.phase === "playing";
  const urgent = playing && world.phaseMsLeft <= 15_000;
  ctx.save(); if (urgent) ctx.globalAlpha = 0.65 + 0.35 * Math.sin(world.elapsedMs / 90);
  text(ctx, playing ? "left" : "next", 988, STATUS_Y + 3, 26, urgent ? RED_INK : SEPIA, FLAVOR_FONT, "right");
  const label = ctx.measureText(playing ? "left" : "next").width;
  text(ctx, playing ? clock(world.phaseMsLeft) : `${Math.ceil(world.phaseMsLeft / 1000)}s`, 978 - label, STATUS_Y, 40, urgent ? RED_INK : INK, LETTER_FONT, "right");
  ctx.restore();
  ctx.strokeStyle = "rgba(107, 68, 35, 0.35)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(84, STATUS_Y + 30); ctx.lineTo(996, STATUS_Y + 30); ctx.stroke();
  star(ctx, 540, STATUS_Y + 30, 8, SEPIA);
}

function drawHighlight(ctx: Ctx, word: PlacedWord, color: string, progress: number): void {
  const cells = wordCells(word);
  const [x1, y1] = cellCenter(...cells[0]);
  const [x2, y2] = cellCenter(...cells[cells.length - 1]);
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 56; ctx.lineCap = "round"; ctx.shadowColor = color; ctx.shadowBlur = 14;
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + (x2 - x1) * progress, y1 + (y2 - y1) * progress); ctx.stroke();
  ctx.restore();
}

function drawGrid(ctx: Ctx, state: GameState): void {
  const { world } = state;
  const covered = new Set<number>();
  world.words.forEach((word, index) => {
    const missed = !word.foundBy && world.phase === "timeout";
    if (!word.foundBy && !missed) return;
    const start = word.foundBy ? word.foundAtMs : world.phaseAtMs;
    drawHighlight(ctx, word, missed ? "rgba(185, 28, 28, 0.42)" : INKS[index % INKS.length], easeOutCubic(clamp01((world.elapsedMs - start) / HIGHLIGHT_MS)));
    for (const [r, c] of wordCells(word)) covered.add(r * GRID_SIZE + c);
  });
  for (let row = 0; row < GRID_SIZE; row++) {
    for (let column = 0; column < GRID_SIZE; column++) {
      const [x, y] = cellCenter(row, column);
      text(ctx, world.grid[row * GRID_SIZE + column], x, y + 2, 44, covered.has(row * GRID_SIZE + column) ? "#120a04" : INK, LETTER_FONT);
    }
  }
}

/** Where a left-aligned string's ink actually reaches; decorative swashes can overhang its advance width. */
function inkBounds(ctx: Ctx, value: string, font: string): { left: number; right: number } {
  ctx.font = font; ctx.textAlign = "left";
  const metrics = ctx.measureText(value);
  return { left: Math.max(0, metrics.actualBoundingBoxLeft ?? 0), right: Math.max(metrics.width, metrics.actualBoundingBoxRight ?? 0) };
}

/** Centred badge announcing the latest find, e.g. "✦ Priya found FLUTE ✦". */
function drawToast(ctx: Ctx, state: GameState): void {
  const { world } = state;
  if (world.phase !== "playing") return;
  const latest = world.words.filter(word => word.foundBy).sort((left, right) => right.foundAtMs - left.foundAtMs)[0];
  const age = latest ? world.elapsedMs - latest.foundAtMs : Infinity;
  ctx.save();
  if (age >= TOAST_MS) {
    ctx.globalAlpha = 0.8; ctx.shadowColor = "rgba(0, 0, 0, 0.9)"; ctx.shadowBlur = 10;
    text(ctx, "Spot a hidden word · type it in chat", 540, TOAST_Y, 38, "#e8dcbc", FLAVOR_FONT);
    ctx.restore();
    return;
  }
  const name = shorten(latest.foundBy, 18), joiner = "found", gap = 16;
  const nameInk = inkBounds(ctx, name, `italic 400 38px ${FLAVOR_FONT}`);
  const joinerInk = inkBounds(ctx, joiner, `italic 400 30px ${FLAVOR_FONT}`);
  const wordInk = inkBounds(ctx, latest.word, `400 44px ${TITLE_FONT}`);
  const nameWidth = nameInk.left + nameInk.right, joinerWidth = joinerInk.left + joinerInk.right, wordWidth = wordInk.left + wordInk.right;
  // Generous side padding: each star sits in its own space between the text and the border.
  const content = nameWidth + gap + joinerWidth + gap + wordWidth, width = content + 200, height = 74;
  ctx.globalAlpha = clamp01(age / 180) * clamp01((TOAST_MS - age) / 400);
  const pop = 0.85 + 0.15 * easeOutBack(clamp01(age / 300));
  ctx.translate(540, TOAST_Y); ctx.scale(pop, pop);
  rounded(ctx, -width / 2, -height / 2, width, height, height / 2, "rgba(8, 18, 13, 0.72)", "rgba(243, 210, 124, 0.55)", 2);
  star(ctx, -width / 2 + 46, 0, 11, GOLD); star(ctx, width / 2 - 46, 0, 11, GOLD);
  let x = -content / 2;
  text(ctx, name, x + nameInk.left, 0, 38, "#f1e3bf", FLAVOR_FONT, "left"); x += nameWidth + gap;
  text(ctx, joiner, x + joinerInk.left, 2, 30, "rgba(232, 214, 168, 0.7)", FLAVOR_FONT, "left"); x += joinerWidth + gap;
  text(ctx, latest.word, x + wordInk.left, 3, 44, GOLD, TITLE_FONT, "left");
  ctx.restore();
}

/** Splits words into centred lines no wider than maxWidth in the current font. */
function wrapWords(ctx: Ctx, words: string[], separator: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const word of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && ctx.measureText(last + separator + word).width <= maxWidth) lines[lines.length - 1] = last + separator + word;
    else lines.push(word);
  }
  return lines;
}

/** Round result scroll on the sky above the page, so the solved grid (missed words in red) stays visible. */
function drawRoundEnd(ctx: Ctx, state: GameState): void {
  const { world } = state;
  const age = world.elapsedMs - world.phaseAtMs;
  const complete = world.phase === "cleared";
  const letters = new Map<string, number>();
  for (const word of world.words) if (word.foundBy) letters.set(word.foundBy, (letters.get(word.foundBy) ?? 0) + word.word.length);
  const [mvp, mvpPoints] = [...letters].sort((left, right) => right[1] - left[1])[0] ?? ["", 0];
  const found = world.words.filter(word => word.foundBy).length;
  ctx.font = `400 30px ${LETTER_FONT}`;
  const missed = wrapWords(ctx, world.words.filter(word => !word.foundBy).map(word => word.word), "  ·  ", 780);
  const scale = easeOutBack(clamp01(age / 450));
  ctx.save(); ctx.translate(540, 226); ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(0, 0, 0, 0.6)"; ctx.shadowBlur = 30;
  const scroll = ctx.createLinearGradient(0, -186, 0, 186); scroll.addColorStop(0, "#f8ecd0"); scroll.addColorStop(1, "#e4cb95");
  rounded(ctx, -440, -186, 880, 372, 16, scroll, "#7a5418", 3);
  ctx.shadowBlur = 0;
  for (const side of [-1, 1]) rounded(ctx, side * 440 - 20, -200, 40, 400, 20, "#3a2412", "#a57a24", 2);
  // Centre the block vertically: fewer missed-word lines start it lower.
  let y = missed.length ? -148 + (3 - Math.min(3, missed.length)) * 17 : -100;
  text(ctx, complete ? "All Words Found!" : "The Candle Burns Out", 0, y, complete ? 58 : 50, complete ? INK : RED_INK, TITLE_FONT);
  y += 56;
  text(ctx, complete ? "Amazing teamwork, chat!" : `Time's up · ${found} of ${world.words.length} words found`, 0, y, 34, SEPIA, FLAVOR_FONT);
  if (missed.length) {
    y += 42; text(ctx, "You missed (shown in red):", 0, y, 26, SEPIA, FLAVOR_FONT);
    for (const line of missed) { y += 34; text(ctx, line, 0, y, 30, RED_INK, LETTER_FONT); }
  }
  y += missed.length ? 46 : 66;
  if (mvp) { text(ctx, `Top finder: ${shorten(mvp, 14)}  +${mvpPoints}`, 0, y, 34, INK, LETTER_FONT); y += 44; }
  text(ctx, `Next round in ${Math.ceil(world.phaseMsLeft / 1000)}s`, 0, y, 28, SEPIA, FLAVOR_FONT);
  ctx.restore();
  if (complete) {
    // Golden star shower over the sky and page.
    for (let index = 0; index < 70; index++) {
      const y = -20 - noise(index + 400) * 300 + age * (0.25 + noise(index + 300) * 0.3);
      if (y > 1300) continue;
      star(ctx, noise(index) * 1080 + Math.sin(age / 400 + index) * 20, y, 8 + noise(index + 9) * 10, index % 4 === 0 ? "#fff3c4" : GOLD);
    }
  }
}

export function renderGame(context: Ctx, state: GameState): void {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  drawBackground(context, state.world.elapsedMs);
  drawPage(context);
  // The round result scroll replaces the title area between rounds.
  if (state.world.phase === "playing") drawTitle(context, state);
  drawStatus(context, state);
  drawGrid(context, state);
  drawToast(context, state);
  if (state.world.phase !== "playing") drawRoundEnd(context, state);
  if (state.runtime.paused) {
    context.fillStyle = "rgba(4, 10, 6, 0.7)"; context.fillRect(0, 0, width, height);
    rounded(context, 340, 759, 400, 130, 16, "#efdfb8", "#7a5418", 3);
    text(context, "Paused", 540, 826, 60, INK, TITLE_FONT);
  }
}
