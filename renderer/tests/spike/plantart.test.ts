import { describe, expect, it } from "vitest";
import {
  cellHash,
  plantLook,
  plantOffset,
  standsAlone,
  type Form,
  type Stage,
} from "../../src/spike/pixelart";
import {
  FLOWER_COLOURS,
  INK,
  PLANT_SCALES,
  SMALL_KINDS,
  SMALL_SIZES,
  STANDING_VARIANTS,
  TREE_STYLES,
  colourArt,
  drawSmall,
  drawStanding,
  type PlantArt,
  type TreeStyle,
} from "../../src/spike/plantart";
import { mulberry32 } from "../../src/spike/rng";
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

  it("are drawn richer when they are drawn large", () => {
    const scale = PLANT_SCALES[2];
    if (scale === undefined) throw new Error("no large scale");
    // The local view: four times the middle view's pixels to the cell.
    const far = drawStanding("BROADLEAF", "mature", 0, scale);
    const near = drawStanding("BROADLEAF", "mature", 0, scale, 4);
    expect(extent(near).tall).toBe(4 * scale.broadleaf[0][1]);
    // Bark lit on one side, and leaves picked out: the three tones are all well used.
    expect(count(far, [INK.trunkLight])).toBe(0);
    expect(count(near, [INK.trunkLight])).toBeGreaterThan(5);
    for (const tone of [INK.dark, INK.mid, INK.light]) {
      expect(count(near, [tone])).toBeGreaterThan(count(near, LEAVES) * 0.12);
    }
    // A conifer's tiers end in a fringe: more rim for its size than a smooth cone has.
    const fir = drawStanding("CONIFER", "mature", 0, scale, 4);
    expect(count(fir, [INK.outline]) / count(fir, LEAVES)).toBeGreaterThan(0.12);
    // One bush in three is in berry.
    const berries = [0, 1, 2].map((variant) =>
      count(drawStanding("SHRUB", "mature", variant, scale, 4), [INK.accent]),
    );
    expect(berries[0]).toBe(0);
    expect(berries[1]).toBeGreaterThan(8);
    expect(berries[2]).toBe(0);
    // Grass up close is a fan of blades, and young grass a shorter one.
    const grown = extent(drawStanding("GRASS", "mature", 0, scale, 4));
    const young = extent(drawStanding("GRASS", "young", 0, scale, 4));
    expect(grown.tall).toBeGreaterThan(10);
    expect(young.tall).toBeLessThan(grown.tall);
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

describe("the styles of tree to choose from", () => {
  const large = PLANT_SCALES[2];
  if (large === undefined) throw new Error("no large scale");
  /** The local view: four times the middle view's pixels to the cell. */
  const near = (form: Form, variant: number, style: TreeStyle, stage: Stage = "mature"): PlantArt =>
    drawStanding(form, stage, variant, large, 4, style);
  const FOLIAGE: readonly number[] = [INK.deep, INK.dark, INK.mid, INK.light, INK.bright];

  it("draw every tree and bush differently from each other and from the first", () => {
    for (const form of ["BROADLEAF", "CONIFER", "SHRUB"] as const) {
      const drawings = [...TREE_STYLES, "first" as const].map((style) =>
        near(form, 0, style).ink.join(""),
      );
      expect(new Set(drawings).size).toBe(TREE_STYLES.length + 1);
      for (const style of TREE_STYLES) {
        expect(near(form, 0, style).ink.join("")).toBe(drawings[TREE_STYLES.indexOf(style)]);
      }
    }
  });

  it("carry no shadow of their own, and say what the ground should paint for them", () => {
    for (const style of TREE_STYLES) {
      for (const form of ["BROADLEAF", "CONIFER", "SHRUB"] as const) {
        const art = near(form, 1, style);
        expect(count(art, [INK.shadow])).toBe(0);
        expect(art.shadow?.rx).toBeGreaterThan(8);
        expect(art.shadow?.ry).toBeLessThan(art.shadow?.rx ?? 0);
        // It stands on its foot: the lowest thing drawn is the trunk or the leaves there.
        expect(extent(art).bottom).toBeLessThanOrEqual(art.footY);
        expect(extent(art).bottom).toBeGreaterThan(art.footY - 6);
      }
    }
    expect(drawStanding("BROADLEAF", "mature", 0, large).shadow).toBeUndefined();
  });

  it("shade a crown in five tones, with an outline round its leaves", () => {
    for (const style of TREE_STYLES) {
      const art = near("BROADLEAF", 0, style);
      for (const tone of FOLIAGE) expect(count(art, [tone]), `${style} ${tone}`).toBeGreaterThan(8);
      expect(count(art, [INK.trunk, INK.trunkDark])).toBeGreaterThan(20);
      // No leaf touches the air.
      for (let y = 0; y < art.height; y++) {
        for (let x = 0; x < art.width; x++) {
          if (!FOLIAGE.includes(inkAt(art, x, y))) continue;
          for (const [dx, dy] of [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1],
          ] as const) {
            expect(inkAt(art, x + dx, y + dy)).not.toBe(INK.none);
          }
        }
      }
    }
    // Light comes from the upper left: the lightest tones lie there, the darkest opposite.
    for (const style of TREE_STYLES) {
      const art = near("BROADLEAF", 0, style);
      const middle = (inks: readonly number[]): [number, number] => {
        let x = 0;
        let y = 0;
        let n = 0;
        art.ink.forEach((ink, at) => {
          if (!inks.includes(ink)) return;
          x += at % art.width;
          y += Math.floor(at / art.width);
          n += 1;
        });
        return [x / n, y / n];
      };
      const [lightX, lightY] = middle([INK.bright, INK.light]);
      const [darkX, darkY] = middle([INK.deep, INK.dark]);
      expect(lightX).toBeLessThan(darkX);
      expect(lightY).toBeLessThan(darkY);
    }
  });

  it("stand a conifer's trunk under the middle of its crown, at every size", () => {
    /** How far the middle of the trunk is from the foot, in pixels. */
    const off = (art: PlantArt): number => {
      let sum = 0;
      let n = 0;
      art.ink.forEach((ink, at) => {
        if (ink !== INK.trunk && ink !== INK.trunkDark && ink !== INK.trunkLight) return;
        sum += (at % art.width) + 0.5;
        n += 1;
      });
      expect(n).toBeGreaterThan(0);
      return Math.abs(sum / n - art.footX);
    };
    // The middle view's trees and the local view's: a thinner trunk used to stand left.
    for (const style of ["first", "bundles", "dome"] as const) {
      for (const detail of [1, 4]) {
        for (const stage of ["mature", "young"] as const) {
          const art = drawStanding("CONIFER", stage, 0, large, detail, style);
          expect(off(art), `${style} ×${detail} ${stage}`).toBeLessThanOrEqual(1);
        }
      }
    }
    expect(off(near("BROADLEAF", 0, "bundles"))).toBeLessThanOrEqual(1);
  });

  it("set a bush on the ground: neither cut off below it nor floating above", () => {
    for (const style of TREE_STYLES) {
      for (const stage of ["mature", "young"] as const) {
        for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
          const art = near("SHRUB", variant, style, stage);
          expect(extent(art).bottom).toBeLessThanOrEqual(art.footY);
          expect(extent(art).bottom).toBeGreaterThanOrEqual(art.footY - 2);
        }
      }
    }
  });

  it("build a crown of bundles from many small clumps with soft rims", () => {
    const art = near("BROADLEAF", 0, "bundles");
    // Soft rims: along the top of the crown the outline rises and falls by a pixel or
    // two from one column to the next, not by the teeth of a saw.
    const top: number[] = [];
    for (let x = 0; x < art.width; x++) {
      for (let y = 0; y < art.height; y++) {
        if (inkAt(art, x, y) === INK.none) continue;
        top.push(y);
        break;
      }
    }
    const steps = top.slice(1).map((y, i) => Math.abs(y - (top[i] ?? y)));
    const jumps = steps.filter((step) => step >= 3).length;
    expect(jumps / steps.length).toBeLessThan(0.12);
    // The shade between clumps is a line, not a field: the darkest tone stays the
    // lesser part of the crown, and every tone between has its share.
    expect(count(art, [INK.deep]) / count(art, FOLIAGE)).toBeLessThan(0.35);
    for (const tone of [INK.dark, INK.mid, INK.light]) {
      expect(count(art, [tone]) / count(art, FOLIAGE)).toBeGreaterThan(0.1);
    }
  });

  it("come in three builds, and adapt to the middle view's size", () => {
    for (const style of TREE_STYLES) {
      const [even, slender, broad] = [0, 1, 2].map((variant) =>
        extent(near("BROADLEAF", variant, style)),
      );
      expect(slender?.tall).toBeGreaterThan(even?.tall ?? 0);
      expect(broad?.wide).toBeGreaterThan(slender?.wide ?? 0);
      expect(broad?.tall).toBeLessThan(even?.tall ?? 0);
      // A young tree is smaller; a bush lower than a tree; one bush in three in berry.
      expect(extent(near("BROADLEAF", 0, style, "young")).tall).toBeLessThan(even?.tall ?? 0);
      expect(extent(near("SHRUB", 0, style)).tall).toBeLessThan((even?.tall ?? 0) / 2);
      const fruit = [0, 1, 2].map((variant) => count(near("SHRUB", variant, style), [INK.accent]));
      expect([fruit[0], fruit[2]]).toEqual([0, 0]);
      expect(fruit[1]).toBeGreaterThan(3);
      // The same rule at the middle view's size: a tree of a few dozen pixels, still a tree.
      for (const form of ["BROADLEAF", "CONIFER"] as const) {
        const small = drawStanding(form, "mature", 0, large, 1, style);
        expect(extent(small).tall).toBeGreaterThan(large.broadleaf[0][1] - 4);
        expect(extent(small).tall).toBeLessThanOrEqual(large.broadleaf[0][1] + 2);
        // Leaves and their outline: a whorled conifer this small is mostly outline.
        expect(count(small, [...FOLIAGE, INK.outline])).toBeGreaterThan(45);
      }
    }
  });

  it("tell the conifers of each style apart: boughs, clean tiers, whorls with air between", () => {
    const [boughs, tiers, whorls] = TREE_STYLES.map((style) => near("CONIFER", 0, style));
    if (boughs === undefined || tiers === undefined || whorls === undefined)
      throw new Error("styles");
    // Clean tiers have the least rim for their leaves; whorls let the trunk show.
    const rim = (art: PlantArt): number => count(art, [INK.outline]) / count(art, FOLIAGE);
    expect(rim(tiers)).toBeLessThan(rim(boughs));
    expect(rim(boughs)).toBeLessThan(rim(whorls));
    const wood = (art: PlantArt): number => count(art, [INK.trunk, INK.trunkDark, INK.trunkLight]);
    expect(wood(whorls)).toBeGreaterThan(2 * wood(tiers));
  });
});

describe("what grows and lies among the trees", () => {
  const draw = (kind: (typeof SMALL_KINDS)[number], variant = 0): PlantArt => {
    const [width, height] = SMALL_SIZES[kind];
    return drawSmall(kind, [width * 4, height * 4], mulberry32(31 + variant), variant);
  };

  it("draws each kind inside its own size, standing on its foot, the same every time", () => {
    for (const kind of SMALL_KINDS) {
      const art = draw(kind);
      const [width, height] = SMALL_SIZES[kind];
      const drawn = extent(art);
      expect(drawn.wide, kind).toBeGreaterThan(1);
      // Its outline may reach a pixel beyond the size on every side.
      expect(drawn.wide, kind).toBeLessThanOrEqual(width * 4 + 2);
      expect(drawn.tall, kind).toBeLessThanOrEqual(height * 4 + 2);
      expect(drawn.tall, kind).toBeGreaterThan(height * 4 * 0.4);
      expect(drawn.bottom, kind).toBeGreaterThan(art.footY - 3);
      expect(draw(kind).ink.join("")).toBe(art.ink.join(""));
    }
    expect(new Set(SMALL_KINDS.map((kind) => draw(kind).ink.join(""))).size).toBe(
      SMALL_KINDS.length,
    );
  });

  it("gives flowers petals on a stem, in the colour asked for", () => {
    for (const kind of ["daisy", "bell", "spike", "umbel"] as const) {
      const art = draw(kind);
      expect(count(art, [INK.accent, INK.accentDark]), kind).toBeGreaterThan(3);
      expect(count(art, [INK.dark, INK.deep]), kind).toBeGreaterThan(4);
      expect(count(art, [INK.outline]), kind).toBe(0);
      // Petals are at the top, the stem below them.
      const rows = (inks: readonly number[]): number[] =>
        [...art.ink].flatMap((ink, at) => (inks.includes(ink) ? [Math.floor(at / art.width)] : []));
      expect(Math.min(...rows([INK.accent]))).toBeLessThan(Math.min(...rows([INK.dark])) + 2);
    }
    const pink = colourArt(draw("daisy"), PALETTE["GRASS"] ?? ["", "", ""], FLOWER_COLOURS[2]);
    const petal = draw("daisy").ink.indexOf(INK.accent);
    expect([...pink.rgba.slice(petal * 4, petal * 4 + 3)]).toEqual([0xe5, 0x8f, 0xb1]);
    expect(FLOWER_COLOURS).toHaveLength(5);
  });

  it("tells a mushroom, a stone, a log and a stump by what they are made of", () => {
    const mushroom = draw("mushroom");
    expect(count(mushroom, [INK.pale])).toBeGreaterThan(2); // a pale stem, and spots
    expect(count(mushroom, [INK.accent, INK.accentDark])).toBeGreaterThan(8); // a cap
    expect(count(draw("mushroom", 1), [INK.pale])).toBeLessThan(count(mushroom, [INK.pale]));
    // A stone is bare or grown over; a boulder is a stone several times the size.
    expect(count(draw("stone", 0), [INK.accent])).toBe(0);
    expect(count(draw("stone", 1), [INK.accent])).toBeGreaterThan(1);
    expect(count(draw("boulder"), LEAVES)).toBeGreaterThan(3 * count(draw("stone"), LEAVES));
    // Wood, outlined all round, with a shadow for the ground to paint.
    for (const kind of ["log", "stump"] as const) {
      const art = draw(kind);
      expect(count(art, [INK.trunk, INK.trunkDark, INK.trunkLight])).toBeGreaterThan(10);
      expect(count(art, [INK.pale])).toBeGreaterThan(2); // the cut
      expect(count(art, [INK.outline])).toBeGreaterThan(12);
      expect(art.shadow).toBeDefined();
    }
    // What is too slight for a shadow has none.
    for (const kind of ["daisy", "fern", "herb", "reed", "mushroom"] as const) {
      expect(draw(kind).shadow).toBeUndefined();
    }
  });

  it("colours the darkest tone cooler and the lightest warmer, and wood as asked", () => {
    const ramp = PALETTE["BROADLEAF"] ?? ["", "", ""];
    const scale = PLANT_SCALES[2];
    if (scale === undefined) throw new Error("no large scale");
    const art = drawStanding("BROADLEAF", "mature", 0, scale, 4, "bundles");
    const pixels = colourArt(art, ramp);
    const rgb = (ink: number): number[] => {
      const at = art.ink.indexOf(ink);
      return [...pixels.rgba.slice(at * 4, at * 4 + 3)];
    };
    const sum = (colour: number[]): number => colour.reduce((total, value) => total + value, 0);
    const [deep, dark, light, bright] = [INK.deep, INK.dark, INK.light, INK.bright].map(rgb);
    if (deep === undefined || dark === undefined || light === undefined || bright === undefined)
      throw new Error("tones");
    expect(sum(deep)).toBeLessThan(sum(dark));
    expect((deep[2] ?? 0) / sum(deep)).toBeGreaterThan((dark[2] ?? 0) / sum(dark));
    expect(sum(bright)).toBeGreaterThan(sum(light));
    expect((bright[2] ?? 0) / sum(bright)).toBeLessThan((light[2] ?? 0) / sum(light));
    const charred = colourArt(
      draw("stump", 1),
      PALETTE["BURNT"] ?? ["", "", ""],
      undefined,
      "#2e2622",
    );
    const at = draw("stump", 1).ink.indexOf(INK.trunk);
    expect([...charred.rgba.slice(at * 4, at * 4 + 3)]).toEqual([0x2e, 0x26, 0x22]);
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
