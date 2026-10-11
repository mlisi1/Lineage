/**
 * Plants that stand on the painted ground, drawn by rule at whatever size is asked for:
 * broadleaf trees as clumps of foliage on a trunk, conifers as tiers, bushes as low
 * mounds, grass as a few blades. Each carries its own outline and the shadow at its foot.
 *
 * Drawing by rule is what lets the look sheet offer the same plants at several sizes;
 * the size that is chosen can be redrawn by hand later (R1).
 */
import type { Ramp } from "./fixture";
import { hexToRgb, type Form, type Pixels, type Stage } from "./pixelart";
import { mulberry32, type Random } from "./rng";

/** What a pixel of a drawing is made of. */
export const INK = {
  none: 0,
  shadow: 1,
  outline: 2,
  dark: 3,
  mid: 4,
  light: 5,
  trunk: 6,
  trunkDark: 7,
} as const;
type Ink = (typeof INK)[keyof typeof INK];

export interface PlantArt {
  width: number;
  height: number;
  /** One INK value per pixel, row by row. */
  ink: Uint8Array;
  /** Where the plant stands, in pixels from the top-left corner of the drawing. */
  footX: number;
  footY: number;
}

/** Width and height of a drawing's plant, in art pixels. */
export type Size = readonly [number, number];

/** One proposal for how big plants are, at eight art pixels per cell. */
export interface PlantScale {
  name: string;
  /** Grown and young, per kind. */
  broadleaf: readonly [Size, Size];
  conifer: readonly [Size, Size];
  bush: readonly [Size, Size];
  tuft: Size;
  /** Share of the cells of a wood, and of scrub, that carry a plant of their own. */
  treeDensity: number;
  bushDensity: number;
}

export const PLANT_SCALES: readonly PlantScale[] = [
  {
    name: "small",
    broadleaf: [
      [9, 12],
      [6, 8],
    ],
    conifer: [
      [8, 12],
      [6, 8],
    ],
    bush: [
      [8, 6],
      [5, 4],
    ],
    tuft: [5, 3],
    treeDensity: 1,
    bushDensity: 1,
  },
  {
    name: "medium",
    broadleaf: [
      [13, 18],
      [8, 11],
    ],
    conifer: [
      [11, 18],
      [8, 11],
    ],
    bush: [
      [11, 8],
      [7, 5],
    ],
    tuft: [6, 4],
    treeDensity: 0.62,
    bushDensity: 0.75,
  },
  {
    name: "large",
    broadleaf: [
      [17, 24],
      [10, 14],
    ],
    conifer: [
      [15, 24],
      [9, 14],
    ],
    bush: [
      [13, 10],
      [8, 6],
    ],
    tuft: [6, 4],
    treeDensity: 0.42,
    bushDensity: 0.6,
  },
];
/** Drawings of each kind and age, so that neighbours differ. */
export const STANDING_VARIANTS = 3;
const TRUNK = "#5a4632";
/** Clear pixels kept around a plant for its outline and, below, its shadow. */
const MARGIN = 2;
const SHADOW_ROWS = 2;
/** Where the light comes from: up and to the left. */
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;

interface Lobe {
  x: number;
  y: number;
  r: number;
}

/** A blank drawing with room for a plant `width` × `height` and its trimmings. */
function blank(width: number, height: number): PlantArt {
  const wide = width + 2 * MARGIN;
  const tall = height + MARGIN + SHADOW_ROWS;
  return {
    width: wide,
    height: tall,
    ink: new Uint8Array(wide * tall),
    footX: MARGIN + width / 2,
    footY: MARGIN + height,
  };
}

function put(art: PlantArt, x: number, y: number, ink: Ink): void {
  const px = Math.round(x) + MARGIN;
  const py = Math.round(y) + MARGIN;
  if (px >= 0 && py >= 0 && px < art.width && py < art.height) art.ink[py * art.width + px] = ink;
}

const inkAt = (art: PlantArt, x: number, y: number): number => {
  const px = x + MARGIN;
  const py = y + MARGIN;
  return px >= 0 && py >= 0 && px < art.width && py < art.height
    ? (art.ink[py * art.width + px] ?? 0)
    : 0;
};

/** The shadow a plant throws at its foot: an ellipse, a little toward the south-east. */
function shadow(art: PlantArt, width: number, height: number, reach: number): void {
  const rx = Math.max(width * reach, 1.5);
  const ry = Math.max(width * 0.12, 1.1);
  for (let y = Math.floor(height - ry - 1); y <= height + SHADOW_ROWS; y++) {
    for (let x = -MARGIN; x < width + MARGIN; x++) {
      const dx = (x + 0.5 - (width / 2 + 0.7)) / rx;
      const dy = (y + 0.5 - (height - 0.2)) / ry;
      if (dx * dx + dy * dy <= 1 && inkAt(art, x, y) === INK.none) put(art, x, y, INK.shadow);
    }
  }
}

/** Foliage as overlapping lobes, each lit from the upper left; later lobes lie on top. */
function foliage(art: PlantArt, lobes: readonly Lobe[], floor: number): void {
  const left = Math.floor(Math.min(...lobes.map((lobe) => lobe.x - lobe.r)));
  const right = Math.ceil(Math.max(...lobes.map((lobe) => lobe.x + lobe.r)));
  const top = Math.floor(Math.min(...lobes.map((lobe) => lobe.y - lobe.r)));
  for (let y = top; y < floor; y++) {
    for (let x = left; x < right; x++) {
      for (let i = lobes.length - 1; i >= 0; i--) {
        const lobe = lobes[i];
        if (lobe === undefined) continue;
        const dx = x + 0.5 - lobe.x;
        const dy = y + 0.5 - lobe.y;
        if (dx * dx + dy * dy > lobe.r * lobe.r) continue;
        const lit = (dx * LIGHT_X + dy * LIGHT_Y) / lobe.r;
        put(art, x, y, lit > 0.3 ? INK.light : lit < -0.25 ? INK.dark : INK.mid);
        break;
      }
    }
  }
}

const LEAF: readonly number[] = [INK.dark, INK.mid, INK.light];

/** Turn the rim of the foliage into an outline. */
function outline(art: PlantArt): void {
  const rim: number[] = [];
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const at = y * art.width + x;
      if (!LEAF.includes(art.ink[at] ?? 0)) continue;
      const open = (dx: number, dy: number): boolean => {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= art.width || ny >= art.height) return true;
        const ink = art.ink[ny * art.width + nx] ?? 0;
        return ink === INK.none || ink === INK.shadow;
      };
      if (open(-1, 0) || open(1, 0) || open(0, -1) || open(0, 1)) rim.push(at);
    }
  }
  for (const at of rim) art.ink[at] = INK.outline;
}

function trunk(art: PlantArt, width: number, from: number, height: number): void {
  const thick = width >= 15 ? 3 : width >= 8 ? 2 : 1;
  const left = Math.floor(width / 2 - thick / 2);
  for (let y = from; y < height; y++) {
    for (let i = 0; i < thick; i++) {
      put(art, left + i, y, thick > 1 && i === thick - 1 ? INK.trunkDark : INK.trunk);
    }
  }
}

export function drawBroadleaf(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const crown = Math.round(height * 0.74);
  const r = width * 0.34;
  const nudge = (): number => (random() - 0.5) * Math.min(1.2, width * 0.08);
  trunk(art, width, crown - 2, height);
  foliage(
    art,
    [
      { x: width / 2 + nudge(), y: crown - r * 1.02, r: r * 1.12 },
      { x: r + nudge() * 0.5, y: crown * 0.58 + nudge(), r },
      { x: width - r + nudge() * 0.5, y: crown * 0.55 + nudge(), r },
      { x: width / 2 + nudge(), y: r * 1.05, r: r * 1.08 },
    ],
    crown,
  );
  outline(art);
  shadow(art, width, height, 0.4);
  return art;
}

export function drawConifer(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const stem = Math.max(1, Math.round(height * 0.12));
  const crown = height - stem;
  const tiers = height >= 20 ? 4 : height >= 11 ? 3 : 2;
  const tier = crown / tiers;
  const lean = (random() - 0.5) * 0.6;
  trunk(art, Math.min(width, 9), crown - 1, height);
  for (let y = 0; y < crown; y++) {
    const index = Math.min(Math.floor(y / tier), tiers - 1);
    const within = (y - index * tier) / tier;
    // Each tier flares from half its width to all of it; the tiers widen down the tree.
    const reach = 0.3 + (0.7 * (index + 1)) / tiers;
    const half = Math.max((width / 2) * reach * (0.5 + 0.5 * within), 1);
    const last = Math.floor((index + 1) * tier - 0.001) === y;
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - width / 2 - lean * (1 - y / crown);
      if (Math.abs(dx) > half) continue;
      const across = dx / half;
      put(art, x, y, last || across > 0.3 ? INK.dark : across < -0.35 ? INK.light : INK.mid);
    }
  }
  outline(art);
  shadow(art, width, height, 0.36);
  return art;
}

export function drawBush(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const r = Math.max(height * 0.46, 1.6);
  const nudge = (): number => (random() - 0.5) * Math.min(1, width * 0.08);
  foliage(
    art,
    [
      { x: Math.max(r, width * 0.3) + nudge(), y: height - r * 0.8, r },
      { x: Math.min(width - r, width * 0.7) + nudge(), y: height - r * 0.85, r: r * 1.05 },
      { x: width / 2 + nudge(), y: Math.max(r, height * 0.45), r: r * 1.05 },
    ],
    height,
  );
  outline(art);
  shadow(art, width, height, 0.46);
  return art;
}

export function drawTuft(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  for (let x = 0; x < width; x++) {
    if (random() > 0.78) continue;
    const blade = 1 + Math.floor(random() * height);
    const tone = random() < 0.3 ? INK.dark : INK.mid;
    for (let y = height - blade; y < height; y++) {
      put(art, x, y, y === height - blade && blade > 1 ? INK.light : tone);
    }
  }
  return art;
}

/** The plant of `form` and `stage`, in drawing number `variant`, at `detail` times the scale. */
export function drawStanding(
  form: Form,
  stage: Stage,
  variant: number,
  scale: PlantScale,
  detail = 1,
): PlantArt {
  const sized = (size: Size): Size => [Math.round(size[0] * detail), Math.round(size[1] * detail)];
  const age = stage === "mature" ? 0 : 1;
  const seed = FORM_SEEDS[form] * 97 + age * 13 + variant;
  const random = mulberry32(seed);
  if (form === "BROADLEAF") return drawBroadleaf(sized(scale.broadleaf[age]), random);
  if (form === "CONIFER") return drawConifer(sized(scale.conifer[age]), random);
  if (form === "SHRUB") return drawBush(sized(scale.bush[age]), random);
  return drawTuft(sized(scale.tuft), random);
}

const FORM_SEEDS: Readonly<Record<Form, number>> = {
  LICHEN: 1,
  GRASS: 2,
  SHRUB: 3,
  BROADLEAF: 4,
  CONIFER: 5,
};

/** Colour a drawing with its form's ramp. The shadow is a flat, see-through dark. */
export function colourArt(art: PlantArt, ramp: Ramp): Pixels {
  const shadeOf = (colour: string, factor: number): [number, number, number] => {
    const [r, g, b] = hexToRgb(colour);
    return [Math.round(r * factor), Math.round(g * factor), Math.round(b * factor)];
  };
  const inks: Record<number, readonly [number, number, number, number]> = {
    [INK.shadow]: [0, 0, 0, 84],
    [INK.outline]: [...shadeOf(ramp[0], 0.62), 255],
    [INK.dark]: [...hexToRgb(ramp[0]), 255],
    [INK.mid]: [...hexToRgb(ramp[1]), 255],
    [INK.light]: [...hexToRgb(ramp[2]), 255],
    [INK.trunk]: [...hexToRgb(TRUNK), 255],
    [INK.trunkDark]: [...shadeOf(TRUNK, 0.72), 255],
  };
  const rgba = new Uint8ClampedArray(art.width * art.height * 4);
  art.ink.forEach((ink, at) => {
    const colour = inks[ink];
    if (colour !== undefined) rgba.set(colour, at * 4);
  });
  return { width: art.width, height: art.height, rgba };
}
