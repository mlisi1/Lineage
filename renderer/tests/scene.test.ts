import { describe, expect, it } from "vitest";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "../src/scene";

describe("fitToViewport", () => {
  it("is the identity on the desk display", () => {
    expect(fitToViewport(DESIGN_WIDTH, DESIGN_HEIGHT)).toEqual({
      scale: 1,
      offsetX: 0,
      offsetY: 0,
    });
  });

  it("letterboxes a portrait phone without cropping", () => {
    const fit = fitToViewport(390, 844);
    expect(fit.scale).toBeCloseTo(390 / DESIGN_WIDTH);
    expect(fit.offsetX).toBe(0);
    expect(fit.offsetY).toBeCloseTo((844 - DESIGN_HEIGHT * fit.scale) / 2);
  });

  it("pillarboxes a wide viewport", () => {
    const fit = fitToViewport(2400, 600);
    expect(fit.scale).toBe(1);
    expect(fit.offsetX).toBe((2400 - DESIGN_WIDTH) / 2);
    expect(fit.offsetY).toBe(0);
  });

  it("collapses on an empty viewport", () => {
    expect(fitToViewport(0, 600).scale).toBe(0);
  });
});
