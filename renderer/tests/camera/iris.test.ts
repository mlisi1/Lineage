import { describe, expect, it } from "vitest";
import { IRIS_CATCH_UP, LOADER_DOT, LOADER_RADIUS, drawIris, irisStep } from "../../src/iris";

const COLOUR = 0x10081c;
const SOLID = 0xff1c0810;

describe("the iris between views (R5)", () => {
  it("closes with the dip at once", () => {
    expect(irisStep(1, 0.25, 1, 1 / 30)).toBeCloseTo(0.75);
    expect(irisStep(0.4, 1, 1, 1 / 30)).toBe(0);
  });

  it("opens no further than the ground painted allows, and catches up once it has come", () => {
    expect(irisStep(0, 0, 0, 1 / 30)).toBe(0);
    expect(irisStep(0.1, 0, 0.3, 1 / 30)).toBeCloseTo(0.1 + IRIS_CATCH_UP / 30);
    expect(irisStep(0.29, 0, 0.3, 1 / 30)).toBeCloseTo(0.3);
    expect(irisStep(0.5, 0.6, 1, 1 / 30)).toBeCloseTo(0.4);
  });

  it("is see-through inside its circle and solid outside, in stepped blocks", () => {
    const width = 40;
    const height = 20;
    const pixels = new Uint32Array(width * height);
    drawIris(pixels, width, height, 6, COLOUR);
    expect(pixels[10 * width + 20]).toBe(0);
    expect(pixels[0]).toBe(SOLID);
    expect(pixels[10 * width + 30]).toBe(SOLID);
    expect(pixels[10 * width + 15]).toBe(0);
    const open = [...pixels].filter((value) => value === 0).length;
    expect(open).toBeGreaterThan(Math.PI * 36 * 0.8);
    expect(open).toBeLessThan(Math.PI * 36 * 1.2);
  });

  it("shows the loading ring only while shut, its head brightest", () => {
    const width = 40;
    const height = 40;
    const pixels = new Uint32Array(width * height);
    drawIris(pixels, width, height, 0, COLOUR, 0);
    expect(pixels.every((value) => value === SOLID)).toBe(true);
    drawIris(pixels, width, height, 0, COLOUR, 1, 0, 0xffffff);
    const lit = [...pixels].filter((value) => value !== SOLID);
    expect(lit.length).toBe(8 * LOADER_DOT * LOADER_DOT);
    // The head, at the top of the ring, is the ink itself.
    const top = (20 - LOADER_RADIUS) * width + 20;
    expect(pixels[top]).toBe(0xffffffff);
  });
});
