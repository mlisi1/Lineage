/**
 * What the look sheet and the benchmark draw the three views with: the choices made so
 * far, and for what is still open the proposal the rest is held at.
 */
import type { BodyOptions } from "./body";
import type { GroundStyle } from "./ground";
import type { TreeStyle } from "./plantart";

/** Art pixels to the cell in each view. The map and the middle view are settled. */
export const MAP_PIXELS = 2;
export const MID_PIXELS = 8;
/** The local view follows one animal from close by. Chosen: four times the middle view. */
export const LOCAL_PIXELS = 32;
/** Portraits, as the bestiary will show an animal: twice as close again. */
export const PORTRAIT_PIXELS = 64;

/** Chosen: the map interpolated, the ground of the closer views interpolated and dithered. */
export const MAP_GROUND: GroundStyle = "smooth";
export const GROUND: GroundStyle = "blended";
/** Chosen for the middle view: the large plants (a name of `PLANT_SCALES`). */
export const PLANTS = "large";
/** The local view's trees and bushes: still open; the rest is held at this style. */
export const TREES: TreeStyle = "bundles";

/**
 * How large animals are drawn, against the first look's: one number for every view, so
 * that an animal is as many cells long from far as from close. Chosen: body plans,
 * outlined and lit. Still open: the size, between these; the rest is held at the middle
 * one, at which an animal of mass 1 is about a fifth as long as a grown tree is tall.
 */
export const CREATURE_SCALES = [0.4, 0.5, 0.62] as const;
export const CREATURE_SCALE = 0.5;
export const MID_BODY: BodyOptions = {
  style: "lit",
  scale: CREATURE_SCALE,
  pixels: MID_PIXELS,
  pace: 1,
};
/** Up close an animal ambles instead of hurrying. */
export function localBody(pixels: number, scale: number = CREATURE_SCALE): BodyOptions {
  return { style: "lit", scale, pixels, pace: 0.35 };
}
