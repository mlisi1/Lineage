import { describe, expect, it } from "vitest";
import { cosyTuft, rimAll } from "../../src/plants/cosyart";
import {
  GRASS_VARIANTS,
  INK,
  STANDING_VARIANTS,
  blank,
  drawStanding,
  settle,
  type PlantArt,
} from "../../src/plants/plantart";
import { mulberry32 } from "../../src/rng";

const count = (art: PlantArt, ink: number): number =>
  art.ink.filter((value) => value === ink).length;
const drawn = (art: PlantArt): number => art.ink.filter((value) => value !== INK.none).length;
/** The rows a drawing's ink spans: the top one and the bottom one. */
function rows(art: PlantArt): { top: number; bottom: number } {
  let top = art.height;
  let bottom = -1;
  art.ink.forEach((ink, at) => {
    if (ink === INK.none) return;
    top = Math.min(top, Math.floor(at / art.width));
    bottom = Math.max(bottom, Math.floor(at / art.width));
  });
  return { top, bottom };
}
/** Flip a drawing left to right. */
function mirrored(art: PlantArt): number[] {
  const out: number[] = [];
  for (let y = 0; y < art.height; y++) {
    for (let x = art.width - 1; x >= 0; x--) out.push(art.ink[y * art.width + x] ?? 0);
  }
  return out;
}
/** A tuft of the local view (the size the scale gives grass up close). */
const tuft = (variant: number, seeding = false, flat = false): PlantArt =>
  cosyTuft([24, 16], mulberry32(3), seeding, flat, variant);

describe("cosy tufts of grass (R5)", () => {
  it("are small spikes with no outline, dark at the foot and bright at the tips", () => {
    for (let variant = 0; variant < GRASS_VARIANTS; variant++) {
      const art = tuft(variant);
      expect(count(art, INK.outline), `variant ${variant}`).toBe(0);
      expect(count(art, INK.woodOutline)).toBe(0);
      expect(count(art, INK.deep)).toBeGreaterThan(0);
      expect(count(art, INK.bright)).toBeGreaterThan(0);
      // The foot is the darkest, the top the brightest.
      const { top, bottom } = rows(art);
      const bottomRow = [...art.ink.subarray(bottom * art.width, (bottom + 1) * art.width)];
      const topRow = [...art.ink.subarray(top * art.width, (top + 1) * art.width)];
      expect(bottomRow).toContain(INK.deep);
      expect(topRow).toContain(INK.bright);
      expect(topRow).not.toContain(INK.deep);
    }
  });

  it("are a third of a cell or so: half the scale's width, never taller than 0.7 of it", () => {
    for (let variant = 0; variant < 3; variant++) {
      const art = tuft(variant);
      const width = Math.round(24 * 0.5);
      // The drawing keeps a margin for an outline it no longer draws.
      expect(art.width - 4).toBe(width);
      const { top, bottom } = rows(art);
      expect(bottom - top + 1).toBeLessThanOrEqual(Math.round(width * 0.7));
    }
  });

  it("carry seed heads in the accent only when in seed, on most tufts", () => {
    let seeded = 0;
    let tufts = 0;
    for (let seed = 1; seed <= 20; seed++) {
      for (let variant = 0; variant < 3; variant++) {
        const plain = cosyTuft([24, 16], mulberry32(seed), false, false, variant);
        expect(count(plain, INK.accent)).toBe(0);
        const seeding = cosyTuft([24, 16], mulberry32(seed), true, false, variant);
        tufts += 1;
        if (count(seeding, INK.accent) > 0) seeded += 1;
      }
    }
    expect(seeded).toBeGreaterThan(tufts / 2);
  });

  it("are pressed down by winter: shorter than standing grass", () => {
    for (let variant = 0; variant < 3; variant++) {
      const standing = rows(tuft(variant));
      const flat = rows(tuft(variant, false, true));
      expect(flat.bottom - flat.top).toBeLessThan(standing.bottom - standing.top);
    }
  });

  it("come in three shapes, each again mirrored", () => {
    const shapes = [0, 1, 2].map((variant) => [...tuft(variant).ink]);
    expect(shapes[0]).not.toEqual(shapes[1]);
    expect(shapes[1]).not.toEqual(shapes[2]);
    expect(shapes[0]).not.toEqual(shapes[2]);
    // A clump is two sprigs, one behind the other: more spikes than one sprig.
    expect(drawn(tuft(1))).toBeGreaterThan(drawn(tuft(0)));
    for (let variant = 0; variant < 3; variant++) {
      expect([...tuft(variant + 3).ink]).toEqual(mirrored(tuft(variant)));
      // And back again for the next three.
      expect([...tuft(variant + 6).ink]).toEqual([...tuft(variant).ink]);
    }
  });

  it("mirrors the middle view's small fans too", () => {
    const small = (variant: number): PlantArt =>
      cosyTuft([8, 6], mulberry32(3), false, false, variant);
    expect([...small(3).ink]).toEqual(mirrored(small(0)));
  });

  it("are drawn in several sizes in the cosy look, all alike in the old one", () => {
    const heights = (shapes: "cosy" | "bundles"): Set<number> =>
      new Set(
        Array.from(
          { length: GRASS_VARIANTS },
          (_, variant) => drawStanding("GRASS", "grown", variant, 4, "summer", false, shapes).width,
        ),
      );
    expect(GRASS_VARIANTS).toBeGreaterThan(STANDING_VARIANTS);
    expect(heights("cosy").size).toBeGreaterThanOrEqual(5);
    expect(heights("bundles").size).toBe(1);
  });
});

describe("outlining and settling a drawing", () => {
  /** A 4 × 3 block of leaves in a blank drawing, `lift` rows above its foot. */
  function leaves(lift = 0): PlantArt {
    const art = blank(8, 10);
    for (let y = 4; y < 7 - lift; y++) {
      for (let x = 4; x < 8; x++) art.ink[y * art.width + x] = INK.mid;
    }
    return art;
  }

  it("outlines from a row down only, when told to (`rimAll`)", () => {
    const whole = leaves();
    rimAll(whole);
    const lower = leaves();
    rimAll(lower, 5);
    const outlinedAbove = (art: PlantArt, row: number): number =>
      [...art.ink.subarray(0, row * art.width)].filter((ink) => ink === INK.outline).length;
    expect(outlinedAbove(whole, 5)).toBeGreaterThan(0);
    expect(outlinedAbove(lower, 5)).toBe(0);
    expect(count(lower, INK.outline)).toBeGreaterThan(0);
    expect(count(lower, INK.outline)).toBeLessThan(count(whole, INK.outline));
  });

  it("says how many rows it moved a drawing down to its foot (`settle`)", () => {
    // Height 10 and a margin of 2: the foot is row 11. The block's lowest row is 6, then 4.
    const art = leaves();
    expect(settle(art, 10)).toBe(11 - 6);
    expect(rows(art).bottom).toBe(11);
    const higher = leaves(2);
    expect(settle(higher, 10)).toBe(11 - 4);
    // Already on its foot, or with nothing drawn, it stays.
    expect(settle(art, 10)).toBe(0);
    expect(settle(blank(8, 10), 10)).toBe(0);
  });
});
