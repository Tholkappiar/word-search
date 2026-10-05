// Presentation-only assets, bundled locally so the stream looks identical everywhere.
// Art: AI-generated forest background and stag emblem supplied for this game.
// Fonts: Henny Penny and IM Fell English (SIL OFL 1.1, see assets/fonts/OFL-*.txt).
export const TITLE_FONT = "'Henny Penny', Georgia, serif";
export const LETTER_FONT = "'IM Fell English SC', Georgia, serif";
export const FLAVOR_FONT = "'IM Fell English', Georgia, serif";

const artUrls = {
  forest: new URL("./assets/art/forest.jpg", import.meta.url).href,
  stag: new URL("./assets/art/stag.png", import.meta.url).href
};
export type ArtName = keyof typeof artUrls;

const images = new Map<ArtName, HTMLImageElement>();
if (typeof Image !== "undefined") {
  for (const [name, url] of Object.entries(artUrls)) {
    const image = new Image(); image.src = url; images.set(name as ArtName, image);
  }
}
if (typeof document !== "undefined" && typeof FontFace !== "undefined") {
  const font = (family: string, file: string, descriptors: FontFaceDescriptors = {}) =>
    new FontFace(family, `url(${new URL(`./assets/fonts/${file}`, import.meta.url).href})`, descriptors);
  const fonts = [
    font("Henny Penny", "HennyPenny.woff2"),
    font("IM Fell English SC", "IMFellEnglishSC.woff2"),
    font("IM Fell English", "IMFellEnglish-Italic.woff2", { style: "italic" })
  ];
  for (const face of fonts) void face.load().then(loaded => document.fonts.add(loaded)).catch(() => undefined);
}

let goldStag: HTMLCanvasElement | undefined;
/** The black-on-white stag emblem recoloured as gold on transparency, for the dark sky. */
export function goldStagImage(): HTMLCanvasElement | undefined {
  const stag = artImage("stag");
  if (goldStag || !stag || typeof document === "undefined") return goldStag;
  const canvas = document.createElement("canvas");
  canvas.width = stag.naturalWidth; canvas.height = stag.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) return undefined;
  context.drawImage(stag, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const darkness = 1 - (pixels.data[index] + pixels.data[index + 1] + pixels.data[index + 2]) / 765;
    pixels.data[index] = 243; pixels.data[index + 1] = 210; pixels.data[index + 2] = 124;
    pixels.data[index + 3] = Math.round(darkness * pixels.data[index + 3]);
  }
  context.putImageData(pixels, 0, 0);
  goldStag = canvas;
  return goldStag;
}

/** The loaded artwork, or undefined while it is still loading (or outside a browser). */
export function artImage(name: ArtName): HTMLImageElement | undefined {
  const image = images.get(name);
  return image?.complete && image.naturalWidth > 0 ? image : undefined;
}
