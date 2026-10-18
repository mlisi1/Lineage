/**
 * Tones shared by everything drawn in the cosy style (after Stardew Valley; R1 ground and
 * plants, R2 creatures), so that the land and its animals are lit by the same light.
 * Colours are 0xRRGGBB. A part of the scene takes its own colours toward these; it does
 * not replace its colours with them.
 */

/** What outlines are taken toward: an object's own darkest tone, blended toward plum. */
export const PLUM = 0x2b1630;
/** What shade is mixed with: violet, so that the side away from the light is cooler. */
export const SHADE = 0x4a2a7a;
/** What lit patches are mixed with: gold, so that the side toward the light is warmer. */
export const GOLD = 0xffe08a;
/** A warm white, for small lit marks and glints that should not read as pure white. */
export const SUNLIT = 0xfff1b8;
/** Shadows cast on the ground: this colour, see-through. */
export const GROUND_SHADOW = 0x10081c;
/**
 * Water, as seen over what is under it: what a submerged body is taken toward (the sea's
 * middle depth band in the report maps), and the dark its outline turns to.
 */
export const WATER = 0x3b7fbf;
export const DEEP_WATER = 0x1f437a;
