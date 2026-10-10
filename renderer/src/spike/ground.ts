/**
 * The ground of a close-up, painted at the plants' own pixel size: eight art pixels per
 * cell instead of one flat square per cell.
 *
 * Every pixel looks up its cell through a gentle warp, so borders between cells wander
 * instead of running straight. Low growth (grass, lichen, the floor of a wood) is
 * painted on the soil in patches whose density follows biomass; the shore gets the
 * map's dark outline, one pixel wide, and foam; plants that stand alone get a shadow.
 * Colours are those of the two map bitmaps and their ramps, nothing new but shade.
 */
import type { WorldFixture } from "./fixture";
import {
  cellHash,
  hexToRgb,
  plantLook,
  plantOffset,
  standsAlone,
  type Pixels,
  type PlantLook,
} from "./pixelart";

/** Art pixels per cell. */
export const TILE = 8;
/** The warp: how far (art pixels) a border may wander, and over what distance it turns. */
const WARP_PX = 2.4;
const WARP_WAVELENGTH = 7;
const WARP_JITTER_PX = 0.3;
/** Size of the patches low growth comes in, in art pixels. */
const PATCH_WAVELENGTH = 3.6;
/** Share of bare ground with a pebble or a lighter grain. */
const PEBBLES = 0.012;
const WAVES = 0.006;
/** Foam: share of water pixels touching land, and one pixel further out. */
const FOAM_NEAR = 0.85;
const FOAM_FAR = 0.3;
const SHADOW = 0.74;

type Rgb = number; // 0xRRGGBB

const pack = (colour: string): Rgb => {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
};
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

/** Smooth noise in [0, 1): hashed corners of the unit grid, blended. */
function valueNoise(x: number, y: number, salt: number): number {
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

/** How low growth of each form covers the soil: share at no and at full biomass. */
const COVERAGE: Readonly<Record<PlantLook["form"], readonly [number, number]>> = {
  LICHEN: [0.3, 0.52],
  GRASS: [0.42, 0.95],
  SHRUB: [0.42, 0.72],
  BROADLEAF: [0.5, 0.85],
  CONIFER: [0.5, 0.85],
};

/**
 * Paint the ground of `fixture`. `terrain` and `map` are the RGBA pixels of terrain.png
 * and map.png, one per cell. The result is TILE times as wide and as tall.
 */
export function paintGround(
  fixture: WorldFixture,
  terrain: Uint8ClampedArray,
  map: Uint8ClampedArray,
): Pixels {
  const { width, height } = fixture;
  const cells = width * height;
  const pixel = (source: Uint8ClampedArray, cell: number): Rgb =>
    ((source[cell * 4] ?? 0) << 16) |
    ((source[cell * 4 + 1] ?? 0) << 8) |
    (source[cell * 4 + 2] ?? 0);
  const waterClass = fixture.coverClasses.indexOf("WATER");
  const isWater = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && fixture.cover[y * width + x] === waterClass;
  const ramps = new Map<string, readonly Rgb[]>();
  for (const [name, ramp] of Object.entries(fixture.palette)) ramps.set(name, ramp.map(pack));
  const sand = ramps.get("BARE")?.[2] ?? 0xcdbd9f;
  const foam = mix(pack(fixture.sea[0] ?? "#8ecbe6"), 0xffffff, 0.6);

  // What each cell brings: its soil, what grows low on it and how thickly, and marks.
  const water = new Uint8Array(cells);
  const soil = new Uint32Array(cells);
  const growth = new Uint32Array(cells);
  const coverage = new Float32Array(cells);
  const light = new Uint32Array(cells);
  const lightShare = new Float32Array(cells);
  const dark = new Uint32Array(cells);
  const darkShare = new Float32Array(cells);
  const alone: { x: number; y: number; grown: boolean }[] = [];
  // The map's shore outline: the colour of a land cell of the ground bitmap on the coast.
  let outline = 0x3d3528;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = y * width + x;
      if (isWater(x, y)) {
        water[cell] = 1;
        soil[cell] = pixel(terrain, cell);
        continue;
      }
      const coastal =
        isWater(x - 1, y) || isWater(x + 1, y) || isWater(x, y - 1) || isWater(x, y + 1);
      if (coastal) outline = pixel(terrain, cell);
      soil[cell] = coastal ? sand : pixel(terrain, cell);
      const kind = fixture.coverClasses[fixture.cover[cell] ?? 0] ?? "";
      const biomass = fixture.biomass[cell] ?? 0;
      const tone = pixel(map, cell);
      if (kind === "BURNT") {
        growth[cell] = tone;
        coverage[cell] = 0.9;
        dark[cell] = shade(tone, 0.7);
        darkShare[cell] = 0.08;
        continue;
      }
      const look = plantLook(kind, biomass, x, y, fixture.dormantBelow, fixture.dormantClasses);
      if (look === null) continue;
      const ramp = ramps.get(look.dormant ? "DORMANT" : look.form) ?? [tone, tone, tone];
      const step = Math.max(ramp.indexOf(tone), 0);
      const darker = ramp[Math.max(step - 1, 0)] ?? tone;
      const lighter = ramp[Math.min(step + 1, 2)] ?? tone;
      const [thin, thick] = COVERAGE[look.form];
      coverage[cell] = thin + (thick - thin) * (biomass / 255);
      if (look.form === "GRASS" || look.form === "LICHEN") {
        // The growth is the plant: its own tone, with blades of the next tones.
        growth[cell] = tone;
        light[cell] = lighter;
        dark[cell] = darker;
        lightShare[cell] = look.form === "GRASS" ? 0.03 + (0.06 * biomass) / 255 : 0.02;
        darkShare[cell] = look.form === "GRASS" ? 0.04 : 0;
      } else {
        // Under shrubs and trees: a darker floor, for the plant to stand out on.
        growth[cell] = darker;
        light[cell] = tone;
        lightShare[cell] = 0.03;
      }
      if (standsAlone(look, x, y)) alone.push({ x, y, grown: look.stage === "mature" });
    }
  }

  const wide = width * TILE;
  const tall = height * TILE;
  const colours = new Uint32Array(wide * tall);
  const land = new Uint8Array(wide * tall);
  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      const warpX =
        (valueNoise(px / WARP_WAVELENGTH, py / WARP_WAVELENGTH, 1) - 0.5) * 2 * WARP_PX +
        (cellHash(px, py, 3) - 0.5) * 2 * WARP_JITTER_PX;
      const warpY =
        (valueNoise(px / WARP_WAVELENGTH, py / WARP_WAVELENGTH, 2) - 0.5) * 2 * WARP_PX +
        (cellHash(px, py, 4) - 0.5) * 2 * WARP_JITTER_PX;
      const cx = Math.min(Math.max(Math.floor((px + 0.5 + warpX) / TILE), 0), width - 1);
      const cy = Math.min(Math.max(Math.floor((py + 0.5 + warpY) / TILE), 0), height - 1);
      const cell = cy * width + cx;
      const base = soil[cell] ?? 0;
      if (water[cell] === 1) {
        // A short lighter dash here and there: two pixels share one draw.
        colours[at] = cellHash(px >> 1, py, 7) < WAVES ? mix(base, foam, 0.35) : base;
        continue;
      }
      land[at] = 1;
      const grows = coverage[cell] ?? 0;
      if (grows > 0 && valueNoise(px / PATCH_WAVELENGTH, py / PATCH_WAVELENGTH, 5) < grows) {
        // Blades are two pixels tall: both rows of a pair share one draw.
        const blade = cellHash(px, py >> 1, 6);
        const lit = lightShare[cell] ?? 0;
        colours[at] =
          blade < lit
            ? (light[cell] ?? 0)
            : blade < lit + (darkShare[cell] ?? 0)
              ? (dark[cell] ?? 0)
              : (growth[cell] ?? 0);
      } else {
        const grain = cellHash(px, py, 8);
        colours[at] =
          grain < PEBBLES ? shade(base, 0.86) : grain > 1 - PEBBLES / 2 ? shade(base, 1.08) : base;
      }
    }
  }

  // The shore: the map's outline on the last pixel of land, foam on the first of water.
  const landAt = (px: number, py: number): boolean =>
    px >= 0 && py >= 0 && px < wide && py < tall && land[py * wide + px] === 1;
  const shore = new Uint8Array(wide * tall);
  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      if (land[at] === 1) {
        const edge =
          (px > 0 && land[at - 1] === 0) ||
          (px < wide - 1 && land[at + 1] === 0) ||
          (py > 0 && land[at - wide] === 0) ||
          (py < tall - 1 && land[at + wide] === 0);
        if (edge) {
          colours[at] = outline;
          shore[at] = 1;
        }
        continue;
      }
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1 && !near; dx++) near = landAt(px + dx, py + dy);
      }
      const far =
        !near &&
        (landAt(px - 2, py) || landAt(px + 2, py) || landAt(px, py - 2) || landAt(px, py + 2));
      const chance = near ? FOAM_NEAR : far ? FOAM_FAR : 0;
      if (chance > 0 && cellHash(px, py, 9) < chance) colours[at] = foam;
    }
  }

  // A shadow at the foot of every plant that stands alone.
  for (const plant of alone) {
    const [dx, dy] = plantOffset(plant.x, plant.y);
    const footX = plant.x * TILE + TILE / 2 + dx;
    const footY = plant.y * TILE + TILE - 1 + dy;
    const reach = plant.grown ? 3 : 2;
    for (let oy = -1; oy <= 1; oy++) {
      // An ellipse: full width on its middle row, one pixel shorter above and below.
      const half = oy === 0 ? reach : reach - 1;
      for (let ox = -half; ox <= half; ox++) {
        const px = footX + ox;
        const py = footY + oy;
        if (!landAt(px, py) || shore[py * wide + px] === 1) continue;
        colours[py * wide + px] = shade(colours[py * wide + px] ?? 0, SHADOW);
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
