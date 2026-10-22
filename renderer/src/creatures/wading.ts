/**
 * A land animal in the water (R5, the owner: animals may be in the shallows, as long as it
 * is clear they struggle more than on land, unless they are partly aquatic).
 *
 * The simulation lets a walker into the sea: on `main` it pays heavily for every hour
 * there and drowns when its energy runs out; with M11's wading, the shallow shelf costs it
 * nothing. The renderer shows what the simulation says, never moves an animal out of the
 * water, and draws how hard it is going:
 *
 *   shallows  (no deeper than `WADE_DEPTH` below the sea) its legs are under the water,
 *             it slows, and ripples spread from it
 *   deep      its legs are gone from sight, its body sunk but for its head, it slows more,
 *             bobs, and the ripples come faster and wider
 *
 * How much of that shows is its effort: none for a body as aquatic as a swimmer's, all of
 * it for one with no aquatic gene at all.
 */
import { CanvasSource, Rectangle, Texture } from "pixi.js";
import { SWIMS_FROM } from "./body";

/** How the water holds an animal: not at all, wading in the shallows, or out of its depth. */
export type Wet = "dry" | "shallow" | "deep";

/** Below the sea (height units) a walker still wades: M11's shallow shelf (`[fauna] wading_depth`). */
export const WADE_DEPTH = 0.03;
/** How much slower a walker with no aquatic gene goes, wading, and out of its depth. */
const WADE_SLOWS = 0.45;
const DEEP_SLOWS = 0.7;
/** Out of its depth, it bobs this far (cells) this many times a second. */
const BOB_CELLS = 0.035;
const BOB_PER_S = 1.6;
/** Ripples: seconds one takes to spread wading and out of its depth, and how far, in body lengths. */
const RIPPLE_S = { shallow: 1.6, deep: 0.9 } as const;
const RIPPLE_REACH = { shallow: 1.8, deep: 2.4 } as const;
/** A ripple starts this share of its reach across, and is this opaque at its start. */
const RIPPLE_FROM = 0.45;
const RIPPLE_ALPHA = 0.7;
/** Ripples are seen at a slant from above: this much shorter than wide. */
const RIPPLE_SLANT = 0.6;
/** The ripples round one animal, each this share of a spread behind the one before. */
export const RIPPLES = 2;

/** How the water holds a walker this far (height units) below the sea; 0 or less is land. */
export function wetOf(below: number): Wet {
  return below <= 0 ? "dry" : below <= WADE_DEPTH ? "shallow" : "deep";
}

/** How hard the water is for a body with this aquatic gene: 1 with none, 0 for a swimmer's. */
export function effortOf(aquatic: number): number {
  return Math.min(Math.max(1 - aquatic / SWIMS_FROM, 0), 1);
}

/** How fast it goes in `wet` against on land, for its `effort`. */
export function paceIn(wet: Wet, effort: number): number {
  if (wet === "dry") return 1;
  return 1 - (wet === "shallow" ? WADE_SLOWS : DEEP_SLOWS) * effort;
}

/** How far (cells) it is lifted, out of its depth, at `timeS`; `offset` keeps animals apart. */
export function bobAt(wet: Wet, effort: number, timeS: number, offset: number): number {
  if (wet !== "deep") return 0;
  return BOB_CELLS * effort * Math.sin(2 * Math.PI * (BOB_PER_S * timeS + offset));
}

/**
 * Ripple `k` round an animal `length` cells long at `timeS`: how far across it is (cells)
 * and how opaque, for its `effort`; null when it shows nothing.
 */
export function rippleAt(
  wet: Wet,
  effort: number,
  length: number,
  timeS: number,
  k: number,
): { across: number; alpha: number } | null {
  if (wet === "dry") return null;
  const phase = (timeS / RIPPLE_S[wet] + k / RIPPLES) % 1;
  const reach = RIPPLE_REACH[wet] * Math.max(length, 0.5);
  const across = reach * (RIPPLE_FROM + (1 - RIPPLE_FROM) * phase);
  // A swimmer-like body leaves faint rings; one that struggles, plain ones.
  const alpha = RIPPLE_ALPHA * (1 - phase) * (0.35 + 0.65 * effort);
  return { across, alpha };
}

const rings = new Map<number, Texture>();

/** A ripple's ring `across` art pixels wide, one pixel thick, white (tinted by whoever draws it). */
export function ringTexture(across: number): Texture {
  const wide = Math.max(3, Math.round(across));
  const known = rings.get(wide);
  if (known !== undefined) return known;
  const tall = Math.max(3, Math.round(wide * RIPPLE_SLANT));
  const canvas = document.createElement("canvas");
  canvas.width = wide;
  canvas.height = tall;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for a ripple");
  context.fillStyle = "#ffffff";
  const rx = wide / 2;
  const ry = tall / 2;
  // The pixels whose middles lie within half a pixel of the ellipse.
  for (let y = 0; y < tall; y++) {
    for (let x = 0; x < wide; x++) {
      const u = (x + 0.5 - rx) / rx;
      const v = (y + 0.5 - ry) / ry;
      const r = Math.hypot(u, v);
      const pixel = 1 / Math.min(rx, ry);
      if (Math.abs(r - (1 - pixel / 2)) <= pixel / 2) context.fillRect(x, y, 1, 1);
    }
  }
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const texture = new Texture({ source, frame: new Rectangle(0, 0, wide, tall) });
  rings.set(wide, texture);
  return texture;
}
