import { describe, expect, it } from "vitest";
import {
  bodyPlan,
  colour,
  type BodyOptions,
  type BodyPlan,
  type Look,
} from "../../src/creatures/body";
import { ownColours, speciesColours, type Hsl } from "../../src/creatures/colours";
import { GENE_COUNT, Gene, type GeneName } from "../../src/creatures/genome";
import { mulberry32 } from "../../src/rng";

/** The ground's and the grass's hues, which no animal is given (no olive). */
const GROUND = [0.11, 0.42] as const;

function genome(change: Partial<Record<GeneName, number>> = {}): number[] {
  const genes = Array.from({ length: GENE_COUNT }, () => 0.5);
  for (const [name, value] of Object.entries(change)) genes[Gene[name as GeneName]] = value;
  return genes;
}

/** How far round the wheel a hue is from the ground's end, where the animals' hues begin. */
const round = (hue: number): number => (hue - GROUND[1] + 1) % 1;
const offGround = (hsl: Hsl): boolean => hsl.hue <= GROUND[0] || hsl.hue >= GROUND[1];
/** Distance between two hues round the wheel. */
const apart = (a: number, b: number): number => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));

describe("colours from the genes", () => {
  it("never gives a body or its markings the ground's olive greens", () => {
    const random = mulberry32(21);
    const members = Array.from({ length: 200 }, () => ({
      species: 1 + Math.floor(random() * 9),
      genome: Array.from({ length: GENE_COUNT }, () => random()),
    }));
    const species = speciesColours(members);
    expect(species.size).toBe(9);
    for (const { species: id, genome: genes } of members) {
      const ranked = species.get(id);
      expect(ranked).toBeDefined();
      if (ranked === undefined) continue;
      expect(offGround(ranked.colours.body)).toBe(true);
      expect(offGround(ranked.colours.mark)).toBe(true);
      const own = ownColours(ranked, genes);
      expect(offGround(own.body)).toBe(true);
      expect(offGround(own.mark)).toBe(true);
    }
  });

  it("tells sister species apart: ranked hues spread evenly round the wheel, in the genes' order", () => {
    // Five species within a few hundredths of each other in HUE (as the v9 world's).
    const hues = [0.95, 0.92, 0.97, 0.93, 0.94];
    const members = hues.map((hue, k) => ({ species: k + 1, genome: genome({ HUE: hue }) }));
    const species = speciesColours(members);
    const ordered = [...members]
      .sort((a, b) => (a.genome[Gene.HUE] ?? 0) - (b.genome[Gene.HUE] ?? 0))
      .map(({ species: id }) => round(species.get(id)?.colours.body.hue ?? 0));
    for (let k = 1; k < ordered.length; k++) {
      // The redder species stays the warmer: each a fifth of the spare wheel on.
      expect((ordered[k] ?? 0) - (ordered[k - 1] ?? 0)).toBeCloseTo(0.69 / 5);
    }
    // The first at the ground's end, the last a step short of coming round to it.
    expect(ordered[0]).toBeCloseTo(0);
  });

  it("gives a species alone the middle of every range", () => {
    const species = speciesColours([{ species: 4, genome: genome() }]);
    const { body, mark } = species.get(4)?.colours ?? { body: null, mark: null };
    expect(body?.saturation).toBeCloseTo((0.5 + 0.78) / 2);
    expect(body?.light).toBeCloseTo((0.66 + 0.36) / 2);
    expect(mark?.saturation).toBeCloseTo((0.4 + 0.76) / 2);
  });

  it("reads each gene for its own part: size light to deep, water vivid, hunters' markings bold", () => {
    const members = [
      { species: 1, genome: genome({ SIZE: 0.1, AQUATIC: 0.1, DIET: 0.1, SOCIAL: 0.1 }) },
      { species: 2, genome: genome({ SIZE: 0.9, AQUATIC: 0.9, DIET: 0.9, SOCIAL: 0.9 }) },
    ];
    const species = speciesColours(members);
    const small = species.get(1)?.colours;
    const large = species.get(2)?.colours;
    if (small === undefined || large === undefined) throw new Error("not coloured");
    // The small light, the big deep.
    expect(small.body.light).toBeGreaterThan(large.body.light);
    // The water's more vivid.
    expect(large.body.saturation).toBeGreaterThan(small.body.saturation);
    // Hunters vivid, grazers muted.
    expect(large.mark.saturation).toBeGreaterThan(small.mark.saturation);
    // Loners' markings near the body's hue, the social's across the wheel.
    expect(apart(large.mark.hue, large.body.hue)).toBeGreaterThan(
      apart(small.mark.hue, small.body.hue),
    );
  });

  it("keeps markings at least 0.2 lighter or darker than the body", () => {
    const random = mulberry32(5);
    const members = Array.from({ length: 60 }, (_, k) => ({
      species: k % 12,
      genome: Array.from({ length: GENE_COUNT }, () => random()),
    }));
    for (const { colours } of speciesColours(members).values()) {
      expect(Math.abs(colours.mark.light - colours.body.light)).toBeGreaterThanOrEqual(0.2 - 1e-9);
    }
  });

  it("is the same whatever order the animals come in", () => {
    const random = mulberry32(8);
    const members = Array.from({ length: 30 }, (_, k) => ({
      species: k % 4,
      genome: Array.from({ length: GENE_COUNT }, () => random()),
    }));
    const forward = speciesColours(members);
    const backward = speciesColours([...members].reverse());
    for (const [id, colour] of forward) expect(backward.get(id)).toEqual(colour);
  });

  it("keeps each species' gene averages", () => {
    const species = speciesColours([
      { species: 7, genome: genome({ HUE: 0.2, SIZE: 0.4 }) },
      { species: 7, genome: genome({ HUE: 0.4, SIZE: 0.8 }) },
    ]);
    expect(species.get(7)?.means.HUE).toBeCloseTo(0.3);
    expect(species.get(7)?.means.SIZE).toBeCloseTo(0.6);
  });

  it("shows an animal's own genes a little against its species'", () => {
    const species = speciesColours([
      { species: 1, genome: genome({ HUE: 0.6 }) },
      { species: 2, genome: genome({ HUE: 0.9 }) },
    ]);
    const ranked = species.get(2);
    if (ranked === undefined) throw new Error("not coloured");
    // At the average, its species' colours.
    expect(ownColours(ranked, genome({ HUE: 0.9 }))).toEqual(ranked.colours);
    // Redder or larger than the average, a little: never further than 0.04 of a turn.
    const own = ownColours(ranked, genome({ HUE: 0.95, SIZE: 0.6 }));
    expect(apart(own.body.hue, ranked.colours.body.hue)).toBeCloseTo(0.02);
    expect(own.body.light).toBeLessThan(ranked.colours.body.light);
    const far = ownColours(ranked, genome({ HUE: 0, SIZE: 1, EXPLORATION: 1 }));
    expect(apart(far.body.hue, ranked.colours.body.hue)).toBeLessThanOrEqual(0.04 + 1e-9);
    expect(Math.abs(far.body.light - ranked.colours.body.light)).toBeLessThanOrEqual(0.04 + 1e-9);
    expect(Math.abs(far.mark.light - ranked.colours.mark.light)).toBeLessThanOrEqual(0.04 + 1e-9);
  });
});

describe("a body drawn in its gene colours, and a young one", () => {
  const look = (change: Partial<Look> = {}): Look => ({
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
    pattern: 0.9,
    ...change,
  });
  const COSY: BodyOptions = { style: "cosy", scale: 1, pixels: 8, pace: 1 };
  const colours = {
    body: { hue: 0.6, saturation: 0.7, light: 0.5 },
    mark: { hue: 0.95, saturation: 0.6, light: 0.25 },
  };

  it("is its body colour, and wears its markings' colour", () => {
    const plan = bodyPlan(look({ colours }), COSY);
    expect(plan.colour).toBe(colour(0.6, 0.5, 0.7));
    // A stripe down its back, in its markings' colour.
    const striped = bodyPlan(look({ colours, pattern: 0.1 }), COSY);
    expect(striped.parts.some((part) => part.colour === colour(0.95, 0.25, 0.6))).toBe(true);
    // Without, as before: its HUE.
    expect(bodyPlan(look(), COSY).colour).not.toBe(plan.colour);
  });

  it("draws a newborn half as long, its head larger for its body, growing to its full size", () => {
    const grown = bodyPlan(look(), COSY);
    expect(bodyPlan(look({ growth: 1 }), COSY)).toEqual(grown);
    const newborn = bodyPlan(look({ growth: 0 }), COSY);
    const half = bodyPlan(look({ growth: 0.5 }), COSY);
    expect(newborn.length).toBeCloseTo(grown.length / 2);
    expect(half.length).toBeGreaterThan(newborn.length);
    expect(half.length).toBeLessThan(grown.length);
    const head = (plan: BodyPlan): number => (plan.radii[0] ?? 0) / (plan.radii[1] ?? 1);
    expect(head(newborn)).toBeCloseTo(head(grown) * 1.35);
  });
});
