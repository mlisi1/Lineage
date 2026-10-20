/**
 * The atmosphere's few textures (R4), drawn once on a canvas in the pixel-art way: hard
 * pixel edges and light in steps, never a smooth gradient (CLAUDE.md §1).
 *
 *   halo    a disc of light in four steps, brightest in the middle (glow, fire, lava)
 *   puff    a round puff with a lighter crown (smoke, ash clouds, dust)
 *   fleck   one pixel (falling ash, sparks, rain)
 *   beam    a column of light in steps, brightest down its middle (seed, ark)
 *   flames  four frames of a flame, red outside to white at its heart, its tip swaying
 *           (fires, in the middle and local views; R4)
 *   rings   a ripple three sizes, a ring of one pixel (rain on water)
 *   mouth   a volcano's mouth: a dark rim round a pool of lava
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

/** The flame's size in texels, and its frames. */
export const FLAME_WIDTH = 7;
export const FLAME_HEIGHT = 11;
export const FLAME_FRAMES = 4;
/** The flame's colours from the outside in (0xRRGGBB): its rim, body, inside and heart. */
const FLAME = [0xc8361c, 0xf2762a, 0xffbe44, 0xfff2c8] as const;
/** The ripples' sizes (texels across), and the mouth's. */
export const RINGS = [3, 5, 7] as const;
export const MOUTH_WIDTH = 12;
export const MOUTH_HEIGHT = 8;
const MOUTH_RIM = 0x2a1e1c;
const MOUTH_LAVA = [0xd2401c, 0xff8a2a, 0xffd25a] as const;

/** The larger flame of the local view: size in texels, frames, and colours from its rim in. */
export const BIG_FLAME_WIDTH = 11;
export const BIG_FLAME_HEIGHT = 17;
export const BIG_FLAME_FRAMES = 6;
const BIG_FLAME = [0x9c2416, 0xd8401c, 0xf47a28, 0xffb83e, 0xffe7a0] as const;

/**
 * Which of the big flame's colours (index into its five) texel (x, y) of `frame` is, or
 * -1: a broad foot rising into two or three tongues that lick up and sway as the frames
 * go by, outlined in deep red, white-gold at its heart.
 */
export function bigFlameTexel(frame: number, x: number, y: number): number {
  const fromFoot = BIG_FLAME_HEIGHT - 1 - y;
  const centre = (BIG_FLAME_WIDTH - 1) / 2;
  const phase = (2 * Math.PI * frame) / BIG_FLAME_FRAMES;
  const off = (x - centre) / (BIG_FLAME_WIDTH / 2);
  // The body: tallest in the middle; tongues rise and fall in turn across it.
  const body = (1 - off * off) * (BIG_FLAME_HEIGHT * 0.62);
  const tongues =
    Math.max(0, Math.cos(off * 5.2 + phase)) * BIG_FLAME_HEIGHT * 0.3 +
    Math.max(0, Math.cos(off * 3.1 - phase * 0.7 + 1)) * BIG_FLAME_HEIGHT * 0.18;
  const height = body + tongues * (1 - Math.abs(off) * 0.6);
  if (Math.abs(off) > 1 || fromFoot > height) return -1;
  const inside = height - fromFoot;
  const edge = (1 - Math.abs(off)) * BIG_FLAME_WIDTH * 0.5;
  const depth = Math.min(inside, edge);
  if (depth < 0.9) return 0;
  if (depth < 1.8) return 1;
  if (depth < 2.8 || fromFoot > body * 0.85) return 2;
  if (depth < 3.6 || fromFoot > body * 0.5) return 3;
  return 4;
}

export interface Sprites {
  /** The local view's larger flame, frame by frame. */
  bigFlames: Texture[];
  halo: Texture;
  /** A halo with a dark heart: light round a thing without hiding it (glowing animals). */
  ring: Texture;
  puff: Texture;
  fleck: Texture;
  beam: Texture;
  flames: Texture[];
  rings: Texture[];
  mouth: Texture;
}

/** Which of the flame's colours (index into its four) texel (x, y) of `frame` is, or -1. */
export function flameTexel(frame: number, x: number, y: number): number {
  // Broad at its foot, tapering to a point that sways with the frame; a tongue licks off
  // one side on every other frame.
  const sway = [0, 1, 0, -1][frame % 4] ?? 0;
  const fromFoot = FLAME_HEIGHT - 1 - y;
  const t = fromFoot / (FLAME_HEIGHT - 1);
  const centre = (FLAME_WIDTH - 1) / 2 + sway * t ** 1.5 * 1.6;
  let half = 3.4 * (1 - t) ** 0.85 * Math.min(1, 0.6 + t * 3);
  const tongue = frame % 2 === 0 ? 1 : -1;
  if (t > 0.45 && t < 0.75 && Math.sign(x - centre) === tongue) half += 0.9;
  const d = Math.abs(x - centre);
  if (d > half + 0.25) return -1;
  const inner = half - d;
  if (inner < 0.75) return 0;
  if (inner < 1.6 || t > 0.7) return 1;
  if (inner < 2.4 || t > 0.45) return 2;
  return 3;
}

/** The ring's steps: (share of its radius, opacity), from the outside in; clear in its middle. */
export const RING_STEPS: readonly (readonly [number, number])[] = [
  [1, 0.12],
  [0.8, 0.3],
  [0.62, 0.55],
  [0.44, 0.3],
  [0.3, 0.08],
  [0.18, 0],
];

/** Opacity of the ring at texel (x, y). */
export function ringAlpha(x: number, y: number, size = HALO_SIZE): number {
  const r = size / 2;
  const d = Math.hypot(x + 0.5 - r, y + 0.5 - r) / r;
  let alpha = 0;
  for (const [reach, opacity] of RING_STEPS) if (d <= reach) alpha = opacity;
  return alpha;
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
  const ringX = HALO_SIZE + PUFF_SIZE + 1 + BEAM_WIDTH + 1;
  const flamesX = ringX + HALO_SIZE + 1;
  const ringsX = flamesX + FLAME_FRAMES * (FLAME_WIDTH + 1);
  const mouthX = ringsX + RINGS.reduce((sum, size) => sum + size + 1, 0);
  const bigX = mouthX + MOUTH_WIDTH + 1;
  const width = bigX + BIG_FLAME_FRAMES * (BIG_FLAME_WIDTH + 1);
  const height = Math.max(HALO_SIZE, BEAM_HEIGHT, BIG_FLAME_HEIGHT);
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
  const paint = (x: number, y: number, colour: number): void => {
    const at = (y * width + x) * 4;
    image.data[at] = colour >> 16;
    image.data[at + 1] = (colour >> 8) & 255;
    image.data[at + 2] = colour & 255;
    image.data[at + 3] = 255;
  };
  for (let frame = 0; frame < FLAME_FRAMES; frame++) {
    for (let y = 0; y < FLAME_HEIGHT; y++) {
      for (let x = 0; x < FLAME_WIDTH; x++) {
        const tone = flameTexel(frame, x, y);
        if (tone >= 0) paint(flamesX + frame * (FLAME_WIDTH + 1) + x, y, FLAME[tone] ?? 0);
      }
    }
  }
  let ringAt = ringsX;
  for (const size of RINGS) {
    const r = (size - 1) / 2;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - r, y - r);
        if (Math.abs(d - r) < 0.6) put(ringAt + x, y, 1);
      }
    }
    ringAt += size + 1;
  }
  for (let frame = 0; frame < BIG_FLAME_FRAMES; frame++) {
    for (let y = 0; y < BIG_FLAME_HEIGHT; y++) {
      for (let x = 0; x < BIG_FLAME_WIDTH; x++) {
        const tone = bigFlameTexel(frame, x, y);
        if (tone >= 0) paint(bigX + frame * (BIG_FLAME_WIDTH + 1) + x, y, BIG_FLAME[tone] ?? 0);
      }
    }
  }
  for (let y = 0; y < MOUTH_HEIGHT; y++) {
    for (let x = 0; x < MOUTH_WIDTH; x++) {
      const dx = (x + 0.5 - MOUTH_WIDTH / 2) / (MOUTH_WIDTH / 2);
      const dy = (y + 0.5 - MOUTH_HEIGHT / 2) / (MOUTH_HEIGHT / 2);
      const d = Math.hypot(dx, dy);
      if (d > 1) continue;
      const lava = d < 0.35 ? 2 : d < 0.55 ? 1 : 0;
      paint(mouthX + x, y, d > 0.75 ? MOUTH_RIM : (MOUTH_LAVA[lava] ?? 0));
    }
  }
  for (let y = 0; y < HALO_SIZE; y++) {
    for (let x = 0; x < HALO_SIZE; x++) {
      put(x, y, haloAlpha(x, y));
      put(ringX + x, y, ringAlpha(x, y));
    }
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
    ring: frame(ringX, HALO_SIZE, HALO_SIZE),
    puff: frame(puffX, PUFF_SIZE, PUFF_SIZE),
    fleck: frame(fleckX, 1, 1),
    beam: frame(beamX, BEAM_WIDTH, BEAM_HEIGHT),
    flames: Array.from({ length: FLAME_FRAMES }, (_, k) =>
      frame(flamesX + k * (FLAME_WIDTH + 1), FLAME_WIDTH, FLAME_HEIGHT),
    ),
    rings: RINGS.map((size, k) =>
      frame(ringsX + RINGS.slice(0, k).reduce((sum, s) => sum + s + 1, 0), size, size),
    ),
    mouth: frame(mouthX, MOUTH_WIDTH, MOUTH_HEIGHT),
    bigFlames: Array.from({ length: BIG_FLAME_FRAMES }, (_, k) =>
      frame(bigX + k * (BIG_FLAME_WIDTH + 1), BIG_FLAME_WIDTH, BIG_FLAME_HEIGHT),
    ),
  };
  return made;
}

const streaks = new Map<string, Texture>();

/**
 * A raindrop's streak `length` art pixels long, leaning `lean` pixels across for each
 * pixel down (the wind), drawn a pixel a row as pixel art does a slanted line: its head
 * (lowest, brightest) at the bottom right. Made once for each length and lean.
 */
export function streakTexture(length: number, lean: number): Texture {
  const rows = Math.max(Math.round(length), 1);
  const step = Math.round(lean * 4) / 4;
  const key = `${rows}:${step}`;
  const known = streaks.get(key);
  if (known !== undefined) return known;
  const width = Math.round((rows - 1) * Math.abs(step)) + 1;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for rain");
  const image = context.createImageData(width, rows);
  for (let row = 0; row < rows; row++) {
    const across = Math.round(row * Math.abs(step));
    const x = step >= 0 ? across : width - 1 - across;
    const at = (row * width + x) * 4;
    image.data[at] = 255;
    image.data[at + 1] = 255;
    image.data[at + 2] = 255;
    // Fainter toward its tail.
    image.data[at + 3] = Math.round(255 * (0.35 + 0.65 * ((row + 1) / rows)));
  }
  context.putImageData(image, 0, 0);
  const texture = new Texture({
    source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }),
  });
  streaks.set(key, texture);
  return texture;
}

/** A sprout as it grows (R4, the seed power), frame by frame: pixel rows, bottom at its foot. */
export const SPROUT_FRAMES: readonly (readonly string[])[] = [
  [".......", ".......", ".......", ".......", ".......", "...g...", "..ddd.."],
  [".......", ".......", ".......", ".......", "..L.L..", "...s...", "...s..."],
  [".......", ".......", ".L...L.", ".lL.Ll.", "...s...", "...s...", "...s..."],
  [".L...L.", ".l.L.l.", ".lLlLl.", "l.lsl.l", "..lsl..", "...s...", "...s..."],
];
const SPROUT_COLOURS: Readonly<Record<string, number>> = {
  s: 0x3f7a35, // stem
  l: 0x5fa83e, // leaf
  L: 0x9ed65a, // leaf in the light
  g: 0x9ed65a, // the first green out of the seed
  d: 0x5a4636, // the soil it broke
};

let sprouts: Texture[] | null = null;

/** The sprout's frames (made on first use). */
export function sproutTextures(): Texture[] {
  if (sprouts !== null) return sprouts;
  const width = SPROUT_FRAMES.length * 8;
  const height = 7;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the sprouts");
  SPROUT_FRAMES.forEach((rows, frame) => {
    rows.forEach((row, y) => {
      [...row].forEach((key, x) => {
        const colour = SPROUT_COLOURS[key];
        if (colour === undefined) return;
        context.fillStyle = `#${colour.toString(16).padStart(6, "0")}`;
        context.fillRect(frame * 8 + x, y, 1, 1);
      });
    });
  });
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  sprouts = SPROUT_FRAMES.map(
    (_, frame) => new Texture({ source, frame: new Rectangle(frame * 8, 0, 7, height) }),
  );
  return sprouts;
}
