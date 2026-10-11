/**
 * The ground, painted from the world's cells at any number of pixels per cell. The map
 * view and the local view are the same painter at two sizes, so they stay in proportion:
 * the close-up is the map with what lies between its cells worked out, not another
 * picture.
 *
 * Colour follows the report maps' rules (sea in bands of depth, relief as three tones by
 * slope toward the light, rock and snow on bare heights, an outline on the shore), from
 * the fixture's heights, cover and biomass. Styles differ in how a pixel reads the cells
 * around it:
 *
 *   squares   the cell it falls in: flat squares, as the report maps
 *   warped    the cell it falls in after a gentle warp: squares with wandering borders
 *   tiles     the nearest of the cells' centres, each nudged off its place: irregular tiles
 *   smooth    every value interpolated between the four nearest cells: contours
 *   blended   the same, with every transition dithered instead of cut
 */
import type { CellRect } from "./camera";
import type { Ramp, WorldFixture } from "./fixture";
import { VISIBLE_FROM, cellHash, hexToRgb, type Pixels } from "./pixelart";

export type GroundStyle = "squares" | "warped" | "tiles" | "smooth" | "blended";
export const GROUND_STYLES: readonly GroundStyle[] = [
  "squares",
  "warped",
  "tiles",
  "smooth",
  "blended",
];
/** Art pixels per cell in the local view and in the map view. */
export const LOCAL_TILE = 8;
export const MAP_TILE = 2;

export interface GroundOptions {
  /** Pixels per cell. */
  tile: number;
  style: GroundStyle;
  /** Whole cells to paint; the whole world when left out. */
  cells?: CellRect;
  /**
   * Grain: growth in patches that thin with biomass, blades, pebbles, waves and foam.
   * Without it (the map view) every pixel takes the flat colour of what covers it.
   */
  grain: boolean;
}

/** The forms that grow, in the order of their class numbers here (1 to 5); 0 is bare. */
const FORMS = ["LICHEN", "GRASS", "SHRUB", "BROADLEAF", "CONIFER"] as const;
const BURNT = FORMS.length + 1;
/** Forms that are the ground's own cover; the others are plants standing on a floor. */
const LOW = 2;
/** How growth of each class covers the soil: share at no and at full biomass. */
const COVERAGE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.3, 0.52],
  [0.42, 0.95],
  [0.42, 0.72],
  [0.5, 0.85],
  [0.5, 0.85],
  [0.9, 0.9],
];
/** warped: how far (cells) a border may wander, and how often it turns (per cell). */
const WARP = 0.3;
const WARP_FREQUENCY = 1.15;
/** tiles: how far (cells) a centre is nudged off its place. */
const NUDGE = 0.36;
/** smooth, blended: the same wander, finer, so contours are not ruled lines. */
const WOBBLE = 0.22;
const WOBBLE_FREQUENCY = 1.7;
/** Land less than this above the sea is beach. */
const BEACH = 0.006;
/** Growth thins out toward the edge of its kind: from this share of the weight to that. */
const EDGE_FROM = 0.3;
const EDGE_TO = 0.58;
/** blended: how far either side of a threshold the two sides are mixed. */
const MIX_CLASS = 0.7;
const MIX_SLOPE = 0.5;
const MIX_DEPTH = 0.3;
/** Size of the patches growth comes in, in pixels of the local view. */
const PATCH = 3.6;
const PEBBLES = 0.012;
const WAVES = 0.006;
const FOAM_NEAR = 0.85;
const FOAM_FAR = 0.3;
/** Ordered dither: thresholds of a 4×4 Bayer matrix. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((n) => (n + 0.5) / 16);

type Rgb = number; // 0xRRGGBB

const pack = (colour: string): Rgb => {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
};
const packRamp = (ramp: Ramp): readonly [Rgb, Rgb, Rgb] => [
  pack(ramp[0]),
  pack(ramp[1]),
  pack(ramp[2]),
];
const shade = (colour: Rgb, factor: number): Rgb => {
  const channel = (shift: number): number =>
    Math.min(255, Math.round(((colour >> shift) & 255) * factor)) << shift;
  return channel(16) | channel(8) | channel(0);
};
const mix = (from: Rgb, to: Rgb, t: number): Rgb => {
  const channel = (shift: number): number =>
    Math.round(((from >> shift) & 255) * (1 - t) + ((to >> shift) & 255) * t) << shift;
  return channel(16) | channel(8) | channel(0);
};
const smoothstep = (from: number, to: number, value: number): number => {
  const t = Math.min(Math.max((value - from) / (to - from), 0), 1);
  return t * t * (3 - 2 * t);
};

/** Smooth noise in [0, 1): hashed corners of the unit grid, blended. */
export function valueNoise(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = cellHash(x0, y0, salt) * (1 - sx) + cellHash(x0 + 1, y0, salt) * sx;
  const bottom = cellHash(x0, y0 + 1, salt) * (1 - sx) + cellHash(x0 + 1, y0 + 1, salt) * sx;
  return top * (1 - sy) + bottom * sy;
}

/** Paint the ground of `fixture`: `tile` pixels per cell over the cells asked for. */
export function paintGround(fixture: WorldFixture, options: GroundOptions): Pixels {
  const { width, height, heights, seaLevel, relief } = fixture;
  const { tile, style, grain } = options;
  const rect = options.cells ?? { x0: 0, y0: 0, x1: width, y1: height };
  const count = width * height;
  const waterClass = fixture.coverClasses.indexOf("WATER");

  // What each cell is: sea or land, what grows on it, how thickly, how it slopes.
  const sea = new Uint8Array(count);
  const kind = new Uint8Array(count);
  const biomass = new Float32Array(count);
  const slope = new Float32Array(count);
  const coastal = new Uint8Array(count);
  const seaAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && fixture.cover[y * width + x] === waterClass;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (x > 0 && y > 0) slope[cell] = (heights[cell] ?? 0) - (heights[cell - width - 1] ?? 0);
      if (seaAt(x, y)) {
        sea[cell] = 1;
        continue;
      }
      coastal[cell] =
        seaAt(x - 1, y) || seaAt(x + 1, y) || seaAt(x, y - 1) || seaAt(x, y + 1) ? 1 : 0;
      const name = fixture.coverClasses[fixture.cover[cell] ?? 0] ?? "";
      const grown = fixture.biomass[cell] ?? 0;
      biomass[cell] = grown / 255;
      const form = (FORMS as readonly string[]).indexOf(name);
      if (name === "BURNT") kind[cell] = BURNT;
      else if (form >= 0 && grown >= VISIBLE_FROM) kind[cell] = form + 1;
    }
  }

  const bare = packRamp(fixture.palette["BARE"] ?? ["#8f7f68", "#b3a188", "#cdbd9f"]);
  const rock = packRamp(relief.highRock);
  const snow = packRamp(relief.snow);
  const dry = packRamp(fixture.palette["DORMANT"] ?? ["#8f8448", "#b3a65c", "#cdc177"]);
  const burnt = packRamp(fixture.palette["BURNT"] ?? ["#3a302b", "#4f423a", "#66564b"]);
  const ramps = FORMS.map((form) => packRamp(fixture.palette[form] ?? ["", "", ""]));
  const dries = FORMS.map((form) => fixture.dormantClasses.includes(form));
  const dryBelow = fixture.dormantBelow / 255;
  const bands = relief.seaBands.map((band) => ({ limit: band.limit, colour: pack(band.colour) }));
  const outline = pack(relief.shoreOutline);
  const sand = bare[2];
  const foam = mix(bands[0]?.colour ?? 0x8ecbe6, 0xffffff, 0.6);

  // What a pixel is, filled in by one of the two ways of reading the cells.
  let land = false;
  let above = 0; // height over the sea
  let rise = 0; // height gained toward the light
  let first = 0; // what grows here
  let second = 0; // the runner-up, where two kinds meet
  let lead = 1; // 0 where they are level, 1 where `first` is alone
  let grown = 0;
  let share = 1; // how much of the weight here is `first`'s
  let beach = false;

  const clampX = (x: number): number => Math.min(Math.max(x, 0), width - 1);
  const clampY = (y: number): number => Math.min(Math.max(y, 0), height - 1);
  const fromCell = (x: number, y: number): void => {
    const cell = clampY(y) * width + clampX(x);
    land = sea[cell] === 0;
    above = (heights[cell] ?? 0) - seaLevel;
    rise = slope[cell] ?? 0;
    first = kind[cell] ?? 0;
    second = first;
    lead = 1;
    grown = biomass[cell] ?? 0;
    share = 1;
    beach = coastal[cell] === 1;
  };
  const heightAt = (u: number, v: number): number => {
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const row0 = clampY(y0) * width;
    const row1 = clampY(y0 + 1) * width;
    const top =
      (heights[row0 + clampX(x0)] ?? 0) * (1 - fx) + (heights[row0 + clampX(x0 + 1)] ?? 0) * fx;
    const bottom =
      (heights[row1 + clampX(x0)] ?? 0) * (1 - fx) + (heights[row1 + clampX(x0 + 1)] ?? 0) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  const weights = new Float32Array(BURNT + 1);
  const growth = new Float32Array(BURNT + 1);
  const between = (u: number, v: number): void => {
    const level = heightAt(u, v);
    above = level - seaLevel;
    land = above > 0;
    rise = level - heightAt(u - 1, v - 1);
    beach = above < BEACH;
    // What grows: each of the four cells around votes for its kind with its nearness.
    weights.fill(0);
    growth.fill(0);
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    let total = 0;
    for (let corner = 0; corner < 4; corner++) {
      const dx = corner & 1;
      const dy = corner >> 1;
      const cell = clampY(y0 + dy) * width + clampX(x0 + dx);
      if (sea[cell] === 1) continue;
      const weight = (dx === 1 ? fx : 1 - fx) * (dy === 1 ? fy : 1 - fy);
      const voted = kind[cell] ?? 0;
      weights[voted] = (weights[voted] ?? 0) + weight;
      growth[voted] = (growth[voted] ?? 0) + weight * (biomass[cell] ?? 0);
      total += weight;
    }
    first = 0;
    second = 0;
    let best = -1;
    let next = -1;
    for (let voted = 0; voted <= BURNT; voted++) {
      const weight = weights[voted] ?? 0;
      if (weight > best) {
        next = best;
        second = first;
        best = weight;
        first = voted;
      } else if (weight > next) {
        next = weight;
        second = voted;
      }
    }
    share = total > 0 ? best / total : 1;
    lead = total > 0 ? (best - Math.max(next, 0)) / total : 1;
    grown = best > 0 ? (growth[first] ?? 0) / best : 0;
  };

  const wide = (rect.x1 - rect.x0) * tile;
  const tall = (rect.y1 - rect.y0) * tile;
  const colours = new Uint32Array(wide * tall);
  const isLand = new Uint8Array(wide * tall);
  const interpolated = style === "smooth" || style === "blended";
  const dithered = style === "blended";
  // Grain is drawn at the local view's pixel size whatever the tile.
  const fine = LOCAL_TILE / tile;

  /** The colour of growth of class `grows` here, or -1 where the soil shows through. */
  const cover = (grows: number, step: number, px: number, py: number): Rgb | -1 => {
    if (grows === 0) return -1;
    const ramp =
      grows === BURNT
        ? burnt
        : (dries[grows - 1] ?? false) && grown < dryBelow
          ? dry
          : (ramps[grows - 1] ?? bare);
    // A plant standing on a floor: the floor is a tone darker, for it to stand out on.
    const floor = grows > LOW && grows !== BURNT;
    const tone = ramp[floor && grain ? Math.max(step - 1, 0) : step] ?? 0;
    if (!grain) return tone;
    const [thin, thick] = COVERAGE[grows] ?? [0, 0];
    const fade = interpolated ? smoothstep(EDGE_FROM, EDGE_TO, share) : 1;
    const covered = (thin + (thick - thin) * grown) * fade;
    if (valueNoise((px * fine) / PATCH, (py * fine) / PATCH, 5) >= covered) return -1;
    // Blades are two pixels tall: both rows of a pair share one draw.
    const blade = cellHash(px, py >> 1, 6);
    if (grows === BURNT) return blade < 0.08 ? shade(tone, 0.7) : tone;
    if (floor) return blade < 0.03 ? (ramp[step] ?? tone) : tone;
    const lit = grows === 2 ? 0.03 + 0.06 * grown : 0.02;
    if (blade < lit) return ramp[Math.min(step + 1, 2)] ?? tone;
    return grows === 2 && blade < lit + 0.04 ? (ramp[Math.max(step - 1, 0)] ?? tone) : tone;
  };

  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      // Position in cells, measured from the middle of the world's first cell.
      const worldX = rect.x0 * tile + px;
      const worldY = rect.y0 * tile + py;
      const u = (worldX + 0.5) / tile - 0.5;
      const v = (worldY + 0.5) / tile - 0.5;
      if (style === "squares") {
        fromCell(Math.round(u), Math.round(v));
      } else if (style === "warped") {
        const du = (valueNoise(u * WARP_FREQUENCY, v * WARP_FREQUENCY, 1) - 0.5) * 2 * WARP;
        const dv = (valueNoise(u * WARP_FREQUENCY, v * WARP_FREQUENCY, 2) - 0.5) * 2 * WARP;
        const jitter = 0.04 * (cellHash(worldX, worldY, 3) - 0.5);
        fromCell(Math.round(u + du + jitter), Math.round(v + dv - jitter));
      } else if (style === "tiles") {
        const cx = Math.round(u);
        const cy = Math.round(v);
        let nearest = Infinity;
        let bestX = cx;
        let bestY = cy;
        for (let y = cy - 1; y <= cy + 1; y++) {
          for (let x = cx - 1; x <= cx + 1; x++) {
            const sx = x + (cellHash(x, y, 14) - 0.5) * 2 * NUDGE;
            const sy = y + (cellHash(x, y, 15) - 0.5) * 2 * NUDGE;
            const distance = (u - sx) ** 2 + (v - sy) ** 2;
            if (distance < nearest) {
              nearest = distance;
              bestX = x;
              bestY = y;
            }
          }
        }
        fromCell(bestX, bestY);
      } else {
        const du = (valueNoise(u * WOBBLE_FREQUENCY, v * WOBBLE_FREQUENCY, 1) - 0.5) * 2 * WOBBLE;
        const dv = (valueNoise(u * WOBBLE_FREQUENCY, v * WOBBLE_FREQUENCY, 2) - 0.5) * 2 * WOBBLE;
        between(u + du, v + dv);
      }

      // Where two sides of a threshold meet, `dither` decides pixel by pixel.
      const dither = dithered ? (BAYER[(worldY & 3) * 4 + (worldX & 3)] ?? 0.5) * 2 - 1 : 0;
      if (!land) {
        const depth = -above * (1 + MIX_DEPTH * dither);
        const band = bands.find((candidate) => depth <= candidate.limit) ?? bands[bands.length - 1];
        const base = band?.colour ?? 0;
        colours[at] =
          grain && cellHash(worldX >> 1, worldY, 7) < WAVES ? mix(base, foam, 0.35) : base;
        continue;
      }
      isLand[at] = 1;
      const felt = rise + MIX_SLOPE * relief.slope * dither;
      const step = felt > relief.slope ? 2 : felt < -relief.slope ? 0 : 1;
      // Two kinds side by side: nearer the border, more pixels go to the other.
      const grows = dithered && dither + 1 < 1 - lead / MIX_CLASS ? second : first;
      const growthColour = cover(grows, step, worldX, worldY);
      if (growthColour !== -1) {
        colours[at] = growthColour;
        continue;
      }
      const soil = above >= relief.snowFrom ? snow : above >= relief.highRockFrom ? rock : bare;
      const sandy = interpolated ? above * (1 + 0.6 * dither) < BEACH : beach;
      const base = sandy ? sand : (soil[step] ?? 0);
      const grainHere = grain ? cellHash(worldX, worldY, 8) : 0.5;
      colours[at] =
        grainHere < PEBBLES
          ? shade(base, 0.86)
          : grainHere > 1 - PEBBLES / 2
            ? shade(base, 1.08)
            : base;
    }
  }

  // The shore: the map's outline on the last pixel of land, foam on the first of water.
  const landAt = (px: number, py: number): boolean =>
    px >= 0 && py >= 0 && px < wide && py < tall && isLand[py * wide + px] === 1;
  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      if (isLand[at] === 1) {
        const edge =
          (px > 0 && isLand[at - 1] === 0) ||
          (px < wide - 1 && isLand[at + 1] === 0) ||
          (py > 0 && isLand[at - wide] === 0) ||
          (py < tall - 1 && isLand[at + wide] === 0);
        if (edge) colours[at] = outline;
        continue;
      }
      if (!grain) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) near = landAt(px + dx, py + dy);
      }
      const far =
        !near &&
        (landAt(px - 2, py) || landAt(px + 2, py) || landAt(px, py - 2) || landAt(px, py + 2));
      const chance = near ? FOAM_NEAR : far ? FOAM_FAR : 0;
      if (chance > 0 && cellHash(rect.x0 * tile + px, rect.y0 * tile + py, 9) < chance) {
        colours[at] = foam;
      }
    }
  }

  const rgba = new Uint8ClampedArray(wide * tall * 4);
  for (let at = 0; at < colours.length; at++) {
    const colour = colours[at] ?? 0;
    rgba[at * 4] = colour >> 16;
    rgba[at * 4 + 1] = (colour >> 8) & 255;
    rgba[at * 4 + 2] = colour & 255;
    rgba[at * 4 + 3] = 255;
  }
  return { width: wide, height: tall, rgba };
}
