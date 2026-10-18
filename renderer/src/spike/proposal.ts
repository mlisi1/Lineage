/**
 * What the look sheet and the benchmark draw the three views with: the choices made so
 * far, and for what is still open the proposal the rest is held at.
 */
import type { BodyOptions } from "../creatures/body";
import type { GroundStyle } from "./ground";

/** Art pixels to the cell in each view. The map and the middle view are settled. */
export const MAP_PIXELS = 2;
export const MID_PIXELS = 8;
/** The local view follows one animal from close by. Chosen: four times the middle view. */
export const LOCAL_PIXELS = 32;

/** Chosen: the map interpolated, the ground of the closer views interpolated and dithered. */
export const MAP_GROUND: GroundStyle = "smooth";
export const GROUND: GroundStyle = "blended";
/**
 * How large animals are drawn, against the first look's. Chosen: body plans, outlined
 * and lit, in the cosy palette after Stardew Valley (ADR 0013); in the local view at 0.35, where an animal of mass 1 is an eighth as long as
 * a grown tree is tall; in the middle view at 0.5, larger than life, as the map's dots
 * are: at the local view's size they would be three pixels long there.
 */
export const MID_CREATURE_SCALE = 0.5;
export const CREATURE_SCALE = 0.35;
/**
 * Portraits, as a bestiary will show an animal: from close enough that one of mass 1 is
 * some thirty art pixels long, whatever size the views draw it at.
 */
export const PORTRAIT_PIXELS = Math.round(32 / CREATURE_SCALE);
/** A body of the middle view, at `scale`. */
export function midBody(scale: number = MID_CREATURE_SCALE): BodyOptions {
  return { style: "cosy", scale, pixels: MID_PIXELS, pace: 1 };
}
export const MID_BODY: BodyOptions = midBody();
/** Up close an animal ambles instead of hurrying. */
export function localBody(pixels: number, scale: number = CREATURE_SCALE): BodyOptions {
  return { style: "cosy", scale, pixels, pace: 0.35 };
}
