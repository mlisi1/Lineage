import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENE_COUNT, geneOf } from "../../src/creatures/genome";
import { phenotype } from "../../src/creatures/phenotype";
import { RARE_LOOKS } from "../../src/creatures/rare";
import { decodeBase64, parseFixture } from "../../src/spike/fixture";
import { PHENOTYPE_CONFIG } from "./worlds";
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
    // The time of year comes with the world: its plants are drawn in it.
    expect(fixture.season).toBe("summer");
    expect(fixture.description).toContain(fixture.season);
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

  it("carries the heights the ground is painted from, and the maps' rules for them", () => {
    expect(fixture.heights).toHaveLength(256 * 150);
    expect(fixture.seaLevel).toBeGreaterThan(0);
    expect(fixture.seaLevel).toBeLessThan(1);
    // What stands above the sea is exactly what is not water.
    const water = fixture.coverClasses.indexOf("WATER");
    for (let cell = 0; cell < fixture.heights.length; cell += 7) {
      expect((fixture.heights[cell] ?? 0) > fixture.seaLevel).toBe(fixture.cover[cell] !== water);
    }
    const { relief } = fixture;
    expect(relief.seaBands.length).toBeGreaterThanOrEqual(3);
    const limits = relief.seaBands.map((band) => band.limit);
    expect([...limits].sort((a, b) => a - b)).toEqual(limits); // shallowest first
    expect(fixture.sea).toEqual(relief.seaBands.map((band) => band.colour));
    expect(relief.slope).toBeGreaterThan(0);
    expect(relief.highRockFrom).toBeLessThan(relief.snowFrom);
    for (const tone of [...relief.highRock, ...relief.snow, relief.shoreOutline]) {
      expect(tone).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("carries the genes that show, in range", () => {
    for (const creature of fixture.creatures) {
      const genes = [
        creature.diet,
        creature.speed,
        creature.armour,
        creature.sense,
        creature.aquatic,
        creature.jaw,
        creature.pattern,
      ];
      for (const gene of genes) {
        expect(gene).toBeGreaterThanOrEqual(0);
        expect(gene).toBeLessThanOrEqual(1);
      }
      expect(creature.landSpeed).toBeGreaterThan(0);
      expect(creature.swimSpeed).toBeGreaterThan(0);
    }
    expect(fixture.herbivoreMaxDiet).toBeLessThan(fixture.predatorMinDiet);
    for (const colour of fixture.sea) expect(colour).toMatch(/^#[0-9a-f]{6}$/);
    expect(fixture.sea.length).toBeGreaterThanOrEqual(3);
  });

  it("derives every body from its genome with the sim's config", () => {
    expect(fixture.phenotypeConfig).toEqual(PHENOTYPE_CONFIG);
    for (const creature of [...fixture.creatures, ...fixture.casts.flatMap((c) => c.creatures)]) {
      expect(creature.genome).toHaveLength(GENE_COUNT);
      const body = phenotype(fixture.phenotypeConfig, creature.genome);
      // A giant (M7) is drawn at the rare-adjusted mass, as the sim has it.
      const giant = creature.rare?.includes("giant") ? fixture.rareConfig.giant_mass_factor : 1;
      expect(creature.mass).toBeCloseTo(body.mass * giant, 9);
      expect(creature.limbPairs).toBe(body.limbPairs);
      expect(creature.hue).toBe(geneOf(creature.genome, "HUE"));
    }
  });

  it("brings fifteen specimens and a five-step sweep of every gene with a look", () => {
    const [specimens, ...others] = fixture.casts;
    const sweeps = others.filter((cast) => cast.name.startsWith("sweep-"));
    expect(specimens?.name).toBe("specimens");
    expect(specimens?.members).toHaveLength(15);
    expect(specimens?.members).toContain("giant");
    expect(new Set(specimens?.members).size).toBe(15);
    expect(sweeps.map((cast) => cast.name)).toEqual(
      ["size", "limbs", "speed", "armour", "sense", "aquatic", "jaw", "diet", "hue", "pattern"].map(
        (gene) => `sweep-${gene}`,
      ),
    );
    for (const sweep of sweeps) {
      expect(sweep.members).toEqual(["0", "0.25", "0.5", "0.75", "1"]);
      expect(sweep.creatures).toHaveLength(5);
    }
    // A sweep changes its own gene and nothing else that shows.
    const armour = sweeps.find((cast) => cast.name === "sweep-armour")?.creatures ?? [];
    expect(armour.map((creature) => creature.armour)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(new Set(armour.map((creature) => creature.mass)).size).toBe(1);
    expect(new Set(armour.map((creature) => creature.hue)).size).toBe(1);
    const size = sweeps.find((cast) => cast.name === "sweep-size")?.creatures ?? [];
    expect(size[0]?.mass).toBeCloseTo(0.25);
    expect(size[4]?.mass).toBeCloseTo(16);
    const limbs = sweeps.find((cast) => cast.name === "sweep-limbs")?.creatures ?? [];
    expect(limbs.map((creature) => creature.limbPairs)).toEqual([0, 1, 2, 3, 4]);
  });

  it("knows each rare gene by its signature, and brings a plain carrier of each", () => {
    expect([...fixture.rareSignatures.values()].sort()).toEqual([...RARE_LOOKS].sort());
    const rare = fixture.casts.find((cast) => cast.name === "rare");
    expect(rare?.members).toEqual([...RARE_LOOKS, "coat, torpid"]);
    rare?.creatures.forEach((creature, index) => {
      const key = RARE_LOOKS[index] ?? "coat";
      expect(creature.rare).toEqual([key]);
      expect(creature.torpid).toBe(index === RARE_LOOKS.length);
    });
    // In the world: a giant, drawn at twice its genes' mass.
    const giants = fixture.creatures.filter((creature) => creature.rare?.includes("giant"));
    expect(giants.length).toBeGreaterThan(0);
    expect(fixture.rareConfig.giant_mass_factor).toBeGreaterThan(1);
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
    const flat = { ...(document as Record<string, unknown>), heights: "AAAA" };
    expect(() => parseFixture(flat)).toThrow("does not match");
    const short = { ...(document as Record<string, unknown>), creature_fields: ["x", "y"] };
    expect(() => parseFixture(short)).toThrow('no creature field "size"');
    const unconfigured = { ...(document as Record<string, unknown>), phenotype_config: {} };
    expect(() => parseFixture(unconfigured)).toThrow("phenotype config");
    const lopsided = {
      ...(document as Record<string, unknown>),
      casts: [{ name: "odd", members: ["a", "b"], creatures: [] }],
    };
    expect(() => parseFixture(lopsided)).toThrow("cast members and rows differ");
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
