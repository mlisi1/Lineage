/** The full-screen tint: one colour multiplied over the scene for the time of day. */

/** Tint colours at four points of the day, as red, green and blue multipliers. */
export const LIGHTS = {
  day: [1.0, 1.0, 1.0],
  dusk: [1.0, 0.76, 0.56],
  night: [0.36, 0.44, 0.72],
  dawn: [0.92, 0.72, 0.78],
} as const;
export type Light = keyof typeof LIGHTS;
export const LIGHT_ORDER: readonly Light[] = ["day", "dusk", "night", "dawn"];
/** Seconds for the spike's tint to go through the whole day. */
export const DAY_CYCLE_S = 16;

type Rgb = readonly [number, number, number];

function pack(from: Rgb, to: Rgb, mix: number): number {
  const channel = (i: 0 | 1 | 2): number => Math.round((from[i] + (to[i] - from[i]) * mix) * 255);
  return (channel(0) << 16) | (channel(1) << 8) | channel(2);
}

/** The tint of one time of day, as 0xRRGGBB. */
export function lightTint(light: Light): number {
  return pack(LIGHTS[light], LIGHTS[light], 0);
}

/** The tint `timeS` seconds into the cycle, blending from each time of day to the next. */
export function cycleTint(timeS: number): number {
  const phase = ((timeS / DAY_CYCLE_S) % 1) * LIGHT_ORDER.length;
  const index = Math.floor(phase);
  const from = LIGHT_ORDER[index % LIGHT_ORDER.length] ?? "day";
  const to = LIGHT_ORDER[(index + 1) % LIGHT_ORDER.length] ?? "day";
  return pack(LIGHTS[from], LIGHTS[to], phase - index);
}
