/**
 * What the look sheet and the benchmark draw the three views with: the choices made so
 * far, and for what is still open the proposal the rest is held at.
 */
import type { BodyOptions } from "./body";
import type { GroundStyle } from "./ground";

/** Art pixels to the cell in each view. The map and the middle view are settled. */
export const MAP_PIXELS = 2;
export const MID_PIXELS = 8;
/** The local view follows one animal from close by; how close is still to be chosen. */
export const LOCAL_ZOOMS = [24, 32, 48] as const;
export const LOCAL_PIXELS = 32;

/** Chosen: the map interpolated, the ground of the closer views interpolated and dithered. */
export const MAP_GROUND: GroundStyle = "smooth";
export const GROUND: GroundStyle = "blended";
/** Chosen for the middle view: the large plants (a name of `PLANT_SCALES`). */
export const PLANTS = "large";

/**
 * Chosen: body plans, outlined and lit, drawn a little smaller than the first look's
 * (which makes them larger than its double once the local view is four times closer).
 * Up close an animal ambles instead of hurrying.
 */
const CREATURE_SCALE = 0.85;
export const MID_BODY: BodyOptions = {
  style: "lit",
  scale: CREATURE_SCALE,
  pixels: MID_PIXELS,
  pace: 1,
};
export function localBody(pixels: number): BodyOptions {
  return { style: "lit", scale: CREATURE_SCALE, pixels, pace: 0.35 };
}
