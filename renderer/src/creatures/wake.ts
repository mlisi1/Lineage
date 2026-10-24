/**
 * A swimmer's wake (R5, rare genes in action): an animal that swims (a swimmer's AQUATIC
 * gene, or the rare AMPHIBIOUS one, drawn by its gills, in the water) leaves a small V of
 * foam behind it while it moves, and none while it stands still. Every few art pixels it
 * swims, a pair of short foam dashes is put down beside it at its widest, one each side
 * (beside its head they were drawn over by its body), laid along the arm of the V; each drifts out to its side, shortens, fades and
 * is gone. As the swimmer goes on, the older pairs lie further behind and further apart:
 * the V. Marks of whole art pixels (`sparks.ts`) in the white of the waders' ripples.
 */
import type { Texture } from "pixi.js";
import type { Point } from "./chain";
import { pixelTexture, type SparkKind, type Sparks } from "./sparks";

/** The foam: the waders' ripples' white (`layer.ts` `RIPPLE_TINT`). */
export const FOAM = 0xf4fbff;
/** A pair of dashes is put down every this many art pixels swum. */
export const WAKE_EVERY_PX = 4;
/** It leaves a wake only swimming faster than this (cells a second): drifting is not swimming. */
export const WAKE_FROM = 0.12;
/** The arms of the V open this far (radians) from straight behind. */
const ARM = 0.45;
/** A dash drifts out to its side this fast (art pixels a second), for this long (seconds). */
const DRIFT = 10;
const DASH_S = 1.5;
/** Pairs of dashes this many art pixels each side beyond its body. */
const OUT_PX = 1;

/** The dashes by the way they lie: along, aslant down, across, aslant up; then by length. */
const DASHES: readonly (readonly (readonly string[])[])[] = [
  [["###"], ["##"]],
  [
    ["#..", ".#.", "..#"],
    ["#.", ".#"],
  ],
  [
    ["#", "#", "#"],
    ["#", "#"],
  ],
  [
    ["..#", ".#.", "#.."],
    [".#", "#."],
  ],
];

let kinds: SparkKind[] | null = null;

/** A dash lying along each of the four ways: three pixels, two, then one. */
function dashKinds(): SparkKind[] {
  if (kinds === null) {
    const dot = pixelTexture(["#"]);
    kinds = DASHES.map((lengths) => {
      const frames: Texture[] = [...lengths.map((rows) => pixelTexture(rows)), dot];
      return { frames, lasts: DASH_S, fadesAt: 0.45 };
    });
  }
  return kinds;
}

/** Which of the four ways a line at `angle` (radians, y down) lies nearest. */
function wayOf(angle: number): number {
  const half = (((angle % Math.PI) + Math.PI) % Math.PI) / (Math.PI / 4);
  return Math.round(half) % 4;
}

/**
 * Put down a pair of the wake's dashes in `sparks` beside `at` (cells), for a swimmer
 * heading `heading` whose body is `radius` cells across its middle there; `pixels` art
 * pixels to the cell.
 */
export function wakePair(
  sparks: Sparks,
  at: Point,
  heading: number,
  radius: number,
  pixels: number,
): void {
  const ways = dashKinds();
  const leftX = -Math.sin(heading);
  const leftY = Math.cos(heading);
  const out = radius + OUT_PX / pixels;
  for (const side of [1, -1] as const) {
    // The arm runs back from the head and out to this side.
    const kind = ways[wayOf(heading + Math.PI - side * ARM)];
    if (kind === undefined) continue;
    sparks.emit(
      kind,
      FOAM,
      at.x + leftX * side * out,
      at.y + leftY * side * out,
      leftX * side * DRIFT,
      leftY * side * DRIFT,
    );
  }
}
