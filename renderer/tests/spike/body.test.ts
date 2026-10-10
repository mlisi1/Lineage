import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SWIMS_FROM, blend, bodyPlan, colour, spriteCount } from "../../src/spike/body";
import { parseFixture, type CreatureSeed } from "../../src/spike/fixture";

/** A plain mid-sized walker; tests change one thing at a time. */
function seed(change: Partial<CreatureSeed> = {}): CreatureSeed {
  return {
    x: 0,
    y: 0,
    mass: 2,
    limbPairs: 2,
    landSpeed: 3,
    swimSpeed: 1,
    diet: 0.2,
    speed: 0.5,
    armour: 0,
    sense: 0.4,
    aquatic: 0,
    jaw: 0.5,
    hue: 0.9,
    pattern: 0,
    ...change,
  };
}

const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 255,
  (rgb >> 8) & 255,
  rgb & 255,
];

describe("bodyPlan", () => {
  it("grows with the cube root of mass and gains segments", () => {
    const small = bodyPlan(seed({ mass: 0.25 }));
    const large = bodyPlan(seed({ mass: 16 }));
    expect(large.length / small.length).toBeCloseTo(4); // 64 times the mass
    expect(small.radii).toHaveLength(5);
    expect(large.radii).toHaveLength(9);
    for (const plan of [small, large]) {
      expect(plan.spacing * (plan.radii.length - 1)).toBeCloseTo(plan.length);
      // Widest at the chest, thinnest at the tail.
      expect(Math.max(...plan.radii)).toBe(plan.radii[1]);
      expect(Math.min(...plan.radii)).toBe(plan.radii[plan.radii.length - 1]);
      expect(Math.min(...plan.radii)).toBeGreaterThan(0);
    }
  });

  it("hangs every leg pair on a joint between the head and the tail tip", () => {
    for (const mass of [0.25, 2, 16]) {
      for (let pairs = 0; pairs <= 4; pairs++) {
        const plan = bodyPlan(seed({ mass, limbPairs: pairs }));
        expect(plan.legJoints).toHaveLength(pairs);
        expect([...plan.legJoints].sort((a, b) => a - b)).toEqual(plan.legJoints);
        for (const joint of plan.legJoints) {
          expect(joint).toBeGreaterThanOrEqual(1);
          expect(joint).toBeLessThanOrEqual(plan.radii.length - 2);
        }
      }
    }
    // A long body has room to give each of four pairs its own joint.
    expect(new Set(bodyPlan(seed({ mass: 16, limbPairs: 4 })).legJoints).size).toBe(4);
  });

  it("makes a fast animal slimmer and longer in the leg", () => {
    const slow = bodyPlan(seed({ speed: 0 }));
    const fast = bodyPlan(seed({ speed: 1 }));
    expect(fast.length).toBe(slow.length);
    expect(fast.radii[0]).toBeLessThan(slow.radii[0] ?? 0);
    expect(fast.legLength).toBeGreaterThan(slow.legLength);
  });

  it("shows armour, sense and jaw only as far as the genes go", () => {
    expect(bodyPlan(seed({ armour: 0.1 })).shell).toBe(0);
    const thin = bodyPlan(seed({ armour: 0.2 })).shell;
    const thick = bodyPlan(seed({ armour: 1 })).shell;
    expect(thin).toBeGreaterThan(0);
    expect(thick).toBeGreaterThan(thin);

    expect(bodyPlan(seed({ sense: 1 })).eyeRadius).toBeGreaterThan(
      bodyPlan(seed({ sense: 0 })).eyeRadius * 2,
    );

    expect(bodyPlan(seed({ jaw: 0.1 })).jawLength).toBe(0);
    expect(bodyPlan(seed({ jaw: 1 })).jawLength).toBeGreaterThan(
      bodyPlan(seed({ jaw: 0.3 })).jawLength * 2,
    );
  });

  it("colours the jaws of a hunter ivory and those of a grazer like its legs", () => {
    const grazer = bodyPlan(seed({ diet: 0 }));
    const hunter = bodyPlan(seed({ diet: 1 }));
    expect(grazer.colours.jaw).toBe(grazer.colours.dark);
    expect(hunter.colours.jaw).toBe(0xf2ead0);
    expect(Math.min(...channels(hunter.colours.jaw))).toBeGreaterThan(200);
  });

  it("gives swimmers fins, and the water from a threshold on", () => {
    const land = bodyPlan(seed({ aquatic: 0.2 }));
    expect([land.finLength, land.swims]).toEqual([0, false]);
    const amphibian = bodyPlan(seed({ aquatic: 0.5 }));
    expect(amphibian.finLength).toBeGreaterThan(0);
    expect(amphibian.swims).toBe(false);
    const fish = bodyPlan(seed({ aquatic: 1, landSpeed: 0.5, swimSpeed: 4 }));
    expect(fish.finLength).toBeGreaterThan(amphibian.finLength);
    expect(fish.swims).toBe(true);
    expect(bodyPlan(seed({ aquatic: SWIMS_FROM })).swims).toBe(true);
    // Each moves at the speed of where it lives.
    expect(fish.pace).toBeGreaterThan(bodyPlan(seed({ aquatic: 0.5, landSpeed: 0.5 })).pace);
  });

  it("reads the pattern gene as plain, banded or spotted", () => {
    expect(
      [0, 0.3, 0.34, 0.6, 0.67, 1].map((pattern) => bodyPlan(seed({ pattern })).pattern),
    ).toEqual(["plain", "plain", "bands", "bands", "spots", "spots"]);
  });

  it("counts the sprites a body needs", () => {
    const plain = bodyPlan(seed({ jaw: 0, limbPairs: 0 }));
    expect(spriteCount(plain)).toBe(plain.radii.length + 2); // segments and eyes
    const full = bodyPlan(seed({ armour: 1, pattern: 1, aquatic: 1, limbPairs: 4 }));
    const segments = full.radii.length;
    expect(spriteCount(full)).toBe(segments * 2 + (segments - 1) + 2 + 2 + 3 + 16);
  });
});

describe("colours", () => {
  it("turns hue into a colour of the asked lightness", () => {
    const [r, g, b] = channels(colour(0, 0.55));
    expect(r).toBeGreaterThan(g);
    expect(g).toBe(b); // pure red hue
    const [, green] = channels(colour(1 / 3, 0.55));
    expect(green).toBe(r);
    expect(colour(1.25, 0.4)).toBe(colour(0.25, 0.4)); // hue wraps
    const light = (rgb: number): number => channels(rgb).reduce((sum, value) => sum + value, 0);
    expect(light(colour(0.6, 0.8))).toBeGreaterThan(light(colour(0.6, 0.3)));
  });

  it("blends between two colours", () => {
    expect(blend(0x102030, 0xf0e0d0, 0)).toBe(0x102030);
    expect(blend(0x102030, 0xf0e0d0, 1)).toBe(0xf0e0d0);
    expect(blend(0x000000, 0xffffff, 0.5)).toBe(0x808080);
    expect(blend(0x000000, 0xffffff, 7)).toBe(0xffffff);
  });
});

describe("the committed casts", () => {
  const fixture = parseFixture(JSON.parse(readFileSync("public/spike/world.json", "utf8")));

  it("give every creature a body that can be drawn", () => {
    const everyone = [...fixture.creatures, ...fixture.casts.flatMap((cast) => cast.creatures)];
    expect(everyone.length).toBeGreaterThan(200);
    for (const creature of everyone) {
      const plan = bodyPlan(creature);
      const numbers = [plan.length, plan.spacing, plan.legLength, plan.eyeRadius, plan.pace];
      for (const value of [...numbers, ...plan.radii]) {
        expect(Number.isFinite(value) && value > 0).toBe(true);
      }
      expect(spriteCount(plan)).toBeLessThan(60);
    }
  });

  it("show every look at least once among the specimens", () => {
    const plans = (fixture.casts[0]?.creatures ?? []).map(bodyPlan);
    expect(new Set(plans.map((plan) => plan.pattern))).toEqual(
      new Set(["plain", "bands", "spots"]),
    );
    expect(new Set(plans.map((plan) => plan.legJoints.length))).toEqual(new Set([0, 2, 3, 4]));
    for (const has of [
      (plan: (typeof plans)[number]) => plan.shell > 0,
      (plan: (typeof plans)[number]) => plan.finLength > 0,
      (plan: (typeof plans)[number]) => plan.swims,
      (plan: (typeof plans)[number]) => plan.jawLength === 0,
    ]) {
      expect(plans.some(has)).toBe(true);
      expect(plans.every(has)).toBe(false);
    }
  });
});
