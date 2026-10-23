/**
 * The creatures' textures (R5: moved here from the R0 spike, which the real scene no
 * longer depends on): a white disc, a white square and a white wedge in one small canvas,
 * tinted per part. The spike's own atlas adds its plants beside them.
 */
import { CanvasSource, Rectangle, Texture } from "pixi.js";
import type { Pixels } from "../terrain/pixels";

/** Big enough to stay round on the largest animal of the closest view. */
export const DISC_SIZE = 64;
/** Texels across the white square. */
export const WHITE_SIZE = 4;

export interface Atlas {
  /** Plant textures by look (the spike's; the scene draws its plants otherwise, R1). */
  plants: ReadonlyMap<string, Texture>;
  /** A white disc: body segments, tinted. */
  disc: Texture;
  /** A white square: legs and the full-screen tint, stretched and tinted. */
  white: Texture;
  /** A white wedge pointing right: snouts, fins, claws, tinted. */
  wedge: Texture;
}

/** Copy `pixels` into `context` at (x, y). */
export function put(context: CanvasRenderingContext2D, pixels: Pixels, x: number, y: number): void {
  context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), x, y);
}

/** A filled white disc with hard edges, `size` pixels across: one body segment. */
export function disc(size: number): Pixels {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const centre = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = (x + 0.5 - centre) ** 2 + (y + 0.5 - centre) ** 2 <= centre * centre;
      if (inside) rgba.set([255, 255, 255, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, rgba };
}

/** A hard-edged white wedge: its base down the left edge, its point at the middle right. */
export function wedge(size: number): Pixels {
  const rgba = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const half = (size / 2) * (1 - (x + 0.5) / size);
      if (Math.abs(y + 0.5 - size / 2) <= half) rgba.set([255, 255, 255, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, rgba };
}

/** The disc, the white square and the wedge, which start `below` in `source`. */
export function shapes(
  source: CanvasSource,
  below: number,
  wedgeLeft: number,
): Omit<Atlas, "plants"> {
  return {
    disc: new Texture({ source, frame: new Rectangle(1, below, DISC_SIZE, DISC_SIZE) }),
    // The inner pixels only, so stretching never samples the transparent surround.
    white: new Texture({
      source,
      frame: new Rectangle(DISC_SIZE + 4, below + 1, WHITE_SIZE - 2, WHITE_SIZE - 2),
    }),
    wedge: new Texture({ source, frame: new Rectangle(wedgeLeft, below, DISC_SIZE, DISC_SIZE) }),
  };
}

/** The atlas of the creatures alone (the scene draws its plants otherwise, R1). */
export function creatureAtlas(): Atlas {
  const canvas = document.createElement("canvas");
  canvas.width = 2 * DISC_SIZE + WHITE_SIZE + 8;
  canvas.height = DISC_SIZE + 2;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the atlas");
  put(context, disc(DISC_SIZE), 1, 1);
  context.fillStyle = "#ffffff";
  context.fillRect(DISC_SIZE + 3, 1, WHITE_SIZE, WHITE_SIZE);
  const wedgeLeft = DISC_SIZE + WHITE_SIZE + 5;
  put(context, wedge(DISC_SIZE), wedgeLeft, 1);
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  return { plants: new Map(), ...shapes(source, 1, wedgeLeft) };
}
