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
  submerge,
  type BodyOptions,
  type BodyPlan,
  type Kind,
  type Look,
} from "../../src/creatures/body";
import { parseFixture, type CreatureSeed } from "../../src/spike/fixture";

/** A plain mid-sized walker; tests change one thing at a time. */
function seed(change: Partial<Look> = {}): Look {
  return {
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
/** The chosen style (ADR 0013), from close. */
const COSY: BodyOptions = { style: "cosy", scale: 1, pixels: 32, pace: 0.35 };
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
const KINDS: Readonly<Record<Kind, Partial<Look>>> = {
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

describe("the cosy style (ADR 0013)", () => {
  const shadows = (plan: BodyPlan): BodyPlan["parts"] => inLayer(plan, LAYER.ground);

  it("is lit's body plan, with one see-through shadow on the ground and nothing else see-through", () => {
    for (const kind of Object.keys(KINDS) as Kind[]) {
      const lit = bodyPlan(seed(KINDS[kind]), CLOSE);
      const cosy = bodyPlan(seed(KINDS[kind]), COSY);
      expect([cosy.kind, cosy.joints, cosy.length]).toEqual([lit.kind, lit.joints, lit.length]);
      expect(cosy.legs.map((leg) => leg.joint)).toEqual(lit.legs.map((leg) => leg.joint));
      expect(shadows(lit)).toHaveLength(0);
      const [shadow, ...more] = shadows(cosy);
      expect(more).toHaveLength(0);
      expect(shadow?.alpha).toBeGreaterThan(0);
      expect(shadow?.alpha).toBeLessThan(1);
      expect(cosy.parts.filter((part) => (part.alpha ?? 1) < 1)).toEqual([shadow]);
      // Under everything, a little away from the light (down and to the right).
      expect(cosy.parts[0]).toBe(shadow);
      expect(shadow?.lift).toBeLessThan(0);
      // What it costs: the shadow, and a glint in each eye where lit's eyes are too small for one.
      const glints = (plan: BodyPlan): number =>
        inLayer(plan, LAYER.face).filter((part) => part.colour === 0xffffff).length;
      expect(glints(cosy)).toBeGreaterThanOrEqual(glints(lit));
      expect(spriteCount(cosy)).toBe(spriteCount(lit) + 1 + glints(cosy) - glints(lit));
      expect(spriteCount(cosy)).toBeLessThanOrEqual(spriteCount(lit) + 3);
    }
  });

  it("outlines each animal in its own dark colour, where lit uses one for all", () => {
    const outline = (hue: number, options: BodyOptions): number =>
      bodyPlan(seed({ hue }), options).outline;
    expect(outline(0.1, CLOSE)).toBe(outline(0.6, CLOSE));
    expect(outline(0.1, COSY)).not.toBe(outline(0.6, COSY));
    for (const hue of [0, 0.25, 0.5, 0.75]) {
      // Dark: no channel above a third of full.
      for (const channel of channels(outline(hue, COSY))) expect(channel).toBeLessThan(86);
      const plan = bodyPlan(seed({ hue }), COSY);
      for (const part of inLayer(plan, LAYER.outline)) expect(part.colour).toBe(plan.outline);
    }
  });

  it("is more saturated than lit, and has larger eyes", () => {
    const spread = (rgb: number): number => Math.max(...channels(rgb)) - Math.min(...channels(rgb));
    const lit = bodyPlan(seed({ hue: 0.3 }), CLOSE);
    const cosy = bodyPlan(seed({ hue: 0.3 }), COSY);
    expect(spread(cosy.colour)).toBeGreaterThan(spread(lit.colour));
    const eye = (plan: BodyPlan): number =>
      Math.max(...inLayer(plan, LAYER.face).map((part) => part.along));
    expect(eye(cosy)).toBeGreaterThan(eye(lit));
  });
});

describe("under water", () => {
  const WATER = 0x3b7fbf;
  const distance = (a: number, b: number): number => {
    const [r1, g1, b1] = channels(a);
    const [r2, g2, b2] = channels(b);
    return Math.hypot(r1 - r2, g1 - g2, b1 - b2);
  };

  it("takes every colour of a body toward the water's, and fades its shadow", () => {
    const dry = bodyPlan(seed({ hue: 0.05 }), COSY);
    const wet = structuredClone(dry);
    submerge(wet);
    dry.parts.forEach((part, i) => {
      const under = wet.parts[i];
      if (under === undefined) throw new Error("parts differ");
      if (part.layer === LAYER.ground) {
        expect(under.alpha).toBeCloseTo((part.alpha ?? 1) / 2);
      } else if (part.colour !== WATER) {
        expect(distance(under.colour, WATER)).toBeLessThan(distance(part.colour, WATER));
      }
    });
    expect(channels(wet.outline)[2]).toBeGreaterThan(channels(wet.outline)[0]);
    for (const part of inLayer(wet, LAYER.outline)) expect(part.colour).toBe(wet.outline);
    dry.legs.forEach((leg, i) => {
      expect(distance(wet.legs[i]?.colour ?? 0, WATER)).toBeLessThan(distance(leg.colour, WATER));
    });
    expect(wet.colour).toBe(dry.colour); // the dot on the map keeps its colour
  });

  it("is how every animal that lives in the water is drawn, and no other", () => {
    const fish = bodyPlan(seed({ ...KINDS.fish, hue: 0.05 }), COSY);
    const newt = bodyPlan(seed({ ...KINDS.newt, hue: 0.05 }), COSY);
    expect([fish.swims, newt.swims]).toEqual([true, false]);
    // A red fish's outline goes blue; a red newt on the shore keeps its own dark red.
    expect(channels(fish.outline)[2]).toBeGreaterThan(channels(fish.outline)[0]);
    expect(channels(newt.outline)[0]).toBeGreaterThan(channels(newt.outline)[2]);
    // In both lit styles its head is nearer the water's colour than a land animal's of its hue.
    for (const style of ["lit", "cosy"] as const) {
      const head = (genes: Partial<Look>): number =>
        inLayer(bodyPlan(seed({ ...genes, hue: 0.05 }), { ...COSY, style }), LAYER.body)[0]
          ?.colour ?? 0;
      expect(distance(head(KINDS.eel), WATER)).toBeLessThan(distance(head(KINDS.worm), WATER));
    }
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
        // A back that fades does it in the colours of its masses, not in marks on them.
        const fades = pattern === "fade" && body === KINDS.beast;
        if (pattern === "plain") expect(marks.length).toBeLessThanOrEqual(1);
        else if (!fades) expect(marks.length).toBeGreaterThan(0);
        for (const mark of marks) expect(mark.joint).toBeLessThan(plan.joints);
        looks.add(
          [
            ...marks.map((m) => [m.shape, m.along.toFixed(3), m.across.toFixed(3), m.colour]),
            ...discs(plan).map((mass) => mass.colour),
          ].join("|"),
        );
      });
      expect(looks.size).toBe(PATTERNS.length);
    }
    // False eyes come in a pair, three rings each (the middle one shows from close only);
    // a saddle brings a mask over the head.
    const eyespots = (pixels: number): number =>
      inLayer(bodyPlan(seed({ pattern: 11.5 / 12, jaw: 0 }), { ...SHAPES, pixels }), LAYER.mark)
        .length;
    expect([eyespots(8), eyespots(32)]).toEqual([4, 6]);
    const saddle = inLayer(bodyPlan(seed({ pattern: 7.5 / 12, jaw: 0 }), SHAPES), LAYER.mark);
    expect(saddle.some((mark) => mark.joint === 0)).toBe(true);
  });

  it("fade a back in its own masses, from the body's colour to the marking's", () => {
    const plain = bodyPlan(seed({ ...KINDS.lizard, jaw: 0 }), SHAPES);
    const faded = bodyPlan(seed({ ...KINDS.lizard, pattern: 8.5 / 12, jaw: 0 }), SHAPES);
    expect(inLayer(faded, LAYER.mark)).toHaveLength(inLayer(plain, LAYER.mark).length);
    const colours = (plan: BodyPlan): number[] =>
      Array.from(
        { length: plan.joints - 1 },
        (_, i) => discs(plan).find((mass) => mass.joint === i + 1)?.colour ?? 0,
      );
    expect(new Set(colours(plain)).size).toBe(1);
    // A different colour at every joint, the shoulders as the plain animal's.
    expect(new Set(colours(faded)).size).toBe(faded.joints - 1);
    expect(colours(faded)[0]).toBe(colours(plain)[0]);
    // Under one shell it is the shell that fades, in ovals laid on it.
    const shell = bodyPlan(seed({ ...KINDS.beetle, pattern: 8.5 / 12, jaw: 0 }), SHAPES);
    expect(new Set(inLayer(shell, LAYER.mark).map((mark) => mark.colour)).size).toBeGreaterThan(2);
  });

  it("keep every marking on the mass it is drawn on", () => {
    // What used to stick out over the outline: bands, stripes and ovals near the end of a shell.
    for (const kind of ["beetle", "tortoise", "crab"] as const) {
      PATTERNS.forEach((_, k) => {
        for (const options of [SHAPES, CLOSE]) {
          const plan = bodyPlan(
            seed({ ...KINDS[kind], mass: 8, pattern: (k + 0.5) / 12, jaw: 0, armour: 0.8 }),
            options,
          );
          const shell = inLayer(plan, LAYER.body)
            .filter((part) => part.shape === "disc")
            .reduce((best, part) => (part.across > best.across ? part : best));
          // The shell as it is before the light makes it a little smaller.
          const a = shell.along / 2 + 1 / options.pixels;
          const b = shell.across / 2 + 1 / options.pixels;
          for (const mark of inLayer(plan, LAYER.mark)) {
            if (mark.joint !== shell.joint) continue;
            // The corners of the box the marking fills, for a bar; an oval's are rounder.
            const corner = mark.shape === "disc" ? Math.SQRT1_2 : 1;
            const cos = Math.abs(Math.cos(mark.turn));
            const sin = Math.abs(Math.sin(mark.turn));
            const long = ((mark.along * cos + mark.across * sin) / 2) * corner;
            const wide = ((mark.along * sin + mark.across * cos) / 2) * corner;
            const x = Math.abs(mark.forward - shell.forward) + long;
            const y = Math.abs(mark.side) + wide;
            expect((x / a) ** 2 + (y / b) ** 2, `${kind} ${PATTERNS[k]}`).toBeLessThanOrEqual(1.02);
          }
        }
      });
    }
  });

  it("draw bars, bands, stripes and a shell's fade so that they read as what they are", () => {
    const marks = (body: Partial<Look>, k: number, options = SHAPES): BodyPlan["parts"] =>
      inLayer(
        bodyPlan(seed({ ...body, mass: 12, pattern: (k + 0.5) / 12, jaw: 0 }), options),
        LAYER.mark,
      );
    const index = (name: (typeof PATTERNS)[number]): number => PATTERNS.indexOf(name);
    // Bars: at most one to a place on the back (as spots are; none where the back is
    // too narrow for one), all leaning the same way.
    const bars = marks(KINDS.beast, index("bars")).filter((mark) => mark.shape === "bar");
    expect(bars.length).toBeGreaterThanOrEqual(3);
    expect(bars.length).toBeLessThanOrEqual(marks(KINDS.beast, index("spots")).length);
    expect(new Set(bars.map((bar) => bar.turn)).size).toBe(1);
    // Bands: ovals across the back, far wider than they are long.
    for (const band of marks(KINDS.beast, index("bands"))) {
      expect(band.across).toBeGreaterThan(1.8 * band.along);
    }
    // A stripe down a back: ovals long enough to run into each other, drawn flat, so
    // that a lit body does not shade each length of it on its own.
    const plan = bodyPlan(seed({ ...KINDS.beast, mass: 12, pattern: 1.5 / 12, jaw: 0 }), SHAPES);
    const stripe = inLayer(plan, LAYER.mark);
    expect(stripe.every((mark) => mark.shape === "disc" && mark.flat)).toBe(true);
    expect(stripe.every((mark) => mark.along > plan.spacing)).toBe(true);
    for (const pattern of ["stripe", "twin"] as const) {
      for (const body of [KINDS.beast, KINDS.beetle]) {
        const lit = marks(body, index(pattern), CLOSE).filter((mark) => mark.shape === "disc");
        const flat = marks(body, index(pattern)).filter((mark) => mark.shape === "disc");
        expect(lit).toHaveLength(flat.length);
      }
    }
    // A shell fades in three ovals that all end where the shell ends, each smaller.
    const shell = marks(KINDS.beetle, index("fade")).filter((mark) => mark.shape === "disc");
    expect(shell).toHaveLength(3);
    const rear = shell.map((oval) => oval.forward - oval.along / 2);
    expect(rear[1]).toBeCloseTo(rear[0] ?? 0);
    expect(rear[2]).toBeCloseTo(rear[0] ?? 0);
    expect(shell[1]?.along).toBeLessThan(shell[0]?.along ?? 0);
    expect(new Set(shell.map((oval) => oval.colour)).size).toBe(3);
    // A long marking carries no lit patch (it would cut a band in two): it comes in
    // shade and as itself, and that is all. A rounder one comes as three.
    for (const body of [KINDS.beast, KINDS.beetle]) {
      const flatBands = marks(body, index("bands")).filter((mark) => mark.shape === "disc");
      const long = flatBands.filter((band) => band.across > 2.2 * band.along).length;
      const lit = marks(body, index("bands"), CLOSE).filter((mark) => mark.shape === "disc");
      expect(lit).toHaveLength(2 * long + 3 * (flatBands.length - long));
    }
    expect(marks(KINDS.beast, index("bands")).some((band) => band.across > 2.2 * band.along)).toBe(
      true,
    );
    // A saddle's mask lies across the eyes: wider than long, ahead of the head's middle.
    const mask = marks(KINDS.beast, index("saddle")).find((mark) => mark.joint === 0);
    expect(mask?.across).toBeGreaterThan(mask?.along ?? 0);
    expect(mask?.forward).toBeGreaterThan(0);
  });

  it("bring tusks out from under the head, outlined with it", () => {
    const plain = bodyPlan(seed({ ...KINDS.beast, jaw: 0.8 }), SHAPES);
    const tusks = inLayer(plain, LAYER.under).filter(
      (part) => part.shape === "wedge" && part.joint === 0 && part.side !== 0 && part.forward > 0,
    );
    expect(tusks).toHaveLength(2);
    expect(inLayer(plain, LAYER.mark).filter((part) => part.joint === 0)).toHaveLength(0);
    // None without the gene.
    const none = bodyPlan(seed({ ...KINDS.beast, jaw: 0 }), SHAPES);
    expect(inLayer(none, LAYER.under).filter((p) => p.joint === 0 && p.forward > 0)).toHaveLength(
      0,
    );
    // In the lit style everything under the head has its edge.
    const lit = bodyPlan(seed({ ...KINDS.beast, jaw: 0.8 }), LIT);
    expect(inLayer(lit, LAYER.outline).length).toBe(
      inLayer(plain, LAYER.under).length + inLayer(plain, LAYER.body).length,
    );
  });

  it("end a crab with its carapace, and give it pincers", () => {
    const crab = bodyPlan(seed({ ...KINDS.crab, jaw: 0.6 }), SHAPES);
    const solid = crab.parts.filter(
      (part) => part.layer === LAYER.body || part.layer === LAYER.under,
    );
    // Nothing trails behind: the last joint only steers the chain.
    expect(solid.filter((part) => part.joint === crab.joints - 1)).toHaveLength(0);
    const carapace = discs(crab).reduce((best, part) => (part.across > best.across ? part : best));
    expect(carapace.across).toBeGreaterThan(carapace.along);
    // The head pokes out in front of the carapace, and no further than a head.
    expect(crab.spacing).toBeGreaterThan(carapace.along / 2);
    expect(crab.spacing).toBeLessThan(carapace.along);
    // A pincer each side: a palm, and two fingers of different lengths that lean inward.
    const palms = discs(crab).filter((part) => part.joint === 1 && part.side !== 0);
    const fingers = inLayer(crab, LAYER.under).filter(
      (part) => part.shape === "wedge" && part.joint === 1 && part.side !== 0,
    );
    expect(palms).toHaveLength(2);
    expect(fingers).toHaveLength(4);
    for (const finger of fingers) {
      expect(Math.sign(finger.turn)).toBe(-Math.sign(finger.side));
      expect(finger.forward).toBeGreaterThan(palms[0]?.forward ?? 0);
    }
    expect(new Set(fingers.map((finger) => finger.along.toFixed(4))).size).toBe(2);
    // Its armour is the carapace: no plates laid on it.
    expect(inLayer(crab, LAYER.mark).filter((part) => part.shape === "bar")).toHaveLength(0);
  });

  it("leave out a marking too small to show", () => {
    const marks = (pixels: number): number =>
      inLayer(
        bodyPlan(seed({ mass: 0.3, pattern: 10.5 / 12, jaw: 0 }), {
          ...SHAPES,
          scale: 0.5,
          pixels,
        }),
        LAYER.mark,
      ).length;
    expect(marks(8)).toBe(0);
    expect(marks(64)).toBeGreaterThan(3);
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
        // Grey-black, but deep water's blue round an animal seen through the water.
        expect(edge.colour).toBe(lit.swims ? lit.outline : 0x1f1a17);
      });
      if (lit.swims) expect(lit.outline).not.toBe(0x1f1a17);
      expect(plain.parts.every((part) => part.lift === 0)).toBe(true);
      if (["beast", "tortoise", "beetle", "crab"].includes(plain.kind)) {
        expect(lit.parts.filter((part) => part.lift > 0).length).toBeGreaterThan(0);
      }
      // From this far no leg is thick enough for an edge or a foot.
      expect(lit.legs.every((leg) => leg.edge === 0)).toBe(true);
      expect(spriteCount(lit)).toBe(
        lit.parts.length + lit.legs.reduce((sum, leg) => sum + 2 + (leg.foot > 0 ? 1 : 0), 0),
      );
    }
  });

  it("shade the far side of every mass, and light its back", () => {
    const plain = bodyPlan(seed({ mass: 4, jaw: 0 }), { ...CLOSE, style: "shapes" });
    const lit = bodyPlan(seed({ mass: 4, jaw: 0 }), CLOSE);
    const masses = inLayer(plain, LAYER.body);
    const shades = inLayer(lit, LAYER.shade);
    const bodies = inLayer(lit, LAYER.body);
    // Every mass as it was, in a darker and cooler tone, under the mass itself...
    expect(shades).toHaveLength(masses.length);
    shades.forEach((shade, i) => {
      const mass = masses[i];
      const [r, g, b] = channels(shade.colour);
      const [r0, g0, b0] = channels(mass?.colour ?? 0);
      expect([shade.along, shade.across, shade.lift]).toEqual([mass?.along, mass?.across, 0]);
      expect(r + g + b).toBeLessThan(r0 + g0 + b0);
      expect(b / (r + g + b)).toBeGreaterThan(b0 / (r0 + g0 + b0));
    });
    // ...which is drawn smaller and toward the light, by as much: between half a pixel
    // and a pixel and a half, so that the shade shows on the far side only.
    bodies.forEach((body, i) => {
      const rim = ((masses[i]?.along ?? 0) - body.along) / 2;
      expect(rim).toBeGreaterThanOrEqual(0.5 / 32 - 1e-9);
      expect(rim).toBeLessThanOrEqual(1.5 / 32 + 1e-9);
      expect(body.lift).toBeCloseTo(rim);
      expect(body.colour).toBe(masses[i]?.colour);
    });
    // The round masses catch the light: a lighter patch, further toward it.
    const lights = inLayer(lit, LAYER.light);
    expect(lights.length).toBeGreaterThan(2);
    for (const light of lights) expect(light.lift).toBeGreaterThan(bodies[0]?.lift ?? 0);
    // A heavy animal's largest masses gleam as well; a light one's do not.
    const gleams = (mass: number): number =>
      inLayer(bodyPlan(seed({ ...KINDS.beetle, mass, jaw: 0 }), CLOSE), LAYER.light).length;
    expect(gleams(16)).toBeGreaterThan(gleams(1));
  });

  it("shade the markings too, each on its own", () => {
    const spots = { ...KINDS.beetle, mass: 12, pattern: 5.5 / 12, jaw: 0 };
    const flat = inLayer(bodyPlan(seed(spots), { ...CLOSE, style: "shapes" }), LAYER.mark);
    const lit = inLayer(bodyPlan(seed(spots), CLOSE), LAYER.mark);
    // A beetle's seam is too thin to shade; every spot comes as three: in shade, itself, lit.
    const seams = flat.filter((mark) => mark.shape === "bar");
    const dots = flat.filter((mark) => mark.shape === "disc");
    expect(seams).toHaveLength(1);
    expect(dots.length).toBeGreaterThan(1);
    expect(lit).toHaveLength(seams.length + 3 * dots.length);
    const first = lit.findIndex((mark) => mark.shape === "disc");
    const [shade, dot, light] = lit.slice(first, first + 3);
    const sum = (part: BodyPlan["parts"][number] | undefined): number =>
      channels(part?.colour ?? 0).reduce((total, value) => total + value, 0);
    expect(dot?.colour).toBe(dots[0]?.colour);
    expect(sum(shade)).toBeLessThan(sum(dot));
    expect(sum(light)).toBeGreaterThan(sum(dot));
    expect(shade?.along).toBe(dots[0]?.along);
    expect(dot?.along).toBeLessThan(shade?.along ?? 0);
    expect(light?.along).toBeCloseTo((dot?.along ?? 0) / 2);
    expect(light?.lift).toBeGreaterThan(dot?.lift ?? 0);
    // On a small animal seen from far a spot is too small for any of it.
    const far = inLayer(bodyPlan(seed({ ...spots, mass: 1 }), LIT), LAYER.mark);
    expect(far.filter((mark) => mark.shape === "disc")).toHaveLength(dots.length);
  });

  it("add what only shows from close: thin outlines, glints, legs with edges and feet", () => {
    const far = bodyPlan(seed({ mass: 4, sense: 0.8 }), LIT);
    const near = bodyPlan(seed({ mass: 4, sense: 0.8 }), CLOSE);
    // The same animal, as long in cells; its outline is one pixel of its own view.
    expect(near.length).toBe(far.length);
    const edge = (plan: BodyPlan): number =>
      (inLayer(plan, LAYER.outline)[0]?.along ?? 0) -
      (inLayer(
        { ...plan, parts: bodyPlan(seed({ mass: 4, sense: 0.8 }), SHAPES).parts },
        LAYER.under,
      )[0]?.along ?? 0);
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

  it("turn legs into fins as the aquatic gene rises", () => {
    const legs = (aquatic: number, body: Partial<Look> = KINDS.beast): BodyPlan["legs"] =>
      bodyPlan(seed({ ...body, aquatic, jaw: 0 }), CLOSE).legs;
    // On land: legs, with feet of the legs' own colour.
    expect(legs(0.2).every((leg) => leg.fin === 0 && leg.sole === leg.colour)).toBe(true);
    // From 0.3 the feet web, wider with the gene, in a colour that goes toward the fins'.
    const [some, more] = [legs(0.35), legs(0.48)];
    expect(some.every((leg) => leg.fin > 0 && leg.fin < 1)).toBe(true);
    expect(more[0]?.foot).toBeGreaterThan(some[0]?.foot ?? 0);
    expect(some[0]?.sole).not.toBe(some[0]?.colour);
    expect(more[0]?.length).toBe(legs(0.2)[0]?.length);
    // From 0.6, when it lives in the water, they are flippers: shorter blades, far wider
    // than a leg, each one sprite and its edge.
    const flippers = bodyPlan(seed({ ...KINDS.tortoise, aquatic: 0.8, jaw: 0 }), CLOSE);
    const walking = bodyPlan(seed({ ...KINDS.tortoise, jaw: 0 }), CLOSE);
    expect(flippers.swims).toBe(true);
    expect(flippers.legs.every((leg) => leg.fin === 1 && leg.edge > 0)).toBe(true);
    expect(flippers.legs[0]?.length).toBeLessThan(walking.legs[0]?.length ?? 0);
    expect(flippers.legs[0]?.thickness).toBeGreaterThan(1.4 * (walking.legs[0]?.thickness ?? 0));
    expect(spriteCount(flippers)).toBe(flippers.parts.length + 2 * flippers.legs.length);
    // An animal with legs grows no fins at the shoulders beside them; one without does.
    const wedges = (body: Partial<Look>, aquatic: number): number =>
      bodyPlan(seed({ ...body, aquatic, jaw: 0 }), SHAPES).parts.filter(
        (part) => part.shape === "wedge" && part.layer === LAYER.under && part.side !== 0,
      ).length;
    expect(wedges(KINDS.beast, 0.45) - wedges(KINDS.beast, 0)).toBe(0);
    expect(wedges(KINDS.fish, 0.9)).toBeGreaterThanOrEqual(2);
    // With three or four pairs only the last turns, as a water beetle's, and into
    // shorter flippers than on a body that swims with all its legs.
    const six = legs(0.9, KINDS.beetle);
    expect(six.map((leg) => leg.fin)).toEqual([0, 0, 0, 0, 1, 1]);
    const eight = legs(0.45, KINDS.crab);
    expect(eight.filter((leg) => leg.fin > 0)).toHaveLength(2);
    const shortened = (body: Partial<Look>): number =>
      (legs(0.9, body).at(-1)?.length ?? 0) / (legs(0.2, body).at(-1)?.length ?? 1);
    expect(shortened(KINDS.beetle)).toBeLessThan(0.8 * shortened(KINDS.tortoise));
    // A fin at the end of the tail only where there is a tail: not under a shell.
    const flukes = (body: Partial<Look>, aquatic: number): number =>
      bodyPlan(seed({ ...body, aquatic, jaw: 0 }), SHAPES).parts.filter(
        (part) => part.shape === "wedge" && part.side === 0 && part.forward < 0 && part.turn === 0,
      ).length;
    expect(flukes(KINDS.lizard, 0.45) - flukes(KINDS.lizard, 0)).toBe(1);
    expect(flukes(KINDS.beetle, 0.45) - flukes(KINDS.beetle, 0)).toBe(0);
    expect(flukes(KINDS.tortoise, 0.45) - flukes(KINDS.tortoise, 0)).toBe(0);
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
