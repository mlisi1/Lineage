/**
 * When the waves come to each place of the island (R4), shared by the painter (which
 * writes it into the shore's data, `ground.ts`) and the sea (which plays it, `sea.ts`).
 * Free of PixiJS, so the painter's worker can use it.
 */
import { cellHash } from "./pixels";

/** Seconds of a wave: lines rolling in, the break, the swash running up and draining. */
export const BREATH_S = 5;
/**
 * How far apart in time the waves break along the coasts: up to this many seconds, turning
 * over this many cells, so a stretch of beach breaks almost at once (as waves meet a beach
 * nearly parallel) and far coasts at their own time.
 */
const WAVE_SPREAD_S = 2.5;
const WAVE_SPREAD_SPAN = 60;

/** Smooth noise in [0, 1) over the plane. */
function smooth(x: number, y: number, salt: number): number {
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

/**
 * When the waves come to a place of the island (x, y in cells), as seconds added to the
 * clock there: a slow, wide noise, the same in every view.
 */
export function tidePhase(x: number, y: number): number {
  return WAVE_SPREAD_S * smooth(x / WAVE_SPREAD_SPAN, y / WAVE_SPREAD_SPAN, 31);
}

/**
 * The shore's sizes in a view of `tile` art pixels to the cell, in art pixels: how far
 * apart the wave lines roll in, how far out they are seen, how far up the beach the swash
 * runs at high tide (none on the map, whose coast is a pixel).
 */
export function shoreSizes(tile: number): { spacing: number; reach: number; swash: number } {
  if (tile < 8) return { spacing: 3, reach: 6, swash: 0 };
  if (tile < 32) return { spacing: 5, reach: 15, swash: 4 };
  return { spacing: 9, reach: 27, swash: 10 };
}

/**
 * The open sea's swell (round 7, the owner: the water away from the coast should move too,
 * on the map and a little in the middle view): long, low crests lying across the screen,
 * bent by a wide noise and broken into short dashes, drifting down the sea, after how pixel
 * art draws open water. In a view of `tile` art pixels to the cell: the crests' spacing
 * (art pixels) and how strongly they show (0: not at all, as up close, where the water is
 * calm away from the shore).
 */
export function swellSizes(tile: number): { spacing: number; strength: number } {
  if (tile < 8) return { spacing: 12, strength: 1 };
  if (tile < 32) return { spacing: 20, strength: 0.7 };
  return { spacing: 0, strength: 0 };
}

/** The way the swell runs (radians, screen y down: nearly straight down) and how far a crest bends (spacings). */
const SWELL_ANGLE = 1.45;
const SWELL_BEND = 1.4;
/** How wide the noise that bends the crests is, in spacings. */
const SWELL_BEND_SPAN = 3;
/** The dashes a crest is broken into: how long and how tall the noise that breaks it is, in spacings. */
const SWELL_DASH_ACROSS = 0.6;
const SWELL_DASH_DOWN = 0.2;

/**
 * Art pixel (x, y) of a view in the swell: where it lies between two crests (a share of
 * the spacing, 0–1; the shader moves the crests on by adding time to it), and its dash
 * noise (0–1; the shader shows a crest where the noise, drifting, is low).
 */
export function swellAt(x: number, y: number, spacing: number): { phase: number; dash: number } {
  const along = (x * Math.cos(SWELL_ANGLE) + y * Math.sin(SWELL_ANGLE)) / spacing;
  const span = spacing * SWELL_BEND_SPAN;
  const turn = along + SWELL_BEND * smooth(x / span, y / span, 41);
  const dash = smooth(x / (spacing * SWELL_DASH_ACROSS), y / (spacing * SWELL_DASH_DOWN), 43);
  return { phase: turn - Math.floor(turn), dash };
}

/** Seconds of a tide, which sets how far the swash runs (its least and most share). */
export const TIDE_S = 60;
export const TIDE_LOW = 0.55;

/** How far the tide is in at `timeS` (wall seconds): from `TIDE_LOW` to 1. */
export function tideLevel(timeS: number): number {
  return TIDE_LOW + (1 - TIDE_LOW) * (0.5 + 0.5 * Math.sin((2 * Math.PI * timeS) / TIDE_S));
}

/** The swash's share of a wave that it runs up the sand, and back down by. */
const SWASH_RISES = 0.3;
const SWASH_FALLS = 0.8;
const ease = (t: number): number => {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
};

/**
 * How far up the beach (art pixels) the swash is at `timeS` at a place (cells), when it
 * runs at most `top` art pixels up: as the shore's shader draws it (`sea.ts`), each place
 * on its own wave (`tidePhase`), rising for the first 0.3 of the wave and back by 0.8.
 */
export function swashUp(timeS: number, x: number, y: number, top: number): number {
  const turn = ((((timeS + tidePhase(x, y)) / BREATH_S) % 1) + 1) % 1;
  if (turn < SWASH_RISES) return top * ease(turn / SWASH_RISES);
  if (turn < SWASH_FALLS)
    return top * (1 - ease((turn - SWASH_RISES) / (SWASH_FALLS - SWASH_RISES)));
  return 0;
}
