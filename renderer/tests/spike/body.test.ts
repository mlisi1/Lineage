import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CREATURE_STYLES,
  LAYER,
  PATTERNS,
  SWIMS_FROM,
  blend,
  bodyPlan,
  colour,
  kindOf,
  patternOf,
  spriteCount,
  type BodyOptions,
  type BodyPlan,
  type Kind,
} from "../../src/spike/body";
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

const SHAPES: BodyOptions = { style: "shapes", scale: 1, pixels: 8, pace: 1 };
const LIT: BodyOptions = { style: "lit", scale: 1, pixels: 8, pace: 1 };
/** The same body seen from close: 32 art pixels to the cell, at an amble. */
const CLOSE: BodyOptions = { style: "lit", scale: 1, pixels: 32, pace: 0.35 };
const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 255,
  (rgb >> 8) & 255,
  rgb & 255,
];
const inLayer = (plan: BodyPlan, layer: number): BodyPlan["parts"] =>
  plan.parts.filter((part) => part.layer === layer);
/** The bodies of the first look: discs in the body layer, one per joint. */
const discs = (plan: BodyPlan): BodyPlan["parts"] =>
  inLayer(plan, LAYER.body).filter((part) => part.shape === "disc");

/** A genome for every kind of animal. */
const KINDS: Readonly<Record<Kind, Partial<CreatureSeed>>> = {
  worm: { limbPairs: 0, speed: 0.2 },
  snake: { limbPairs: 0, speed: 0.8 },
  fish: { limbPairs: 0, aquatic: 0.9, speed: 0.7 },
  eel: { limbPairs: 0, aquatic: 0.9, speed: 0.2 },
  hopper: { limbPairs: 1 },
  lizard: { limbPairs: 2, speed: 0.8 },
  beast: { limbPairs: 2, speed: 0.3 },
  newt: { limbPairs: 2, aquatic: 0.55 },
  tortoise: { limbPairs: 2, armour: 0.8 },
  insect: { limbPairs: 3 },
  beetle: { limbPairs: 3, armour: 0.8 },
  spider: { limbPairs: 4 },
  crab: { limbPairs: 4, armour: 0.6 },
};

describe("the first look: a chain of circles", () => {
  it("grows with the cube root of mass and gains segments", () => {
    const small = bodyPlan(seed({ mass: 0.25 }));
    const large = bodyPlan(seed({ mass: 16 }));
    expect(small.kind).toBe("chain");
    expect(large.length / small.length).toBeCloseTo(4); // 64 times the mass
    expect([small.joints, large.joints]).toEqual([5, 9]);
    for (const plan of [small, large]) {
      expect(plan.radii).toHaveLength(plan.joints);
      expect(discs(plan)).toHaveLength(plan.joints);
      expect(plan.spacing * (plan.joints - 1)).toBeCloseTo(plan.length);
      // Widest at the chest, thinnest at the tail.
      expect(Math.max(...plan.radii)).toBe(plan.radii[1]);
      expect(Math.min(...plan.radii)).toBe(plan.radii[plan.joints - 1]);
      expect(Math.min(...plan.radii)).toBeGreaterThan(0);
    }
  });

  it("hangs every leg on a joint between the head and the tail tip", () => {
    for (const mass of [0.25, 2, 16]) {
      for (let pairs = 0; pairs <= 4; pairs++) {
        const plan = bodyPlan(seed({ mass, limbPairs: pairs }));
        expect(plan.legs).toHaveLength(2 * pairs);
        expect(plan.legs.filter((leg) => leg.side === 1)).toHaveLength(pairs);
        for (const leg of plan.legs) {
          expect(leg.joint).toBeGreaterThanOrEqual(1);
          expect(leg.joint).toBeLessThanOrEqual(plan.joints - 2);
          expect(leg.length).toBeGreaterThan(0);
        }
      }
    }
    // A long body has room to give each of four pairs its own joint.
    const joints = bodyPlan(seed({ mass: 16, limbPairs: 4 })).legs.map((leg) => leg.joint);
    expect(new Set(joints).size).toBe(4);
  });

  it("makes a fast animal slimmer and longer in the leg", () => {
    const slow = bodyPlan(seed({ speed: 0 }));
    const fast = bodyPlan(seed({ speed: 1 }));
    expect(fast.length).toBe(slow.length);
    expect(fast.radii[0]).toBeLessThan(slow.radii[0] ?? 0);
    expect(fast.legs[0]?.length).toBeGreaterThan(slow.legs[0]?.length ?? 0);
  });

  it("adds a shell, mandibles, fins and spots only as far as the genes go", () => {
    const plain = bodyPlan(seed({ jaw: 0 }));
    // Two eyes, and nothing else on a body of bare circles.
    expect(plain.parts).toHaveLength(plain.joints + 2);
    expect(inLayer(plain, LAYER.face)).toHaveLength(2);
    expect(inLayer(bodyPlan(seed({ armour: 0.1, jaw: 0 })), LAYER.under)).toHaveLength(0);
    const shelled = inLayer(bodyPlan(seed({ armour: 1, jaw: 0 })), LAYER.under);
    expect(shelled).toHaveLength(plain.joints);
    expect(shelled[0]?.along).toBeGreaterThan(discs(plain)[0]?.along ?? 0);

    const jaws = (jaw: number): BodyPlan["parts"] =>
      bodyPlan(seed({ jaw })).parts.filter((part) => part.shape === "bar");
    expect(jaws(0.1)).toHaveLength(0);
    expect(jaws(0.3)).toHaveLength(2);
    expect(jaws(1)[0]?.along).toBeGreaterThan((jaws(0.3)[0]?.along ?? 0) * 1.8);
    // A grazer's are the colour of its legs; a hunter's are ivory.
    expect(bodyPlan(seed({ diet: 0 })).parts.find((part) => part.shape === "bar")?.colour).toBe(
      bodyPlan(seed({ diet: 0 })).legs[0]?.colour,
    );
    expect(bodyPlan(seed({ diet: 1 })).parts.find((part) => part.shape === "bar")?.colour).toBe(
      0xf2ead0,
    );

    expect(inLayer(bodyPlan(seed({ aquatic: 0.2, jaw: 0 })), LAYER.under)).toHaveLength(0);
    expect(inLayer(bodyPlan(seed({ aquatic: 0.5, jaw: 0 })), LAYER.under)).toHaveLength(3);
    expect(inLayer(bodyPlan(seed({ pattern: 0.9, jaw: 0 })), LAYER.mark)).toHaveLength(
      plain.joints - 1,
    );
    const eyes = (sense: number): number =>
      inLayer(bodyPlan(seed({ sense })), LAYER.face)[0]?.along ?? 0;
    expect(eyes(1)).toBeGreaterThan(eyes(0) * 2);
  });

  it("puts swimmers in the water from a threshold on, at the speed of where they live", () => {
    expect(bodyPlan(seed({ aquatic: 0.5 })).swims).toBe(false);
    expect(bodyPlan(seed({ aquatic: SWIMS_FROM })).swims).toBe(true);
    const fish = bodyPlan(seed({ aquatic: 1, landSpeed: 0.5, swimSpeed: 4 }));
    expect(fish.pace).toBeGreaterThan(bodyPlan(seed({ aquatic: 0.5, landSpeed: 0.5 })).pace);
  });
});

describe("body plans", () => {
  it("pick a kind by leg pairs first, then water, armour and speed", () => {
    for (const [kind, genes] of Object.entries(KINDS)) expect(kindOf(seed(genes))).toBe(kind);
    // The thresholds: a shell from 0.55 armour, a lizard from 0.55 speed.
    expect(kindOf(seed({ armour: 0.5 }))).toBe("beast");
    expect(kindOf(seed({ armour: 0.55 }))).toBe("tortoise");
    expect(kindOf(seed({ speed: 0.5 }))).toBe("beast");
    expect(kindOf(seed({ speed: 0.55 }))).toBe("lizard");
    // A shell or the sea outranks speed.
    expect(kindOf(seed({ speed: 0.9, armour: 0.9 }))).toBe("tortoise");
  });

  it("give every kind a body of its own, with as many legs as the genes say", () => {
    const shapes = new Set<string>();
    for (const [kind, genes] of Object.entries(KINDS)) {
      const plan = bodyPlan(seed(genes), SHAPES);
      expect(plan.kind).toBe(kind);
      expect(plan.legs).toHaveLength(2 * Math.round(seed(genes).limbPairs));
      expect(plan.radii).toHaveLength(plan.joints);
      expect(plan.joints).toBeLessThanOrEqual(12);
      for (const leg of plan.legs) expect(leg.joint).toBeLessThan(plan.joints);
      for (const part of plan.parts) {
        expect(part.joint).toBeLessThan(plan.joints);
        for (const value of [part.along, part.across, part.forward, part.side, part.turn]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(part.along).toBeGreaterThan(0);
        expect(part.across).toBeGreaterThan(0);
      }
      // Drawn back to front.
      const layers = plan.parts.map((part) => part.layer);
      expect([...layers].sort((a, b) => a - b)).toEqual(layers);
      // What tells kinds apart: how many joints, how wide where, which shapes.
      shapes.add(
        [
          plan.joints,
          plan.radii.map((r) => r.toFixed(2)),
          plan.parts.map((p) => p.shape[0]),
        ].join(),
      );
    }
    expect(shapes.size).toBe(Object.keys(KINDS).length);
  });

  it("make the silhouettes differ where it matters", () => {
    const plan = (kind: Kind): BodyPlan => bodyPlan(seed(KINDS[kind]), SHAPES);
    // A snake is long and thin, a crab short and wide.
    expect(plan("snake").length).toBeGreaterThan(plan("worm").length * 1.2);
    expect(plan("crab").length).toBeLessThan(plan("beast").length);
    const widest = (kind: Kind): number =>
      Math.max(...inLayer(plan(kind), LAYER.body).map((part) => part.across));
    expect(widest("crab")).toBeGreaterThan(widest("beast") * 1.2);
    // Its carapace is wider than it is long.
    const carapace = inLayer(plan("crab"), LAYER.body).find(
      (part) => part.across === widest("crab"),
    );
    expect(carapace?.across).toBeGreaterThan((carapace?.along ?? 0) * 1.4);
    expect(widest("snake")).toBeLessThan(widest("beast") * 0.75);
    // Wedges: a lizard's snout, a fish's forked tail, a crab's claws.
    const wedges = (kind: Kind): number =>
      plan(kind).parts.filter((part) => part.shape === "wedge").length;
    expect(wedges("worm")).toBe(0);
    expect(wedges("lizard")).toBeGreaterThanOrEqual(1);
    expect(wedges("fish")).toBeGreaterThanOrEqual(4);
    expect(wedges("crab")).toBeGreaterThanOrEqual(2);
    // One shell over a tortoise: its biggest part is as long as most of the body.
    const shell = Math.max(...plan("tortoise").parts.map((part) => part.along));
    expect(shell).toBeGreaterThan(plan("tortoise").length * 0.7);
  });

  it("read the pattern gene as one of twelve markings, in one of four colours", () => {
    expect(PATTERNS).toHaveLength(12);
    expect(patternOf(0)).toEqual({ pattern: "plain", shade: 0 });
    expect(patternOf(1).pattern).toBe("eyespots");
    expect(patternOf(1).shade).toBeLessThan(1);
    // Each marking has a twelfth of the gene; how far into it picks the colour.
    PATTERNS.forEach((pattern, k) => {
      expect(patternOf((k + 0.5) / 12)).toEqual({ pattern, shade: 0.5 });
    });
    expect(patternOf(-3).pattern).toBe("plain");
    const colours = new Set(
      [0.1, 0.35, 0.6, 0.85].map(
        (shade) =>
          inLayer(bodyPlan(seed({ pattern: (1 + shade) / 12, jaw: 0 }), SHAPES), LAYER.mark)[0]
            ?.colour,
      ),
    );
    expect(colours.size).toBe(4);
  });

  it("draw every marking differently, on a back and on a shell", () => {
    for (const body of [KINDS.beast, KINDS.beetle]) {
      const looks = new Set<string>();
      PATTERNS.forEach((pattern, k) => {
        const plan = bodyPlan(seed({ ...body, pattern: (k + 0.5) / 12, jaw: 0 }), SHAPES);
        const marks = inLayer(plan, LAYER.mark).filter(
          // A beetle's seam and plates are marks too, whatever its pattern.
          (part) => !(part.shape === "bar" && part.colour === plan.parts[0]?.colour),
        );
        if (pattern === "plain") expect(marks.length).toBeLessThanOrEqual(1);
        else expect(marks.length).toBeGreaterThan(0);
        for (const mark of marks) expect(mark.joint).toBeLessThan(plan.joints);
        looks.add(
          marks.map((m) => [m.shape, m.along.toFixed(3), m.across.toFixed(3), m.colour]).join("|"),
        );
      });
      expect(looks.size).toBe(PATTERNS.length);
    }
    // False eyes come in a pair, three rings each; a saddle brings a mask over the head.
    const eyespots = inLayer(bodyPlan(seed({ pattern: 11.5 / 12, jaw: 0 }), SHAPES), LAYER.mark);
    expect(eyespots).toHaveLength(6);
    const saddle = inLayer(bodyPlan(seed({ pattern: 7.5 / 12, jaw: 0 }), SHAPES), LAYER.mark);
    expect(saddle.some((mark) => mark.joint === 0)).toBe(true);
  });

  it("show a hunter by its snout", () => {
    const snout = (diet: number): number =>
      bodyPlan(seed({ speed: 0.3, diet, jaw: 0 }), SHAPES).parts.filter(
        (part) => part.shape === "wedge" && part.layer === LAYER.body,
      ).length;
    expect(snout(0.2)).toBe(0);
    expect(snout(0.9)).toBe(1);
  });

  it("scale with the size asked for", () => {
    const once = bodyPlan(seed(), SHAPES);
    const twice = bodyPlan(seed(), { ...SHAPES, scale: 2 });
    expect(twice.length).toBeCloseTo(2 * once.length);
    expect(twice.parts).toHaveLength(once.parts.length);
    twice.parts.forEach((part, i) => {
      expect(part.along).toBeCloseTo(2 * (once.parts[i]?.along ?? 0), 1);
    });
    expect(twice.legs[0]?.length).toBeCloseTo(2 * (once.legs[0]?.length ?? 0));
  });

  it("outline and light the lit style, on the same bodies", () => {
    for (const genes of Object.values(KINDS)) {
      const plain = bodyPlan(seed(genes), SHAPES);
      const lit = bodyPlan(seed(genes), LIT);
      expect(lit.kind).toBe(plain.kind);
      expect(lit.legs).toEqual(plain.legs);
      const edges = inLayer(lit, LAYER.outline);
      const solid = plain.parts.filter(
        (part) => part.layer === LAYER.body || part.layer === LAYER.under,
      );
      // An edge under everything solid, one art pixel of the local view wider all round.
      expect(edges).toHaveLength(solid.length);
      edges.forEach((edge, i) => {
        expect(edge.along).toBeCloseTo((solid[i]?.along ?? 0) + 0.25);
        expect(edge.colour).toBe(0x1f1a17);
      });
      expect(plain.parts.every((part) => part.lift === 0)).toBe(true);
      // What is left over is the light on the back, for bodies wide enough to catch it.
      const lights = lit.parts.filter((part) => part.lift > 0);
      expect(lit.parts).toHaveLength(plain.parts.length + edges.length + lights.length);
      if (["beast", "tortoise", "beetle", "crab"].includes(plain.kind)) {
        expect(lights.length).toBeGreaterThan(0);
      }
      // From this far no leg is thick enough for an edge or a foot.
      expect(lit.legs.every((leg) => leg.edge === 0)).toBe(true);
      expect(spriteCount(lit)).toBe(
        lit.parts.length + lit.legs.reduce((sum, leg) => sum + 2 + (leg.foot > 0 ? 1 : 0), 0),
      );
    }
  });

  it("add what only shows from close: thin outlines, glints, legs with edges and feet", () => {
    const far = bodyPlan(seed({ mass: 4, sense: 0.8 }), LIT);
    const near = bodyPlan(seed({ mass: 4, sense: 0.8 }), CLOSE);
    // The same animal, as long in cells; its outline is one pixel of its own view.
    expect(near.length).toBe(far.length);
    const edge = (plan: BodyPlan): number =>
      (inLayer(plan, LAYER.outline)[0]?.along ?? 0) -
      (plan.parts.find((part) => part.layer === LAYER.under || part.layer === LAYER.body)?.along ??
        0);
    expect(edge(far)).toBeCloseTo(2 / 8);
    expect(edge(near)).toBeCloseTo(2 / 32);
    // A glint in each eye, lifted toward the light.
    const white = (plan: BodyPlan): number =>
      plan.parts.filter((part) => part.colour === 0xffffff && part.lift > 0).length;
    expect([white(far), white(near)]).toEqual([0, 2]);
    expect(near.legs.every((leg) => leg.edge > 0 && leg.foot > 0)).toBe(true);
    expect(spriteCount(near)).toBe(near.parts.length + 6 * near.legs.length);
    // And it ambles.
    expect(near.pace).toBeCloseTo(far.pace * 0.35);
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
  const cast = (name: string): readonly CreatureSeed[] =>
    fixture.casts.find((candidate) => candidate.name === name)?.creatures ?? [];

  it("give every creature a body that can be drawn, in every style", () => {
    const everyone = [...fixture.creatures, ...fixture.casts.flatMap((group) => group.creatures)];
    expect(everyone.length).toBeGreaterThan(200);
    for (const style of CREATURE_STYLES) {
      for (const creature of everyone) {
        const plan = bodyPlan(creature, { style, scale: 0.85, pixels: 32, pace: 1 });
        for (const value of [plan.length, plan.spacing, plan.pace, ...plan.radii]) {
          expect(Number.isFinite(value) && value > 0).toBe(true);
        }
        expect(spriteCount(plan)).toBeLessThan(200);
      }
    }
  });

  it("show many kinds among the specimens, and a family per leg count", () => {
    const kinds = new Set(cast("specimens").map(kindOf));
    expect(kinds.size).toBeGreaterThanOrEqual(7);
    for (const kind of ["worm", "fish", "beetle", "crab", "tortoise"] as const) {
      expect(kinds).toContain(kind);
    }
    expect(cast("sweep-limbs").map(kindOf)).toEqual([
      "snake",
      "hopper",
      "beast",
      "insect",
      "spider",
    ]);
    expect(new Set(cast("sweep-armour").map(kindOf))).toEqual(new Set(["beast", "tortoise"]));
    expect(new Set(cast("sweep-hue").map(kindOf)).size).toBe(1);
  });
});
