/**
 * Plants that stand on the painted ground, drawn by rule at whatever size is asked for:
 * broadleaf trees as clumps of foliage on a trunk, conifers as tiers, bushes as low
 * mounds, grass as blades; and, for the closest view, flowers and stones. Each carries
 * its own outline and the shadow at its foot.
 *
 * The rule adapts to the size: a tree twelve pixels tall is four clumps, one ninety-six
 * tall is a crown of many with leaves picked out, bark and roots. That is what lets one
 * world be drawn from far and from close with the same plants in the same places; the
 * sizes that are kept can be redrawn by hand later (R1).
 */
import type { Ramp } from "./fixture";
import { cellHash, hexToRgb, type Form, type Pixels, type Stage } from "./pixelart";
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
  trunkLight: 8,
  accent: 9,
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

/** How big plants are, at eight art pixels per cell; closer views multiply it. */
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
/** What stands beside the plants in the closest view, at eight art pixels per cell. */
export const FLOWER: Size = [1.5, 2.5];
export const STONE: Size = [2.5, 1.5];
export const FLOWER_COLOURS = ["#f4f1e4", "#f2d24b", "#e58fb1"] as const;

const TRUNK = "#5a4632";
/** Clear pixels kept around a plant for its outline and, below, its shadow. */
const MARGIN = 2;
const SHADOW_ROWS = 2;
/** Where the light comes from: up and to the left. */
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;
/** From this many pixels wide a plant is drawn rich: more clumps, leaves, bark. */
const RICH_FROM = 24;

interface Lobe {
  x: number;
  y: number;
  r: number;
  /** How much darker than its own shading: positive away from the light. */
  shade: number;
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

/**
 * Foliage as overlapping lobes, each lit from the upper left; later lobes lie on top.
 * With `leaves`, single leaves are picked out lighter and darker across it.
 */
function foliage(art: PlantArt, lobes: readonly Lobe[], floor: number, leaves: number): void {
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
        const lit = (dx * LIGHT_X + dy * LIGHT_Y) / lobe.r - lobe.shade;
        let ink: Ink = lit > 0.3 ? INK.light : lit < -0.25 ? INK.dark : INK.mid;
        if (leaves > 0) {
          const leaf = cellHash(x, y, leaves);
          if (ink === INK.mid) ink = leaf < 0.08 ? INK.light : leaf > 0.9 ? INK.dark : ink;
          else if (ink === INK.light && leaf < 0.07) ink = INK.mid;
          else if (ink === INK.dark && leaf > 0.94) ink = INK.mid;
        }
        put(art, x, y, ink);
        break;
      }
    }
  }
}

const LEAF: readonly number[] = [INK.dark, INK.mid, INK.light, INK.accent];

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

/** A trunk from `from` down to the foot: lit on the left, and flared into roots if thick. */
function trunk(art: PlantArt, width: number, from: number, height: number): void {
  const thick =
    width >= RICH_FROM
      ? Math.max(3, Math.round(width * 0.13))
      : width >= 15
        ? 3
        : width >= 8
          ? 2
          : 1;
  const left = Math.floor(width / 2 - thick / 2);
  for (let y = from; y < height; y++) {
    // Roots: the last rows are a pixel or two wider on each side.
    const flare = thick >= 4 ? Math.max(0, y - (height - 3)) : 0;
    for (let i = -flare; i < thick + flare; i++) {
      const dark = thick > 1 && i >= thick - Math.max(1, Math.round(thick * 0.35));
      const lit = thick >= 4 && i === 0;
      put(art, left + i, y, dark ? INK.trunkDark : lit ? INK.trunkLight : INK.trunk);
    }
  }
}

export function drawBroadleaf(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const crown = Math.round(height * 0.74);
  const rich = width >= RICH_FROM;
  trunk(art, width, crown - (rich ? Math.round(crown * 0.2) : 2), height);
  const lobes: Lobe[] = [];
  if (!rich) {
    const r = width * 0.34;
    const nudge = (): number => (random() - 0.5) * Math.min(1.2, width * 0.08);
    lobes.push(
      { x: width / 2 + nudge(), y: crown - r * 1.02, r: r * 1.12, shade: 0 },
      { x: r + nudge() * 0.5, y: crown * 0.58 + nudge(), r, shade: 0 },
      { x: width - r + nudge() * 0.5, y: crown * 0.55 + nudge(), r, shade: 0 },
      { x: width / 2 + nudge(), y: r * 1.05, r: r * 1.08, shade: 0 },
    );
  } else {
    // A ring of clumps round the crown and a few across its middle.
    const r = width * 0.2;
    const ring = Math.min(Math.max(Math.round(width / 6), 7), 13);
    for (let k = 0; k < ring; k++) {
      const angle = (2 * Math.PI * (k + random() * 0.6)) / ring;
      lobes.push({
        x: width / 2 + Math.cos(angle) * (width / 2 - r),
        y: crown / 2 + Math.sin(angle) * (crown / 2 - r),
        r: r * (0.88 + 0.3 * random()),
        shade: 0,
      });
    }
    for (let k = 0; k < 4; k++) {
      lobes.push({
        x: width * (0.34 + 0.32 * random()),
        y: crown * (0.3 + 0.36 * random()),
        r: r * (1.1 + 0.3 * random()),
        shade: 0,
      });
    }
    // The side away from the light is darker as a whole; what faces it lies on top.
    for (const lobe of lobes) {
      lobe.shade =
        0.45 * (((lobe.x - width / 2) * -LIGHT_X + (lobe.y - crown / 2) * -LIGHT_Y) / (width / 2));
    }
    lobes.sort((a, b) => b.shade - a.shade);
  }
  foliage(art, lobes, crown, rich ? 21 : 0);
  outline(art);
  shadow(art, width, height, 0.4);
  return art;
}

export function drawConifer(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const rich = width >= RICH_FROM;
  const stem = Math.max(1, Math.round(height * 0.12));
  const crown = height - stem;
  const tiers = Math.min(Math.max(Math.round(height / 6.5), 2), 9);
  const tier = crown / tiers;
  const lean = (random() - 0.5) * 0.6;
  trunk(art, Math.min(width, rich ? width * 0.6 : 9), crown - 1, height);
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
      // The hem of a tier is a fringe of needles: every third pixel is missing.
      if (rich && last && (x + index) % 3 === 0 && Math.abs(dx) > half * 0.25) continue;
      const across = dx / half;
      let ink: Ink = last || across > 0.3 ? INK.dark : across < -0.35 ? INK.light : INK.mid;
      if (rich) {
        const needle = cellHash(x, y, 22);
        if (ink === INK.mid) ink = needle < 0.1 ? INK.light : needle > 0.88 ? INK.dark : ink;
        else if (ink === INK.dark && !last && needle > 0.93) ink = INK.mid;
      }
      put(art, x, y, ink);
    }
  }
  outline(art);
  shadow(art, width, height, 0.36);
  return art;
}

export function drawBush(size: Size, random: Random, berries = false): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const rich = width >= RICH_FROM;
  const lobes: Lobe[] = [];
  if (!rich) {
    const r = Math.max(height * 0.46, 1.6);
    const nudge = (): number => (random() - 0.5) * Math.min(1, width * 0.08);
    lobes.push(
      { x: Math.max(r, width * 0.3) + nudge(), y: height - r * 0.8, r, shade: 0 },
      {
        x: Math.min(width - r, width * 0.7) + nudge(),
        y: height - r * 0.85,
        r: r * 1.05,
        shade: 0,
      },
      { x: width / 2 + nudge(), y: Math.max(r, height * 0.45), r: r * 1.05, shade: 0 },
    );
  } else {
    // A mound: clumps along the ground, fewer on them, fewer still on top.
    const r = height * 0.3;
    const base = Math.max(4, Math.round(width / (r * 1.25)));
    for (let level = 0; level < 3; level++) {
      const count = base - 2 * level;
      if (count < 1) break;
      // Each level is narrower than the one below and sits most of a clump higher.
      const inset = r + level * r * 1.15;
      for (let k = 0; k < count; k++) {
        const along = count === 1 ? 0.5 : k / (count - 1);
        lobes.push({
          x: inset + (width - 2 * inset) * along + (random() - 0.5) * 2,
          y: height - r * (0.8 + 1.05 * level) + (random() - 0.5) * 2,
          r: r * (0.92 + 0.3 * random()),
          shade: 0.3 - 0.15 * level,
        });
      }
    }
  }
  foliage(art, lobes, height, rich ? 23 : 0);
  if (rich && berries) {
    for (let k = 0; k < Math.round(width / 5); k++) {
      const x = Math.round(width * (0.12 + 0.76 * random()));
      const y = Math.round(height * (0.25 + 0.6 * random()));
      if (!LEAF.includes(inkAt(art, x, y)) || !LEAF.includes(inkAt(art, x + 1, y + 1))) continue;
      for (const [dx, dy] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ] as const)
        put(art, x + dx, y + dy, INK.accent);
    }
  }
  outline(art);
  shadow(art, width, height, 0.46);
  return art;
}

export function drawTuft(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  if (width < 12) {
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
  // Blades that fan out from the foot and bend as they rise; the back ones are darker.
  const blades = Math.round(width * 0.6);
  for (let k = 0; k < blades; k++) {
    const root = width * (0.3 + 0.4 * random());
    const tall = height * (0.45 + 0.55 * random());
    const lean = (random() - 0.5) * width * 0.8;
    const tone = k < blades / 2 ? INK.dark : INK.mid;
    for (let t = 0; t < tall; t++) {
      const along = t / tall;
      put(art, root + lean * along * along, height - 1 - t, along > 0.8 ? INK.light : tone);
    }
  }
  return art;
}

/** A flower: a stem, a leaf, and a head of four petals round a middle. */
export function drawFlower(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const stem = Math.floor(width / 2);
  const bend = random() < 0.5 ? -1 : 1;
  for (let y = 2; y < height; y++) put(art, stem, y, INK.dark);
  put(art, stem + bend, Math.round(height * 0.62), INK.mid);
  for (const [dx, dy] of [
    [0, -1],
    [-1, 0],
    [1, 0],
    [0, 1],
  ] as const)
    put(art, stem + dx, 1 + dy, INK.accent);
  put(art, stem, 1, INK.light);
  return art;
}

/** A stone: a low mound, lit from the upper left, with its outline and a small shadow. */
export function drawStone(size: Size, random: Random): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const r = height * 0.62;
  foliage(
    art,
    [
      { x: width * (0.36 + 0.08 * random()), y: height - r * 0.72, r, shade: 0.1 },
      { x: width * (0.62 + 0.08 * random()), y: height - r * 0.6, r: r * 0.9, shade: 0.25 },
    ],
    height,
    0,
  );
  outline(art);
  shadow(art, width, height, 0.48);
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
  if (form === "SHRUB") return drawBush(sized(scale.bush[age]), random, variant === 1);
  // Young grass is a shorter tuft of the same blades.
  const [width, height] = sized(scale.tuft);
  return drawTuft(
    age === 0 ? [width, height] : [width, Math.max(2, Math.round(height * 0.6))],
    random,
  );
}

const FORM_SEEDS: Readonly<Record<Form, number>> = {
  LICHEN: 1,
  GRASS: 2,
  SHRUB: 3,
  BROADLEAF: 4,
  CONIFER: 5,
};

/**
 * Colour a drawing with a ramp, and `accent` for berries and petals. The shadow is a
 * flat, see-through dark.
 */
export function colourArt(art: PlantArt, ramp: Ramp, accent = "#b8443a"): Pixels {
  const shadeOf = (colour: string, factor: number): [number, number, number] => {
    const [r, g, b] = hexToRgb(colour);
    return [
      Math.min(255, Math.round(r * factor)),
      Math.min(255, Math.round(g * factor)),
      Math.min(255, Math.round(b * factor)),
    ];
  };
  const inks: Record<number, readonly [number, number, number, number]> = {
    [INK.shadow]: [0, 0, 0, 84],
    [INK.outline]: [...shadeOf(ramp[0], 0.62), 255],
    [INK.dark]: [...hexToRgb(ramp[0]), 255],
    [INK.mid]: [...hexToRgb(ramp[1]), 255],
    [INK.light]: [...hexToRgb(ramp[2]), 255],
    [INK.trunk]: [...hexToRgb(TRUNK), 255],
    [INK.trunkDark]: [...shadeOf(TRUNK, 0.72), 255],
    [INK.trunkLight]: [...shadeOf(TRUNK, 1.3), 255],
    [INK.accent]: [...hexToRgb(accent), 255],
  };
  const rgba = new Uint8ClampedArray(art.width * art.height * 4);
  art.ink.forEach((ink, at) => {
    const colour = inks[ink];
    if (colour !== undefined) rgba.set(colour, at * 4);
  });
  return { width: art.width, height: art.height, rgba };
}
