import { describe, expect, it } from "vitest";
import { kindOf, type Look } from "../../src/creatures/body";
import { kindFor, speciesPlans, type Member } from "../../src/creatures/species";

/** A plain walker; tests change one thing at a time. */
function member(species: number, change: Partial<Look> = {}): Member {
  return {
    species,
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

describe("one body plan per species", () => {
  it("draws every member as the kind of its average member", () => {
    // Mostly beasts, a few whose leg gene rounds to one pair: hoppers on their own.
    const herd = [
      ...Array.from({ length: 9 }, () => member(1)),
      member(1, { limbPairs: 1 }),
      member(1, { limbPairs: 1 }),
    ];
    expect(new Set(herd.map(kindOf))).toEqual(new Set(["beast", "hopper"]));
    const plans = speciesPlans(herd);
    expect(plans.get(1)).toEqual({ kind: "beast", swims: false, members: 11 });
    expect(new Set(herd.map((animal) => kindFor(animal, plans)))).toEqual(new Set(["beast"]));
  });

  it("keeps species apart, and an animal of no species as its own genes make it", () => {
    const animals = [
      member(1),
      member(1, { speed: 0.6 }), // a lizard on its own
      member(2, { limbPairs: 3 }),
      member(0, { limbPairs: 4 }),
    ];
    const plans = speciesPlans(animals);
    expect([...plans.keys()].sort()).toEqual([1, 2]);
    expect(animals.map((animal) => kindFor(animal, plans))).toEqual([
      kindOf(member(1, { speed: 0.55 })),
      kindOf(member(1, { speed: 0.55 })),
      "insect",
      "spider",
    ]);
  });

  it("never draws an animal as a kind of the water while it lives on land, or the reverse", () => {
    // A species of swimmers with one member whose aquatic gene keeps it on land.
    const school = [
      ...Array.from({ length: 5 }, () => member(3, { limbPairs: 0, aquatic: 0.9, speed: 0.7 })),
      member(3, { limbPairs: 0, aquatic: 0.2, speed: 0.7 }),
    ];
    const plans = speciesPlans(school);
    expect(plans.get(3)?.swims).toBe(true);
    const ashore = school[school.length - 1];
    if (ashore === undefined) throw new Error("no member");
    expect(kindFor(ashore, plans)).toBe(kindOf(ashore));
    expect(kindFor(school[0] ?? ashore, plans)).toBe("fish");
  });
});
