import { describe, expect, it } from "vitest";
import { cellHash, plantLook, plantOffset, standsAlone } from "../../src/spike/pixelart";
import {
  INK,
  PLANT_SCALES,
  STANDING_VARIANTS,
  colourArt,
  drawStanding,
  type PlantArt,
} from "../../src/spike/plantart";
import { PALETTE } from "./worlds";

const DORMANT = ["LICHEN", "GRASS", "SHRUB"];
const LEAVES: readonly number[] = [INK.dark, INK.mid, INK.light];
const count = (art: PlantArt, inks: readonly number[]): number =>
  art.ink.reduce((sum, ink) => sum + (inks.includes(ink) ? 1 : 0), 0);
const inkAt = (art: PlantArt, x: number, y: number): number =>
  x < 0 || y < 0 || x >= art.width || y >= art.height
    ? INK.none
    : (art.ink[y * art.width + x] ?? 0);
/** The columns and rows a drawing's plant (not its shadow) covers. */
function extent(art: PlantArt): { wide: number; tall: number; bottom: number } {
  let left = art.width;
  let right = -1;
  let top = art.height;
  let bottom = -1;
  art.ink.forEach((ink, at) => {
    if (ink === INK.none || ink === INK.shadow) return;
    left = Math.min(left, at % art.width);
    right = Math.max(right, at % art.width);
    top = Math.min(top, Math.floor(at / art.width));
    bottom = Math.max(bottom, Math.floor(at / art.width));
  });
  return { wide: right - left + 1, tall: bottom - top + 1, bottom };
}

describe("standing plants", () => {
  it("are drawn at the size their scale asks for, standing on their foot", () => {
    for (const scale of PLANT_SCALES) {
      const cases = [
        ["BROADLEAF", scale.broadleaf],
        ["CONIFER", scale.conifer],
        ["SHRUB", scale.bush],
      ] as const;
      for (const [form, sizes] of cases) {
        for (const [age, stage] of (["mature", "young"] as const).entries()) {
          const [width, height] = sizes[age] ?? [0, 0];
          const art = drawStanding(form, stage, 0, scale);
          const drawn = extent(art);
          expect(drawn.tall).toBeGreaterThanOrEqual(height - 1);
          expect(drawn.tall).toBeLessThanOrEqual(height);
          expect(drawn.wide).toBeLessThanOrEqual(width + 1);
          expect(drawn.wide).toBeGreaterThanOrEqual(width - 2);
          // The foot is the bottom of the plant, in the middle of the drawing.
          expect(art.footY).toBe(drawn.bottom + 1);
          expect(art.footX).toBeCloseTo(art.width / 2);
        }
      }
    }
  });

  it("have an outline all round their leaves, a trunk if they are trees, and a shadow", () => {
    for (const scale of PLANT_SCALES) {
      for (const form of ["BROADLEAF", "CONIFER", "SHRUB"] as const) {
        const art = drawStanding(form, "mature", 1, scale);
        expect(count(art, LEAVES)).toBeGreaterThan(8);
        expect(count(art, [INK.shadow])).toBeGreaterThan(2);
        expect(count(art, [INK.trunk, INK.trunkDark]) > 0).toBe(form !== "SHRUB");
        // No leaf touches the air: the outline is in between.
        for (let y = 0; y < art.height; y++) {
          for (let x = 0; x < art.width; x++) {
            if (!LEAVES.includes(inkAt(art, x, y))) continue;
            for (const [dx, dy] of [
              [1, 0],
              [-1, 0],
              [0, 1],
              [0, -1],
            ] as const) {
              expect([INK.none, INK.shadow]).not.toContain(inkAt(art, x + dx, y + dy));
            }
          }
        }
        // The shadow lies at the foot, not up in the crown.
        art.ink.forEach((ink, at) => {
          if (ink === INK.shadow) expect(Math.floor(at / art.width)).toBeGreaterThan(art.footY - 5);
        });
      }
    }
  });

  it("grow with the scale and thin out as they do", () => {
    const leaves = PLANT_SCALES.map((scale) =>
      count(drawStanding("BROADLEAF", "mature", 0, scale), LEAVES),
    );
    expect(leaves[1]).toBeGreaterThan((leaves[0] ?? 0) * 1.6);
    expect(leaves[2]).toBeGreaterThan((leaves[1] ?? 0) * 1.4);
    const densities = PLANT_SCALES.map((scale) => scale.treeDensity);
    expect([...densities].sort((a, b) => b - a)).toEqual(densities);
    expect(densities[0]).toBe(1);
    // A tree is taller than a bush, a bush taller than a tuft of grass, at every scale.
    for (const scale of PLANT_SCALES) {
      expect(scale.broadleaf[0][1]).toBeGreaterThan(scale.bush[0][1] * 1.5);
      expect(scale.bush[0][1]).toBeGreaterThan(scale.tuft[1]);
      expect(scale.broadleaf[1][1]).toBeLessThan(scale.broadleaf[0][1]);
    }
  });

  it("come in several drawings, the same every time, and at any detail", () => {
    const scale = PLANT_SCALES[1];
    if (scale === undefined) throw new Error("no medium scale");
    const drawings = Array.from({ length: STANDING_VARIANTS }, (_, variant) =>
      drawStanding("BROADLEAF", "mature", variant, scale).ink.join(""),
    );
    expect(new Set(drawings).size).toBe(STANDING_VARIANTS);
    expect(drawStanding("BROADLEAF", "mature", 0, scale).ink.join("")).toBe(drawings[0]);
    // At twice the detail (a closer view) the same plant has four times the pixels.
    const close = drawStanding("BROADLEAF", "mature", 0, scale, 2);
    const plain = drawStanding("BROADLEAF", "mature", 0, scale);
    expect(extent(close).tall).toBe(2 * scale.broadleaf[0][1]);
    expect(count(close, LEAVES)).toBeGreaterThan(count(plain, LEAVES) * 3.5);
  });

  it("take their form's colours, with a see-through shadow", () => {
    const scale = PLANT_SCALES[1];
    if (scale === undefined) throw new Error("no medium scale");
    const art = drawStanding("CONIFER", "mature", 0, scale);
    const ramp = PALETTE["CONIFER"] ?? ["", "", ""];
    const pixels = colourArt(art, ramp);
    expect([pixels.width, pixels.height]).toEqual([art.width, art.height]);
    const hex = (at: number): string =>
      `#${[0, 1, 2].map((i) => (pixels.rgba[at * 4 + i] ?? 0).toString(16).padStart(2, "0")).join("")}`;
    art.ink.forEach((ink, at) => {
      const alpha = pixels.rgba[at * 4 + 3];
      if (ink === INK.none) expect(alpha).toBe(0);
      else if (ink === INK.shadow) expect(alpha).toBeLessThan(128);
      else expect(alpha).toBe(255);
      if (ink === INK.dark) expect(hex(at)).toBe(ramp[0]);
      if (ink === INK.mid) expect(hex(at)).toBe(ramp[1]);
      if (ink === INK.light) expect(hex(at)).toBe(ramp[2]);
    });
  });
});

describe("plants that stand alone", () => {
  const look = (kind: string, biomass: number): NonNullable<ReturnType<typeof plantLook>> => {
    const found = plantLook(kind, biomass, 3, 4, 77, DORMANT);
    if (found === null) throw new Error("no plant");
    return found;
  };

  it("are every tree, shrubs in leaf, and one tuft of grown grass in three", () => {
    expect(standsAlone(look("BROADLEAF", 40), 3, 4)).toBe(true);
    expect(standsAlone(look("CONIFER", 240), 3, 4)).toBe(true);
    expect(standsAlone(look("SHRUB", 200), 3, 4)).toBe(true);
    expect(standsAlone(look("SHRUB", 40), 3, 4)).toBe(false); // died back
    expect(standsAlone(look("LICHEN", 240), 3, 4)).toBe(false);
    let tufts = 0;
    for (let x = 0; x < 300; x++) {
      expect(standsAlone(look("GRASS", 100), x, 9)).toBe(false); // young grass is ground
      if (standsAlone(look("GRASS", 240), x, 9)) tufts += 1;
    }
    expect(tufts).toBeGreaterThan(70);
    expect(tufts).toBeLessThan(130);
  });

  it("stand a little off the middle of their cell, always the same way", () => {
    const seen = new Set<string>();
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const [dx, dy] = plantOffset(x, y);
        expect(Number.isInteger(dx) && dx >= -2 && dx <= 2).toBe(true);
        expect(Number.isInteger(dy) && dy >= -2 && dy <= 1).toBe(true);
        seen.add(`${dx},${dy}`);
      }
    }
    expect(seen.size).toBe(20); // every offset is used
    expect(plantOffset(7, 9)).toEqual(plantOffset(7, 9));
  });

  it("hash a cell to a number in [0, 1) that the salt changes", () => {
    const values = Array.from({ length: 2000 }, (_, i) => cellHash(i % 50, Math.floor(i / 50), 1));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(cellHash(3, 4, 1)).toBe(cellHash(3, 4, 1));
    expect(cellHash(3, 4, 1)).not.toBe(cellHash(3, 4, 2));
    expect(cellHash(-5, -9, 1)).toBeGreaterThanOrEqual(0); // off the map is fine too
  });
});
