/**
 * Rare genes (M7) on the renderer's side. The sim carries them as bits of each creature's
 * slots and sends, once, the signature each bit is drawn by (`rare.CREATURE_SIGNATURES`):
 * the renderer draws by signature, never by bit number, so the sim may renumber bits.
 * Each signature's overlay is drawn in `body.ts`; here, which an animal has, and the one
 * that changes its body values: a giant is drawn at its rare-adjusted mass.
 */
import type { Look } from "./body";

/** The signatures the renderer knows how to draw; others are carried but not drawn. */
export const RARE_LOOKS = [
  "venom",
  "warning",
  "giant",
  "elder",
  "gills",
  "coat",
  "leaves",
  "glow",
] as const;
export type RareLook = (typeof RARE_LOOKS)[number];

/** The `[fauna]` values the rare genes are drawn with (`rare.RENDER_KEYS` in the sim). */
export interface RareConfig {
  giant_mass_factor: number;
}

export function parseRareConfig(raw: unknown): RareConfig {
  const value =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)["giant_mass_factor"]
      : undefined;
  if (typeof value !== "number") throw new Error('rare config: bad or missing "giant_mass_factor"');
  return { giant_mass_factor: value };
}

/** Signature by bit, from the sim's table. */
export type Signatures = ReadonlyMap<number, string>;

/** The signatures of the rare genes in `slots`, in bit order; unknown ones left out. */
export function rareLooks(slots: number, signatures: Signatures): RareLook[] {
  const looks: RareLook[] = [];
  for (const [bit, signature] of [...signatures].sort(([a], [b]) => a - b)) {
    if ((slots & bit) !== 0 && (RARE_LOOKS as readonly string[]).includes(signature)) {
      looks.push(signature as RareLook);
    }
  }
  return looks;
}

/** `look` with its rare genes: their overlays, and a giant's mass. */
export function withRare<T extends Look>(
  look: T,
  rare: readonly RareLook[],
  config: RareConfig,
): T {
  const giant = rare.includes("giant") ? config.giant_mass_factor : 1;
  return { ...look, mass: look.mass * giant, rare };
}
