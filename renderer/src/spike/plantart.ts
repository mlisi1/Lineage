/**
 * Plants that stand on the painted ground, drawn by rule at whatever size is asked for:
 * trees, bushes and grass, and for the closest view what grows among them (flowers,
 * ferns, herbs, mushrooms, reeds) and what lies there (stones, logs, stumps, snags).
 *
 * A rule adapts to the size it is asked for, which is what lets one world be drawn from
 * far and from close with the same plants in the same places; what is kept can be
 * redrawn by hand later (R1). It also takes the plant's stage of growth and the season:
 *
 *   broadleaf  a crown of many small bundles of leaves on a trunk with bark, each bundle
 *              lit on its own and shading the ones behind it; in blossom in spring,
 *              turned in autumn, bare branches in winter
 *   conifer    tiers of drooping boughs, each shading the one below; light tips in
 *              spring; evergreen
 *   bush       a mound of bundles; in blossom in spring, in berry later, bare twigs in
 *              winter
 *   grass      a tuft of blades; short in spring, in seed in autumn, flat in winter
 *
 * The crown of bundles follows how pixel-art trees are usually built: one cluster of
 * leaves repeated and layered by the light (Slynyrd's Pixelblog 44). Two other rules
 * were tried and passed over (one rounded dome; limbs that fork with a clump per end):
 * see ADR 0007. No plant carries a shadow: the ground paints it, so that shadows do not
 * darken each other.
 */
import type { Ramp } from "./fixture";
import { cellHash, hexToRgb, type Form, type Pixels } from "./pixelart";
import { mulberry32, type Random } from "./rng";
import type { Growth, Season } from "./seasons";

/** What a pixel of a drawing is made of. */
export const INK = {
  none: 0,
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
  /** Snow lying on a plant, and the snow in its own shade. */
  snow: 15,
  snowShade: 16,
  /** The deepest furrow of bark. */
  trunkDeep: 17,
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
   * width and height in pixels. Left out by what is too small for one.
   */
  shadow?: { rx: number; ry: number };
}

/** Width and height of a drawing's plant, in art pixels. */
export type Size = readonly [number, number];

/**
 * How big plants are at eight art pixels per cell (closer views multiply it), full
 * grown and young, and how many cells of a wood and of scrub carry a plant of their
 * own. Chosen as the largest of three sizes (P3).
 */
export const PLANT_SCALE = {
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
} as const satisfies {
  broadleaf: readonly [Size, Size];
  conifer: readonly [Size, Size];
  bush: readonly [Size, Size];
  tuft: Size;
  treeDensity: number;
  bushDensity: number;
};
/** A sprout against a full-grown plant: a tree's sapling, a bush's first shoots. */
const SPROUT = { tree: 0.42, bush: 0.46 };
/** An old tree is as tall as a grown one, broader and stouter; an old bush a little larger. */
const OLD: Readonly<Record<"tree" | "bush", Size>> = { tree: [1.12, 1], bush: [1.1, 1.06] };
/** Drawings of each kind and age, so that neighbours differ. */
export const STANDING_VARIANTS = 3;
const TRUNK = "#5a4632";
/** What the darkest and the lightest tone of foliage are mixed with. */
const DEEP: readonly [number, number, number] = [18, 30, 56];
const BRIGHT: readonly [number, number, number] = [246, 240, 150];
/** The middle of a flower, and pale wood or a mushroom's stem. */
const CORE = "#e0b83a";
const PALE = "#e9dfc6";
const SNOW: readonly [number, number, number] = [244, 248, 252];
const SNOW_SHADE: readonly [number, number, number] = [196, 212, 232];
/** Clear pixels kept around a plant for its outline. */
const MARGIN = 2;
/** Where the light comes from: up and to the left. */
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;
/** From this many pixels wide a plant is drawn rich: bark, a thicker trunk. */
const RICH_FROM = 24;

interface Lobe {
  x: number;
  y: number;
  r: number;
  /** How much darker than its own shading: positive away from the light. */
  shade: number;
}

/** A blank drawing with room for a plant `width` × `height` and its outline. */
function blank(width: number, height: number): PlantArt {
  const wide = width + 2 * MARGIN;
  const tall = height + 2 * MARGIN;
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
        return ink === INK.none;
      };
      if (open(-1, 0) || open(1, 0) || open(0, -1) || open(0, 1)) rim.push(at);
    }
  }
  for (const at of rim) art.ink[at] = INK.outline;
}

/** How thick the trunk of a plant `width` wide is, in pixels. */
function girth(width: number, stout: boolean): number {
  const thick =
    width >= RICH_FROM
      ? Math.max(3, Math.round(width * 0.13))
      : width >= 15
        ? 3
        : width >= 8
          ? 2
          : 1;
  return stout ? thick + Math.max(1, Math.round(thick * 0.3)) : thick;
}

/**
 * A trunk from `from` down to the foot, standing at `centre` (the middle of `width`
 * unless told otherwise), as thick as suits a plant `width` wide: lit on the left, in
 * shade on the right, flared into roots if thick. From four pixels thick it has bark:
 * `furrowed` in strokes that run down it, each column on its own rhythm, with a knot on
 * the stoutest; or `scaly`, in short plates staggered from one column to the next.
 */
function trunk(
  art: PlantArt,
  width: number,
  from: number,
  height: number,
  centre = width / 2,
  bark: "furrowed" | "scaly" = "furrowed",
  stout = false,
): void {
  const thick = girth(width, stout);
  const left = Math.floor(centre - thick / 2);
  const shaded = Math.max(1, Math.round(thick * 0.35));
  for (let y = from; y < height; y++) {
    // Roots: the last rows are a pixel or two wider on each side.
    const flare = thick >= 4 ? Math.max(0, y - (height - 3)) : 0;
    for (let i = -flare; i < thick + flare; i++) {
      const dark = thick > 1 && i >= thick - shaded;
      const lit = thick >= 4 && i <= 0;
      let ink: Ink = dark ? INK.trunkDark : lit ? INK.trunkLight : INK.trunk;
      if (thick >= 4 && i >= 0 && i < thick) {
        if (bark === "furrowed") {
          // A stroke of shade three rows long in every stretch of five, or none.
          const offset = (i * 7) % 5;
          const stretch = Math.floor((y + offset) / 5);
          const within = (y + offset) % 5;
          const drawn = cellHash(left + i, stretch, 61);
          if (drawn < 0.5 && within < 3)
            ink = dark ? INK.trunkDeep : lit ? INK.trunk : INK.trunkDark;
          else if (dark && drawn > 0.8 && within < 2) ink = INK.trunk;
        } else if ((y + i * 2) % 4 === 0) {
          // The lower edge of a plate.
          ink = dark ? INK.trunkDeep : lit ? INK.trunk : INK.trunkDark;
        } else if (!dark && !lit && (y + i * 2) % 4 === 1 && cellHash(left + i, y, 62) < 0.4) {
          ink = INK.trunkLight;
        }
      }
      put(art, left + i, y, ink);
    }
  }
  // A knot, on a trunk with room for one: a dark ring round a lighter middle.
  if (thick >= 7 && bark === "furrowed" && height - from >= 14) {
    const x = left + 2 + Math.floor(cellHash(left, from, 63) * (thick - shaded - 3));
    const y = height - 6 - Math.floor(cellHash(left, from, 64) * Math.max(height * 0.12, 1));
    for (const [dx, dy] of [
      [0, -1],
      [-1, 0],
      [1, 0],
      [0, 1],
    ] as const)
      put(art, x + dx, y + dy, INK.trunkDark);
    put(art, x, y, INK.trunkLight);
  }
}

/** Shade a crown throws on its own trunk: wood just under leaves is a tone darker. */
function underCrown(art: PlantArt): void {
  const darker = new Map<number, Ink>([
    [INK.trunkLight, INK.trunk],
    [INK.trunk, INK.trunkDark],
  ]);
  const reach = art.width >= RICH_FROM ? 3 : 1;
  for (let y = art.height - 1; y >= 1; y--) {
    for (let x = 0; x < art.width; x++) {
      const at = y * art.width + x;
      const shadedTo = darker.get((art.ink[at] ?? 0) as Ink);
      if (shadedTo === undefined) continue;
      for (let up = 1; up <= reach && y - up >= 0; up++) {
        if (!LEAF.includes(art.ink[(y - up) * art.width + x] ?? 0)) continue;
        art.ink[at] = shadedTo;
        break;
      }
    }
  }
}

/** The tones of foliage, darkest first. */
const TONES: readonly Ink[] = [INK.deep, INK.dark, INK.mid, INK.light, INK.bright];
const toneOf = (level: number): Ink =>
  TONES[Math.min(Math.max(Math.round(level), 0), 4)] ?? INK.mid;
const GOLDEN_ANGLE = 2.39996;
/** A clump shows its leaves from this radius; they move the line between tones this far. */
const LEAVES_FROM = 3.5;
/** A clump throws a line of shade on those behind it from this radius. */
const SHADE_LINE_FROM = 3;
const LEAF_RUFFLE = 0.34;
const isLeaf = (art: PlantArt, x: number, y: number): boolean =>
  LEAF.includes(inkAt(art, Math.round(x), Math.round(y)));

/**
 * A clump of leaves: a disc with a soft, slightly uneven rim, lit from the upper left.
 * Its leaves are small slanted dabs a couple of pixels long: they ruffle the line
 * between two tones and stand out lighter or darker here and there. `lift` shifts all
 * of its tones: +1 is a tone lighter.
 */
function clump(art: PlantArt, x: number, y: number, r: number, lift: number, salt: number): void {
  const phase = cellHash(Math.round(x * 7), Math.round(y * 7), salt) * Math.PI * 2;
  for (let py = Math.floor(y - r - 1); py <= Math.ceil(y + r + 1); py++) {
    for (let px = Math.floor(x - r - 1); px <= Math.ceil(x + r + 1); px++) {
      const dx = px + 0.5 - x;
      const dy = py + 0.5 - y;
      // Three gentle bulges: side by side, clumps make a bumpy crown, not a saw.
      const rim = r * (1 + 0.07 * Math.cos(3 * Math.atan2(dy, dx) + phase));
      if (dx * dx + dy * dy > rim * rim) continue;
      const leaf = r >= LEAVES_FROM ? cellHash((px + py) >> 1, (px - py) >> 2, salt) : 0.5;
      const lit = (dx * LIGHT_X + dy * LIGHT_Y) / r + (leaf - 0.5) * LEAF_RUFFLE;
      let level = 2 + lift + (lit > 0.4 ? 1 : lit < -0.4 ? -1 : 0);
      if (leaf < 0.07) level += 1;
      else if (leaf > 0.93) level -= 1;
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
    if (r < SHADE_LINE_FROM) {
      // Too small for a line of shade between clumps: it would be most of the plant.
      // Drawn a little lighter instead, so that a small plant stays clear of the ground.
      clump(art, x, y, r, facing * 0.6 + 0.35, salt);
      continue;
    }
    // A thin line of shade under it, no more: a crown is leaves, not scales.
    cast(art, x + r * 0.06, y + r * 0.14, r + 0.4);
    clump(art, x, y, r, facing * 0.85 + 0.2, salt);
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
  const count = Math.max(4, Math.round(((rx * ry) / (r * r)) * 1.9));
  const turn = random() * Math.PI * 2;
  const clumps: Clump[] = [];
  for (let k = 0; k < count; k++) {
    const far = Math.sqrt((k + 0.5) / count);
    const angle = turn + k * GOLDEN_ANGLE;
    const x = cx + Math.cos(angle) * far * Math.max(rx - r * 1.15, 0) + (random() - 0.5) * r * 0.4;
    const y = cy + Math.sin(angle) * far * Math.max(ry - r * 1.15, 0) + (random() - 0.5) * r * 0.4;
    clumps.push({
      x,
      y,
      r: r * (0.82 + 0.34 * random()),
      facing: ((x - cx) / rx) * LIGHT_X + ((y - cy) / ry) * LIGHT_Y,
    });
  }
  heap(art, clumps, salt);
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

/** Move a drawing down until its lowest pixel is on the line it stands on. */
function settle(art: PlantArt, height: number): void {
  const foot = height + MARGIN - 1;
  let lowest = -1;
  for (let at = art.ink.length - 1; at >= 0 && lowest < 0; at--) {
    if (art.ink[at] !== INK.none) lowest = Math.floor(at / art.width);
  }
  const down = foot - lowest;
  if (lowest < 0 || down <= 0) return;
  art.ink.copyWithin(down * art.width, 0, (art.height - down) * art.width);
  art.ink.fill(INK.none, 0, down * art.width);
}

/** Where the plant's shadow falls: an ellipse under its foot. */
const shadowOf = (width: number, reach: number): PlantArt["shadow"] => ({
  rx: Math.max(width * reach, 2),
  ry: Math.max(width * reach * 0.34, 1.5),
});

/**
 * A mound of clumps, for a bush: rows of them from the ground up, each row narrower
 * than the one below along the line of a dome, the clumps a little smaller toward the
 * top.
 */
function mound(
  art: PlantArt,
  width: number,
  height: number,
  r: number,
  random: Random,
  salt: number,
): void {
  const rows = Math.max(2, Math.round((height - 1.6 * r) / (r * 0.95)) + 1);
  const clumps: Clump[] = [];
  for (let row = 0; row < rows; row++) {
    const up = row / (rows - 1);
    const y = height - r * 0.9 - up * (height - 1.9 * r);
    // Widest a little above the ground, where the lowest branches spread.
    const tucked = 0.86 + 0.14 * Math.min(up / 0.3, 1);
    const half = Math.max(width / 2 - r, 0) * Math.sqrt(1 - 0.85 * up * up) * tucked;
    const across = Math.max(1, Math.round((2 * half) / (r * 1.1)) + 1);
    for (let k = 0; k < across; k++) {
      const x =
        width / 2 +
        (across === 1 ? 0 : (k / (across - 1) - 0.5) * 2 * half) +
        (random() - 0.5) * r * 0.3;
      const cy = y + (random() - 0.5) * r * 0.25;
      clumps.push({
        x,
        y: cy,
        r: r * (0.92 + 0.22 * random()) * (1 - 0.1 * up),
        facing:
          ((x - width / 2) / (width / 2)) * LIGHT_X + ((cy - height / 2) / (height / 2)) * LIGHT_Y,
      });
    }
  }
  heap(art, clumps, salt);
}

/** Blossom: small flowers of the accent over the lit side of the leaves, a few in shade. */
function blossom(art: PlantArt, width: number, height: number, random: Random): void {
  const big = width >= RICH_FROM;
  for (let k = 0; k < Math.max(4, Math.round((width * height) / (big ? 55 : 16))); k++) {
    const x = Math.round(width * (0.06 + 0.88 * random()));
    const y = Math.round(height * (0.04 + 0.9 * random()));
    if (!isLeaf(art, x, y) || !isLeaf(art, x + 1, y + 1) || !isLeaf(art, x - 1, y - 1)) continue;
    const shaded = inkAt(art, x, y) === INK.deep || inkAt(art, x, y) === INK.dark;
    put(art, x, y, shaded ? INK.accentDark : INK.accent);
    if (!big) continue;
    put(art, x + 1, y, INK.accent);
    put(art, x, y + 1, INK.accentDark);
  }
}

/**
 * Bare branches: from `forkX`, `forkY` limbs part and fork again, each fork thinner,
 * down to twigs a pixel wide, kept inside the drawing above row `floor`. The first
 * limbs are under half as thick as the trunk (`thick`) and `reach` long.
 */
function branches(
  art: PlantArt,
  width: number,
  forkX: number,
  forkY: number,
  floor: number,
  reach: number,
  thick: number,
  forks: number,
  random: Random,
): void {
  const grow = (
    x: number,
    y: number,
    angle: number,
    length: number,
    left: number,
    size: number,
  ): void => {
    const ex = Math.min(Math.max(x + Math.sin(angle) * length, 1), width - 2);
    const ey = Math.min(Math.max(y - Math.cos(angle) * length, 1), floor);
    limb(art, x, y, ex, ey, size);
    if (left === 0) {
      // A twig or two at the very end.
      for (const side of [-1, 1]) {
        if (random() < 0.3) continue;
        const twig = angle + side * (0.5 + 0.4 * random());
        limb(
          art,
          ex,
          ey,
          Math.min(Math.max(ex + Math.sin(twig) * length * 0.5, 0), width - 1),
          Math.max(ey - Math.cos(twig) * length * 0.5, 0),
          1,
        );
      }
      return;
    }
    const arms = random() < 0.3 ? 3 : 2;
    for (let arm = 0; arm < arms; arm++) {
      const side = arms === 2 ? (arm === 0 ? -1 : 1) : arm - 1;
      grow(
        ex,
        ey,
        angle * 0.7 + side * (0.3 + 0.36 * random()),
        length * (0.62 + 0.16 * random()),
        left - 1,
        Math.max(1, size - 1),
      );
    }
  };
  const first = Math.max(1, Math.round(thick * 0.42));
  const arms = forks >= 3 ? 5 : 3;
  for (let arm = 0; arm < arms; arm++) {
    // A fan from the fork, the middle limb the leader: it stands and reaches highest.
    const angle = ((arm + 0.5) / arms - 0.5) * 2.0 + (random() - 0.5) * 0.2;
    const long = reach * (1.1 - 0.35 * Math.abs(Math.sin(angle))) * (0.9 + 0.2 * random());
    grow(forkX, forkY, angle, long, forks - 1, first);
  }
}

/** Snow lying on a drawing: the pixels under its upper outline, `deep` of them. */
function snowCap(art: PlantArt, deep: number): void {
  for (let x = 0; x < art.width; x++) {
    let y = 0;
    while (y < art.height && art.ink[y * art.width + x] === INK.none) y++;
    // Under the outline where there is one, so that the plant keeps its edge.
    if (y < art.height && art.ink[y * art.width + x] === INK.outline) y++;
    for (let k = 0; k < deep && y + k < art.height; k++) {
      const at = (y + k) * art.width + x;
      const ink = art.ink[at] ?? INK.none;
      if (ink === INK.none || ink === INK.outline) break;
      art.ink[at] = k === deep - 1 && deep > 1 ? INK.snowShade : INK.snow;
    }
  }
}

/** A plant as drawn: what of it, how grown, which of its drawings, when. */
export interface Standing {
  form: Form;
  growth: Growth;
  variant: number;
  season: Season;
  /** Winter with snow lying on it. */
  snow: boolean;
}

function broadleaf(size: Size, random: Random, salt: number, look: Standing): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const bare = look.season === "winter";
  const old = look.growth === "old";
  if (look.growth === "sprout") {
    // A sapling: a stem, and a few leaves at its top, or two twigs when it is bare.
    const top = height * 0.42;
    limb(art, width / 2, height - 1, width / 2, top, width >= 14 ? 2 : 1);
    if (bare) {
      limb(art, width / 2, top + height * 0.12, width * 0.2, height * 0.18, 1);
      limb(art, width / 2, top, width * 0.78, height * 0.1, 1);
    } else {
      const r = Math.max(1.6, width * 0.24);
      heap(
        art,
        [
          { x: width * 0.3, y: height * 0.36, r, facing: 0.3 },
          { x: width * 0.7, y: height * 0.32, r: r * 0.95, facing: -0.3 },
          { x: width * 0.5, y: height * 0.2, r: r * 1.05, facing: 0.5 },
        ],
        salt,
      );
    }
  } else {
    const crown = height * 0.74;
    if (bare) {
      const forkY = height * 0.5;
      trunk(art, width, Math.round(forkY), height, width / 2, "furrowed", old);
      branches(
        art,
        width,
        width / 2,
        forkY,
        crown,
        height * 0.185,
        girth(width, old),
        width >= RICH_FROM ? 3 : 2,
        random,
      );
    } else {
      trunk(art, width, Math.round(crown * 0.6), height, width / 2, "furrowed", old);
      bundles(
        art,
        width / 2,
        crown / 2,
        width / 2,
        crown / 2,
        Math.max(2, width * 0.12),
        random,
        salt,
      );
      // One tree in three is a kind that flowers.
      if (look.season === "spring" && look.variant % 3 === 1) blossom(art, width, crown, random);
      underCrown(art);
    }
  }
  trim(art, height);
  outline(art);
  if (look.snow) snowCap(art, width >= RICH_FROM ? 2 : 1);
  if (look.growth !== "sprout") art.shadow = shadowOf(width, bare ? 0.2 : 0.42);
  return art;
}

/**
 * A conifer in tiers of drooping boughs, the lowest drawn first so that each hangs over
 * the one below and shades it. With `tips` the ends of the boughs are the light green
 * of new growth; with `snow` it lies on the shoulders of every tier.
 */
function tiers(
  art: PlantArt,
  width: number,
  height: number,
  random: Random,
  salt: number,
  tips: boolean,
  snow: boolean,
): void {
  const stem = Math.max(2, Math.round(height * 0.1));
  const crown = height - stem;
  const count = Math.min(Math.max(Math.round(height / 11), 2), 9);
  const tall = crown / count;
  const lean = (random() - 0.5) * 0.08 * width;
  const tooth = Math.max(3, Math.round(width / 9));
  // Thinner than a broadleaf's, under the middle of the crown.
  trunk(
    art,
    Math.min(width, Math.max(3, width * 0.5)),
    Math.round(crown - tall * 0.5),
    height,
    width / 2,
    "scaly",
  );
  for (let index = count - 1; index >= 0; index--) {
    const top = index === 0 ? 0 : tall * (index - 0.2);
    const bottom = tall * (index + 1) + (index < count - 1 ? tall * 0.3 : 0);
    const half = (width / 2) * (0.2 + (0.8 * (index + 1)) / count);
    const peak = index === 0 ? 0.03 : 0.3;
    // The tips of one tier do not hang under those of the next.
    const shift = Math.floor(cellHash(index, 1, salt) * tooth);
    // Twice: first the tier's shade on what is already below it, then the tier.
    for (const pass of ["shade", "tier"] as const) {
      const drop = pass === "shade" ? Math.max(1, Math.round(tall * 0.14)) : 0;
      for (let y = Math.floor(top); y < bottom; y++) {
        const along = Math.max((y - top) / (bottom - top), 0);
        const reach = half * (peak + (1 - peak) * along ** 0.85);
        for (let x = 0; x < width; x++) {
          const dx = x + 0.5 - width / 2 - lean * (1 - y / crown);
          if (Math.abs(dx) > reach) continue;
          // Tips hang lower than the gaps between them, some longer than others.
          const tip = Math.floor((x + shift) / tooth);
          const phase = ((((x + shift) % tooth) + tooth) % tooth) / tooth;
          const hang = tall * 0.24 * (0.65 + 0.7 * cellHash(tip, index, salt));
          const hem = bottom - hang * Math.abs(2 * phase - 1) - 0.5;
          if (y >= hem) continue;
          if (pass === "shade") {
            if (isLeaf(art, x, y + drop)) put(art, x, y + drop, INK.deep);
            continue;
          }
          // A tier is lit on its upper left and in shade under its right hem. Needles
          // hang: two rows share one draw, which ruffles the line between two tones.
          const needle = cellHash(x, y >> 1, salt);
          const lit = -(dx / half) * 0.75 - (along - 0.45) * 0.9 + (needle - 0.5) * 0.5;
          let level = lit > 0.6 ? 4 : lit > 0.2 ? 3 : lit > -0.3 ? 2 : lit > -0.75 ? 1 : 0;
          if (along > 0.86) level = Math.min(level, 1);
          // New growth at the ends of the boughs: the last pixels above the hem.
          if (tips && y >= hem - Math.max(1.5, tall * 0.14)) level = dx < 0 ? 4 : 3;
          const snowed = snow && along < 0.34 && needle < 0.86;
          put(art, x, y, snowed ? (along > 0.24 ? INK.snowShade : INK.snow) : toneOf(level));
        }
      }
    }
  }
}

function conifer(size: Size, random: Random, salt: number, look: Standing): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  tiers(art, width, height, random, salt, look.season === "spring", look.snow);
  trim(art, height);
  outline(art);
  if (look.growth !== "sprout") art.shadow = shadowOf(width, 0.36);
  return art;
}

function bush(size: Size, random: Random, salt: number, look: Standing): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  const sprout = look.growth === "sprout";
  if (look.season === "winter") {
    // Bare: stems that fan out from the foot and fork into twigs.
    const stems = sprout ? 3 : Math.max(4, Math.round(width / 8));
    for (let k = 0; k < stems; k++) {
      const angle = ((k + 0.5) / stems - 0.5) * 2.1 + (random() - 0.5) * 0.2;
      const length = height * (0.5 + 0.3 * random());
      const x = Math.min(Math.max(width / 2 + Math.sin(angle) * length * 1.2, 1), width - 2);
      const y = Math.max(height - 1 - Math.cos(angle) * length, 1);
      limb(art, width / 2 + Math.sin(angle) * 1.5, height - 1, x, y, 1);
      if (sprout) continue;
      for (const side of [-1, 1]) {
        const twig = angle + side * (0.5 + 0.3 * random());
        limb(
          art,
          x,
          y,
          Math.min(Math.max(x + Math.sin(twig) * length * 0.4, 0), width - 1),
          Math.max(y - Math.cos(twig) * length * 0.4, 0),
          1,
        );
      }
    }
    // A berry or two the birds have left.
    if (!sprout && look.variant % 3 === 1) {
      for (let k = 0; k < 4; k++) {
        const x = Math.round(width * (0.15 + 0.7 * random()));
        const y = Math.round(height * (0.1 + 0.5 * random()));
        if (inkAt(art, x, y) !== INK.none || inkAt(art, x, y + 1) === INK.none) continue;
        put(art, x, y, INK.accent);
      }
    }
  } else {
    mound(art, width, height, Math.max(1.6, height * (sprout ? 0.3 : 0.24)), random, salt);
    // Clumps do not always reach the ground: a bush sits on it all the same.
    settle(art, height);
    if (sprout) {
      // Too young to flower or fruit.
    } else if (look.season === "spring") {
      if (look.variant % 3 !== 2) blossom(art, width, height, random);
    } else if (look.variant % 3 === 1 || (look.season === "autumn" && look.variant % 3 === 0)) {
      berries(art, width, height, random);
    }
  }
  trim(art, height);
  outline(art);
  if (look.snow) snowCap(art, width >= RICH_FROM ? 2 : 1);
  if (!sprout) art.shadow = shadowOf(width, look.season === "winter" ? 0.3 : 0.46);
  return art;
}

/**
 * A tuft of grass, `size` pixels wide and tall: blades that fan out from the foot and
 * bend as they rise. In seed, its tallest blades end in a head of the accent; flat, it
 * has been pressed down by winter.
 */
export function drawTuft(size: Size, random: Random, seeding = false, flat = false): PlantArt {
  const [width, height] = size;
  const art = blank(width, height);
  if (width < 12) {
    for (let x = 0; x < width; x++) {
      if (random() > 0.78) continue;
      const blade = 1 + Math.floor(random() * height);
      const tone = random() < 0.3 ? INK.dark : INK.mid;
      for (let y = height - blade; y < height; y++) {
        const tip = y === height - blade && blade > 1;
        put(art, x, y, tip ? (seeding ? INK.accent : INK.light) : tone);
      }
    }
    return art;
  }
  const blades = Math.round(width * (flat ? 0.4 : 0.6));
  for (let k = 0; k < blades; k++) {
    const root = width * (0.3 + 0.4 * random());
    const tall = height * (0.45 + 0.55 * random());
    // Flat, a blade leans far over and rises little.
    const lean = (random() - 0.5) * width * (flat ? 1.6 : 0.8);
    const rise = flat ? 0.55 : 1;
    const tone = k < blades / 2 ? INK.dark : INK.mid;
    for (let t = 0; t < tall; t++) {
      const along = t / tall;
      const head = seeding && tall > height * 0.7 && along > 0.72;
      put(
        art,
        root + lean * along * (flat ? 1 : along),
        height - 1 - t * rise,
        head ? (along > 0.86 ? INK.accent : INK.accentDark) : along > 0.8 ? INK.light : tone,
      );
    }
  }
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
  "snag",
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
  snag: [5, 13],
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
    (art.ink[y * art.width + x] ?? 0) !== INK.none;
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
 * picks between a mushroom with and without spots, a stone bare and grown over. With
 * `snow` it lies on what stays out all winter: stones, wood.
 */
export function drawSmall(
  kind: Small,
  size: Size,
  random: Random,
  variant = 0,
  snow = false,
): PlantArt {
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
    case "snag": {
      // What a fire leaves of a tree: its trunk, thinner toward a broken top, and the
      // stubs of two or three limbs.
      const cx = width / 2;
      const thick = Math.max(2, Math.round(width * 0.22));
      limb(art, cx, height - 1, cx + (random() - 0.5) * 2, height * 0.45, thick);
      limb(
        art,
        cx,
        height * 0.45,
        cx + (random() - 0.5) * 2,
        height * 0.08,
        Math.max(1, thick - 1),
      );
      put(art, cx - 1, height * 0.08 - 1, INK.trunkDark);
      put(art, cx + 1, height * 0.08 - 2, INK.trunk);
      for (const [up, side, long] of [
        [0.5, -1, 0.42],
        [0.34, 1, 0.5],
        [0.2, -1, 0.26],
      ] as const) {
        const reach = width * long * (0.8 + 0.4 * random());
        const y = height * up;
        limb(art, cx, y, cx + side * reach, y - reach * 0.7, Math.max(1, thick - 2));
        limb(art, cx + side * reach * 0.6, y - reach * 0.42, cx + side * reach * 0.7, y - reach, 1);
      }
      // Roots, and bark that has cracked pale in places.
      put(art, cx - thick / 2 - 1, height - 1, INK.trunkDark);
      put(art, cx + thick / 2 + 1, height - 1, INK.trunkDark);
      for (let k = 0; k < Math.round(height / 6); k++) {
        const y = Math.round(height * (0.15 + 0.8 * random()));
        if (inkAt(art, Math.round(cx), y) !== INK.none) put(art, cx, y, INK.trunkLight);
      }
      art.shadow = shadowOf(width, 0.3);
      break;
    }
  }
  if (snow && art.shadow !== undefined) snowCap(art, width >= 16 ? 2 : 1);
  return art;
}

/** Build of each drawing of a tree or a bush: its width and height against the scale's. */
const BUILDS: readonly Size[] = [
  [1, 1],
  [0.84, 1.1],
  [1.16, 0.9],
];

const FORM_SEEDS: Readonly<Record<Form, number>> = {
  LICHEN: 1,
  GRASS: 2,
  SHRUB: 3,
  BROADLEAF: 4,
  CONIFER: 5,
};

/** A plain summer plant: what the other arguments of `drawStanding` change. */
export const SUMMER = { season: "summer", snow: false } as const;

/**
 * The plant of `form`, as far grown as `growth` says, in drawing number `variant`, at
 * `detail` times the scale, in `season` (with `snow` lying on it, in winter). The
 * drawings of a kind differ in build as well as in arrangement: one as the scale has
 * it, one slender and tall, one broad and low.
 */
export function drawStanding(
  form: Form,
  growth: Growth,
  variant: number,
  detail = 1,
  season: Season = "summer",
  snow = false,
): PlantArt {
  const look: Standing = { form, growth, variant, season, snow: snow && season === "winter" };
  const tree = form === "BROADLEAF" || form === "CONIFER";
  const [wider, taller] = BUILDS[variant % BUILDS.length] ?? [1, 1];
  const [alsoWider, alsoTaller] = growth === "old" ? OLD[tree ? "tree" : "bush"] : [1, 1];
  const young = growth === "young" || growth === "sprout" ? 1 : 0;
  const sprout = growth === "sprout" ? (tree ? SPROUT.tree : SPROUT.bush) / YOUNG_SHARE : 1;
  const sized = (sizes: readonly [Size, Size]): Size => [
    Math.max(2, Math.round((sizes[young] ?? sizes[0])[0] * detail * wider * alsoWider * sprout)),
    Math.max(2, Math.round((sizes[young] ?? sizes[0])[1] * detail * taller * alsoTaller * sprout)),
  ];
  const seed = FORM_SEEDS[form] * 97 + young * 13 + (growth === "sprout" ? 31 : 0) + variant;
  const random = mulberry32(seed);
  const salt = 60 + seed;
  if (form === "BROADLEAF") return broadleaf(sized(PLANT_SCALE.broadleaf), random, salt, look);
  if (form === "CONIFER") return conifer(sized(PLANT_SCALE.conifer), random, salt, look);
  if (form === "SHRUB") return bush(sized(PLANT_SCALE.bush), random, salt, look);
  // Grass: short while young and in spring, in seed in autumn, pressed flat in winter.
  const [width, height] = [PLANT_SCALE.tuft[0] * detail, PLANT_SCALE.tuft[1] * detail];
  const short = young === 1 || season === "spring" ? (growth === "sprout" ? 0.45 : 0.65) : 1;
  return drawTuft(
    [Math.round(width), Math.max(2, Math.round(height * short))],
    random,
    season === "autumn" && young === 0,
    look.season === "winter",
  );
}
/** A young plant against a full-grown one, as the scale's two sizes have it. */
const YOUNG_SHARE = PLANT_SCALE.broadleaf[1][1] / PLANT_SCALE.broadleaf[0][1];

/**
 * Colour a drawing with a ramp, `accent` for berries, petals, caps and moss, and `wood`
 * for trunks.
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
    [INK.outline]: [...shadeOf(ramp[0], 0.62), 255],
    [INK.dark]: [...hexToRgb(ramp[0]), 255],
    [INK.mid]: [...hexToRgb(ramp[1]), 255],
    [INK.light]: [...hexToRgb(ramp[2]), 255],
    [INK.trunk]: [...hexToRgb(wood), 255],
    [INK.trunkDark]: [...shadeOf(wood, 0.72), 255],
    [INK.trunkLight]: [...shadeOf(wood, 1.3), 255],
    [INK.trunkDeep]: [...shadeOf(wood, 0.52), 255],
    [INK.accent]: [...hexToRgb(accent), 255],
    // In shade a colour is cooler as well as darker; in the light, warmer.
    [INK.deep]: [...toward(ramp[0], DEEP, 0.34), 255],
    [INK.bright]: [...toward(ramp[2], BRIGHT, 0.34), 255],
    [INK.accentDark]: [...toward(accent, DEEP, 0.3), 255],
    [INK.core]: [...hexToRgb(CORE), 255],
    [INK.pale]: [...hexToRgb(PALE), 255],
    [INK.snow]: [...SNOW, 255],
    [INK.snowShade]: [...SNOW_SHADE, 255],
  };
  const rgba = new Uint8ClampedArray(art.width * art.height * 4);
  art.ink.forEach((ink, at) => {
    const colour = inks[ink];
    if (colour !== undefined) rgba.set(colour, at * 4);
  });
  return { width: art.width, height: art.height, rgba };
}
