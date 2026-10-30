/**
 * Plants in the wind (R5, the owner, 2026-10-23): grass, flowers, bushes and the crowns of
 * trees lean with the wind, a little on a calm day, more in rain, much more in a
 * thunderstorm, and a little less at night. The wind comes in gusts that roll across the
 * land as a slow wave, so neighbouring plants move together and plants far apart do not.
 *
 * A pixel-art plant cannot bend smoothly: it leans by whole art pixels. Each drawing that
 * bends is drawn again a few times, leaning one, two, three pixels with the wind and one
 * against it (`leanedPixels`): the rows above its hinge (the trunk, the foot of a tuft)
 * slide sideways by whole pixels, more toward the top, up to where it is stiff (a tree's
 * crown moves as one). The plant layer swaps a plant's drawing for the lean the wind
 * gives it where it stands (`PlantLayer.blow`); no shader, no smearing, and the drawings
 * stay in the sheet they were packed in, so the plants are still drawn in one batch.
 */
import type { Pixels } from "../terrain/pixels";
import { valueNoise } from "../terrain/ground";

/** The wind as the scene has it this frame: its own clock, and how hard it blows. */
export interface Wind {
  /** Seconds on the atmosphere's clock: gusts roll on with it, and stand when it stands. */
  timeS: number;
  /** How hard it blows: 1 a calm day's breeze, more in rain and storms (`windStrength`). */
  strength: number;
}

/**
 * How a kind of drawing bends: `flex` art pixels of lean at the top for each pixel of its
 * height, at a wind of strength 1 at the crest of a gust; it bends from `hinge` (a share of
 * its height above the foot) and above `stiff` moves as one piece.
 */
export interface Bend {
  flex: number;
  hinge: number;
  stiff: number;
}

/**
 * How each kind bends, by the first part of its drawing's name. Grass bends from its foot
 * and the most; a flower or a reed nearly as much; a bush from a little above the ground,
 * its top half as one; a broadleaf from its trunk, its crown (the upper part) as one; a
 * conifer is stiffer. Stones, logs, mushrooms, stumps and snags do not move.
 */
const BENDS: Readonly<Record<string, Bend>> = {
  GRASS: { flex: 0.09, hinge: 0, stiff: 1 },
  dry: { flex: 0.08, hinge: 0, stiff: 1 },
  daisy: { flex: 0.07, hinge: 0.1, stiff: 1 },
  bell: { flex: 0.07, hinge: 0.1, stiff: 1 },
  spike: { flex: 0.07, hinge: 0.1, stiff: 1 },
  umbel: { flex: 0.07, hinge: 0.1, stiff: 1 },
  reed: { flex: 0.07, hinge: 0.1, stiff: 1 },
  herb: { flex: 0.06, hinge: 0.1, stiff: 1 },
  fern: { flex: 0.05, hinge: 0.1, stiff: 1 },
  SHRUB: { flex: 0.022, hinge: 0.15, stiff: 0.65 },
  BROADLEAF: { flex: 0.012, hinge: 0.25, stiff: 0.55 },
  CONIFER: { flex: 0.009, hinge: 0.2, stiff: 0.6 },
};

/** Overlays that stand on the ground, not on the plant: mangrove roots do not move. */
const STILL_OVERLAYS = ["#stilts"] as const;

/** How a drawing named `key` (`season[+snow]:FORM/...` or `kind/variant`) bends, if at all. */
export function bendOf(key: string): Bend | null {
  if (STILL_OVERLAYS.some((overlay) => key.endsWith(overlay))) return null;
  const name = key.slice(key.indexOf(":") + 1);
  const kind = name.slice(0, name.indexOf("/"));
  return BENDS[kind] ?? null;
}

/**
 * The furthest any drawing leans (art pixels at its top): the tallest tree in the strongest
 * storm. Each pixel more is one more drawing of every plant that bends, in the sheet.
 */
const MOST = 3;
/** Nor more than this share of its height: a small tuft of the middle view leans a pixel. */
const MOST_SHARE = 0.2;
/** Pixels a plant that bends at all leans back against the wind as a gust lets go. */
const RECOIL = 1;
/** Fewest pixels of lean at the strongest wind for a drawing to be drawn leaning at all. */
const LEANS_FROM = 1;

/**
 * The leans a drawing is drawn in (art pixels at its top, with the wind positive): from
 * `-RECOIL` to the most the strongest wind gives it, or none for one that does not bend.
 * Its height is the height of the plant above its foot (`footY`).
 */
export function leansOf(bend: Bend | null, height: number): { lowest: number; highest: number } {
  if (bend === null) return { lowest: 0, highest: 0 };
  const strongest = CALM_WIND + RAIN_WIND + STORM_WIND;
  const hardest = BREEZE + GUST + ROCK;
  const highest = Math.min(
    Math.round(strongest * hardest * bend.flex * height),
    MOST,
    Math.ceil(MOST_SHARE * height),
  );
  if (highest < LEANS_FROM) return { lowest: 0, highest: 0 };
  return { lowest: -RECOIL, highest };
}

/**
 * Drawing `pixels`, whose foot is `footY` pixels down, leaning `lean` art pixels at its top,
 * widened by `left` and `right` clear pixels (the most it leans either way): each row
 * slides by whole pixels, none at the hinge and below, `lean` from where it is stiff up.
 */
export function leanedPixels(
  pixels: Pixels,
  footY: number,
  bend: Bend,
  lean: number,
  left: number,
  right: number,
): Pixels {
  const width = pixels.width + left + right;
  const { height } = pixels;
  const rgba = new Uint8ClampedArray(width * height * 4);
  const hinge = footY * (1 - bend.hinge);
  const stiff = footY * (1 - bend.stiff);
  for (let row = 0; row < height; row++) {
    const share = Math.min(Math.max((hinge - row) / Math.max(hinge - stiff, 1), 0), 1);
    const shift = Math.round(lean * share);
    const from = row * pixels.width * 4;
    rgba.set(pixels.rgba.subarray(from, from + pixels.width * 4), (row * width + left + shift) * 4);
  }
  return { width, height, rgba };
}

/** The wind of a calm day, and what rain and a thunderstorm add to it (strength). */
const CALM_WIND = 1;
const RAIN_WIND = 0.9;
const STORM_WIND = 1.5;
/** At full dark the wind drops by this share: nights are a little calmer. */
const NIGHT_CALM = 0.3;

/**
 * How hard the wind blows: a calm day's breeze, more as it rains (`rain`, the rain's
 * strength, 1 a steady shower, eased by the atmosphere), more again in a thunderstorm
 * (`storm`, 0–1, eased), a little less in the dark (`dark`, 0–1).
 */
export function windStrength(rain: number, storm: number, dark: number): number {
  const wet = Math.min(Math.max(rain, 0), 1);
  return (CALM_WIND + RAIN_WIND * wet + STORM_WIND * storm) * (1 - NIGHT_CALM * dark);
}

/** Where the wind blows to: east, a little south (cells; the rain leans the same way). */
const BLOWS_X = 0.94;
const BLOWS_Y = 0.34;
/** How far apart gusts come along the wind, and how wide a gust's front is across it (cells). */
const GUST_LENGTH_CELLS = 7;
const GUST_WIDTH_CELLS = 5;
/**
 * How fast gusts roll across the land (cells a second): a slow wave. The same in any wind:
 * a speed that changed with the strength would throw the gusts across the land as the
 * rain eased in (the distance rolled is the speed times the clock).
 */
const GUST_SPEED_CELLS = 2.2;
/** The steady push of the wind between gusts, and what a gust adds at its crest. */
const BREEZE = 0.3;
const GUST = 0.8;
/** Below this the noise is a lull (a plant springs back a little against the wind), above it a gust. */
const GUST_FROM = 0.45;
/**
 * The plants' rocking between gusts (share of the gust's push), a ripple `ROCK_CELLS`
 * long that rolls with the wind as the gusts do (a plant rocks once every 2.3 s), so that
 * neighbours rock nearly together: each only up to `ROCK_JITTER` radians out of step.
 */
const ROCK = 0.12;
const ROCK_CELLS = 5;
export const ROCK_JITTER = 1.2;
/** The noise's salt: gusts are their own pattern, not the ground's. */
const GUST_SALT = 913;

/**
 * The wind's push on a plant standing at (x, y) (cells) at `timeS`, about -0.5 to 1.2: a
 * steady breeze, gusts that roll across the land with the wind, and a gentle rocking that
 * rolls with them, `jitter` (radians, up to `ROCK_JITTER`) out of step with its neighbours'.
 */
/**
 * The most a plant of `reach` 1 leans (pixels): the strongest wind (a storm in rain, by day)
 * at a gust's crest, the rock with it, or a lull's spring back the other way. A plant whose
 * reach times this is under half a pixel never leans: `PlantLayer.blow` passes it by.
 */
export const MOST_LEAN_PER_REACH =
  (CALM_WIND + RAIN_WIND + STORM_WIND) *
  Math.max(BREEZE + GUST + ROCK, Math.abs(BREEZE - (GUST * GUST_FROM) / (1 - GUST_FROM) - ROCK));

export function gustAt(x: number, y: number, timeS: number, jitter: number): number {
  const along = x * BLOWS_X + y * BLOWS_Y - GUST_SPEED_CELLS * timeS;
  const across = y * BLOWS_X - x * BLOWS_Y;
  const noise = valueNoise(along / GUST_LENGTH_CELLS, across / GUST_WIDTH_CELLS, GUST_SALT);
  const gust = (noise - GUST_FROM) / (1 - GUST_FROM);
  const rock = Math.sin((2 * Math.PI * along) / ROCK_CELLS + jitter);
  return BREEZE + GUST * gust + ROCK * rock;
}
