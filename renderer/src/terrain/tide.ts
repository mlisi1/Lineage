/**
 * When the waves come to each place of the island (R4), shared by the painter (which
 * writes it into the shore's data, `ground.ts`) and the sea (which plays it, `sea.ts`).
 * Free of PixiJS, so the painter's worker can use it.
 */
import { cellHash } from "./pixels";

/** Seconds of a wave: lines rolling in, the break, the swash running up and draining. */
export const BREATH_S = 5;
/** The wave front: the way it travels (unit vector), its speed (cells a second); how much it wanders (seconds, over cells). */
const WAVE_HEADING = [0.8, 0.6] as const;
const WAVE_SPEED = 5;
const WAVE_WANDER_S = 1.2;
const WAVE_WANDER_SPAN = 40;

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
 * Where the waves are at a place of the island (x, y in cells), as seconds added to the
 * clock there: a front travelling across the sea at `WAVE_SPEED`, wandering a little, so
 * near places break a moment apart and the wave runs along a coast; the same in every view.
 */
export function tidePhase(x: number, y: number): number {
  const along = x * WAVE_HEADING[0] + y * WAVE_HEADING[1];
  const wander = WAVE_WANDER_S * smooth(x / WAVE_WANDER_SPAN, y / WAVE_WANDER_SPAN, 31);
  return -along / WAVE_SPEED + wander;
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
