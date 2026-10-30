/**
 * What the look sheet and the benchmark draw the three views with: the choices made so
 * far (the views' own numbers now live in `creatures/views.ts`, R5), and what only the
 * sheets use.
 */
import { CREATURE_SCALE } from "../creatures/views";
import type { GroundStyle } from "../terrain/ground";

export {
  CREATURE_SCALE,
  LOCAL_PIXELS,
  MAP_PIXELS,
  MID_BODY,
  MID_CREATURE_SCALE,
  MID_PIXELS,
  WATER_LOOK,
  localBody,
  midBody,
} from "../creatures/views";

/** Chosen: the map interpolated, the ground of the closer views interpolated and dithered. */
export const MAP_GROUND: GroundStyle = "smooth";
export const GROUND: GroundStyle = "blended";
/**
 * Portraits, as a bestiary will show an animal: from close enough that one of mass 1 is
 * some thirty art pixels long, whatever size the views draw it at.
 */
export const PORTRAIT_PIXELS = Math.round(32 / CREATURE_SCALE);
