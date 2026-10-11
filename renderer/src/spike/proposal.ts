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

/** Chosen: the map interpolated, the ground of the closer views interpolated and dithered. */
export const MAP_GROUND: GroundStyle = "smooth";
export const GROUND: GroundStyle = "blended";
/** Chosen for the middle view: the large plants (a name of `PLANT_SCALES`). */
export const PLANTS = "large";
/** Chosen for the local view: trees and bushes as bundles of leaves (T1). */
export const TREES: TreeStyle = "bundles";

/**
 * How large animals are drawn, against the first look's. Chosen: body plans, outlined
 * and lit. The middle view is drawn at the size it was found good at. The local view's
 * is still open, among these; the rest of the sheet is held at the proposed one, at
 * which an animal of mass 1 is an eighth as long as a grown tree is tall. Whether the
 * middle view then follows (one size in every view, as so far) or keeps its own is
 * part of the choice.
 */
export const MID_CREATURE_SCALE = 0.5;
export const CREATURE_SCALES = [0.2, 0.25, 0.3, 0.35, 0.4, 0.5] as const;
export const CREATURE_SCALE = 0.35;
/**
 * Portraits, as a bestiary will show an animal: from close enough that one of mass 1 is
 * some thirty art pixels long, whatever size the views draw it at.
 */
export const PORTRAIT_PIXELS = Math.round(32 / CREATURE_SCALE);
/** A body of the middle view, at `scale`. */
export function midBody(scale: number = MID_CREATURE_SCALE): BodyOptions {
  return { style: "lit", scale, pixels: MID_PIXELS, pace: 1 };
}
export const MID_BODY: BodyOptions = midBody();
/** Up close an animal ambles instead of hurrying. */
export function localBody(pixels: number, scale: number = CREATURE_SCALE): BodyOptions {
  return { style: "lit", scale, pixels, pace: 0.35 };
}
