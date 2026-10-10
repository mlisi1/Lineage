import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { decodeBase64, parseFixture } from "../../src/spike/fixture";
import {
  ART,
  FORMS,
  SPRITE_WIDTH,
  STAGES,
  VARIANTS,
  disc,
  hexToRgb,
  lookKey,
  plantLook,
  rasterise,
} from "../../src/spike/pixelart";

const document: unknown = JSON.parse(readFileSync("public/spike/world.json", "utf8"));

describe("the committed fixture", () => {
  const fixture = parseFixture(document);

  it("is a 256×150 world with plants and creatures", () => {
    expect([fixture.width, fixture.height]).toEqual([256, 150]);
    expect(fixture.cover).toHaveLength(256 * 150);
    expect(fixture.biomass).toHaveLength(256 * 150);
    expect(fixture.coverClasses[0]).toBe("WATER");
    expect(fixture.creatures.length).toBeGreaterThan(50);
    expect(fixture.description).toContain("seed 42");
  });

  it("has a three-tone ramp for every plant form and for dormant plants", () => {
    for (const name of [...FORMS, "DORMANT"]) {
      expect(fixture.palette[name]).toHaveLength(3);
      for (const tone of fixture.palette[name] ?? []) expect(tone).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("puts creatures inside the map with plausible bodies", () => {
    for (const creature of fixture.creatures) {
      expect(creature.x).toBeGreaterThanOrEqual(0);
      expect(creature.x).toBeLessThanOrEqual(255);
      expect(creature.y).toBeLessThanOrEqual(149);
      expect(creature.mass).toBeGreaterThan(0);
      expect(Number.isInteger(creature.limbPairs)).toBe(true);
      expect(creature.hue).toBeGreaterThanOrEqual(0);
      expect(creature.hue).toBeLessThanOrEqual(1);
    }
  });

  it("has thousands of cells to draw as plant sprites", () => {
    let plants = 0;
    for (let index = 0; index < fixture.cover.length; index++) {
      const look = plantLook(
        fixture.coverClasses[fixture.cover[index] ?? 0] ?? "",
        fixture.biomass[index] ?? 0,
        index % fixture.width,
        Math.floor(index / fixture.width),
        fixture.dormantBelow,
        fixture.dormantClasses,
      );
      if (look !== null) plants += 1;
    }
    expect(plants).toBeGreaterThan(5000);
    expect(plants).toBeLessThan(256 * 150);
  });
});

describe("parseFixture", () => {
  it("rejects other formats and inconsistent grids", () => {
    expect(() => parseFixture({ format: "something-else" })).toThrow("expected format");
    expect(() => parseFixture(null)).toThrow("not an object");
    const broken = { ...(document as Record<string, unknown>), width: 10 };
    expect(() => parseFixture(broken)).toThrow("does not match");
  });

  it("decodes base64", () => {
    expect([...decodeBase64("AAEC/w==")]).toEqual([0, 1, 2, 255]);
  });
});

describe("pixel art", () => {
  it("has two variants of every form and stage, 8 pixels wide", () => {
    for (const form of FORMS) {
      for (const stage of STAGES) {
        const variants = ART[form][stage];
        expect(variants).toHaveLength(VARIANTS);
        for (const bitmap of variants) {
          expect([8, 12]).toContain(bitmap.length);
          for (const row of bitmap) expect(row).toMatch(/^[.dmlt]{8}$/);
          // Every plant stands on the bottom row of its cell.
          expect(bitmap[bitmap.length - 1]).not.toBe("........");
        }
      }
    }
  });

  it("paints bitmaps with the ramp, leaving dots transparent", () => {
    const pixels = rasterise(["d.mlt..."], ["#102030", "#405060", "#708090"]);
    expect([pixels.width, pixels.height]).toEqual([SPRITE_WIDTH, 1]);
    expect([...pixels.rgba.slice(0, 4)]).toEqual([0x10, 0x20, 0x30, 255]);
    expect([...pixels.rgba.slice(4, 8)]).toEqual([0, 0, 0, 0]);
    expect([...pixels.rgba.slice(8, 12)]).toEqual([0x40, 0x50, 0x60, 255]);
    expect([...pixels.rgba.slice(12, 16)]).toEqual([0x70, 0x80, 0x90, 255]);
    expect(pixels.rgba[19]).toBe(255); // the trunk is opaque
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
  });

  it("draws a hard-edged, symmetric disc", () => {
    const pixels = disc(16);
    const alpha = (x: number, y: number): number => pixels.rgba[(y * 16 + x) * 4 + 3] ?? -1;
    expect(alpha(8, 8)).toBe(255);
    expect(alpha(0, 0)).toBe(0);
    expect(new Set(Array.from({ length: 256 }, (_, i) => alpha(i % 16, i >> 4)))).toEqual(
      new Set([0, 255]),
    );
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) expect(alpha(x, y)).toBe(alpha(15 - x, 15 - y));
    }
  });

  it("chooses a look from the cell's cover and biomass", () => {
    const dormant = ["LICHEN", "GRASS", "SHRUB"];
    expect(plantLook("WATER", 200, 0, 0, 77, dormant)).toBeNull();
    expect(plantLook("BARE", 200, 0, 0, 77, dormant)).toBeNull();
    expect(plantLook("GRASS", 5, 0, 0, 77, dormant)).toBeNull(); // too sparse to draw
    expect(plantLook("GRASS", 200, 3, 4, 77, dormant)).toMatchObject({
      form: "GRASS",
      stage: "mature",
      dormant: false,
    });
    expect(plantLook("GRASS", 40, 3, 4, 77, dormant)).toMatchObject({
      stage: "young",
      dormant: true,
    });
    // Trees keep their colour however thin they are.
    expect(plantLook("CONIFER", 40, 3, 4, 77, dormant)?.dormant).toBe(false);
    const variants = new Set<number>();
    for (let x = 0; x < 50; x++)
      variants.add(plantLook("SHRUB", 200, x, 7, 77, dormant)?.variant ?? -1);
    expect(variants).toEqual(new Set([0, 1]));
    expect(lookKey({ form: "GRASS", stage: "young", variant: 1, dormant: true })).toBe(
      "GRASS/young/1/dormant",
    );
  });
});
