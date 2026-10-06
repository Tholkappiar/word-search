import { artImage, FLAVOR_FONT, goldStagImage, LETTER_FONT, TITLE_FONT } from "./assets";
import { THEMES } from "./themes";
import { DIRECTIONS, isFinalLevel, levelSpec, wordCells, type GameConfig, type GameState, type PlacedWord, type World } from "./game";

// Enchanted Forest word search. The title and instructions float on the night sky
// above a parchment page; the page holds the timer, the letter tiles (inside the
// 25%-60% band of the 1080x1920 canvas) and one slot per hidden word. The level
// badge sits on the forest below the page. Each find puts the finder's name in a
// bouncing spotlight on the sky.
// Every animation (tile drop-in, pops, confetti) is a pure function of world time,
// so drawing never touches gameplay state or randomness.
type Ctx = CanvasRenderingContext2D;
const INK = "#24160c", SEPIA = "#6b4423", GOLD = "#f3d27c", CREAM = "#f1e3bf", RED = "#c0262d", NIGHT = "#091510";
/** Tile colours for found words. No reds: red marks missed words when time runs out. */
const WORD_COLORS = ["#d9920b", "#0f9d6e", "#0b8fc4", "#7c3aed", "#e2680c", "#4f46e5"];
const CONFETTI = ["#ffd23f", "#ff5d8f", "#3ee0cf", "#7ae582", "#a78bfa", "#ff9f1c", "#ffffff", "#4cc9f0"];
const PAGE = { x: 40, y: 440, width: 1000, height: 776 };
const STAG_Y = 70, TITLE_Y = 186, TASK_Y = 292, TIP_Y = 376, NAME_Y = 250, FOUND_Y = 364;
const STATUS_Y = 490, BAR_Y = 522, LEVEL_Y = 1292;
/**
 * End-of-round leaderboard on the forest below the page: shifted right and down to
 * leave room for Sobo the host (bottom-left) and his speech bubble (above it).
 */
const BOARD_Y = 1338, BOARD_LEFT = 268, BOARD_WIDTH = 664, BOARD_ROWS = 5;
/** Square area the tiles are centred in, and the hidden-word slots below it. */
const GRID_TOP = 552, GRID_AREA = 480, SLOTS_Y = 1128;
/** How far the painting is pushed down; the gap above is filled with its night-sky colour. */
const ART_SHIFT = 380;
const INTRO_MS = 1700, SPOTLIGHT_MS = 3400, BURST_MS = 3600, POP_MS = 380;
/** After the last word of a level, its finder gets the spotlight before the result scroll arrives. */
export const RESULT_DELAY_MS = 1700;

/** Deterministic 0..1 noise so decorations never flicker or touch game randomness. */
function noise(seed: number): number { const value = Math.sin(seed * 12.9898) * 43758.5453; return value - Math.floor(value); }
function clamp01(value: number): number { return Math.max(0, Math.min(1, value)); }
function easeOutBack(t: number): number { const c = 1.70158; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; }
function easeOutCubic(t: number): number { return 1 - (1 - t) ** 3; }
function easeOutElastic(t: number): number { return t <= 0 ? 0 : t >= 1 ? 1 : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * (2 * Math.PI / 3)) + 1; }

function text(ctx: Ctx, value: string, x: number, y: number, size: number, color: string, font: string, align: CanvasTextAlign = "center", weight = 400): void {
  ctx.font = `${font === FLAVOR_FONT ? "italic " : ""}${weight} ${size}px ${font}`;
  ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = "middle";
  ctx.fillText(value, x, y);
}
/** Text with a dark outline, readable over confetti and busy art. */
function outlined(ctx: Ctx, value: string, x: number, y: number, size: number, color: string | CanvasGradient, font: string, outline = "rgba(20, 10, 2, 0.9)"): void {
  ctx.font = `400 ${size}px ${font}`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.lineJoin = "round"; ctx.lineWidth = size * 0.16; ctx.strokeStyle = outline; ctx.strokeText(value, x, y);
  ctx.fillStyle = color; ctx.fillText(value, x, y);
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
/** Whole seconds left, ignoring floating-point leftovers from fractional ticks. */
function secondsLeft(ms: number): number { return Math.ceil(ms / 1000 - 1e-6); }
function clock(ms: number): string { const seconds = secondsLeft(ms); return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`; }
function wordColor(index: number): string { return WORD_COLORS[index % WORD_COLORS.length]; }
/** Points each player scored this round. */
function roundPoints(world: World): Map<string, number> {
  const points = new Map<string, number>(), each = levelSpec(world.level).points;
  for (const word of world.words) if (word.foundBy) points.set(word.foundBy, (points.get(word.foundBy) ?? 0) + each);
  return points;
}
function taskLabel(world: World): string {
  const theme = THEMES[world.themeIndex], count = world.words.length;
  return `Find ${count} ${count === 1 ? theme.one : theme.many}`;
}

/** Tile size and top-left corner for a size x size grid centred in the grid area. */
export function gridLayout(size: number): { tile: number; x: number; y: number } {
  const tile = Math.min(156, Math.floor(GRID_AREA / size)), total = tile * size;
  return { tile, x: 540 - total / 2, y: GRID_TOP + (GRID_AREA - total) / 2 };
}
function cellCenter(size: number, row: number, column: number): [number, number] {
  const { tile, x, y } = gridLayout(size);
  return [x + column * tile + tile / 2, y + row * tile + tile / 2];
}
function wordCenter(size: number, word: PlacedWord): [number, number] {
  const cells = wordCells(word);
  const [x1, y1] = cellCenter(size, ...cells[0]), [x2, y2] = cellCenter(size, ...cells[cells.length - 1]);
  return [(x1 + x2) / 2, (y1 + y2) / 2];
}

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
  // Double gold rule with corner brackets.
  rounded(ctx, x + 10, y + 10, width - 20, height - 20, 6, "rgba(0, 0, 0, 0)", "rgba(150, 105, 35, 0.75)", 2);
  rounded(ctx, x + 16, y + 16, width - 32, height - 32, 4, "rgba(0, 0, 0, 0)", "rgba(150, 105, 35, 0.35)", 1);
  ctx.strokeStyle = "#a57a24"; ctx.lineWidth = 4;
  for (const [cx, cy, dx, dy] of [[x + 10, y + 10, 1, 1], [x + width - 10, y + 10, -1, 1], [x + 10, y + height - 10, 1, -1], [x + width - 10, y + height - 10, -1, -1]]) {
    ctx.beginPath(); ctx.moveTo(cx, cy + dy * 40); ctx.lineTo(cx, cy); ctx.lineTo(cx + dx * 40, cy); ctx.stroke();
    star(ctx, cx + dx * 16, cy + dy * 16, 7, "#a57a24");
  }
}

/** Speech bubble icon with three dots, signalling "type in chat". */
function chatBubble(ctx: Ctx, x: number, y: number, color: string): void {
  ctx.beginPath(); ctx.roundRect(x - 26, y - 19, 52, 34, 12);
  ctx.moveTo(x - 12, y + 14); ctx.lineTo(x - 20, y + 26); ctx.lineTo(x - 2, y + 14);
  ctx.fillStyle = color; ctx.fill();
  for (const dx of [-12, 0, 12]) { ctx.beginPath(); ctx.arc(x + dx, y - 2, 4, 0, Math.PI * 2); ctx.fillStyle = NIGHT; ctx.fill(); }
}

/** Gold stag emblem and title on the sky above the page; the title steps aside for the spotlight. */
function drawTitle(ctx: Ctx, showTitle: boolean): void {
  const stag = goldStagImage();
  ctx.save(); ctx.shadowColor = "rgba(243, 210, 124, 0.55)"; ctx.shadowBlur = 24;
  if (stag) ctx.drawImage(stag, 540 - 58, STAG_Y - 58, 116, 116);
  if (!showTitle) { ctx.restore(); return; }
  const title = ctx.createLinearGradient(0, TITLE_Y - 40, 0, TITLE_Y + 40);
  title.addColorStop(0, "#fbe9b4"); title.addColorStop(1, "#d6a548");
  ctx.font = `400 76px ${TITLE_FONT}`; ctx.fillStyle = title; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.shadowBlur = 18; ctx.fillText("Enchanted Words", 540, TITLE_Y);
  ctx.restore();
}

/** The task and how to answer (or a hint late in the round), under the title. */
function drawTask(ctx: Ctx, world: World): void {
  ctx.save(); ctx.shadowColor = "rgba(0, 0, 0, 0.9)"; ctx.shadowBlur = 12;
  text(ctx, taskLabel(world), 540, TASK_Y, 54, "#fff4d6", LETTER_FONT);
  ctx.restore();
  const hint = hintActive(world);
  const message = hint ? "Hint: words start at the glowing letters!" : "Type the words you see in chat!";
  ctx.font = `italic 400 38px ${FLAVOR_FONT}`;
  const width = ctx.measureText(message).width + 120;
  rounded(ctx, 540 - width / 2, TIP_Y - 32, width, 64, 32, "rgba(8, 18, 13, 0.75)", hint ? "rgba(255, 210, 63, 0.8)" : "rgba(243, 210, 124, 0.5)", 2);
  chatBubble(ctx, 540 - width / 2 + 46, TIP_Y - 2, hint ? "#ffd23f" : GOLD);
  text(ctx, message, 540 + 28, TIP_Y, 38, hint ? "#ffe58a" : "#efe2c0", FLAVOR_FONT);
}

function latestFind(world: World): PlacedWord | undefined {
  return world.words.filter(word => word.foundBy).sort((left, right) => right.foundAtMs - left.foundAtMs)[0];
}

/** The finder's name bounces in big and gold, ringed by twinkling stars and confetti, with "found CAT!" below. */
function drawSpotlight(ctx: Ctx, world: World, word: PlacedWord, age: number): void {
  const name = shorten(word.foundBy, 16);
  const fade = clamp01((SPOTLIGHT_MS - age) / 350);
  ctx.font = `400 104px ${TITLE_FONT}`;
  const size = Math.min(104, 104 * 820 / Math.max(1, ctx.measureText(name).width));
  ctx.font = `400 ${size}px ${TITLE_FONT}`;
  const half = ctx.measureText(name).width / 2;
  // Soft golden glow behind the name.
  // Soft oval glow: a circular gradient squashed vertically, so it has no visible edge.
  const glowRadius = half + 180;
  ctx.save(); ctx.globalAlpha = fade * clamp01(age / 250); ctx.translate(540, NAME_Y); ctx.scale(1, 0.32);
  const glow = ctx.createRadialGradient(0, 0, 0, 0, 0, glowRadius);
  glow.addColorStop(0, "rgba(255, 214, 120, 0.5)"); glow.addColorStop(1, "rgba(255, 214, 120, 0)");
  ctx.fillStyle = glow; ctx.fillRect(-glowRadius, -glowRadius, glowRadius * 2, glowRadius * 2);
  ctx.restore();
  // Twinkling stars orbit the name.
  const radiusX = Math.min(500, half + 70);
  for (let index = 0; index < 12; index++) {
    const angle = index / 12 * Math.PI * 2 + age / 1100;
    const twinkle = 0.6 + 0.4 * Math.sin(age / 140 + index * 2);
    ctx.save(); ctx.globalAlpha = fade * clamp01((age - index * 30) / 300);
    star(ctx, 540 + Math.cos(angle) * radiusX, NAME_Y + Math.sin(angle) * 78, (9 + (index % 3) * 4) * twinkle, index % 2 ? "#ffffff" : "#ffd23f");
    ctx.restore();
  }
  // Elastic pop-in, then a gentle bob.
  const pop = easeOutElastic(clamp01(age / 900));
  const bob = Math.sin(age / 220) * 8 * clamp01(age / 700);
  ctx.save(); ctx.globalAlpha = fade; ctx.translate(540, NAME_Y + bob); ctx.scale(pop, pop);
  const fill = ctx.createLinearGradient(0, -size / 2, 0, size / 2);
  fill.addColorStop(0, "#fff6cf"); fill.addColorStop(0.55, "#ffd23f"); fill.addColorStop(1, "#e89a12");
  ctx.shadowColor = "rgba(255, 200, 60, 0.9)"; ctx.shadowBlur = 30;
  outlined(ctx, name, 0, 0, size, fill, TITLE_FONT, "rgba(60, 30, 4, 0.95)");
  ctx.restore();
  // "found CAT!" pops in a beat later on a pill in the word's colour.
  const subPop = easeOutBack(clamp01((age - 220) / 380));
  if (subPop > 0.01) {
    const message = `found ${word.word}!`;
    ctx.font = `400 44px ${LETTER_FONT}`;
    const width = ctx.measureText(message).width + 70;
    ctx.save(); ctx.globalAlpha = fade; ctx.translate(540, FOUND_Y); ctx.scale(subPop, subPop);
    rounded(ctx, -width / 2, -33, width, 66, 33, wordColor(world.words.indexOf(word)), "rgba(255, 244, 214, 0.9)", 3);
    text(ctx, message, 0, 2, 44, "#ffffff", LETTER_FONT);
    ctx.restore();
  }
  // Confetti fountains from both sides of the name.
  const seed = word.foundAtMs * 0.002 + world.words.indexOf(word) * 17;
  confetti(ctx, seed + 1, 540 - radiusX + 30, NAME_Y, age - 80, 80, -Math.PI * 0.78, 0.9, 700, 1700, 1.25);
  confetti(ctx, seed + 2, 540 + radiusX - 30, NAME_Y, age - 80, 80, -Math.PI * 0.22, 0.9, 700, 1700, 1.25);
}

/** Level badge on the forest below the page. */
function drawLevelBadge(ctx: Ctx, world: World): void {
  const badge = ctx.createLinearGradient(0, LEVEL_Y - 32, 0, LEVEL_Y + 32);
  badge.addColorStop(0, "#ffe9a8"); badge.addColorStop(1, "#d9a03a");
  ctx.save(); ctx.shadowColor = "rgba(0, 0, 0, 0.7)"; ctx.shadowBlur = 24; ctx.shadowOffsetY = 6;
  rounded(ctx, 540 - 140, LEVEL_Y - 32, 280, 64, 32, badge, "#7a5418", 3);
  ctx.restore();
  text(ctx, `LEVEL ${world.level}`, 540, LEVEL_Y + 2, 42, INK, LETTER_FONT);
  star(ctx, 540 - 178, LEVEL_Y, 14, GOLD); star(ctx, 540 + 178, LEVEL_Y, 14, GOLD);
}

/** The last 40% of a round highlights where unfound words begin. */
function hintActive(world: World): boolean { return world.phase === "playing" && world.phaseMsLeft <= world.phaseMs * 0.4; }

function arrow(ctx: Ctx, x: number, y: number, direction: number, size: number, color: string): void {
  const [rowStep, columnStep] = DIRECTIONS[direction];
  const length = Math.hypot(rowStep, columnStep), dx = columnStep / length, dy = rowStep / length;
  const half = size / 2, tipX = x + dx * half, tipY = y + dy * half;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 4; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(x - dx * half, y - dy * half); ctx.lineTo(tipX - dx * 6, tipY - dy * 6); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(tipX, tipY);
  ctx.lineTo(tipX - dx * 11 - dy * 8, tipY - dy * 11 + dx * 8); ctx.lineTo(tipX - dx * 11 + dy * 8, tipY - dy * 11 - dx * 8);
  ctx.closePath(); ctx.fill();
}

/** Which ways words read, the clock and a draining timer bar at the top of the page. */
function drawStatus(ctx: Ctx, world: World): void {
  const { directions } = levelSpec(world.level);
  text(ctx, "Words go", 84, STATUS_Y, 30, SEPIA, FLAVOR_FONT, "left");
  directions.forEach((direction, index) => arrow(ctx, 232 + index * 40, STATUS_Y + 2, direction, 28, INK));
  const playing = world.phase === "playing";
  const urgent = playing && world.phaseMsLeft <= 10_000;
  const pulse = urgent ? 0.65 + 0.35 * Math.sin(world.elapsedMs / 90) : 1;
  ctx.save(); ctx.globalAlpha = pulse;
  text(ctx, playing ? clock(world.phaseMsLeft) : `next in ${secondsLeft(world.phaseMsLeft)}s`, 996, STATUS_Y, playing ? 42 : 32, urgent ? RED : INK, playing ? LETTER_FONT : FLAVOR_FONT, "right");
  ctx.restore();
  const fraction = world.phaseMs > 0 ? clamp01(world.phaseMsLeft / world.phaseMs) : 0;
  rounded(ctx, 84, BAR_Y - 7, 912, 14, 7, "rgba(107, 68, 35, 0.22)");
  if (fraction > 0) {
    const fill = ctx.createLinearGradient(84, 0, 996, 0);
    if (urgent || world.phase === "timeout") { fill.addColorStop(0, "#e0453c"); fill.addColorStop(1, RED); }
    else { fill.addColorStop(0, "#f7c948"); fill.addColorStop(1, "#d9920b"); }
    rounded(ctx, 84, BAR_Y - 7, Math.max(14, 912 * fraction), 14, 7, fill);
  }
}

/** Per-cell drawing state: the found word covering it, or the missed word when time is up. */
function cellOwners(world: World): Map<number, { word: PlacedWord; index: number; letter: number; missed: boolean }> {
  const owners = new Map<number, { word: PlacedWord; index: number; letter: number; missed: boolean }>();
  // Later finds paint over earlier ones where words cross.
  const order = world.words.map((word, index) => ({ word, index })).sort((left, right) => left.word.foundAtMs - right.word.foundAtMs);
  for (const { word, index } of order) {
    const missed = !word.foundBy && world.phase === "timeout";
    if (!word.foundBy && !missed) continue;
    wordCells(word).forEach(([row, column], letter) => owners.set(row * world.size + column, { word, index, letter, missed }));
  }
  return owners;
}

function drawGrid(ctx: Ctx, world: World): void {
  const { size } = world;
  const { tile } = gridLayout(size);
  const owners = cellOwners(world);
  const age = world.elapsedMs - world.phaseAtMs;
  const intro = world.phase === "playing";
  const hints = new Set(hintActive(world) ? world.words.filter(word => !word.foundBy).map(word => word.row * size + word.column) : []);
  // A soft light sweeps diagonally across the tiles every few seconds.
  const sweep = (world.elapsedMs % 4200) / 4200 * (2 * size + 6) - 3;
  for (let row = 0; row < size; row++) {
    for (let column = 0; column < size; column++) {
      const cell = row * size + column, [x, y] = cellCenter(size, row, column);
      const owner = owners.get(cell);
      // Tiles drop in one diagonal at a time when a level starts.
      let scale = intro ? easeOutBack(clamp01((age - (row + column) * 55) / 420)) : 1;
      if (owner) {
        const since = world.elapsedMs - (owner.missed ? world.phaseAtMs : owner.word.foundAtMs) - owner.letter * 70;
        scale *= 1 + 0.3 * Math.sin(Math.PI * clamp01(since / POP_MS));
      }
      if (scale <= 0.01) continue;
      const side = tile * 0.88;
      ctx.save(); ctx.translate(x, y); ctx.scale(scale, scale);
      if (hints.has(cell)) {
        // Pulsing gold halo; the tile itself breathes slightly too.
        const pulse = 0.5 + 0.5 * Math.sin(world.elapsedMs / 160);
        ctx.scale(1 + 0.06 * pulse, 1 + 0.06 * pulse);
        ctx.save(); ctx.shadowColor = "#ffd23f"; ctx.shadowBlur = 36 + 24 * pulse;
        rounded(ctx, -side / 2 - 9, -side / 2 - 9, side + 18, side + 18, side * 0.24, `rgba(255, 210, 63, ${0.75 + 0.25 * pulse})`, "#fff4c2", 3);
        ctx.restore();
      }
      // Bevelled tile: a darker base peeking out below the face.
      rounded(ctx, -side / 2, -side / 2 + side * 0.06, side, side, side * 0.18, owner ? (owner.missed ? "#8f1d22" : "rgba(0, 0, 0, 0.35)") : "#b48a3c");
      let face: string | CanvasGradient;
      if (owner?.missed) face = "#f9d6d3";
      else if (owner) face = wordColor(owner.index);
      else {
        face = ctx.createLinearGradient(0, -side / 2, 0, side / 2);
        face.addColorStop(0, "#fff8e4"); face.addColorStop(1, "#f0dcae");
      }
      rounded(ctx, -side / 2, -side / 2, side, side * 0.94, side * 0.18, face, owner?.missed ? RED : undefined, 3);
      const shine = Math.max(0, 1 - Math.abs(row + column - sweep) / 1.3);
      if (shine > 0 && !owner) rounded(ctx, -side / 2, -side / 2, side, side * 0.94, side * 0.18, `rgba(255, 255, 255, ${0.45 * shine})`);
      text(ctx, world.grid[cell], 0, side * 0.01, tile * 0.56, owner ? (owner.missed ? RED : "#ffffff") : INK, LETTER_FONT);
      ctx.restore();
    }
  }
}

/** One slot per hidden word, showing its length; letters flip in when found, in red when missed. */
function drawSlots(ctx: Ctx, world: World): void {
  const words = world.words, twoRows = words.length > 3;
  const box = twoRows ? 44 : 56, gap = 6, padding = 12, spacing = 26;
  const rows = twoRows ? [words.slice(0, Math.ceil(words.length / 2)), words.slice(Math.ceil(words.length / 2))] : [words];
  rows.forEach((row, rowIndex) => {
    const widths = row.map(word => word.word.length * (box + gap) - gap + padding * 2);
    const total = widths.reduce((sum, width) => sum + width, 0) + spacing * (row.length - 1);
    const y = twoRows ? SLOTS_Y - 34 + rowIndex * 70 : SLOTS_Y;
    let x = 540 - total / 2;
    row.forEach((word, column) => {
      const index = words.indexOf(word), missed = !word.foundBy && world.phase === "timeout";
      rounded(ctx, x, y - box / 2 - padding * 0.7, widths[column], box + padding * 1.4, 14, "rgba(70, 42, 14, 0.14)", "rgba(107, 68, 35, 0.45)", 2);
      [...word.word].forEach((letter, letterIndex) => {
        const boxX = x + padding + letterIndex * (box + gap);
        const since = world.elapsedMs - (missed ? world.phaseAtMs : word.foundAtMs) - 250 - letterIndex * 80;
        const flip = word.foundBy || missed ? easeOutBack(clamp01(since / 300)) : 0;
        if (flip <= 0.02) {
          rounded(ctx, boxX, y - box / 2, box, box, 8, "rgba(255, 250, 235, 0.55)", "rgba(107, 68, 35, 0.4)", 2);
          return;
        }
        ctx.save(); ctx.translate(boxX + box / 2, y); ctx.scale(1, flip);
        rounded(ctx, -box / 2, -box / 2, box, box, 8, missed ? "#f9d6d3" : wordColor(index), missed ? RED : undefined, 2);
        text(ctx, letter, 0, 1, box * 0.62, missed ? RED : "#ffffff", LETTER_FONT);
        ctx.restore();
      });
      x += widths[column] + spacing;
    });
  });
}

/**
 * Closed-form confetti: each piece launches with drag and gravity, sways and flips
 * like paper, and fades at the end of its life. `ageMs` is time since launch.
 */
function confetti(ctx: Ctx, seed: number, x0: number, y0: number, ageMs: number, count: number,
  angle: number, spread: number, minSpeed: number, maxSpeed: number, size = 1): void {
  const t = ageMs / 1000;
  if (t < 0) return;
  for (let index = 0; index < count; index++) {
    const n = (k: number) => noise(seed * 3.17 + index * 7.31 + k * 0.613);
    const life = 2.4 + n(1) * 1.4;
    if (t > life) continue;
    const launch = angle + (n(2) - 0.5) * spread, speed = minSpeed + n(3) * (maxSpeed - minSpeed);
    const drag = 2.2 + n(4) * 1.4, gravity = 1500, decay = 1 - Math.exp(-drag * t);
    const vx = Math.cos(launch) * speed, vy = Math.sin(launch) * speed;
    const x = x0 + vx / drag * decay + Math.sin(t * (3 + n(5) * 4) + n(6) * 6.3) * 30 * clamp01(t * 2);
    const y = y0 + gravity * t / drag + (vy - gravity / drag) * decay / drag;
    if (y > 1960 || x < -40 || x > 1120) continue;
    ctx.save(); ctx.globalAlpha = clamp01((life - t) / 0.6);
    ctx.translate(x, y); ctx.rotate(n(7) * 6.3 + t * (n(8) - 0.5) * 16);
    ctx.scale(1, Math.cos(t * (5 + n(9) * 9) + n(10) * 6.3));
    ctx.fillStyle = CONFETTI[Math.floor(n(11) * CONFETTI.length)];
    const width = (14 + n(12) * 16) * size, height = (8 + n(13) * 7) * size;
    if (n(14) < 0.78) ctx.fillRect(-width / 2, -height / 2, width, height);
    else { ctx.beginPath(); ctx.arc(0, 0, height * 0.8, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
}

/** Each find: a flash ring, sparks, a big confetti burst and floating points from the word. */
function drawFindEffects(ctx: Ctx, world: World): void {
  world.words.forEach((word, index) => {
    if (!word.foundBy) return;
    const age = world.elapsedMs - word.foundAtMs;
    if (age > BURST_MS) return;
    const [x, y] = wordCenter(world.size, word);
    const ring = clamp01(age / 550);
    if (ring < 1) {
      ctx.save(); ctx.globalAlpha = 1 - ring; ctx.strokeStyle = "#fff4c2"; ctx.lineWidth = 18 * (1 - ring) + 2;
      ctx.beginPath(); ctx.arc(x, y, 40 + easeOutCubic(ring) * 280, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      for (let spark = 0; spark < 14; spark++) {
        const angle = spark / 14 * Math.PI * 2 + noise(index + spark) * 0.4, distance = 50 + easeOutCubic(ring) * (180 + noise(spark + 30) * 90);
        ctx.save(); ctx.globalAlpha = 1 - ring;
        star(ctx, x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, 14 * (1 - ring * 0.6), spark % 2 ? "#ffffff" : "#ffd23f");
        ctx.restore();
      }
    }
    confetti(ctx, word.foundAtMs * 0.001 + index * 13 + world.level, x, y, age, 220, -Math.PI / 2, Math.PI * 1.6, 800, 2500, 1.5);
    // Floating "+points" in the word's colour.
    const rise = clamp01(age / 1400);
    if (rise < 1) {
      ctx.save(); ctx.globalAlpha = clamp01((1 - rise) * 3);
      const scale = 0.6 + 0.4 * easeOutBack(clamp01(age / 300));
      ctx.translate(x, y - 70 - easeOutCubic(rise) * 170); ctx.scale(scale, scale);
      outlined(ctx, `+${levelSpec(world.level).points}`, 0, 0, 96, "#ffe58a", TITLE_FONT);
      ctx.restore();
    }
  });
}

/** "LEVEL 3" zooms in over the tiles as a level starts. */
function drawLevelIntro(ctx: Ctx, world: World): void {
  const age = world.elapsedMs - world.phaseAtMs;
  if (world.phase !== "playing" || age >= INTRO_MS) return;
  const alpha = clamp01(age / 150) * clamp01((INTRO_MS - age) / 450);
  if (alpha <= 0) return;
  const scale = 1.7 - 0.7 * easeOutCubic(clamp01(age / 450));
  const [, y] = cellCenter(world.size, (world.size - 1) / 2, 0);
  ctx.save(); ctx.globalAlpha = alpha; ctx.translate(540, y); ctx.scale(scale, scale);
  ctx.shadowColor = "rgba(255, 210, 63, 0.9)"; ctx.shadowBlur = 40;
  outlined(ctx, `Level ${world.level}`, 0, -20, 150, "#ffe58a", TITLE_FONT);
  ctx.shadowBlur = 0;
  const { size } = levelSpec(world.level);
  outlined(ctx, world.level === 1 ? "Let's start easy!" : `${size} × ${size} grid`, 0, 90, 52, "#fff4d6", LETTER_FONT);
  ctx.restore();
}

/** Round result scroll on the sky above the page, so the solved grid stays visible below it. */
function drawRoundEnd(ctx: Ctx, world: World, config: GameConfig): void {
  const complete = world.phase === "cleared" || world.phase === "finished";
  const [mvp, mvpPoints] = [...roundPoints(world)].sort((left, right) => right[1] - left[1])[0] ?? ["", 0];
  const found = world.words.filter(word => word.foundBy).length;
  const missed = world.words.filter(word => !word.foundBy).map(word => word.word);
  const seconds = secondsLeft(world.phaseMsLeft);
  const scale = easeOutBack(clamp01(resultsAge(world) / 450));
  if (scale <= 0.01) return;
  ctx.save(); ctx.translate(540, 222); ctx.scale(scale, scale);
  ctx.shadowColor = complete ? "rgba(255, 210, 63, 0.7)" : "rgba(0, 0, 0, 0.6)"; ctx.shadowBlur = 36;
  const scroll = ctx.createLinearGradient(0, -186, 0, 186); scroll.addColorStop(0, "#f8ecd0"); scroll.addColorStop(1, "#e4cb95");
  rounded(ctx, -440, -186, 880, 372, 16, scroll, "#7a5418", 3);
  ctx.shadowBlur = 0;
  for (const side of [-1, 1]) rounded(ctx, side * 440 - 20, -200, 40, 400, 20, "#3a2412", "#a57a24", 2);
  if (world.phase === "finished") {
    const champion = world.scores[0];
    // A manual stop can happen mid-level, so it reports how far chat got instead.
    text(ctx, config.stopGame ? "Game Over!" : "Game Complete!", 0, -112, 70, INK, TITLE_FONT);
    text(ctx, config.stopGame ? `You reached level ${world.level}. Thanks for playing, chat!` : `You cleared all ${world.level} levels. Thanks for playing, chat!`, 0, -38, 34, SEPIA, FLAVOR_FONT);
    if (champion) text(ctx, `Champion: ${shorten(champion.name, 16)} · ${champion.points} pts`, 0, 32, 42, "#9a6a0c", LETTER_FONT);
    text(ctx, "Final results below", 0, champion ? 106 : 60, 34, SEPIA, FLAVOR_FONT);
  } else if (complete) {
    const final = isFinalLevel(world.level, config);
    text(ctx, final ? "Final Level Complete!" : `Level ${world.level} Complete!`, 0, -118, final ? 60 : 66, INK, TITLE_FONT);
    text(ctx, "Great teamwork, chat!", 0, -46, 40, SEPIA, FLAVOR_FONT);
    if (mvp) text(ctx, `Top finder: ${shorten(mvp, 14)}  +${mvpPoints}`, 0, 22, 38, INK, LETTER_FONT);
    text(ctx, final ? `Final results in ${seconds}s` : `Level ${world.level + 1} starts in ${seconds}s`, 0, mvp ? 98 : 60, 40, "#0f7a55", LETTER_FONT);
  } else {
    text(ctx, "Time's Up!", 0, -128, 70, RED, TITLE_FONT);
    text(ctx, `You found ${found} of ${world.words.length} · missed words in red`, 0, -60, 34, SEPIA, FLAVOR_FONT);
    text(ctx, `Missed: ${missed.join("  ·  ")}`, 0, -6, 40, RED, LETTER_FONT);
    if (mvp) text(ctx, `Top finder: ${shorten(mvp, 14)}  +${mvpPoints}`, 0, 52, 34, INK, LETTER_FONT);
    text(ctx, `Try level ${world.level} again in ${seconds}s`, 0, mvp ? 116 : 80, 38, INK, LETTER_FONT);
  }
  ctx.restore();
}

/** When the end-of-round results (scroll and leaderboard) start appearing. */
function resultsAge(world: World): number {
  return world.elapsedMs - world.phaseAtMs - (world.phase === "cleared" ? RESULT_DELAY_MS : 0);
}

const MEDALS = [["#fff1a8", "#e0a614"], ["#f4f6fa", "#aab3c2"], ["#f6c08f", "#c17a3a"]];
/** Top players overall, with a green "+N" for points scored this round. Rows slide in one by one. */
function drawLeaderboard(ctx: Ctx, world: World): void {
  const age = resultsAge(world) - 250;
  if (age <= 0) return;
  const thisRound = world.phase === "finished" ? new Map<string, number>() : roundPoints(world);
  const top = world.scores.slice(0, BOARD_ROWS);
  const rowHeight = 48, rowGap = 5, header = 54, left = BOARD_LEFT, width = BOARD_WIDTH, center = left + width / 2;
  const height = header + Math.max(1, top.length) * (rowHeight + rowGap) + 14;
  const enter = easeOutCubic(clamp01(age / 420));
  ctx.save(); ctx.globalAlpha = enter; ctx.translate(0, (1 - enter) * 60);
  // Dark glass panel with a gold hairline.
  ctx.save(); ctx.shadowColor = "rgba(0, 0, 0, 0.7)"; ctx.shadowBlur = 40; ctx.shadowOffsetY = 12;
  const glass = ctx.createLinearGradient(0, BOARD_Y, 0, BOARD_Y + height);
  glass.addColorStop(0, "rgba(16, 30, 22, 0.9)"); glass.addColorStop(1, "rgba(8, 16, 12, 0.92)");
  rounded(ctx, left, BOARD_Y, width, height, 28, glass, "rgba(243, 210, 124, 0.55)", 2);
  ctx.restore();
  const title = world.phase === "finished" ? "FINAL LEADERBOARD" : "LEADERBOARD";
  text(ctx, title, center, BOARD_Y + 31, 30, GOLD, LETTER_FONT);
  const titleHalf = ctx.measureText(title).width / 2;
  star(ctx, center - titleHalf - 26, BOARD_Y + 30, 9, GOLD); star(ctx, center + titleHalf + 26, BOARD_Y + 30, 9, GOLD);
  ctx.strokeStyle = "rgba(243, 210, 124, 0.25)"; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(left + 30, BOARD_Y + header); ctx.lineTo(left + width - 30, BOARD_Y + header); ctx.stroke();
  if (!top.length) {
    text(ctx, "No finds yet. Be the first next round!", center, BOARD_Y + header + 32, 28, "#cfc3a2", FLAVOR_FONT);
    ctx.restore();
    return;
  }
  const best = top[0].points;
  top.forEach((entry, rank) => {
    const rowAge = age - 200 - rank * 110;
    const slide = easeOutBack(clamp01(rowAge / 420));
    if (rowAge <= 0) return;
    const y = BOARD_Y + header + 7 + rank * (rowHeight + rowGap), mid = y + rowHeight / 2;
    ctx.save(); ctx.globalAlpha = enter * clamp01(rowAge / 200); ctx.translate((1 - slide) * 80, 0);
    // Row background with a soft bar showing the share of the leader's points.
    rounded(ctx, left + 16, y, width - 32, rowHeight, 14, rank === 0 ? "rgba(255, 210, 63, 0.14)" : "rgba(255, 255, 255, 0.05)");
    const bar = ctx.createLinearGradient(left + 16, 0, left + width - 16, 0);
    bar.addColorStop(0, "rgba(243, 210, 124, 0.22)"); bar.addColorStop(1, "rgba(243, 210, 124, 0.04)");
    rounded(ctx, left + 16, y, Math.max(rowHeight, (width - 32) * entry.points / best), rowHeight, 14, bar);
    // Medal or rank number.
    const medalX = left + 50;
    if (rank < MEDALS.length) {
      const medal = ctx.createLinearGradient(0, mid - 18, 0, mid + 18);
      medal.addColorStop(0, MEDALS[rank][0]); medal.addColorStop(1, MEDALS[rank][1]);
      ctx.beginPath(); ctx.arc(medalX, mid, 18, 0, Math.PI * 2); ctx.fillStyle = medal; ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)"; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, String(rank + 1), medalX, mid + 2, 23, INK, LETTER_FONT);
    } else {
      ctx.beginPath(); ctx.arc(medalX, mid, 16, 0, Math.PI * 2); ctx.strokeStyle = "rgba(232, 214, 168, 0.45)"; ctx.lineWidth = 2; ctx.stroke();
      text(ctx, String(rank + 1), medalX, mid + 2, 21, "#e8d6a8", LETTER_FONT);
    }
    text(ctx, shorten(entry.name, 13), medalX + 36, mid + 2, rank === 0 ? 33 : 30, rank === 0 ? "#fff1c4" : "#efe2c0", LETTER_FONT, "left");
    // Points on the right, with this round's gain in a green pill.
    const right = left + width - 38;
    text(ctx, "pts", right, mid + 4, 22, "rgba(232, 214, 168, 0.65)", FLAVOR_FONT, "right");
    const pts = ctx.measureText("pts").width;
    text(ctx, String(entry.points), right - pts - 8, mid + 2, 33, GOLD, LETTER_FONT, "right");
    const gained = thisRound.get(entry.name);
    if (gained) {
      const number = ctx.measureText(String(entry.points)).width, label = `+${gained}`;
      ctx.font = `400 23px ${LETTER_FONT}`;
      const pill = ctx.measureText(label).width + 20, pillRight = right - pts - 8 - number - 12;
      rounded(ctx, pillRight - pill, mid - 15, pill, 30, 15, "rgba(34, 197, 94, 0.22)", "rgba(74, 222, 128, 0.7)", 1.5);
      text(ctx, label, pillRight - pill / 2, mid + 2, 23, "#86efac", LETTER_FONT);
    }
    ctx.restore();
  });
  ctx.restore();
}

/** Level clear: confetti cannons from both bottom corners of the page and a rain from the sky. */
function drawCelebration(ctx: Ctx, world: World): void {
  if (world.phase === "finished") { drawEndlessConfetti(ctx, world); return; }
  if (world.phase !== "cleared") return;
  const age = world.elapsedMs - world.phaseAtMs - RESULT_DELAY_MS, seed = world.level * 31;
  confetti(ctx, seed + 1, 60, 1190, age, 200, -Math.PI * 0.36, 0.7, 1800, 3200, 1.2);
  confetti(ctx, seed + 2, 1020, 1190, age, 200, -Math.PI * 0.64, 0.7, 1800, 3200, 1.2);
  confetti(ctx, seed + 3, 60, 1190, age - 700, 120, -Math.PI * 0.4, 0.6, 1600, 2800, 1.1);
  confetti(ctx, seed + 4, 1020, 1190, age - 700, 120, -Math.PI * 0.6, 0.6, 1600, 2800, 1.1);
  for (let wave = 0; wave < 6; wave++) {
    for (let column = 0; column < 6; column++) {
      confetti(ctx, seed + 10 + wave * 6 + column, 90 + column * 180, -30, age - wave * 600 - noise(seed + column) * 300, 10, Math.PI / 2, 1.2, 50, 300, 1.1);
    }
  }
}

/** Game over: an opening cannon blast, then confetti keeps raining from the sky. */
function drawEndlessConfetti(ctx: Ctx, world: World): void {
  const age = world.elapsedMs - world.phaseAtMs, period = 2600;
  confetti(ctx, 901, 60, 1210, age, 220, -Math.PI * 0.36, 0.7, 1800, 3200, 1.2);
  confetti(ctx, 902, 1020, 1210, age, 220, -Math.PI * 0.64, 0.7, 1800, 3200, 1.2);
  for (let column = 0; column < 6; column++) {
    const local = age - noise(column + 50) * period;
    const cycle = Math.floor(local / period);
    // Draw this cycle and the previous one, whose pieces are still falling.
    for (const wave of [cycle, cycle - 1]) {
      if (wave < 0) continue;
      confetti(ctx, 920 + wave * 7 + column, 90 + column * 180, -30, local - wave * period, 14, Math.PI / 2, 1.2, 50, 300, 1.1);
    }
  }
}

/** Crown with three points and jewelled tips, centred on (x, y). */
function crown(ctx: Ctx, x: number, y: number, size: number): void {
  const fill = ctx.createLinearGradient(0, y - size, 0, y + size * 0.5);
  fill.addColorStop(0, "#fff1a8"); fill.addColorStop(1, "#d99a0b");
  ctx.beginPath();
  ctx.moveTo(x - size, y + size * 0.45); ctx.lineTo(x - size, y - size * 0.35); ctx.lineTo(x - size * 0.5, y + size * 0.05);
  ctx.lineTo(x, y - size * 0.6); ctx.lineTo(x + size * 0.5, y + size * 0.05); ctx.lineTo(x + size, y - size * 0.35); ctx.lineTo(x + size, y + size * 0.45);
  ctx.closePath(); ctx.fillStyle = fill; ctx.fill(); ctx.strokeStyle = "#7a5418"; ctx.lineWidth = 3; ctx.stroke();
  for (const [dx, dy] of [[-1, -0.35], [0, -0.6], [1, -0.35]]) {
    ctx.beginPath(); ctx.arc(x + dx * size, y + dy * size, size * 0.13, 0, Math.PI * 2); ctx.fillStyle = "#fff7d6"; ctx.fill();
  }
}

/** Winner podium on the page: blocks rise third, second, then first; the champion gets a crown and light rays. */
function drawPodium(ctx: Ctx, world: World): void {
  const age = world.elapsedMs - world.phaseAtMs;
  text(ctx, "CHAMPIONS", 540, 524, 46, INK, LETTER_FONT);
  ctx.font = `400 46px ${LETTER_FONT}`;
  const half = ctx.measureText("CHAMPIONS").width / 2;
  star(ctx, 540 - half - 34, 522, 12, SEPIA); star(ctx, 540 + half + 34, 522, 12, SEPIA);
  const top = world.scores.slice(0, 3);
  if (!top.length) { text(ctx, "No winners this time. Reset to play again!", 540, 820, 38, SEPIA, FLAVOR_FONT); return; }
  const base = 1150, width = 230;
  const places = [{ x: 540, height: 330, delay: 800 }, { x: 290, height: 250, delay: 500 }, { x: 790, height: 190, delay: 200 }];
  // Slow light rays behind the champion.
  const rise = (rank: number) => easeOutCubic(clamp01((age - places[rank].delay) / 600));
  const championTop = base - places[0].height * rise(0);
  ctx.save(); ctx.globalAlpha = 0.5 * rise(0); ctx.translate(540, championTop - 130); ctx.rotate(age / 4000);
  for (let ray = 0; ray < 12; ray++) {
    ctx.rotate(Math.PI / 6);
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-26, -260); ctx.lineTo(26, -260); ctx.closePath();
    ctx.fillStyle = "rgba(255, 214, 120, 0.35)"; ctx.fill();
  }
  ctx.restore();
  top.forEach((entry, rank) => {
    const place = places[rank], height = place.height * rise(rank), blockTop = base - height;
    if (height < 1) return;
    const block = ctx.createLinearGradient(0, blockTop, 0, base);
    block.addColorStop(0, MEDALS[rank][0]); block.addColorStop(1, MEDALS[rank][1]);
    ctx.save(); ctx.shadowColor = "rgba(60, 30, 4, 0.45)"; ctx.shadowBlur = 18; ctx.shadowOffsetY = 6;
    rounded(ctx, place.x - width / 2, blockTop, width, height, 18, block, "rgba(122, 84, 24, 0.8)", 3);
    ctx.restore();
    ctx.save(); ctx.globalAlpha = clamp01(height / 120);
    text(ctx, String(rank + 1), place.x, blockTop + Math.min(height / 2, 90), 110, "rgba(255, 255, 255, 0.75)", TITLE_FONT);
    if (height > 160) text(ctx, `${entry.points} pts`, place.x, blockTop + 170, 36, INK, LETTER_FONT);
    ctx.restore();
    // Avatar with the player's initial, then their name, pop in once the block is up.
    const pop = easeOutBack(clamp01((age - place.delay - 500) / 450));
    if (pop <= 0.01) return;
    ctx.save(); ctx.translate(place.x, blockTop - 120); ctx.scale(pop, pop);
    const avatar = ctx.createLinearGradient(0, -52, 0, 52);
    avatar.addColorStop(0, MEDALS[rank][0]); avatar.addColorStop(1, MEDALS[rank][1]);
    ctx.save(); ctx.shadowColor = rank === 0 ? "rgba(255, 210, 63, 0.9)" : "rgba(0, 0, 0, 0.35)"; ctx.shadowBlur = rank === 0 ? 30 : 12;
    ctx.beginPath(); ctx.arc(0, 0, rank === 0 ? 56 : 48, 0, Math.PI * 2); ctx.fillStyle = avatar; ctx.fill();
    ctx.restore();
    ctx.strokeStyle = "#fff7d6"; ctx.lineWidth = 4; ctx.stroke();
    text(ctx, entry.name.slice(0, 1).toUpperCase(), 0, 4, rank === 0 ? 62 : 52, INK, TITLE_FONT);
    text(ctx, shorten(entry.name, 12), 0, rank === 0 ? 92 : 82, rank === 0 ? 40 : 34, INK, LETTER_FONT);
    ctx.restore();
    if (rank === 0) {
      const drop = easeOutBack(clamp01((age - place.delay - 900) / 500));
      if (drop > 0.01) {
        ctx.save(); ctx.globalAlpha = clamp01(drop);
        crown(ctx, place.x, blockTop - 120 - 92 - (1 - drop) * 120 + Math.sin(age / 300) * 4, 44);
        ctx.restore();
      }
    }
  });
}

export function renderGame(context: Ctx, state: GameState): void {
  const { width, height } = context.canvas;
  const { world } = state;
  context.clearRect(0, 0, width, height);
  drawBackground(context, world.elapsedMs);
  drawPage(context);
  // The result scroll replaces the header between rounds; a cleared level first
  // shows its last finder in the spotlight.
  const latest = latestFind(world), spotlightAge = latest ? world.elapsedMs - latest.foundAtMs : Infinity;
  const header = world.phase === "playing" || (world.phase === "cleared" && world.elapsedMs - world.phaseAtMs < RESULT_DELAY_MS + 450);
  const spotlight = header && latest !== undefined && spotlightAge < SPOTLIGHT_MS;
  if (header) drawTitle(context, !spotlight);
  if (world.phase === "playing" && spotlightAge >= SPOTLIGHT_MS) drawTask(context, world);
  // Game over swaps the board for the winner podium.
  if (world.phase === "finished") drawPodium(context, world);
  else { drawStatus(context, world); drawGrid(context, world); drawSlots(context, world); }
  // The leaderboard takes the level badge's place once the round's results are shown.
  const results = world.phase !== "playing" && resultsAge(world) > 0;
  if (!results) drawLevelBadge(context, world);
  drawLevelIntro(context, world);
  if (spotlight) drawSpotlight(context, world, latest, spotlightAge);
  if (world.phase !== "playing") drawRoundEnd(context, world, state.runtime.config);
  if (results) drawLeaderboard(context, world);
  drawFindEffects(context, world);
  drawCelebration(context, world);
  if (state.runtime.paused) {
    context.fillStyle = "rgba(4, 10, 6, 0.7)"; context.fillRect(0, 0, width, height);
    rounded(context, 340, 759, 400, 130, 16, "#efdfb8", "#7a5418", 3);
    text(context, "Paused", 540, 826, 60, INK, TITLE_FONT);
  }
}
