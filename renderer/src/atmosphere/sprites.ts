/**
 * The atmosphere's few textures (R4), drawn once on a canvas in the pixel-art way: hard
 * pixel edges and light in steps, never a smooth gradient (CLAUDE.md §1).
 *
 *   halo    a disc of light in four steps, brightest in the middle (glow, fire, lava)
 *   puff    a round puff with a lighter crown (smoke, ash clouds, dust)
 *   fleck   one pixel (falling ash, sparks, rain)
 *   beam    a column of light in steps, brightest down its middle (seed, ark)
 */
import { CanvasSource, Rectangle, Texture } from "pixi.js";

/** Texels across the halo and the puff. */
export const HALO_SIZE = 48;
export const PUFF_SIZE = 8;
/** The beam's width and height in texels. */
export const BEAM_WIDTH = 8;
export const BEAM_HEIGHT = 32;
/** The halo's steps: (share of its radius, opacity), from the outside in. */
export const HALO_STEPS: readonly (readonly [number, number])[] = [
  [1, 0.1],
  [0.78, 0.22],
  [0.56, 0.4],
  [0.36, 0.66],
  [0.18, 1],
];

export interface Sprites {
  halo: Texture;
  puff: Texture;
  fleck: Texture;
  beam: Texture;
}

/** Opacity of the halo at texel (x, y): the step it falls in, or 0 outside. */
export function haloAlpha(x: number, y: number, size = HALO_SIZE): number {
  const r = size / 2;
  const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
  let alpha = 0;
  for (const [reach, opacity] of HALO_STEPS) if (d <= reach) alpha = opacity;
  return alpha;
}

let made: Sprites | null = null;

/** The textures (made on first use; they live as long as the page). */
export function atmosphereSprites(): Sprites {
  if (made !== null) return made;
  const width = HALO_SIZE + PUFF_SIZE + 1 + BEAM_WIDTH + 3;
  const height = Math.max(HALO_SIZE, BEAM_HEIGHT);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the atmosphere");
  const image = context.createImageData(width, height);
  const put = (x: number, y: number, alpha: number, value = 255): void => {
    const at = (y * width + x) * 4;
    image.data[at] = value;
    image.data[at + 1] = value;
    image.data[at + 2] = value;
    image.data[at + 3] = Math.round(alpha * 255);
  };
  for (let y = 0; y < HALO_SIZE; y++) {
    for (let x = 0; x < HALO_SIZE; x++) put(x, y, haloAlpha(x, y));
  }
  // The puff: a disc, its upper part lighter (lit from above), the rest a shade darker.
  const puffX = HALO_SIZE;
  const pr = PUFF_SIZE / 2;
  for (let y = 0; y < PUFF_SIZE; y++) {
    for (let x = 0; x < PUFF_SIZE; x++) {
      const d = Math.hypot(x + 0.5 - pr, y + 0.5 - pr);
      if (d > pr) continue;
      put(puffX + x, y, 1, y < pr - 1 && d < pr - 1 ? 255 : 200);
    }
  }
  const fleckX = puffX + PUFF_SIZE;
  put(fleckX, 0, 1);
  // The beam: three steps across, and fading toward its top.
  const beamX = fleckX + 1;
  for (let y = 0; y < BEAM_HEIGHT; y++) {
    const fade = y < BEAM_HEIGHT / 4 ? 0.5 : 1;
    for (let x = 0; x < BEAM_WIDTH; x++) {
      const across = Math.abs(x + 0.5 - BEAM_WIDTH / 2) / (BEAM_WIDTH / 2);
      const alpha = across < 0.3 ? 0.9 : across < 0.65 ? 0.45 : 0.18;
      put(beamX + x, y, alpha * fade);
    }
  }
  context.putImageData(image, 0, 0);
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const frame = (x: number, w: number, h: number): Texture =>
    new Texture({ source, frame: new Rectangle(x, 0, w, h) });
  made = {
    halo: frame(0, HALO_SIZE, HALO_SIZE),
    puff: frame(puffX, PUFF_SIZE, PUFF_SIZE),
    fleck: frame(fleckX, 1, 1),
    beam: frame(beamX, BEAM_WIDTH, BEAM_HEIGHT),
  };
  return made;
}
