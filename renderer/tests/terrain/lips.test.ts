import { describe, expect, it } from "vitest";
import { MID_TILE, paintGround } from "../../src/terrain/ground";
import { R0 } from "../../src/looks";
import { hexToRgb, type Pixels } from "../../src/terrain/pixels";
import { SEA_LEVEL, world } from "../spike/worlds";

const rows = (letter: string, width: number, height: number): string[] =>
  Array.from({ length: height }, () => letter.repeat(width));
const NEAR = 4 * MID_TILE;
const rgb = (image: Pixels, x: number, y: number): [number, number, number] => {
  const i = (y * image.width + x) * 4;
  return [image.rgba[i] ?? 0, image.rgba[i + 1] ?? 0, image.rgba[i + 2] ?? 0];
};
const brightness = (image: Pixels, x: number, y: number): number =>
  rgb(image, x, y).reduce((sum, channel) => sum + channel, 0);
/** A pixel of growth: green above all. */
const green = (image: Pixels, x: number, y: number): boolean => {
  const [r, g, b] = rgb(image, x, y);
  return g > r + 10 && g > b;
};

/**
 * Where growth meets bare ground across a row of pixels (bare below it with `down`, above
 * it without), how bright the growth's last pixel is against one three pixels further in.
 */
function lip(image: Pixels, down: boolean): { edges: number; ratio: number } {
  const d = down ? 1 : -1;
  let edge = 0;
  let inner = 0;
  let edges = 0;
  for (let x = 0; x < image.width; x++) {
    for (let y = 4; y < image.height - 4; y++) {
      if (!green(image, x, y) || green(image, x, y + d)) continue;
      if (![1, 2, 3].every((k) => green(image, x, y - k * d))) continue;
      edge += brightness(image, x, y);
      inner += brightness(image, x, y - 3 * d);
      edges += 1;
    }
  }
  return { edges, ratio: edge / Math.max(inner, 1) };
}

describe("growth beside bare ground (R5)", () => {
  const above = [...rows("g", 8, 6), ...rows(".", 8, 6)];
  const below = [...rows(".", 8, 6), ...rows("g", 8, 6)];
  const paint = (picture: string[], tile: number): Pixels =>
    paintGround(world(picture, 255), { look: R0, tile, style: "blended", grain: true });

  it("has a lip up close: a pixel of shadow on its lower edge, one of light on its upper", () => {
    const shadowed = lip(paint(above, NEAR), true);
    const lit = lip(paint(below, NEAR), false);
    expect(shadowed.edges).toBeGreaterThan(50);
    expect(lit.edges).toBeGreaterThan(50);
    expect(shadowed.ratio).toBeLessThan(0.9);
    expect(lit.ratio).toBeGreaterThan(1.05);
  });

  it("has none in the middle view, too small for it", () => {
    for (const [picture, down] of [
      [above, true],
      [below, false],
    ] as const) {
      const { ratio } = lip(paint(picture, MID_TILE), down);
      expect(ratio).toBeGreaterThan(0.92);
      expect(ratio).toBeLessThan(1.08);
    }
  });
});

describe("snow on the heights (R5)", () => {
  const flat = { look: R0, tile: MID_TILE, style: "smooth", grain: false } as const;
  const SNOW = hexToRgb("#e6edf2");
  const ROCK = hexToRgb("#98928c");
  const middle = (image: Pixels): [number, number, number] => rgb(image, 16, 16);

  it("lies on a bare summit only where the simulation has it", () => {
    const peak = world(rows(".", 4, 4), 200, () => SEA_LEVEL + 0.5);
    // A land without the simulation's snow: the relief's snow line stands in.
    expect(middle(paintGround(peak, flat))).toEqual(SNOW);
    // The simulation says none lies there (an August summit): rock.
    const bare = { ...peak, snow: new Uint8Array(16) };
    expect(middle(paintGround(bare, flat))).toEqual(ROCK);
    // It says snow lies there: snow.
    const snowy = { ...peak, snow: new Uint8Array(16).fill(255) };
    const [r, g, b] = middle(paintGround(snowy, flat));
    expect(Math.min(r, g, b)).toBeGreaterThan(200);
  });
});
