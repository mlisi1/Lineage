/**
 * Plants that stand on the painted ground, drawn by rule at whatever size is asked for:
 * trees, bushes and grass, and for the closest view what grows among them (flowers,
 * ferns, herbs, mushrooms, reeds) and what lies there (stones, logs, stumps).
 *
 * A rule adapts to the size it is asked for, which is what lets one world be drawn from
 * far and from close with the same plants in the same places; the sizes that are kept
 * can be redrawn by hand later (R1). Trees and bushes come in styles, to choose from:
 *
 *   first    the middle view's: a few lobes on a trunk, a conifer in tiers; drawn with
 *            its shadow at its foot
 *   bundles  a crown of many small bundles of leaves, each lit on its own and shading
 *            the ones behind it; a conifer of drooping boughs
 *   dome     one rounded mass shaded as a whole in stepped tones, its rim in bumps; a
 *            conifer of clean tiers
 *   limbs    branches that fork, a clump of leaves at each end and air between them; a
 *            conifer of whorls on a trunk that shows
 *
 * The three after the first follow how pixel-art trees are usually built: one cluster
 * of leaves repeated and layered by the light (Slynyrd's Pixelblog 44), a crown that
 * dominates a short trunk with its shadow apart (top-down game tilesets), branches
 * grown by forking with a clump of leaves per end (Gentree). They carry no shadow of
 * their own: the ground paints it, so that shadows do not darken each other.
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
  /** Darker than dark and lighter than light: the tones a crown needs up close. */
  deep: 10,
  bright: 11,
  /** The accent in shade, the middle of a flower, and what is pale (a mushroom's stem). */
  accentDark: 12,
  core: 13,
  pale: 14,
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
  /**
   * The shadow it throws on the ground at its foot, for the ground to paint: half its
   * width and height in pixels. Left out by what is too small for one, or carries its own.
   */
  shadow?: { rx: number; ry: number };
}

/** How trees and bushes are drawn. `first` is the middle view's; the rest are proposals. */
export type TreeStyle = "first" | "bundles" | "dome" | "limbs";
export const TREE_STYLES: readonly TreeStyle[] = ["bundles", "dome", "limbs"];

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
const TRUNK = "#5a4632";
/** What the darkest and the lightest tone of foliage are mixed with. */
const DEEP: readonly [number, number, number] = [18, 30, 56];
const BRIGHT: readonly [number, number, number] = [246, 240, 150];
/** The middle of a flower, and pale wood or a mushroom's stem. */
const CORE = "#e0b83a";
const PALE = "#e9dfc6";
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

const LEAF: readonly number[] = [
  INK.dark,
  INK.mid,
  INK.light,
  INK.accent,
  INK.deep,
  INK.bright,
  INK.accentDark,
  INK.core,
  INK.pale,
];

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

/** The tones of foliage, darkest first. */
const TONES: readonly Ink[] = [INK.deep, INK.dark, INK.mid, INK.light, INK.bright];
const toneOf = (level: number): Ink =>
  TONES[Math.min(Math.max(Math.round(level), 0), 4)] ?? INK.mid;
const GOLDEN_ANGLE = 2.39996;
const isLeaf = (art: PlantArt, x: number, y: number): boolean =>
  LEAF.includes(inkAt(art, Math.round(x), Math.round(y)));

/**
 * A clump of leaves: a disc whose rim goes in and out, lit from the upper left, with a
 * leaf picked out here and there. `lift` shifts all of its tones: +1 is a tone lighter.
 */
function clump(art: PlantArt, x: number, y: number, r: number, lift: number, salt: number): void {
  const scallops = Math.max(5, Math.round(r * 0.9));
  const phase = cellHash(Math.round(x * 7), Math.round(y * 7), salt) * Math.PI * 2;
  for (let py = Math.floor(y - r - 1); py <= Math.ceil(y + r + 1); py++) {
    for (let px = Math.floor(x - r - 1); px <= Math.ceil(x + r + 1); px++) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      const rim = r * (1 + 0.1 * Math.cos(scallops * Math.atan2(dy, dx) + phase));
      if (dx * dx + dy * dy > rim * rim) continue;
      const lit = (dx * LIGHT_X + dy * LIGHT_Y) / r;
      let level = 2 + lift + (lit > 0.42 ? 1 : lit < -0.4 ? -1 : 0);
      if (r >= 4) {
        const leaf = cellHash(px, py, salt);
        if (leaf < 0.06) level += 1;
        else if (leaf > 0.94) level -= 1;
      }
      put(art, px, py, toneOf(level));
    }
  }
}

/** The shade a clump about to be drawn at (x, y) throws on the leaves already behind it. */
function cast(art: PlantArt, x: number, y: number, r: number): void {
  for (let py = Math.floor(y - r); py <= Math.ceil(y + r); py++) {
    for (let px = Math.floor(x - r); px <= Math.ceil(x + r); px++) {
      if ((px + 0.5 - x) ** 2 + (py + 0.5 - y) ** 2 > r * r) continue;
      if (isLeaf(art, px, py)) put(art, px, py, INK.deep);
    }
  }
}

interface Clump {
  x: number;
  y: number;
  r: number;
  /** How far toward the light it sits in its crown: -1 on the far side, 1 on the lit one. */
  facing: number;
}

/** Draw clumps from the far side of their crown to the lit one, each shading those behind. */
function heap(art: PlantArt, clumps: Clump[], salt: number): void {
  clumps.sort((a, b) => a.facing - b.facing);
  for (const { x, y, r, facing } of clumps) {
    cast(art, x + r * 0.14, y + r * 0.24, r + 0.5);
    clump(art, x, y, r, facing * 0.95, salt);
  }
}

/** bundles: clumps packed in an oval, as the seeds of a sunflower are. */
function bundles(
  art: PlantArt,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  r: number,
  random: Random,
  salt: number,
): void {
  const count = Math.max(4, Math.round(((rx * ry) / (r * r)) * 1.75));
  const turn = random() * Math.PI * 2;
  const clumps: Clump[] = [];
  for (let k = 0; k < count; k++) {
    const far = Math.sqrt((k + 0.5) / count);
    const angle = turn + k * GOLDEN_ANGLE;
    const x = cx + Math.cos(angle) * far * Math.max(rx - r * 0.85, 0) + (random() - 0.5) * r * 0.4;
    const y = cy + Math.sin(angle) * far * Math.max(ry - r * 0.85, 0) + (random() - 0.5) * r * 0.4;
    clumps.push({
      x,
      y,
      r: r * (0.82 + 0.34 * random()),
      facing: ((x - cx) / rx) * LIGHT_X + ((y - cy) / ry) * LIGHT_Y,
    });
  }
  heap(art, clumps, salt);
}

/**
 * dome: one oval with bumps along its rim, shaded as one mass in five stepped tones.
 * The steps follow a pattern of small bricks, so that they read as leaves; rows from
 * `floor` down are left out (a bush sits on the ground).
 */
function dome(
  art: PlantArt,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  random: Random,
  salt: number,
  floor = Infinity,
): void {
  const knob = Math.max(1.5, Math.min(rx, ry) * 0.34);
  const count = Math.max(5, Math.round((rx + ry) / 4.5));
  const knobs: { x: number; y: number; r: number }[] = [];
  for (let k = 0; k < count; k++) {
    const angle = ((k + random() * 0.6) / count) * Math.PI * 2;
    const r = knob * (0.8 + 0.4 * random());
    knobs.push({ x: cx + Math.cos(angle) * (rx - r), y: cy + Math.sin(angle) * (ry - r), r });
  }
  const coreX = Math.max(rx - knob * 0.6, 1);
  const coreY = Math.max(ry - knob * 0.6, 1);
  const rich = Math.min(rx, ry) >= 9;
  for (let py = Math.floor(cy - ry); py <= Math.ceil(cy + ry) && py < floor; py++) {
    for (let px = Math.floor(cx - rx); px <= Math.ceil(cx + rx); px++) {
      const dx = px + 0.5 - cx;
      const dy = py + 0.5 - cy;
      let lit = (dx / rx) * LIGHT_X + (dy / ry) * LIGHT_Y;
      let inside = (dx / coreX) ** 2 + (dy / coreY) ** 2 <= 1;
      for (const bump of knobs) {
        const bx = px + 0.5 - bump.x;
        const by = py + 0.5 - bump.y;
        if (bx * bx + by * by > bump.r * bump.r) continue;
        // On a bump the light also goes by the bump's own roundness.
        if (!inside) lit = 0.6 * lit + 0.4 * ((bx * LIGHT_X + by * LIGHT_Y) / bump.r);
        inside = true;
      }
      if (!inside) continue;
      if (rich) {
        // Bricks three pixels by two, every other row shifted: the edge of a tone is leaves.
        const row = Math.floor(py / 2);
        lit += 0.2 * (cellHash(Math.floor((px + (row & 1) * 1.5) / 3), row, salt) - 0.5) * 2;
      }
      put(
        art,
        px,
        py,
        toneOf(lit > 0.62 ? 4 : lit > 0.24 ? 3 : lit > -0.3 ? 2 : lit > -0.72 ? 1 : 0),
      );
    }
  }
}

/** A branch from one point to another, `thick` pixels wide, lit on its left. */
function limb(art: PlantArt, x0: number, y0: number, x1: number, y1: number, thick: number): void {
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
  for (let step = 0; step <= steps; step++) {
    const x = x0 + ((x1 - x0) * step) / steps;
    const y = y0 + ((y1 - y0) * step) / steps;
    for (let i = 0; i < thick; i++) {
      const ink =
        thick > 1 && i === thick - 1
          ? INK.trunkDark
          : thick > 2 && i === 0
            ? INK.trunkLight
            : INK.trunk;
      put(art, x - thick / 2 + i + 0.5, y, ink);
    }
  }
}

/**
 * limbs: a trunk that parts into limbs, each limb into two twigs, and a clump of leaves
 * where a limb forks and at the end of every twig. The clumps are kept inside the
 * drawing; `spread` is how wide the limbs open (radians either side of upright).
 */
function limbs(
  art: PlantArt,
  width: number,
  height: number,
  r: number,
  random: Random,
  salt: number,
  spread: number,
): void {
  const ends: Clump[] = [];
  const within = (x: number, y: number): [number, number] => [
    Math.min(Math.max(x, r * 0.95), width - r * 0.95),
    Math.min(Math.max(y, r * 0.95), height * 0.62),
  ];
  const leaf = (x: number, y: number, size: number): void => {
    ends.push({
      x,
      y,
      r: r * size * (0.88 + 0.26 * random()),
      facing:
        ((x - width / 2) / (width / 2)) * LIGHT_X + ((y - height * 0.3) / (height * 0.3)) * LIGHT_Y,
    });
  };
  const thick = width >= 48 ? 4 : width >= RICH_FROM ? 3 : width >= 12 ? 2 : 1;
  const forkX = width / 2 + (random() - 0.5) * width * 0.08;
  const forkY = height * 0.62;
  limb(art, width / 2, height - 1, forkX, forkY, thick);
  const arms = width >= RICH_FROM ? 4 : 3;
  for (let arm = 0; arm < arms; arm++) {
    const angle = ((arm + 0.5) / arms - 0.5) * 2.6 * spread + (random() - 0.5) * 0.24;
    // A limb that leans out is longer than one that stands.
    const length = height * (0.25 + 0.09 * random()) * (1 + 0.3 * Math.abs(Math.sin(angle)));
    const [nx, ny] = within(forkX + Math.sin(angle) * length, forkY - Math.cos(angle) * length);
    limb(art, forkX, forkY, nx, ny, Math.max(1, thick - 1));
    leaf(nx, ny, 1.08);
    for (const side of [-1, 1]) {
      const twig = angle + side * (0.4 + 0.35 * random());
      const reach = length * (0.5 + 0.22 * random());
      const [tx, ty] = within(nx + Math.sin(twig) * reach, ny - Math.cos(twig) * reach);
      limb(art, nx, ny, tx, ty, Math.max(1, thick - 2));
      leaf(tx, ty, 0.92);
    }
  }
  heap(art, ends, salt);
}

/** Berries: pairs of pixels of the accent among the leaves. */
function berries(art: PlantArt, width: number, height: number, random: Random): void {
  const big = width >= RICH_FROM;
  for (let k = 0; k < Math.max(3, Math.round(width / 4)); k++) {
    const x = Math.round(width * (0.12 + 0.76 * random()));
    const y = Math.round(height * (0.15 + 0.7 * random()));
    if (!isLeaf(art, x, y) || !isLeaf(art, x + 1, y + 1) || !isLeaf(art, x - 1, y - 1)) continue;
    put(art, x, y, INK.accent);
    if (!big) continue;
    put(art, x + 1, y, INK.accent);
    put(art, x, y + 1, INK.accentDark);
    put(art, x + 1, y + 1, INK.accentDark);
  }
}

/** Clear what was drawn below the line the plant stands on. */
function trim(art: PlantArt, height: number): void {
  for (let y = height + MARGIN; y < art.height; y++)
    art.ink.fill(INK.none, y * art.width, (y + 1) * art.width);
}

/** Where the plant's shadow falls: an ellipse under its foot. */
const shadowOf = (width: number, reach: number): PlantArt["shadow"] => ({
  rx: Math.max(width * reach, 2),
  ry: Math.max(width * reach * 0.34, 1.5),
});

/** A broadleaf tree in one of the styles after the first. */
function broadleafIn(style: TreeStyle, size: Size, random: Random, salt: number): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const crown = height * 0.74;
  if (style === "limbs") {
    limbs(art, width, height, Math.max(2, width * 0.14), random, salt, 0.62);
  } else {
    trunk(art, width, Math.round(crown * 0.6), height);
    if (style === "bundles") {
      bundles(
        art,
        width / 2,
        crown / 2,
        width / 2,
        crown / 2,
        Math.max(2, width * 0.155),
        random,
        salt,
      );
    } else {
      dome(art, width / 2, crown / 2, width / 2, crown / 2, random, salt);
    }
  }
  trim(art, height);
  outline(art);
  art.shadow = shadowOf(width, 0.42);
  return art;
}

/**
 * A conifer in tiers, the lowest drawn first so that each hangs over the one below and
 * shades it. With `boughs` the hem of a tier is a row of drooping tips and its needles
 * show; without, tiers are clean and cut straight.
 */
function tiers(
  art: PlantArt,
  width: number,
  height: number,
  random: Random,
  salt: number,
  boughs: boolean,
): void {
  const stem = Math.max(2, Math.round(height * 0.1));
  const crown = height - stem;
  const count = Math.min(Math.max(Math.round(height / (boughs ? 11 : 15)), 2), 9);
  const tall = crown / count;
  const lean = (random() - 0.5) * 0.08 * width;
  const tooth = Math.max(3, Math.round(width / 9));
  trunk(art, Math.min(width, Math.max(3, width * 0.5)), Math.round(crown - tall * 0.5), height);
  for (let index = count - 1; index >= 0; index--) {
    const top = index === 0 ? 0 : tall * (index - 0.2);
    const bottom = tall * (index + 1) + (index < count - 1 ? tall * 0.3 : 0);
    const half = (width / 2) * (0.2 + (0.8 * (index + 1)) / count);
    const peak = index === 0 ? 0.03 : 0.3;
    // Twice: first the tier's shade on what is already below it, then the tier.
    for (const pass of ["shade", "tier"] as const) {
      const drop = pass === "shade" ? Math.max(1, Math.round(tall * 0.14)) : 0;
      for (let y = Math.floor(top); y < bottom; y++) {
        const along = Math.max((y - top) / (bottom - top), 0);
        const reach = half * (peak + (1 - peak) * along ** 0.85);
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - width / 2 - lean * (1 - y / crown);
          if (Math.abs(dx) > reach) continue;
          if (boughs) {
            // Tips hang lower than the gaps between them.
            const phase = ((((x + index * 2) % tooth) + tooth) % tooth) / tooth;
            if (y >= bottom - tall * 0.22 * Math.abs(2 * phase - 1) - 0.5) continue;
          }
          if (pass === "shade") {
            if (isLeaf(art, x, y + drop)) put(art, x, y + drop, INK.deep);
            continue;
          }
          const across = dx / half;
          let level = across < -0.3 ? 3 : across > 0.32 ? 1 : 2;
          if (along > 0.82) level -= 1;
          else if (across < -0.5 && along < 0.55) level += 1;
          if (boughs) {
            const needle = cellHash(x, y, salt);
            if (needle < 0.09) level += 1;
            else if (needle > 0.9) level -= 1;
          }
          put(art, x, y, toneOf(level));
        }
      }
    }
  }
}

/** A conifer whose trunk shows between whorls of drooping boughs hung with needles. */
function whorls(art: PlantArt, width: number, height: number, random: Random): void {
  const cx = Math.floor(width / 2);
  const thick = width >= 40 ? 3 : width >= 14 ? 2 : 1;
  limb(art, cx + 0.5, height - 1, cx + 0.5, Math.round(height * 0.1), thick);
  const step = Math.max(3, Math.round(height / 9));
  const rows = Math.max(1, Math.round(step * 0.5));
  const last = height * 0.86;
  // The leader, then whorls that widen down the tree.
  for (let y = 0; y < step; y++) {
    put(art, cx, y, y === 0 ? INK.light : INK.mid);
    if (y > step / 2 && width >= 14) {
      put(art, cx - 1, y, INK.light);
      put(art, cx + 1, y, INK.dark);
    }
  }
  for (let y = step; y < last; y += step) {
    const reach = Math.max(
      2,
      (width / 2 - 1) * (0.16 + (0.84 * y) / last) * (0.86 + 0.28 * random()),
    );
    for (const side of [-1, 1]) {
      for (let k = 0; k <= reach; k++) {
        const along = k / reach;
        // A bough sags in its middle, lifts a little at its tip, and thins toward it.
        const sag = Math.round(Math.sin(along * Math.PI) * step * 0.22 + along * step * 0.3);
        const x = cx + side * k + (side > 0 ? thick - 1 : 0);
        const deep = Math.max(1, Math.round(rows * (1 - 0.55 * along)));
        for (let row = 0; row < deep; row++) {
          const tone = (side < 0 ? 3 : 2) - (row === 0 ? 0 : row === deep - 1 ? 2 : 1);
          put(art, x, y + sag + row, toneOf(along > 0.85 && row === 0 ? tone + 1 : tone));
        }
        // Needles hang under it, every other pixel.
        if ((k & 1) === 0) put(art, x, y + sag + deep, toneOf(side < 0 ? 1 : 0));
      }
    }
  }
}

function coniferIn(style: TreeStyle, size: Size, random: Random, salt: number): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  if (style === "limbs") whorls(art, width, height, random);
  else tiers(art, width, height, random, salt, style === "bundles");
  trim(art, height);
  outline(art);
  art.shadow = shadowOf(width, 0.36);
  return art;
}

function bushIn(
  style: TreeStyle,
  size: Size,
  random: Random,
  salt: number,
  fruit: boolean,
): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  if (style === "bundles") {
    bundles(
      art,
      width / 2,
      height * 0.56,
      width / 2,
      height * 0.44,
      Math.max(1.8, height * 0.27),
      random,
      salt,
    );
  } else if (style === "dome") {
    dome(art, width / 2, height * 0.62, width / 2, height * 0.6, random, salt, height);
  } else {
    // Stems fan out from the foot, a clump on each.
    const stems = Math.max(3, Math.round(width / 9));
    const r = Math.max(1.8, height * 0.3);
    const ends: Clump[] = [];
    for (let k = 0; k < stems; k++) {
      const angle = ((k + 0.5) / stems - 0.5) * 2.2 + (random() - 0.5) * 0.2;
      const length = height * (0.5 + 0.22 * random());
      const x = Math.min(Math.max(width / 2 + Math.sin(angle) * length * 1.25, r), width - r);
      const y = Math.max(height - Math.cos(angle) * length - r * 0.4, r);
      limb(art, width / 2, height - 1, x, y, 1);
      ends.push({
        x,
        y,
        r: r * (0.85 + 0.3 * random()),
        facing: ((x - width / 2) / (width / 2)) * LIGHT_X + (y / height - 0.5) * 2 * LIGHT_Y,
      });
    }
    heap(art, ends, salt);
  }
  if (fruit) berries(art, width, height, random);
  trim(art, height);
  outline(art);
  art.shadow = shadowOf(width, 0.46);
  return art;
}

/** What grows and lies among the trees and the grass in the closest view. */
export const SMALL_KINDS = [
  "daisy",
  "bell",
  "spike",
  "umbel",
  "fern",
  "herb",
  "mushroom",
  "reed",
  "stone",
  "boulder",
  "log",
  "stump",
] as const;
export type Small = (typeof SMALL_KINDS)[number];
/** Their sizes at eight art pixels per cell; closer views multiply them. */
export const SMALL_SIZES: Readonly<Record<Small, Size>> = {
  daisy: [1.5, 2.25],
  bell: [1.5, 2.75],
  spike: [1.75, 3.75],
  umbel: [2.25, 3.25],
  fern: [4.5, 3],
  herb: [3, 2],
  mushroom: [1.5, 1.5],
  reed: [2, 4.5],
  stone: [2.5, 1.5],
  boulder: [5, 3.25],
  log: [6, 2],
  stump: [2.5, 2],
};
/** Petals come white, yellow, pink, violet and red; a mushroom's cap red, brown or ochre. */
export const FLOWER_COLOURS = ["#f4f1e4", "#f2d24b", "#e58fb1", "#9a7fd6", "#d9584a"] as const;
export const CAP_COLOURS = ["#c8473c", "#8a5a3a", "#d9a441"] as const;
export const MOSS_COLOUR = "#7fa24a";

/** Turn the rim of everything drawn into an outline: for what is not foliage. */
function outlineAll(art: PlantArt): void {
  const rim: number[] = [];
  const filled = (x: number, y: number): boolean =>
    x >= 0 &&
    y >= 0 &&
    x < art.width &&
    y < art.height &&
    (art.ink[y * art.width + x] ?? 0) > INK.shadow;
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      if (filled(x, y)) continue;
      if (filled(x - 1, y) || filled(x + 1, y) || filled(x, y - 1) || filled(x, y + 1))
        rim.push(y * art.width + x);
    }
  }
  for (const at of rim) art.ink[at] = INK.outline;
}

/** A stem from the foot up to row `top`, bending a pixel on the way if it is long. */
function stalk(art: PlantArt, x: number, top: number, height: number, bend: number): void {
  for (let y = top; y < height; y++) {
    const off = height - top >= 8 && y < top + (height - top) / 2 ? bend : 0;
    put(art, x + off, y, y === height - 1 ? INK.deep : INK.dark);
  }
}

function flower(
  kind: "daisy" | "bell" | "spike" | "umbel",
  art: PlantArt,
  width: number,
  height: number,
  random: Random,
): void {
  const stem = Math.floor(width / 2);
  const bend = random() < 0.5 ? -1 : 1;
  const head = Math.max(1, Math.round(width / 5));
  if (kind === "daisy") {
    stalk(art, stem, head, height, 0);
    put(art, stem + bend, Math.round(height * 0.66), INK.mid);
    if (height >= 8) put(art, stem - bend, Math.round(height * 0.8), INK.light);
    for (let dy = -head; dy <= head; dy++) {
      for (let dx = -head; dx <= head; dx++) {
        const far = Math.hypot(dx, dy);
        if (far > head + 0.3 || (head === 1 && dx !== 0 && dy !== 0)) continue;
        // Petals round a middle; on a larger head every other one is in shade.
        const petal = far > 0.5;
        put(
          art,
          stem + dx,
          head + dy,
          !petal ? INK.core : head > 1 && (dx + dy) % 2 !== 0 ? INK.accentDark : INK.accent,
        );
      }
    }
  } else if (kind === "bell") {
    const cup = 2 * head + 1;
    stalk(art, stem, cup, height, 0);
    // Two long leaves rise from the foot.
    for (let k = 1; k <= Math.round(height * 0.45); k++) {
      put(art, stem - Math.ceil(k / 2), height - 1 - k, INK.mid);
      put(art, stem + Math.ceil(k / 2), height - 1 - k, k > 2 ? INK.light : INK.mid);
    }
    for (let y = 0; y < cup; y++) {
      for (let dx = -head; dx <= head; dx++) {
        if (y === 0 && dx % 2 === 0 && head > 0 && dx !== 0) continue;
        if (y === cup - 1 && Math.abs(dx) === head) continue;
        put(art, stem + dx, y, dx > 0 || y === cup - 1 ? INK.accentDark : INK.accent);
      }
    }
    put(art, stem, 0, INK.accent);
  } else if (kind === "spike") {
    stalk(art, stem, 1, height, 0);
    const florets = Math.round(height * 0.6);
    for (let y = 0; y < florets; y++) {
      const wide = y < 2 ? 0 : y < florets * 0.5 ? 1 : Math.min(2, head + 1);
      for (let dx = -wide; dx <= wide; dx++) {
        if ((dx + y) % 2 !== 0 && wide > 0) continue;
        put(art, stem + dx, y, dx > 0 ? INK.accentDark : INK.accent);
      }
    }
    // A fan of leaves at the foot.
    for (let k = 1; k <= Math.max(2, Math.round(width / 2)); k++) {
      put(art, stem - k, height - 1 - k, INK.mid);
      put(art, stem + k, height - 1 - k, INK.light);
      put(art, stem - k, height - 1, INK.dark);
      put(art, stem + k, height - 1, INK.dark);
    }
  } else {
    // Rays part from the stem and carry a flat head of many small flowers.
    const rays = Math.max(2, Math.round(width / 3));
    stalk(art, stem, rays + 1, height, bend);
    for (let k = 0; k <= rays; k++) {
      put(art, stem + bend - k, rays + 1 - k, INK.dark);
      put(art, stem + bend + k, rays + 1 - k, INK.dark);
    }
    for (let dx = -rays - 1; dx <= rays + 1; dx++) {
      if (random() < 0.82)
        put(
          art,
          stem + bend + dx,
          Math.abs(dx) > rays ? 1 : 0,
          dx > 0 ? INK.accentDark : INK.accent,
        );
      if (Math.abs(dx) <= rays && random() < 0.6) put(art, stem + bend + dx, 1, INK.accent);
    }
    put(art, stem + bend * 2, Math.round(height * 0.7), INK.mid);
  }
}

/** Fronds that arch out from the foot, each with leaflets on both sides. */
function fern(art: PlantArt, width: number, height: number, random: Random): void {
  const fronds = Math.max(4, Math.round(width / 3));
  for (let k = 0; k < fronds; k++) {
    const angle = ((k + 0.5) / fronds - 0.5) * 2.7 + (random() - 0.5) * 0.25;
    const length = Math.min(height * (0.75 + 0.4 * Math.abs(Math.sin(angle))), width * 0.55);
    const sag = length * 0.4 * Math.abs(Math.sin(angle));
    const back = k % 2 === 0;
    for (let step = 0; step <= length; step++) {
      const along = step / length;
      const x = width / 2 + Math.sin(angle) * length * along;
      const y = height - 1 - Math.cos(angle) * length * along + sag * along * along;
      put(art, x, y, along > 0.85 ? INK.light : back ? INK.dark : INK.mid);
      if (step > 1 && step % 2 === 0 && along < 0.9) {
        put(art, x, y - 1, back ? INK.mid : INK.light);
        put(art, x, y + 1, INK.dark);
      }
    }
  }
}

/** A rosette of broad leaves, flat on the ground. */
function herb(art: PlantArt, width: number, height: number, random: Random): void {
  const leaves = Math.max(4, Math.round(width / 2.5));
  for (let k = 0; k < leaves; k++) {
    const angle = ((k + 0.5) / leaves - 0.5) * 2.9 + (random() - 0.5) * 0.3;
    const length = width * (0.36 + 0.14 * random());
    for (let step = 0; step <= length; step++) {
      const along = step / length;
      const x = width / 2 + Math.sin(angle) * length * along;
      const y = height - 1 - Math.cos(angle) * length * along * 0.95;
      // A leaf is widest in its middle.
      const broad = along > 0.25 && along < 0.85 && length >= 3;
      put(art, x, y, along > 0.8 ? INK.light : INK.mid);
      if (broad) put(art, x, y + 1, INK.dark);
      if (broad && width >= 9) put(art, x, y - 1, INK.light);
    }
  }
  put(art, width / 2, height - 1, INK.deep);
}

function mushroom(
  art: PlantArt,
  width: number,
  height: number,
  random: Random,
  spotted: boolean,
): void {
  const cap = Math.max(2, Math.round(height * 0.55));
  const stem = Math.max(1, Math.round(width / 3));
  const left = Math.floor(width / 2 - stem / 2);
  for (let y = cap - 1; y < height; y++) {
    for (let i = 0; i < stem; i++)
      put(art, left + i, y, i === stem - 1 && stem > 1 ? INK.core : INK.pale);
  }
  for (let y = 0; y < cap; y++) {
    // Half an oval: narrow at the top, widest at its lower edge.
    const reach = (width / 2) * Math.sqrt(1 - ((cap - 1 - y) / cap) ** 2);
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - width / 2;
      if (Math.abs(dx) > Math.max(reach, 1)) continue;
      put(art, x, y, y === cap - 1 || dx > reach * 0.45 ? INK.accentDark : INK.accent);
    }
  }
  if (spotted) {
    // Pale spots on the lit side of the cap, always in the same places.
    for (const [across, down] of [
      [0.3, 0.5],
      [0.55, 0.1],
      [0.14, 0.75],
    ] as const) {
      const x = Math.round(width * across);
      const y = Math.round((cap - 2) * down);
      if (inkAt(art, x, y) === INK.accent) put(art, x, y, INK.pale);
    }
  }
}

/** Reeds: thin stems of several heights, some with a seed head, a blade bending off. */
function reed(art: PlantArt, width: number, height: number, random: Random): void {
  const stems = Math.max(3, Math.round(width / 2));
  for (let k = 0; k < stems; k++) {
    const x = Math.round(((k + 0.5) / stems) * (width - 1) + (random() - 0.5));
    const tall = Math.round(height * (0.55 + 0.45 * random()));
    const lean = (random() - 0.5) * 2.4;
    const headed = random() < 0.5;
    for (let step = 0; step < tall; step++) {
      const along = step / tall;
      const px = x + lean * along * along;
      const seed = headed && along > 0.72 && along < 0.96;
      put(
        art,
        px,
        height - 1 - step,
        seed ? INK.trunk : along > 0.9 ? INK.light : k % 2 === 0 ? INK.dark : INK.mid,
      );
      if (seed && width >= 6) put(art, px + 1, height - 1 - step, INK.trunkDark);
    }
  }
}

/** A stone or a boulder: lobes lit from the upper left; moss or lichen on some. */
function stone(art: PlantArt, width: number, height: number, random: Random, grown: boolean): void {
  const big = width >= 16;
  const r = height * (big ? 0.5 : 0.62);
  const lobes: Lobe[] = [
    { x: width * (0.34 + 0.08 * random()), y: height - r * 0.72, r, shade: 0.1 },
    { x: width * (0.64 + 0.08 * random()), y: height - r * 0.6, r: r * 0.9, shade: 0.25 },
  ];
  if (big) lobes.push({ x: width * (0.5 + 0.1 * random()), y: r * 0.95, r: r * 0.9, shade: 0 });
  foliage(art, lobes, height, 0);
  if (big) {
    // A crack or two down its face.
    for (let k = 0; k < 2; k++) {
      let x = Math.round(width * (0.3 + 0.4 * random()));
      for (let y = Math.round(height * 0.3); y < height * 0.8; y++) {
        if (isLeaf(art, x, y)) put(art, x, y, INK.deep);
        if (random() < 0.45) x += random() < 0.5 ? -1 : 1;
      }
    }
  }
  if (grown) {
    for (let k = 0; k < Math.max(2, Math.round(width / 2.5)); k++) {
      const x = Math.round(width * (0.12 + 0.7 * random()));
      const y = Math.round(height * (0.1 + 0.4 * random()));
      if (!isLeaf(art, x, y)) continue;
      put(art, x, y, INK.accent);
      if (isLeaf(art, x + 1, y)) put(art, x + 1, y, INK.accent);
      if (big && isLeaf(art, x, y + 1)) put(art, x, y + 1, INK.accentDark);
    }
  }
}

/** A fallen log, its cut end toward the left, moss along its top. */
function log(art: PlantArt, width: number, height: number, random: Random): void {
  const top = Math.max(1, Math.round(height * 0.2));
  const face = Math.max(2, Math.round((height - top) * 0.55));
  for (let y = top; y < height; y++) {
    const along = (y - top) / Math.max(height - top - 1, 1);
    for (let x = Math.round(face * 0.5); x < width; x++) {
      const bark = cellHash(Math.floor(x / 3), y, 51) < 0.22;
      put(
        art,
        x,
        y,
        along < 0.22 ? INK.trunkLight : along > 0.7 || bark ? INK.trunkDark : INK.trunk,
      );
    }
  }
  // The cut: an oval of pale wood with a ring in it.
  const cy = (top + height) / 2;
  for (let y = top; y < height; y++) {
    for (let x = 0; x < face; x++) {
      const far =
        ((x + 0.5 - face / 2) / (face / 2)) ** 2 + ((y + 0.5 - cy) / ((height - top) / 2)) ** 2;
      if (far <= 1) put(art, x, y, far < 0.3 ? INK.trunk : INK.pale);
    }
  }
  for (let x = Math.round(width * 0.3); x < width * 0.9; x++) {
    if (random() < 0.5) put(art, x, top, INK.accent);
    if (random() < 0.2) put(art, x, top - 1, INK.accent);
  }
}

/** What is left of a tree: a short trunk on its roots, cut flat. */
function stump(art: PlantArt, width: number, height: number): void {
  const thick = Math.max(2, Math.round(width * 0.6));
  const left = Math.floor(width / 2 - thick / 2);
  const top = Math.max(1, Math.round(height * 0.3));
  for (let y = top; y < height; y++) {
    const flare = y >= height - 2 ? 1 : 0;
    for (let i = -flare; i < thick + flare; i++) {
      put(
        art,
        left + i,
        y,
        i >= thick * 0.65 ? INK.trunkDark : i === 0 ? INK.trunkLight : INK.trunk,
      );
    }
  }
  for (let y = top - 1; y <= top + 1 && thick >= 3; y++) {
    for (let i = 0; i < thick; i++) {
      if (y !== top && (i === 0 || i === thick - 1)) continue;
      put(
        art,
        left + i,
        y,
        y === top && i > 0 && i < thick - 1 && i % 2 === 1 ? INK.trunk : INK.pale,
      );
    }
  }
}

/**
 * One of the small things of the closest view, `size` pixels wide and tall. `variant`
 * picks between a mushroom with and without spots, a stone bare and grown over.
 */
export function drawSmall(kind: Small, size: Size, random: Random, variant = 0): PlantArt {
  const width = Math.max(2, Math.round(size[0]));
  const height = Math.max(2, Math.round(size[1]));
  const art = blank(width, height);
  switch (kind) {
    case "daisy":
    case "bell":
    case "spike":
    case "umbel":
      flower(kind, art, width, height, random);
      break;
    case "fern":
      fern(art, width, height, random);
      break;
    case "herb":
      herb(art, width, height, random);
      break;
    case "mushroom":
      mushroom(art, width, height, random, variant % 2 === 0);
      outlineAll(art);
      break;
    case "reed":
      reed(art, width, height, random);
      break;
    case "stone":
    case "boulder":
      stone(art, width, height, random, variant % 2 === 1);
      outline(art);
      art.shadow = shadowOf(width, 0.5);
      break;
    case "log":
      log(art, width, height, random);
      outlineAll(art);
      art.shadow = shadowOf(width, 0.5);
      break;
    case "stump":
      stump(art, width, height);
      outlineAll(art);
      art.shadow = shadowOf(width, 0.5);
      break;
  }
  return art;
}

/** Build of each drawing of a tree or a bush: its width and height against the scale's. */
const BUILDS: readonly Size[] = [
  [1, 1],
  [0.84, 1.1],
  [1.16, 0.9],
];

/**
 * The plant of `form` and `stage`, in drawing number `variant`, at `detail` times the
 * scale, in `style`. In the styles after the first the drawings of a kind differ in
 * build as well: one as the scale has it, one slender and tall, one broad and low.
 */
export function drawStanding(
  form: Form,
  stage: Stage,
  variant: number,
  scale: PlantScale,
  detail = 1,
  style: TreeStyle = "first",
): PlantArt {
  const [wider, taller] = style === "first" ? [1, 1] : (BUILDS[variant % BUILDS.length] ?? [1, 1]);
  const sized = (size: Size): Size => [
    Math.round(size[0] * detail * wider),
    Math.round(size[1] * detail * taller),
  ];
  const age = stage === "mature" ? 0 : 1;
  const seed = FORM_SEEDS[form] * 97 + age * 13 + variant;
  const random = mulberry32(seed);
  if (form === "GRASS" || form === "LICHEN") {
    // Young grass is a shorter tuft of the same blades.
    const [width, height] = [
      Math.round(scale.tuft[0] * detail),
      Math.round(scale.tuft[1] * detail),
    ];
    return drawTuft(
      age === 0 ? [width, height] : [width, Math.max(2, Math.round(height * 0.6))],
      random,
    );
  }
  if (style === "first") {
    if (form === "BROADLEAF") return drawBroadleaf(sized(scale.broadleaf[age]), random);
    if (form === "CONIFER") return drawConifer(sized(scale.conifer[age]), random);
    return drawBush(sized(scale.bush[age]), random, variant === 1);
  }
  const salt = 60 + seed;
  if (form === "BROADLEAF") return broadleafIn(style, sized(scale.broadleaf[age]), random, salt);
  if (form === "CONIFER") return coniferIn(style, sized(scale.conifer[age]), random, salt);
  return bushIn(style, sized(scale.bush[age]), random, salt, variant === 1);
}

const FORM_SEEDS: Readonly<Record<Form, number>> = {
  LICHEN: 1,
  GRASS: 2,
  SHRUB: 3,
  BROADLEAF: 4,
  CONIFER: 5,
};

/**
 * Colour a drawing with a ramp, `accent` for berries, petals, caps and moss, and `wood`
 * for trunks. A shadow drawn into it is a flat, see-through dark.
 */
export function colourArt(art: PlantArt, ramp: Ramp, accent = "#b8443a", wood = TRUNK): Pixels {
  type Rgb = [number, number, number];
  const shadeOf = (colour: string, factor: number): Rgb => {
    const [r, g, b] = hexToRgb(colour);
    return [
      Math.min(255, Math.round(r * factor)),
      Math.min(255, Math.round(g * factor)),
      Math.min(255, Math.round(b * factor)),
    ];
  };
  const toward = (colour: string, other: Readonly<Rgb>, share: number): Rgb => {
    const from = hexToRgb(colour);
    return [0, 1, 2].map((i) =>
      Math.round((from[i] ?? 0) * (1 - share) + (other[i] ?? 0) * share),
    ) as Rgb;
  };
  const inks: Record<number, readonly [number, number, number, number]> = {
    [INK.shadow]: [0, 0, 0, 84],
    [INK.outline]: [...shadeOf(ramp[0], 0.62), 255],
    [INK.dark]: [...hexToRgb(ramp[0]), 255],
    [INK.mid]: [...hexToRgb(ramp[1]), 255],
    [INK.light]: [...hexToRgb(ramp[2]), 255],
    [INK.trunk]: [...hexToRgb(wood), 255],
    [INK.trunkDark]: [...shadeOf(wood, 0.72), 255],
    [INK.trunkLight]: [...shadeOf(wood, 1.3), 255],
    [INK.accent]: [...hexToRgb(accent), 255],
    // In shade a colour is cooler as well as darker; in the light, warmer.
    [INK.deep]: [...toward(ramp[0], DEEP, 0.34), 255],
    [INK.bright]: [...toward(ramp[2], BRIGHT, 0.34), 255],
    [INK.accentDark]: [...toward(accent, DEEP, 0.3), 255],
    [INK.core]: [...hexToRgb(CORE), 255],
    [INK.pale]: [...hexToRgb(PALE), 255],
  };
  const rgba = new Uint8ClampedArray(art.width * art.height * 4);
  art.ink.forEach((ink, at) => {
    const colour = inks[ink];
    if (colour !== undefined) rgba.set(colour, at * 4);
  });
  return { width: art.width, height: art.height, rgba };
}
