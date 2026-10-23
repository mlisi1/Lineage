/**
 * The scene's views as the creatures need them (R5: out of the R0 spike's proposal, which
 * now takes them from here): art pixels to the cell, the bodies' sizes, the water's look.
 */
import type { BodyOptions } from "./body";
import type { WaterLook } from "./water";

/** Art pixels to the cell in each view. */
export const MAP_PIXELS = 2;
export const MID_PIXELS = 8;
/** The local view follows one animal from close by: four times the middle view. */
export const LOCAL_PIXELS = 32;
/**
 * How large animals are drawn, against the first look's (ADR 0013): in the local view at
 * 0.35, where an animal of mass 1 is an eighth as long as a grown tree is tall; in the
 * middle view at 0.5, larger than life, as the map's dots are.
 */
export const MID_CREATURE_SCALE = 0.5;
export const CREATURE_SCALE = 0.35;
/** A body of the middle view, at `scale`. */
export function midBody(scale: number = MID_CREATURE_SCALE): BodyOptions {
  return { style: "cosy", scale, pixels: MID_PIXELS, pace: 1 };
}
export const MID_BODY: BodyOptions = midBody();
/** Up close an animal ambles instead of hurrying. */
export function localBody(pixels: number, scale: number = CREATURE_SCALE): BodyOptions {
  return { style: "cosy", scale, pixels, pace: 0.35 };
}
/** How an animal that lives in the water is seen through it (`water.ts`): murk (ADR 0013). */
export const WATER_LOOK: WaterLook = "murk";
