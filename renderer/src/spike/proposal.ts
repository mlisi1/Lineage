/**
 * What I would pick among the look sheet's proposals. The sheet holds everything else
 * at these while it varies one thing, and the benchmark measures the two views drawn
 * with them. Nothing here is settled until the owner has chosen.
 */
import type { BodyOptions } from "./body";
import type { GroundStyle } from "./ground";

export const PROPOSED_GROUND: GroundStyle = "blended";
export const PROPOSED_MAP_GROUND: GroundStyle = "smooth";
/** A name of `PLANT_SCALES`. */
export const PROPOSED_PLANTS = "medium";
export const PROPOSED_BODY: BodyOptions = { style: "lit", scale: 1.5 };
