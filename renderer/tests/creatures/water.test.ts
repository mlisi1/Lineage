import { describe, expect, it } from "vitest";
import { colour } from "../../src/creatures/body";
import {
  opacityUnderWater,
  seaKey,
  shadowUnderWater,
  underWater,
  type Sea,
} from "../../src/creatures/water";
import { seaIn } from "../../src/spike/habitat";
import { SEA_LEVEL, world } from "../spike/worlds";

const SHALLOW: Sea = { colour: 0x8ecbe6, depth: 0.1 };
const DEEP: Sea = { colour: 0x1f437a, depth: 1 };

const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 255,
  (rgb >> 8) & 255,
  rgb & 255,
];
const lightness = (rgb: number): number => {
  const [r, g, b] = channels(rgb);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
const distance = (a: number, b: number): number => {
  const [r1, g1, b1] = channels(a);
  const [r2, g2, b2] = channels(b);
  return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
};
/** Hue in degrees, 0–360. */
const hueOf = (rgb: number): number => {
  const [r, g, b] = channels(rgb).map((value) => value / 255) as [number, number, number];
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const h =
    max === r
      ? ((g - b) / (max - min)) % 6
      : max === g
        ? (b - r) / (max - min) + 2
        : (r - g) / (max - min) + 4;
  return (h * 60 + 360) % 360;
};
const hueGap = (a: number, b: number): number => {
  const gap = Math.abs(hueOf(a) - hueOf(b)) % 360;
  return Math.min(gap, 360 - gap);
};
/** Saturated colours all round the wheel, at middling lightness. */
const WHEEL = Array.from({ length: 12 }, (_, i) => colour(i / 12, 0.5, 0.8));

describe("an animal seen through water", () => {
  it("keeps its shading: what was darker stays darker", () => {
    for (const hue of [0, 0.15, 0.33, 0.6, 0.85]) {
      const tones = [0.2, 0.35, 0.55, 0.7, 0.85].map((light) => colour(hue, light, 0.8));
      for (const sea of [SHALLOW, DEEP]) {
        const seen = tones.map((tone) => lightness(underWater(tone, sea)));
        expect([...seen].sort((a, b) => a - b)).toEqual(seen);
      }
    }
  });

  it("turns every hue toward the water's, a red not into purple", () => {
    for (const sea of [SHALLOW, DEEP]) {
      for (const tone of WHEEL) {
        const seen = underWater(tone, sea);
        expect(hueGap(seen, sea.colour)).toBeLessThan(hueGap(tone, sea.colour) + 1e-9);
      }
      // A red, which went purple when mixed with blue, stays out of the purples.
      const red = hueOf(underWater(colour(0, 0.5, 0.8), sea));
      expect(red < 250 || red > 320).toBe(true);
    }
  });

  it("fades into the water the deeper it is: light water lightens, dark water darkens", () => {
    const tone = colour(0.1, 0.5, 0.8);
    const at = (sea: Sea): number => distance(underWater(tone, sea), sea.colour);
    expect(at({ ...DEEP, depth: 1 })).toBeLessThan(at({ ...DEEP, depth: 0.2 }));
    expect(lightness(underWater(tone, DEEP))).toBeLessThan(lightness(tone));
    const pale = { colour: 0xcfeaf5, depth: 0.5 };
    expect(lightness(underWater(colour(0.1, 0.3, 0.8), pale))).toBeGreaterThan(
      lightness(colour(0.1, 0.3, 0.8)),
    );
  });

  it("lets a glint keep more of itself, and a shadow fade with depth", () => {
    for (const sea of [SHALLOW, DEEP]) {
      expect(distance(underWater(0xffffff, sea, true), 0xffffff)).toBeLessThan(
        distance(underWater(0xffffff, sea), 0xffffff),
      );
    }
    expect(shadowUnderWater(0.4, { ...DEEP, depth: 0 })).toBeCloseTo(0.4);
    expect(shadowUnderWater(0.4, DEEP)).toBeLessThan(shadowUnderWater(0.4, SHALLOW));
    expect(shadowUnderWater(0.4, DEEP)).toBeGreaterThanOrEqual(0);
  });

  it("is recoloured only when the water changes to the eye", () => {
    expect(seaKey(null)).toBe(-1);
    expect(seaKey(SHALLOW)).toBe(seaKey({ ...SHALLOW }));
    expect(seaKey(SHALLOW)).not.toBe(seaKey(DEEP));
    expect(seaKey({ ...SHALLOW, depth: 0.5 })).not.toBe(seaKey(SHALLOW));
  });
});

describe("murk and glass: its own hues, darker", () => {
  it("keeps each colour's hue in glass, and darkens it more with depth", () => {
    for (const tone of WHEEL) {
      const shallow = underWater(tone, SHALLOW, false, "glass");
      const deep = underWater(tone, DEEP, false, "glass");
      expect(hueGap(shallow, tone)).toBeLessThan(2);
      expect(hueGap(deep, tone)).toBeLessThan(2);
      expect(lightness(deep)).toBeLessThan(lightness(shallow));
      expect(lightness(shallow)).toBeLessThan(lightness(tone));
    }
  });

  it("lets murk take more of the water the deeper it is, and keep its shading", () => {
    const tone = colour(0, 0.5, 0.8);
    const at = (depth: number): number =>
      distance(underWater(tone, { ...DEEP, depth }, false, "murk"), DEEP.colour);
    expect(at(1)).toBeLessThan(at(0.1));
    for (const sea of [SHALLOW, DEEP]) {
      const tones = [0.2, 0.4, 0.6, 0.8].map((light) => colour(0.05, light, 0.8));
      const seen = tones.map((t) => lightness(underWater(t, sea, false, "murk")));
      expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    }
  });

  it("draws only glass see-through, less opaque the deeper it is", () => {
    expect(opacityUnderWater(DEEP, "hue")).toBe(1);
    expect(opacityUnderWater(DEEP, "murk")).toBe(1);
    expect(opacityUnderWater(SHALLOW, "glass")).toBeLessThan(1);
    expect(opacityUnderWater(DEEP, "glass")).toBeLessThan(opacityUnderWater(SHALLOW, "glass"));
    expect(opacityUnderWater(DEEP, "glass")).toBeGreaterThan(0.3);
  });
});

describe("the water at a place", () => {
  // Land in the west, then a sea floor that falls away eastward, 0.01 a cell.
  const map = world(["....~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~"], 0, (x, _y, water) =>
    water ? SEA_LEVEL - 0.01 * (x - 3) : SEA_LEVEL + 0.1,
  );
  const sea = seaIn(map);

  it("is none on land, and deeper and darker away from the shore", () => {
    expect(sea(1.5, 0.5)).toBeNull();
    const samples = [6, 10, 16, 24, 34].map((x) => sea(x + 0.5, 0.5));
    const depths = samples.map((found) => found?.depth ?? -1);
    expect([...depths].sort((a, b) => a - b)).toEqual(depths);
    expect(depths[0]).toBeGreaterThan(0);
    expect(depths[depths.length - 1]).toBe(1);
    const lights = samples.map((found) => lightness(found?.colour ?? 0));
    expect([...lights].sort((a, b) => b - a)).toEqual(lights);
  });

  it("takes its colours from the sea's bands, from the shallowest to the deepest", () => {
    const shore = sea(4.6, 0.5);
    const open = sea(35.5, 0.5);
    expect(distance(shore?.colour ?? 0, 0x8ecbe6)).toBeLessThan(
      distance(shore?.colour ?? 0, 0x1f437a),
    );
    expect(open?.colour).toBe(0x1f437a);
  });
});
