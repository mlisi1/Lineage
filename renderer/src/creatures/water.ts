/**
 * An animal seen through the water it lives in. The water where it swims (light in the
 * shallows, dark blue in the deep) decides how it looks, in one of three ways to choose
 * from (`WaterLook`):
 *
 *   hue    every colour turns toward the water's hue at its own lightness, so that its
 *          shading still reads, then into a haze of the water that thickens with depth
 *   murk   its own hues, darkened, then partly the water's colour, as if the water showed
 *          through it: more of both with depth
 *   glass  its own hues, a little darkened, and the whole body drawn see-through, so that
 *          the sea itself (its bands, its waves) shows through it: more with depth
 *
 * Mixing toward one blue, the first try, turned reds purple and flattened every body alike.
 */

export type WaterLook = "hue" | "murk" | "glass";
export const WATER_LOOKS: readonly WaterLook[] = ["hue", "murk", "glass"];

/** The water at a place: its colour (0xRRGGBB) and how deep, 0 at the shore … 1 deep. */
export interface Sea {
  colour: number;
  depth: number;
}

/** The water at a place in cells, or null on land. */
export type SeaAt = (x: number, y: number) => Sea | null;

/** How far each colour turns to the water's hue: in the shallows, and in the deep. */
const HUE_SHALLOW = 0.45;
const HUE_DEEP = 0.75;
/** How far it then goes into the water's own colour. */
const HAZE_SHALLOW = 0.1;
const HAZE_DEEP = 0.45;
/** murk: how much darker, and how much of the water's colour, in the shallows and the deep. */
const MURK_DARKEN_SHALLOW = 0.15;
const MURK_DARKEN_DEEP = 0.45;
const MURK_WATER_SHALLOW = 0.15;
const MURK_WATER_DEEP = 0.5;
/** glass: how much darker, and how opaque the body is, in the shallows and the deep. */
const GLASS_DARKEN_SHALLOW = 0.1;
const GLASS_DARKEN_DEEP = 0.3;
const GLASS_OPACITY_SHALLOW = 0.8;
const GLASS_OPACITY_DEEP = 0.45;
/** A glint in an eye keeps more of itself: this share of the above. */
const GLINT_KEEPS = 0.45;
/** A shadow on the bottom is this much fainter in the deep (none of it at depth 1 × this). */
const SHADOW_FADES = 0.8;
/** Depths are told apart in this many steps, so an animal is recoloured only now and then. */
export const DEPTH_STEPS = 12;

const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 255,
  (rgb >> 8) & 255,
  rgb & 255,
];
const pack = (r: number, g: number, b: number): number => {
  const byte = (value: number): number => Math.min(Math.max(Math.round(value), 0), 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
};
/** Perceived lightness, 0–255. */
const lightness = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;
const mix = (from: number, to: number, t: number): number => from + (to - from) * t;

/** `colour` as seen through `sea`; a `glint` keeps more of itself. */
export function underWater(
  colour: number,
  sea: Sea,
  glint = false,
  look: WaterLook = "hue",
): number {
  const [r, g, b] = channels(colour);
  const [wr, wg, wb] = channels(sea.colour);
  const depth = Math.min(Math.max(sea.depth, 0), 1);
  const keeps = glint ? GLINT_KEEPS : 1;
  if (look !== "hue") {
    const murk = look === "murk";
    const darker =
      (murk
        ? mix(MURK_DARKEN_SHALLOW, MURK_DARKEN_DEEP, depth)
        : mix(GLASS_DARKEN_SHALLOW, GLASS_DARKEN_DEEP, depth)) * keeps;
    const water = murk ? mix(MURK_WATER_SHALLOW, MURK_WATER_DEEP, depth) * keeps : 0;
    const shade = 1 - darker;
    return pack(mix(r * shade, wr, water), mix(g * shade, wg, water), mix(b * shade, wb, water));
  }
  // The water's hue at this colour's lightness.
  const scale = lightness(r, g, b) / Math.max(lightness(wr, wg, wb), 1);
  const hue = mix(HUE_SHALLOW, HUE_DEEP, depth) * keeps;
  const haze = mix(HAZE_SHALLOW, HAZE_DEEP, depth) * keeps;
  const turned = [mix(r, wr * scale, hue), mix(g, wg * scale, hue), mix(b, wb * scale, hue)];
  return pack(
    mix(turned[0] ?? r, wr, haze),
    mix(turned[1] ?? g, wg, haze),
    mix(turned[2] ?? b, wb, haze),
  );
}

/** How opaque the whole body is under `sea`: 1 but for glass. */
export function opacityUnderWater(sea: Sea, look: WaterLook): number {
  if (look !== "glass") return 1;
  return mix(GLASS_OPACITY_SHALLOW, GLASS_OPACITY_DEEP, Math.min(Math.max(sea.depth, 0), 1));
}

/** How opaque a shadow on the bottom is under `sea`, from its opacity on land. */
export function shadowUnderWater(alpha: number, sea: Sea): number {
  return alpha * (1 - SHADOW_FADES * Math.min(Math.max(sea.depth, 0), 1));
}

/** The same water to the eye: same colour and depth step. Recolour only when this changes. */
export function seaKey(sea: Sea | null): number {
  if (sea === null) return -1;
  return sea.colour * DEPTH_STEPS + Math.round(sea.depth * (DEPTH_STEPS - 1));
}
