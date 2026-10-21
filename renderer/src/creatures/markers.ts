/**
 * An animal on the map (R5): a round dot of whole art pixels in its body's colour with a
 * dark edge, in three sizes by mass instead of a square grown with it; a swimmer's dot is
 * a ring round a dark middle, so that the sea's animals read apart from the land's.
 */
import { CanvasSource, Rectangle, Texture } from "pixi.js";

export type DotSize = "small" | "medium" | "large";

/** The dot's colour, by size: where the body's colour goes, a row of art pixels a string. */
const FILLS: Readonly<Record<DotSize, readonly string[]>> = {
  small: ["##", "##"],
  medium: [".##.", "####", "####", ".##."],
  large: ["..##..", ".####.", "######", "######", ".####.", "..##.."],
};
/** Mass (cube root) from which a dot is medium, and large. */
const MEDIUM_FROM = 1.25;
const LARGE_FROM = 2;

/** The size of the dot of an animal of this mass. */
export function dotSize(mass: number): DotSize {
  const across = Math.cbrt(mass);
  return across >= LARGE_FROM ? "large" : across >= MEDIUM_FROM ? "medium" : "small";
}

/** A dot's two textures: the edge (to tint dark) and the colour (to tint the body's). */
export interface Dot {
  edge: Texture;
  fill: Texture;
  /** Art pixels across, the edge included. */
  across: number;
}

let dots: Map<string, Dot> | null = null;

/** The dot of `size`, a ring for a swimmer; drawn once for every animal. */
export function dotOf(size: DotSize, ring: boolean): Dot {
  dots ??= drawDots();
  const dot = dots.get(`${size}${ring ? ":ring" : ""}`);
  if (dot === undefined) throw new Error(`no map dot ${size}`);
  return dot;
}

function drawDots(): Map<string, Dot> {
  const masks: [string, boolean[][]][] = [];
  for (const [size, rows] of Object.entries(FILLS) as [DotSize, readonly string[]][]) {
    const fill = rows.map((row) => [...row].map((pixel) => pixel === "#"));
    masks.push([size, fill]);
    // A ring: the fill less what is inside its own edge (a small dot stays whole).
    const inside = fill.map((row, y) =>
      row.map(
        (on, x) =>
          on &&
          (fill[y - 1]?.[x] ?? false) &&
          (fill[y + 1]?.[x] ?? false) &&
          (row[x - 1] ?? false) &&
          (row[x + 1] ?? false),
      ),
    );
    masks.push([`${size}:ring`, fill.map((row, y) => row.map((on, x) => on && !inside[y]?.[x]))]);
  }
  const widest = Math.max(...masks.map(([, mask]) => mask.length + 2));
  const canvas = document.createElement("canvas");
  canvas.width = masks.length * (widest + 1) * 2;
  canvas.height = widest;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the map's dots");
  context.fillStyle = "#ffffff";
  const frames: [string, Rectangle, Rectangle, number][] = [];
  masks.forEach(([key, mask], index) => {
    const across = mask.length + 2;
    const left = index * (widest + 1) * 2;
    const at = (x: number, y: number): boolean => mask[y]?.[x] ?? false;
    // The edge: every pixel next to the fill (not diagonally, so that it stays round),
    // and the fill itself, which the colour covers; a ring's hole is edge too.
    for (let y = -1; y <= mask.length; y++) {
      for (let x = -1; x <= mask.length; x++) {
        const near = at(x, y) || at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1);
        if (near) context.fillRect(left + x + 1, y + 1, 1, 1);
      }
    }
    const fillLeft = left + widest + 1;
    for (let y = 0; y < mask.length; y++)
      for (let x = 0; x < mask.length; x++) if (at(x, y)) context.fillRect(fillLeft + x + 1, y + 1, 1, 1);
    frames.push([
      key,
      new Rectangle(left, 0, across, across),
      new Rectangle(fillLeft, 0, across, across),
      across,
    ]);
  });
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  return new Map(
    frames.map(([key, edge, fill, across]) => [
      key,
      { edge: new Texture({ source, frame: edge }), fill: new Texture({ source, frame: fill }), across },
    ]),
  );
}
