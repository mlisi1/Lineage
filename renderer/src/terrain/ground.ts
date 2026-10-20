/**
 * The ground, painted from the world's cells at any number of pixels per cell. The map
 * view and the local view are the same painter at two sizes, so they stay in proportion:
 * the close-up is the map with what lies between its cells worked out, not another
 * picture.
 *
 * Colour follows the report maps' rules (sea in bands of depth, relief as three tones by
 * slope toward the light, rock and snow on bare heights, an outline on the shore), from
 * the land's heights, cover and biomass. Styles differ in how a pixel reads the cells
 * around it:
 *
 *   squares   the cell it falls in: flat squares, as the report maps
 *   warped    the cell it falls in after a gentle warp: squares with wandering borders
 *   tiles     the nearest of the cells' centres, each nudged off its place: irregular tiles
 *   smooth    every value interpolated between the four nearest cells: contours
 *   blended   the same, with every transition dithered instead of cut
 *
 * From close, a cell is a large thing, and what the cells say one by one would be a
 * patchwork. So a close view reads what grows over a few cells around (`calm`), which
 * gives patches several cells wide, and spends its pixels on what the ground is made of
 * instead: blades, pebbles, cracks, ripples in the sand, litter under trees, lichen on
 * rock. It can also be given the shadows of what stands on it.
 */
import { VISIBLE_FROM } from "../plants/look";
import { DEFAULT_LOOK, type Look } from "../looks";
import { floorRamp, seasonRamp, type Season } from "../plants/seasons";
import type { CellRect, Land, Ramp } from "./land";
import { cellHash, hexToRgb, type Pixels } from "./pixels";

export type GroundStyle = "squares" | "warped" | "tiles" | "smooth" | "blended";
export const GROUND_STYLES: readonly GroundStyle[] = [
  "squares",
  "warped",
  "tiles",
  "smooth",
  "blended",
];
/** Art pixels per cell in the middle view and in the map view. */
export const MID_TILE = 8;
export const MAP_TILE = 2;

/** From this many pixels per cell a view is close: calm patches, and detail in them. */
export const CLOSE_FROM_TILE = 16;
/** How many cells around a close view reads what grows over, unless told otherwise. */
export const CALM_CELLS = 2;

/** The shadow of something standing on the ground: an ellipse, in cells. */
export interface Shadow {
  x: number;
  y: number;
  rx: number;
  ry: number;
}

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
  /**
   * Cells around over which the interpolated styles read what grows and how the land
   * slopes: 0 is what each cell says, more gives larger and calmer patches. Left out, a
   * close view takes `CALM_CELLS` and the others 0.
   */
  calm?: number;
  /** Shadows to lay on the land. */
  shadows?: readonly Shadow[];
  /**
   * The time of year: the colours of what grows, blooms in the grass in spring and
   * summer, fallen leaves under broadleaves in autumn, and in winter low growth dried
   * whatever its biomass (the simulation's own winter has it die back). Summer if left out.
   */
  season?: Season;
  /**
   * Winter with snow lying on the land: in patches, thinner under trees. Where the land
   * carries the simulation's snow (`Land.snow`) that is what lies, in any season, and
   * this is not read.
   */
  snow?: boolean;
  /**
   * The season at each place, in cells, where the year is turning from one season to the
   * next (`turning.ts`); `dither` (−1 to 1) is there to dither the line between them.
   * Every place is in `season` when left out.
   */
  seasonAt?: (u: number, v: number, dither: number) => Season;
  /**
   * Also paint the surf that moves (`Pixels.surf`): a band of foam along the shore and two
   * dashed lines of lighter water beyond it, each on its own, to be shown one after
   * another. The foam is then not painted on the ground itself.
   */
  surf?: boolean;
  /** The colours besides the land's palette (give the land the look's palette too: `dressed`). */
  look?: Look;
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
/** A close view has room for a second, finer wander of the same lines. */
const FINE_WOBBLE = 0.045;
const FINE_FREQUENCY = 6.3;
/** Land less than this above the sea is beach. */
const BEACH = 0.006;
/** Growth thins out toward the edge of its kind: from this share of the weight to that. */
const EDGE_FROM = 0.3;
const EDGE_TO = 0.58;
/** blended: how far either side of a threshold the two sides are mixed. */
const MIX_CLASS = 0.7;
const MIX_SLOPE = 0.5;
const MIX_DEPTH = 0.3;
/** Size of the patches growth comes in, in pixels of the middle view. */
const PATCH = 3.6;
/** In a calm view growth thins in patches this many cells across, with a ragged edge. */
const CALM_PATCH = 1.6;
const CALM_RAGGED = 0.07;
/** How much narrower a calm view's dithered transitions are. */
const CALM_MIX = 0.4;
/** How far, in biomass, the line between dried and green growth wanders in a calm view. */
const DRY_DRIFT = 0.12;
/** Under trees and bushes a close view shows a floor of litter: mixed this far into their dark. */
const FLOOR_LITTER: readonly number[] = [0, 0, 0, 0.18, 0.4, 0.46, 0];
/** Snow lies where this noise is under so much: in the open, and under trees. */
const SNOW_OPEN = 0.64;
const SNOW_UNDER_TREES = 0.46;
const SNOW_PATCH = 2.4;
/** Snow as deep as the simulation's full depth over this share of it lies as thick as it gets. */
const SNOW_FULL_FROM = 1.6;
/** How much more or less of what comes and goes with the year the ground shows. */
const BLOOMING: Readonly<Record<Season, number>> = { spring: 2.5, summer: 1, autumn: 0, winter: 0 };
const LEAF_FALL: Readonly<Record<Season, number>> = {
  spring: 0.8,
  summer: 1,
  autumn: 2,
  winter: 1.3,
};
const BLADE_GROWTH: Readonly<Record<Season, number>> = {
  spring: 0.9,
  summer: 1,
  autumn: 0.8,
  winter: 0.4,
};
/** How wide (as a share of it) a shadow's dithered rim is. */
const SHADOW_RIM = 0.18;
/** Share of the pixels of bare ground that are a grain darker or lighter. */
const GRIT = 0.012;
const WAVES = 0.006;
/**
 * Algae on the shallow sea (M11): biomass at which they are thickest (the sim's
 * algae_capacity), the share of the water they cover then, the clumps' size (pixels), and
 * their two olive tones, mixed into the water's colour this much.
 */
const ALGAE_FULL = 0.4;
const ALGAE_COVER = 0.7;
const ALGAE_CLUMP = 3;
const ALGAE: readonly number[] = [0x4f7a3a, 0x86a24a];
const ALGAE_MIX = 0.7;
/**
 * Burnt ground (R4): charcoal mixed in (more where the fire was recent), and a share of
 * pixels that are pale ash.
 */
const CHARRED = 0x241c1c;
const CHAR_MIX = 0.62;
/**
 * Scorch (0–1) from which a cell is drawn burnt; how far its edge wanders (cells) and over
 * how many cells the wander turns; ash lies in drifts where a noise passes this.
 */
const CHAR_FROM = 0.04;
const CHAR_RAGGED = 0.55;
const CHAR_RAGGED_SPAN = 0.7;
const CHAR_ASH = 0.8;
const CHAR_ASH_COLOUR = 0x8a827c;
const FOAM_NEAR = 0.85;
const FOAM_FAR = 0.3;
/** The moving surf: share of the foam band's pixels that are foam, and of a line's dashes. */
const SURF_FOAM = 0.8;
const SURF_LINE = 0.62;
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

/** What a pixel of land is made of, for the detail that goes on it. */
const MATTER = {
  sea: 0,
  sand: 1,
  soil: 2,
  rock: 3,
  snow: 4,
  lichen: 5,
  grass: 6,
  dry: 7,
  scrub: 8,
  wood: 9,
  pines: 10,
  burnt: 11,
} as const;
type Matter = (typeof MATTER)[keyof typeof MATTER];

/**
 * Detail, as small drawings: one letter per pixel, the last row lowest. `d` and `l` are
 * a tone darker and lighter than the ground they lie on; the other letters are colours
 * of their own (see `inks` in `paintGround`).
 */
type Motif = readonly string[];
const BLADES: readonly Motif[] = [
  ["l..l", ".l.d", ".d.."],
  ["l.l", "l.d", ".d."],
  [".l.", "ll.", ".d."],
  ["l...", ".l.l", ".d.."],
  ["..l", "l.l", ".d."],
  ["l", "l"],
];
const SPECKS: readonly Motif[] = [["l"], ["d"], ["ll"], ["dd"], ["l.", ".d"]];
const PEBBLES: readonly Motif[] = [
  ["ll", "sd"],
  ["ls.", "ssd"],
  [".ll.", "lssd", ".dd."],
  ["l", "d"],
];
const CRACKS: readonly Motif[] = [
  ["d...", ".dd.", "...d"],
  ["..d", ".d.", "d..", "d.."],
  ["d....", ".d.dd", "..d.."],
  ["dd..", "..dd"],
];
const RIPPLES: readonly Motif[] = [
  ["llll..", "..dddd"],
  ["lll", ".dd"],
  ["..llll", "ddd..."],
  ["lllll"],
];
const ROSETTES: readonly Motif[] = [
  [".aa.", "acca", "acca", ".aa."],
  ["aa.", "aca", ".aa"],
  [".aaa.", "accca", "aceca", "accca", ".aaa."],
  ["aa", "aa"],
  [".a..", "acaa", ".aca", "..a."],
  ["a.a", ".c.", "a.a"],
];
const LEAVES: readonly Motif[] = [["o"], ["o.", ".n"], ["n"], ["oo"], ["m"], ["n.", "no"], ["mm"]];
const NEEDLES: readonly Motif[] = [["n.", ".n"], [".n", "n."], ["nn"], ["o"], ["n..", ".n."]];
const TWIGS: readonly Motif[] = [["t..", ".t.", "..t"], ["ttt"], ["..t", "tt."]];
const ASH: readonly Motif[] = [["w"], ["w.", ".w"], ["d"], ["dd"], ["w"]];
const DIMPLES: readonly Motif[] = [["dd"], ["ddd"], ["d.", ".d"]];
const BLOOMS: readonly Motif[] = [["p"], ["p", "d"], ["q"]];

/** What lies on each kind of ground: a motif set and how often a place for one is taken. */
const DETAIL: Readonly<Record<Matter, readonly (readonly [readonly Motif[], number])[]>> = {
  [MATTER.sea]: [],
  [MATTER.sand]: [
    [RIPPLES, 0.2],
    [SPECKS, 0.1],
    [PEBBLES, 0.03],
  ],
  [MATTER.soil]: [
    [PEBBLES, 0.13],
    [SPECKS, 0.2],
    [CRACKS, 0.06],
    [TWIGS, 0.02],
  ],
  [MATTER.rock]: [
    [CRACKS, 0.16],
    [ROSETTES, 0.14],
    [PEBBLES, 0.08],
    [SPECKS, 0.1],
  ],
  [MATTER.snow]: [
    [DIMPLES, 0.12],
    [SPECKS, 0.05],
  ],
  [MATTER.lichen]: [
    [ROSETTES, 0.62],
    [CRACKS, 0.04],
    [PEBBLES, 0.05],
  ],
  [MATTER.grass]: [
    [BLADES, 0.42],
    [DIMPLES, 0.05],
    [SPECKS, 0.06],
    [BLOOMS, 0.025],
  ],
  [MATTER.dry]: [
    [BLADES, 0.4],
    [SPECKS, 0.12],
  ],
  [MATTER.scrub]: [
    [LEAVES, 0.24],
    [BLADES, 0.12],
    [TWIGS, 0.03],
  ],
  [MATTER.wood]: [
    [LEAVES, 0.42],
    [TWIGS, 0.05],
    [SPECKS, 0.06],
  ],
  [MATTER.pines]: [
    [NEEDLES, 0.46],
    [TWIGS, 0.04],
  ],
  [MATTER.burnt]: [
    [ASH, 0.3],
    [TWIGS, 0.05],
  ],
};

/** Weights of a binomial kernel reaching `reach` cells either side. */
function kernel(reach: number): number[] {
  let row = [1];
  for (let step = 0; step < 2 * reach; step++) {
    row = [...row, 0].map((value, i) => value + (row[i - 1] ?? 0));
  }
  const sum = row.reduce((total, value) => total + value, 0);
  return row.map((value) => value / sum);
}

/** Paint the ground of `world`: `tile` pixels per cell over the cells asked for. */
export function paintGround(world: Land, options: GroundOptions): Pixels {
  const { width, height, heights, seaLevel, relief } = world;
  const { tile, style, grain } = options;
  const rect = options.cells ?? { x0: 0, y0: 0, x1: width, y1: height };
  const count = width * height;
  const waterClass = world.coverClasses.indexOf("WATER");
  const interpolated = style === "smooth" || style === "blended";
  const dithered = style === "blended";
  const close = tile >= CLOSE_FROM_TILE;
  const calm = interpolated ? Math.max(0, Math.round(options.calm ?? (close ? CALM_CELLS : 0))) : 0;

  // What each cell is: sea or land, what grows on it, how thickly, how it slopes.
  const sea = new Uint8Array(count);
  const kind = new Uint8Array(count);
  const biomass = new Float32Array(count);
  const slope = new Float32Array(count);
  const coastal = new Uint8Array(count);
  const seaAt = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && world.cover[y * width + x] === waterClass;
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
      const name = world.coverClasses[world.cover[cell] ?? 0] ?? "";
      const grown = world.biomass[cell] ?? 0;
      biomass[cell] = grown / 255;
      const form = (FORMS as readonly string[]).indexOf(name);
      if (name === "BURNT") kind[cell] = BURNT;
      else if (form >= 0 && grown >= VISIBLE_FROM) kind[cell] = form + 1;
    }
  }

  const bare = packRamp(world.palette["BARE"] ?? ["#8f7f68", "#b3a188", "#cdbd9f"]);
  const rock = packRamp(relief.highRock);
  const snow = packRamp(relief.snow);
  const look = options.look ?? DEFAULT_LOOK;
  const tones = look.ground;
  const burnt = packRamp(world.palette["BURNT"] ?? ["#3a302b", "#4f423a", "#66564b"]);
  /** What the time of year paints with: one season everywhere, or each place its own. */
  interface Seasonal {
    season: Season;
    snowing: boolean;
    /** Dried growth: the maps' own dry colours, paler in winter. */
    dry: readonly [Rgb, Rgb, Rgb];
    /** Grass and lichen are the ground's own colour; under bushes and trees it is their floor. */
    ramps: readonly (readonly [Rgb, Rgb, Rgb])[];
  }
  const seasonals = new Map<Season, Seasonal>();
  const seasonalOf = (season: Season): Seasonal => {
    const known = seasonals.get(season);
    if (known !== undefined) return known;
    const made: Seasonal = {
      season,
      snowing: options.snow === true && season === "winter",
      dry: packRamp(
        season === "winter"
          ? seasonRamp(world.palette, "GRASS", "winter", 0, look.seasons)
          : (world.palette["DORMANT"] ?? ["#8f8448", "#b3a65c", "#cdc177"]),
      ),
      ramps: FORMS.map((form, index) =>
        packRamp(
          index + 1 > LOW && grain
            ? floorRamp(world.palette, form, season, look.seasons)
            : seasonRamp(world.palette, form, season, 0, look.seasons),
        ),
      ),
    };
    seasonals.set(season, made);
    return made;
  };
  const { seasonAt } = options;
  // How deep snow lies at a place, from the simulation's cells where the land carries
  // them; otherwise everywhere or nowhere, as `snow` says.
  const snowCells = world.snow;
  const snowDepth =
    snowCells === undefined
      ? null
      : (u: number, v: number): number => {
          const x0 = Math.floor(u);
          const y0 = Math.floor(v);
          const fx = u - x0;
          const fy = v - y0;
          const at = (x: number, y: number): number =>
            (snowCells[clampY(y) * width + clampX(x)] ?? 0) / 255;
          return (
            (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
            (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
          );
        };
  // The sim's other grids, read between cells as the snow is (R4: burnt ground; M11: algae).
  const between4 = (cells: Uint8Array | undefined): ((u: number, v: number) => number) | null =>
    cells === undefined
      ? null
      : (u, v) => {
          const x0 = Math.floor(u);
          const y0 = Math.floor(v);
          const fx = u - x0;
          const fy = v - y0;
          const at = (x: number, y: number): number =>
            (cells[clampY(y) * width + clampX(x)] ?? 0) / 255;
          return (
            (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
            (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
          );
        };
  const scorchCells = world.scorch;
  const algaeAt = between4(world.algae);
  // The season of the pixel being painted.
  let now = seasonalOf(options.season ?? "summer");
  const dries = FORMS.map((form) => world.dormantClasses.includes(form));
  const dryBelow = world.dormantBelow / 255;
  const bands = relief.seaBands.map((band) => ({ limit: band.limit, colour: pack(band.colour) }));
  const outline = pack(relief.shoreOutline);
  const sand = tones.sand ?? bare[2];
  const foam = mix(bands[0]?.colour ?? 0x8ecbe6, 0xffffff, tones.foamMix);

  const clampX = (x: number): number => Math.min(Math.max(x, 0), width - 1);
  const clampY = (y: number): number => Math.min(Math.max(y, 0), height - 1);

  // A calm view: for every cell a pixel may read, what grows over the cells around it
  // (the share of each kind and how thickly each grows) and how high the land lies there.
  const kinds = BURNT + 1;
  // A pixel reads up to a cell beyond its own, wanders a little, and looks one further for the slope.
  const FIELD_REACH = 3;
  const fieldX = rect.x0 - FIELD_REACH;
  const fieldY = rect.y0 - FIELD_REACH;
  const fieldWide = rect.x1 - rect.x0 + 2 * FIELD_REACH;
  const fieldTall = rect.y1 - rect.y0 + 2 * FIELD_REACH;
  const fieldSize = calm > 0 ? fieldWide * fieldTall : 0;
  const calmShares = new Float32Array(fieldSize * kinds);
  const calmGrowth = new Float32Array(fieldSize * kinds);
  const calmLand = new Uint8Array(fieldSize);
  const calmHeights = new Float32Array(fieldSize);
  if (calm > 0) {
    const weightsOf = kernel(calm);
    for (let fy = 0; fy < fieldTall; fy++) {
      for (let fx = 0; fx < fieldWide; fx++) {
        const at = fy * fieldWide + fx;
        let level = 0;
        let landed = 0;
        for (let ky = -calm; ky <= calm; ky++) {
          const row = clampY(fieldY + fy + ky) * width;
          for (let kx = -calm; kx <= calm; kx++) {
            const cell = row + clampX(fieldX + fx + kx);
            const weight = (weightsOf[ky + calm] ?? 0) * (weightsOf[kx + calm] ?? 0);
            level += weight * (heights[cell] ?? 0);
            if (sea[cell] === 1) continue;
            const slot = at * kinds + (kind[cell] ?? 0);
            calmShares[slot] = (calmShares[slot] ?? 0) + weight;
            calmGrowth[slot] = (calmGrowth[slot] ?? 0) + weight * (biomass[cell] ?? 0);
            landed += weight;
          }
        }
        calmHeights[at] = level;
        if (landed <= 0) continue;
        calmLand[at] = 1;
        for (let voted = 0; voted < kinds; voted++) {
          calmShares[at * kinds + voted] = (calmShares[at * kinds + voted] ?? 0) / landed;
          calmGrowth[at * kinds + voted] = (calmGrowth[at * kinds + voted] ?? 0) / landed;
        }
      }
    }
  }

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
  // Where the pixel is, in cells, and what was painted on it.
  let hereU = 0;
  let hereV = 0;
  let withered = false;

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
  /** The same over the calm view's heights. */
  const calmHeightAt = (u: number, v: number): number => {
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    const fx = u - x0;
    const fy = v - y0;
    const at = (y0 - fieldY) * fieldWide + (x0 - fieldX);
    const top = (calmHeights[at] ?? 0) * (1 - fx) + (calmHeights[at + 1] ?? 0) * fx;
    const bottom =
      (calmHeights[at + fieldWide] ?? 0) * (1 - fx) + (calmHeights[at + fieldWide + 1] ?? 0) * fx;
    return top * (1 - fy) + bottom * fy;
  };
  const weights = new Float32Array(kinds);
  const growth = new Float32Array(kinds);
  const between = (u: number, v: number): void => {
    const level = heightAt(u, v);
    above = level - seaLevel;
    land = above > 0;
    rise =
      calm > 0 ? calmHeightAt(u, v) - calmHeightAt(u - 1, v - 1) : level - heightAt(u - 1, v - 1);
    beach = above < BEACH;
    // What grows: each of the four cells around votes with its nearness, for its own kind
    // or, in a calm view, for the kinds around it by their shares.
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
      const weight = (dx === 1 ? fx : 1 - fx) * (dy === 1 ? fy : 1 - fy);
      if (calm > 0) {
        const at = (y0 + dy - fieldY) * fieldWide + (x0 + dx - fieldX);
        if (calmLand[at] !== 1) continue;
        for (let voted = 0; voted < kinds; voted++) {
          weights[voted] = (weights[voted] ?? 0) + weight * (calmShares[at * kinds + voted] ?? 0);
          growth[voted] = (growth[voted] ?? 0) + weight * (calmGrowth[at * kinds + voted] ?? 0);
        }
        total += weight;
        continue;
      }
      const cell = clampY(y0 + dy) * width + clampX(x0 + dx);
      if (sea[cell] === 1) continue;
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
  const originX = rect.x0 * tile;
  const originY = rect.y0 * tile;
  const colours = new Uint32Array(wide * tall);
  const isLand = new Uint8Array(wide * tall);
  // For the detail of a close view: what each pixel is made of, in which tone, how grown.
  const detailed = grain && close;
  const matter = new Uint8Array(detailed ? wide * tall : 0);
  const toned = new Uint8Array(detailed ? wide * tall : 0);
  const thick = new Uint8Array(detailed ? wide * tall : 0);
  // Patches of growth are as big on the land whatever the tile, so that a view closer
  // than the middle one shows the same patches larger; closer still, their edges, the
  // blades and the foam get detail of their own, a pixel or a few at a time.
  const fine = MID_TILE / tile;
  const bladeRows = close ? Math.max(2, Math.round(tile / 8)) : 2;
  const dash = Math.max(2, Math.round(tile / 4));
  const surf = Math.max(1, Math.round(tile / 8));
  // Where two kinds meet they mix over as many pixels in every view, not as many cells.
  // A calm view's values change over more cells, so its thresholds are mixed over less.
  const mixClass = MIX_CLASS * Math.min(1, fine) * (calm > 0 ? CALM_MIX : 1);
  const mixSlope = MIX_SLOPE * (calm > 0 ? CALM_MIX : 1);

  /** The colour of growth of class `grows` here, or -1 where the soil shows through. */
  const cover = (grows: number, step: number, px: number, py: number, dither: number): Rgb | -1 => {
    withered = false;
    if (grows === 0) return -1;
    // From close, lichen is not a colour of the ground but rosettes on it (below).
    if (detailed && grows === 1) return -1;
    // Where growth has dried: in a calm view the line between dry and green wanders and
    // is dithered, as every other line is.
    const drift =
      calm > 0 ? DRY_DRIFT * (valueNoise(hereU * 1.3, hereV * 1.3, 13) - 0.5 + 0.3 * dither) : 0;
    withered =
      grows !== BURNT &&
      (dries[grows - 1] ?? false) &&
      (now.season === "winter" || grown + drift < dryBelow);
    const ramp = grows === BURNT ? burnt : withered ? now.dry : (now.ramps[grows - 1] ?? bare);
    // A plant standing on a floor: the floor is a tone darker, for it to stand out on.
    const floor = grows > LOW && grows !== BURNT;
    let tone = ramp[floor && grain ? Math.max(step - 1, 0) : step] ?? 0;
    if (!grain) return tone;
    if (floor && detailed && !withered) tone = mix(tone, tones.litter, FLOOR_LITTER[grows] ?? 0);
    const [thin, full] = COVERAGE[grows] ?? [0, 0];
    if (calm > 0) {
      // Growth thins in patches cells across, and the soil shows in the gaps. A gap's
      // edge is ragged but not dithered: where the growth only just thins, dithering
      // left a faint field of dots instead of a gap.
      const covered = thin + (full - thin) * grown;
      const patch =
        (1 - CALM_RAGGED) * valueNoise(hereU / CALM_PATCH, hereV / CALM_PATCH, 5) +
        CALM_RAGGED * valueNoise(px / PATCH, py / PATCH, 10);
      if (patch >= covered) return -1;
      // The detail is drawn over it afterwards.
      if (detailed) return tone;
    } else {
      const fade = interpolated ? smoothstep(EDGE_FROM, EDGE_TO, share) : 1;
      const covered = (thin + (full - thin) * grown) * fade;
      const patch = valueNoise((px * fine) / PATCH, (py * fine) / PATCH, 5);
      const ragged = close ? 0.74 * patch + 0.26 * valueNoise(px / PATCH, py / PATCH, 10) : patch;
      if (ragged >= covered) return -1;
    }
    // Blades are two pixels tall: both rows of a pair share one draw.
    const blade = cellHash(px, Math.floor(py / bladeRows), 6);
    if (grows === BURNT) return blade < 0.08 ? shade(tone, 0.7) : tone;
    if (floor) return blade < 0.03 ? (ramp[step] ?? tone) : tone;
    const lit = grows === 2 ? 0.03 + 0.06 * grown : 0.02;
    if (blade < lit) return ramp[Math.min(step + 1, 2)] ?? tone;
    return grows === 2 && blade < lit + 0.04 ? (ramp[Math.max(step - 1, 0)] ?? tone) : tone;
  };
  const MATTER_OF: readonly Matter[] = [
    MATTER.soil,
    MATTER.lichen,
    MATTER.grass,
    MATTER.scrub,
    MATTER.wood,
    MATTER.pines,
    MATTER.burnt,
  ];

  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      // Position in cells, measured from the middle of the world's first cell.
      const worldX = originX + px;
      const worldY = originY + py;
      const u = (worldX + 0.5) / tile - 0.5;
      const v = (worldY + 0.5) / tile - 0.5;
      hereU = u;
      hereV = v;
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
        let du = (valueNoise(u * WOBBLE_FREQUENCY, v * WOBBLE_FREQUENCY, 1) - 0.5) * 2 * WOBBLE;
        let dv = (valueNoise(u * WOBBLE_FREQUENCY, v * WOBBLE_FREQUENCY, 2) - 0.5) * 2 * WOBBLE;
        if (close) {
          du += (valueNoise(u * FINE_FREQUENCY, v * FINE_FREQUENCY, 11) - 0.5) * 2 * FINE_WOBBLE;
          dv += (valueNoise(u * FINE_FREQUENCY, v * FINE_FREQUENCY, 12) - 0.5) * 2 * FINE_WOBBLE;
        }
        between(u + du, v + dv);
      }

      // Where two sides of a threshold meet, `dither` decides pixel by pixel.
      const dither = dithered ? (BAYER[(worldY & 3) * 4 + (worldX & 3)] ?? 0.5) * 2 - 1 : 0;
      if (seasonAt !== undefined) now = seasonalOf(seasonAt(u, v, dither));
      if (!land) {
        const depth = -above * (1 + MIX_DEPTH * dither);
        const band = bands.find((candidate) => depth <= candidate.limit) ?? bands[bands.length - 1];
        const base = band?.colour ?? 0;
        colours[at] =
          grain && cellHash(Math.floor(worldX / dash), worldY, 7) < WAVES
            ? mix(base, foam, 0.35)
            : base;
        // Algae (M11): clumps of olive fronds on the shallows, as thick as they grow.
        const algae = algaeAt === null ? 0 : algaeAt(u, v) / ALGAE_FULL;
        if (algae > 0.02) {
          const clump = valueNoise(worldX / ALGAE_CLUMP, worldY / ALGAE_CLUMP, 51);
          if (clump + 0.15 * dither < Math.min(algae, 1) * ALGAE_COVER) {
            const tone = cellHash(worldX, worldY, 52) < 0.3 ? 1 : 0;
            colours[at] = mix(base, ALGAE[tone] ?? 0, ALGAE_MIX);
          }
        }
        continue;
      }
      isLand[at] = 1;
      const felt = rise + mixSlope * relief.slope * dither;
      const step = felt > relief.slope ? 2 : felt < -relief.slope ? 0 : 1;
      // Two kinds side by side: nearer the border, more pixels go to the other.
      const grows = dithered && dither + 1 < 1 - lead / mixClass ? second : first;
      if (detailed) {
        toned[at] = step;
        thick[at] = Math.round(grown * 255);
      }
      const depth = snowDepth === null ? (now.snowing ? 1 : 0) : snowDepth(u, v);
      if (depth > 0) {
        // Snow in patches cells across, with a dithered edge; less of it under trees, and
        // where it lies thin, patches with ground between.
        const lying =
          0.82 * valueNoise(u / SNOW_PATCH, v / SNOW_PATCH, 40) +
          0.18 * valueNoise(worldX / PATCH, worldY / PATCH, 41);
        const under = grows === 4 || grows === 5 ? SNOW_UNDER_TREES : SNOW_OPEN;
        if (lying + 0.04 * dither < under * Math.min(1, depth * SNOW_FULL_FROM)) {
          colours[at] = snow[step] ?? 0xffffff;
          if (detailed) matter[at] = MATTER.snow;
          continue;
        }
      }
      const growthColour = cover(grows, step, worldX, worldY, dither);
      if (growthColour !== -1) {
        colours[at] = growthColour;
        if (detailed) matter[at] = withered ? MATTER.dry : (MATTER_OF[grows] ?? MATTER.soil);
        continue;
      }
      const high = above >= relief.snowFrom ? 2 : above >= relief.highRockFrom ? 1 : 0;
      const soil = high === 2 ? snow : high === 1 ? rock : bare;
      const sandy = interpolated ? above * (1 + 0.6 * dither) < BEACH : beach;
      const base = sandy ? sand : (soil[step] ?? 0);
      if (detailed) {
        matter[at] = sandy
          ? MATTER.sand
          : grows === 1 && high < 2
            ? MATTER.lichen
            : high === 2
              ? MATTER.snow
              : high === 1
                ? MATTER.rock
                : MATTER.soil;
        colours[at] = base;
        continue;
      }
      const grainHere = grain ? cellHash(worldX, worldY, 8) : 0.5;
      colours[at] =
        grainHere < GRIT ? shade(base, 0.86) : grainHere > 1 - GRIT / 2 ? shade(base, 1.08) : base;
    }
  }

  // The detail of a close view: on a grid of places a few pixels apart, each a little
  // off its place, a small drawing of what the ground there is made of. A drawing keeps
  // to its own kind of ground, so borders stay where they were painted.
  if (detailed) {
    const grid = Math.max(4, Math.round(tile / 5));
    for (let gy = Math.floor(originY / grid) - 1; gy <= Math.floor((originY + tall) / grid); gy++) {
      for (
        let gx = Math.floor(originX / grid) - 1;
        gx <= Math.floor((originX + wide) / grid);
        gx++
      ) {
        const sx = gx * grid + Math.floor(cellHash(gx, gy, 31) * grid) - originX;
        const sy = gy * grid + Math.floor(cellHash(gx, gy, 32) * grid) - originY;
        if (sx < 0 || sy < 0 || sx >= wide || sy >= tall) continue;
        const site = sy * wide + sx;
        if (seasonAt !== undefined) {
          const wx = sx + originX;
          const wy = sy + originY;
          const dither = (BAYER[(wy & 3) * 4 + (wx & 3)] ?? 0.5) * 2 - 1;
          now = seasonalOf(seasonAt((wx + 0.5) / tile - 0.5, (wy + 0.5) / tile - 0.5, dither));
        }
        const { season } = now;
        const lichenRamp = now.ramps[0] ?? bare;
        const made = (matter[site] ?? 0) as Matter;
        if (made === MATTER.sea) continue;
        const amount = (thick[site] ?? 0) / 255;
        // Which drawing, if any: thicker growth has more blades, thicker lichen more rosettes.
        let pick = cellHash(gx, gy, 33);
        let motifs: readonly Motif[] | null = null;
        for (const [set, chance] of DETAIL[made]) {
          const often =
            set === BLADES
              ? chance * (0.45 + 0.75 * amount) * BLADE_GROWTH[season]
              : set === ROSETTES
                ? chance * (0.45 + 0.75 * amount)
                : set === BLOOMS
                  ? chance * BLOOMING[season]
                  : set === LEAVES
                    ? chance * LEAF_FALL[season]
                    : chance;
          if (pick < often) {
            motifs = set;
            break;
          }
          pick -= often;
        }
        if (motifs === null) continue;
        const choice = cellHash(gx, gy, 34);
        const motif = motifs[Math.floor(choice * motifs.length)] ?? [];
        const base = colours[site] ?? 0;
        const step = toned[site] ?? 1;
        const ramp =
          made === MATTER.grass
            ? (now.ramps[1] ?? bare)
            : made === MATTER.dry
              ? now.dry
              : made === MATTER.rock
                ? rock
                : made === MATTER.snow
                  ? snow
                  : null;
        // A tone darker and lighter: the ramp's where the ground has one, else by shading.
        const darker = ramp !== null && step > 0 ? (ramp[step - 1] ?? base) : shade(base, 0.84);
        const lighter = ramp !== null && step < 2 ? (ramp[step + 1] ?? base) : shade(base, 1.12);
        const variety = cellHash(gx, gy, 35);
        const lichen =
          variety < 0.66 ? lichenRamp : (tones.lichens[variety < 0.8 ? 0 : 1] ?? lichenRamp);
        const inks: Readonly<Record<string, Rgb>> = {
          d: darker,
          l: lighter,
          s: base,
          a: lichen[2],
          c: lichen[1],
          e: lichen[0],
          o: season === "autumn" ? tones.leafGold : tones.leafOchre,
          n: season === "autumn" ? tones.leafFlame : tones.leafBrown,
          m: tones.moss,
          t: made === MATTER.burnt ? shade(tones.twig, 0.5) : tones.twig,
          w: tones.ash,
          p: tones.petals[0],
          q: tones.petals[1],
        };
        const flipped = cellHash(gx, gy, 36) < 0.5;
        motif.forEach((row, index) => {
          const y = sy - (motif.length - 1 - index);
          if (y < 0 || y >= tall) return;
          for (let i = 0; i < row.length; i++) {
            const ink = inks[row.charAt(flipped ? row.length - 1 - i : i)];
            const x = sx + i - (row.length >> 1);
            if (ink === undefined || x < 0 || x >= wide) continue;
            if (matter[y * wide + x] === made) colours[y * wide + x] = ink;
          }
        });
      }
    }
  }

  // Shadows of what stands on the land: darker, with a dithered rim, and no darker where
  // two of them overlap.
  if (options.shadows !== undefined && options.shadows.length > 0) {
    const shaded = new Uint8Array(wide * tall);
    for (const cast of options.shadows) {
      const cx = cast.x * tile - originX;
      const cy = cast.y * tile - originY;
      const rx = Math.max(cast.rx * tile, 1);
      const ry = Math.max(cast.ry * tile, 1);
      const top = Math.max(Math.floor(cy - ry * 1.2), 0);
      const bottom = Math.min(Math.ceil(cy + ry * 1.2), tall - 1);
      const left = Math.max(Math.floor(cx - rx * 1.2), 0);
      const right = Math.min(Math.ceil(cx + rx * 1.2), wide - 1);
      for (let py = top; py <= bottom; py++) {
        for (let px = left; px <= right; px++) {
          const at = py * wide + px;
          if (isLand[at] !== 1 || shaded[at] === 1) continue;
          const reach = ((px + 0.5 - cx) / rx) ** 2 + ((py + 0.5 - cy) / ry) ** 2;
          const bayer = BAYER[((originY + py) & 3) * 4 + ((originX + px) & 3)] ?? 0.5;
          if (reach > 1 + SHADOW_RIM * (2 * bayer - 1)) continue;
          shaded[at] = 1;
          colours[at] = mix(colours[at] ?? 0, tones.shadow, tones.shadowMix);
        }
      }
    }
  }

  // Burnt ground (R4): every cell that burnt is charcoal, darker the more recent the fire,
  // with drifts of pale ash; its edge follows the cells, wandering by half a cell or so.
  if (scorchCells !== undefined) {
    for (let py = 0; py < tall; py++) {
      for (let px = 0; px < wide; px++) {
        const at = py * wide + px;
        if (isLand[at] !== 1) continue;
        const worldX = originX + px;
        const worldY = originY + py;
        const bayer = (BAYER[(worldY & 3) * 4 + (worldX & 3)] ?? 0.5) - 0.5;
        const u = (worldX + 0.5) / tile;
        const v = (worldY + 0.5) / tile;
        const wanderX = valueNoise(u / CHAR_RAGGED_SPAN, v / CHAR_RAGGED_SPAN, 55) - 0.5;
        const wanderY = valueNoise(u / CHAR_RAGGED_SPAN, v / CHAR_RAGGED_SPAN, 56) - 0.5;
        const cx = clampX(Math.floor(u + 2 * wanderX * CHAR_RAGGED + bayer * 0.15));
        const cy = clampY(Math.floor(v + 2 * wanderY * CHAR_RAGGED - bayer * 0.15));
        const scorch = (scorchCells[cy * width + cx] ?? 0) / 255;
        if (scorch <= CHAR_FROM) continue;
        const drift = valueNoise(u * 3, v * 3, 54) + 0.25 * bayer;
        const ash = drift > CHAR_ASH && cellHash(worldX, worldY, 57) < 0.6;
        colours[at] = ash
          ? CHAR_ASH_COLOUR
          : mix(colours[at] ?? 0, CHARRED, CHAR_MIX + (1 - CHAR_MIX) * 0.8 * scorch);
      }
    }
  }

  // The shore: the map's outline on the last pixel of land, then foam on the water and
  // wet sand on the land, as far out as the view is close. `away` is how many pixels a
  // pixel is from the other side of the shore, counted up to twice that reach.
  const far = 2 * surf + 1;
  // The surf that moves (`surf` option) reaches further out than the foam painted here.
  const surfing = options.surf === true;
  // Its bands, as distances from the shore: foam up to `foamTo`, then two lines of
  // lighter water, each `line` pixels wide, further out.
  const foamTo = surf + 1;
  const line = Math.max(1, Math.round(surf / 2));
  const midFrom = foamTo + 1 + Math.floor(line / 2);
  const farFrom = midFrom + line + surf + 1;
  const farTo = farFrom + line - 1;
  const away = new Uint8Array(wide * tall).fill(surfing ? farTo + 1 : far);
  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      const here = isLand[at];
      const edge =
        (px > 0 && isLand[at - 1] !== here) ||
        (px < wide - 1 && isLand[at + 1] !== here) ||
        (py > 0 && isLand[at - wide] !== here) ||
        (py < tall - 1 && isLand[at + wide] !== here);
      if (edge) away[at] = 1;
    }
  }
  // Two sweeps spread the count outward along rows and columns, on each side of the shore.
  const reach = (at: number, from: number): void => {
    if (isLand[at] === isLand[from] && (away[from] ?? far) + 1 < (away[at] ?? far)) {
      away[at] = (away[from] ?? far) + 1;
    }
  };
  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      if (px > 0) reach(at, at - 1);
      if (py > 0) reach(at, at - wide);
    }
  }
  for (let py = tall - 1; py >= 0; py--) {
    for (let px = wide - 1; px >= 0; px--) {
      const at = py * wide + px;
      if (px < wide - 1) reach(at, at + 1);
      if (py < tall - 1) reach(at, at + wide);
    }
  }
  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      const distance = away[at] ?? far;
      if (isLand[at] === 1) {
        if (distance === 1) colours[at] = outline;
        // Sand the sea has just left is darker.
        else if (grain && close && distance <= surf + 1 && colours[at] === sand) {
          colours[at] = shade(sand, 0.9);
        }
        continue;
      }
      // Where the surf moves the foam is its, not painted on the ground.
      if (!grain || surfing || distance >= far) continue;
      const chance = distance <= surf ? FOAM_NEAR : FOAM_FAR;
      if (cellHash(originX + px, originY + py, 9) < chance) colours[at] = foam;
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
  if (!surfing) return { width: wide, height: tall, rgba };

  // The surf, in three bands to be shown one after another (`terrain/sea.ts`), a crest
  // coming in: a line of lighter water far out, one nearer, then the foam at the shore.
  // Clear everywhere else.
  const surfBands = [0, 1, 2].map(() => new Uint8ClampedArray(wide * tall * 4));
  const swell = mix(bands[0]?.colour ?? 0x8ecbe6, 0xffffff, tones.surfMix);
  const put = (band: number, at: number, colour: Rgb): void => {
    const into = surfBands[band];
    if (into === undefined) return;
    into[at * 4] = colour >> 16;
    into[at * 4 + 1] = (colour >> 8) & 255;
    into[at * 4 + 2] = colour & 255;
    into[at * 4 + 3] = 255;
  };
  for (let py = 0; py < tall; py++) {
    for (let px = 0; px < wide; px++) {
      const at = py * wide + px;
      if (isLand[at] === 1) continue;
      const distance = away[at] ?? farTo + 1;
      const worldX = originX + px;
      const worldY = originY + py;
      const dashed = cellHash(Math.floor(worldX / dash), Math.floor(worldY / line), 21) < SURF_LINE;
      if (distance <= foamTo) {
        if (cellHash(worldX, worldY, 19) < SURF_FOAM) put(0, at, foam);
      } else if (distance >= midFrom && distance < midFrom + line) {
        if (dashed) put(1, at, swell);
      } else if (distance >= farFrom && distance <= farTo) {
        if (dashed) put(2, at, swell);
      }
    }
  }
  return { width: wide, height: tall, rgba, surf: surfBands };
}
