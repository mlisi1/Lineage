/**
 * What a creature looks like: every drawing decision that follows from its genes and
 * derived body, as plain numbers. A plan is a chain of joints, parts that ride on them
 * (discs, wedges and bars, each with a size, a place and a colour) and legs.
 * `creatures.ts` turns a plan into sprites and moves them.
 *
 * Three styles, to choose from:
 *
 *   circles  every body the same chain of circles, the genes adding trimmings
 *   shapes   a body plan per kind of animal (worm, fish, lizard, beetle, crab…), so
 *            that the silhouette says what it is
 *   lit      the same plans with a dark outline around the animal and a lit back
 *
 * A first pass, to judge the look. R2 replaces it with the phenotype shared with
 * `fauna/phenotype.py`.
 */
import type { CreatureSeed } from "./fixture";

export type CreatureStyle = "circles" | "shapes" | "lit";
export const CREATURE_STYLES: readonly CreatureStyle[] = ["circles", "shapes", "lit"];

export interface BodyOptions {
  style: CreatureStyle;
  /** Drawn size against the first look's: 1 is a body of 1.1 cells at mass 1. */
  scale: number;
  /**
   * Art pixels to the cell in the view the body is drawn for. An outline is one of them
   * wide, and detail smaller than a pixel or two is left out.
   */
  pixels: number;
  /** Walking speed against the first look's hurry: close up, an animal ambles. */
  pace: number;
}
export const FIRST_LOOK: BodyOptions = { style: "circles", scale: 1, pixels: 8, pace: 1 };

/**
 * The markings of the `shapes` and `lit` styles. The pattern gene picks one by twelfths;
 * how far into its twelfth the gene lies picks the colour the marking is made in.
 */
export const PATTERNS = [
  "plain",
  "stripe",
  "twin",
  "bands",
  "bars",
  "spots",
  "rings",
  "saddle",
  "fade",
  "chevrons",
  "speckle",
  "eyespots",
] as const;
export type Pattern = (typeof PATTERNS)[number];

/** The marking a pattern gene gives, and how far (0–1) into its share of the gene it lies. */
export function patternOf(gene: number): { pattern: Pattern; shade: number } {
  const scaled = Math.min(Math.max(gene, 0), 1) * PATTERNS.length;
  const index = Math.min(Math.floor(scaled), PATTERNS.length - 1);
  return { pattern: PATTERNS[index] ?? "plain", shade: Math.min(scaled - index, 0.999) };
}

/** The body plans of the `shapes` and `lit` styles. */
export type Kind =
  | "worm"
  | "snake"
  | "fish"
  | "eel"
  | "hopper"
  | "lizard"
  | "beast"
  | "newt"
  | "tortoise"
  | "insect"
  | "beetle"
  | "spider"
  | "crab";

export type Shape = "disc" | "wedge" | "bar";

/** Drawing order of parts: lower layers first. Legs go under everything. */
export const LAYER = { outline: 1, under: 2, body: 3, light: 4, mark: 5, face: 6 } as const;

export interface Part {
  shape: Shape;
  /** The joint whose position and direction it rides. */
  joint: number;
  /** Size along and across its own axis, in cells. A wedge points along its axis. */
  along: number;
  across: number;
  /** Where its middle is from the joint: toward the joint's front, and to its left. */
  forward: number;
  side: number;
  /** Angle of its axis from the joint's direction, in radians. */
  turn: number;
  colour: number;
  layer: number;
  /** Shifted this far (cells) toward the light, whichever way the body faces. */
  lift: number;
}

export interface LegPlan {
  joint: number;
  side: 1 | -1;
  length: number;
  thickness: number;
  /** Where the foot rests: 0 straight out to the side, positive toward the front (radians). */
  aim: number;
  colour: number;
  /** Width of a dark edge round the leg, in cells; 0 where the leg is too thin for one. */
  edge: number;
  /** Radius of the foot at its end, in cells; 0 where it would not show. */
  foot: number;
}

export interface BodyPlan {
  kind: Kind | "chain";
  /** Head to tail, in cells. */
  length: number;
  /** Distance between neighbouring joints of the chain. */
  spacing: number;
  joints: number;
  /** Half the width of the body at each joint, head first (legs start from its edge). */
  radii: number[];
  parts: Part[];
  legs: LegPlan[];
  /** Lives in the water rather than on land. */
  swims: boolean;
  /** Cells per second. */
  pace: number;
  /** The animal's own colour: what a marker on the map shows. */
  colour: number;
}

/** Body length in cells of a creature of mass 1; it grows with the cube root of mass. */
const LENGTH_PER_UNIT_MASS = 1.1;
/** Head radius as a share of body length, for a creature of middling build. */
const HEAD_RADIUS = 0.17;
/** Build: the speed gene trades girth for leg. Stout at 0, slim at 1. */
const GIRTH_SLOW = 1.14;
const GIRTH_FAST = 0.84;
const LEG_SLOW = 1.8;
const LEG_FAST = 2.8;
/** Eyes: radius as a share of the head's, at no sense and at full sense. */
const EYE_MIN = 0.2;
const EYE_MAX = 0.5;
/** Jaws: none below this gene value; then this long, in head radii. */
const JAW_FROM = 0.2;
const JAW_MIN = 0.6;
const JAW_MAX = 2.0;
/** Armour: none below the first value; from the second the body is under one shell. */
const ARMOUR_FROM = 0.15;
const SHELL_FROM = 0.55;
/** Fins: none below this gene value; then this long, in head radii. */
const FINS_FROM = 0.3;
const FIN_MIN = 1.0;
const FIN_MAX = 2.6;
/** From this aquatic gene value a creature lives in the water. */
export const SWIMS_FROM = 0.6;
/** Pace in cells per second: far faster than the sim, to keep bodies moving. */
const PACE_BASE = 0.6;
const PACE_PER_SPEED = 0.4;
const SATURATION = 0.5;
const IVORY = 0xf2ead0;
const EYE = 0x1b1b1b;
const OUTLINE = 0x1f1a17;
/** A leg gets an edge of its own from this many pixels thick, a foot from this many. */
const LEG_EDGE_FROM_PX = 2.5;
const FOOT_FROM_PX = 2;
/** An eye gets a glint from this many pixels across. */
const GLINT_FROM_PX = 3;

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;
const clamp01 = (value: number): number => Math.min(Math.max(value, 0), 1);
/** 0 at `from`, 1 at full gene value. */
const above = (gene: number, from: number): number => clamp01((gene - from) / (1 - from));

/** hue 0–1 → 0xRRGGBB at a fixed saturation, with `light` as lightness (0–1). */
export function colour(hue: number, light: number): number {
  const chroma = (1 - Math.abs(2 * light - 1)) * SATURATION;
  const sector = (((hue % 1) + 1) % 1) * 6;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const lift = light - chroma / 2;
  const byte = (value: number): number => Math.round((value + lift) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

/** Blend two 0xRRGGBB colours: `from` at 0, `to` at 1. */
export function blend(from: number, to: number, t: number): number {
  const channel = (shift: number): number =>
    Math.round(lerp((from >> shift) & 0xff, (to >> shift) & 0xff, clamp01(t))) << shift;
  return channel(16) | channel(8) | channel(0);
}

/** Which body plan a genome builds: leg pairs first, then water, armour and speed. */
export function kindOf(seed: CreatureSeed): Kind {
  const pairs = Math.round(seed.limbPairs);
  const finned = seed.aquatic >= FINS_FROM;
  const shelled = seed.armour >= SHELL_FROM;
  if (pairs === 0) {
    if (finned) return seed.speed < 0.4 ? "eel" : "fish";
    return seed.speed >= 0.5 ? "snake" : "worm";
  }
  if (pairs === 1) return "hopper";
  if (pairs === 2) {
    if (shelled) return "tortoise";
    if (seed.aquatic >= 0.5) return "newt";
    return seed.speed >= 0.55 ? "lizard" : "beast";
  }
  if (pairs === 3) return shelled ? "beetle" : "insect";
  return finned || seed.armour >= 0.4 ? "crab" : "spider";
}

/** Widths of the body at each joint, as shares of the reference radius, head first. */
function widths(kind: Kind, length: number): number[] {
  const count = (base: number, low: number, high: number): number =>
    Math.min(Math.max(Math.round(base + 3 * length), low), high);
  switch (kind) {
    case "worm": {
      const joints = count(4, 6, 10);
      return Array.from({ length: joints }, (_, i) =>
        i === 0 ? 0.62 : i === joints - 1 ? 0.42 : i === joints - 2 ? 0.6 : 0.7,
      );
    }
    case "snake": {
      const joints = count(6, 9, 12);
      return Array.from({ length: joints }, (_, i) => {
        const t = i / (joints - 1);
        return i === 0
          ? 0.75
          : i === 1
            ? 0.5
            : t < 0.55
              ? 0.62
              : lerp(0.62, 0.14, (t - 0.55) / 0.45);
      });
    }
    case "fish":
      return [0.8, 1.15, 1.0, 0.65, 0.32];
    case "eel":
      return [0.6, 0.66, 0.66, 0.62, 0.58, 0.52, 0.44, 0.34, 0.2];
    case "hopper":
      return [1.0, 1.35, 0.9];
    case "lizard":
      return [0.85, 0.7, 1.05, 1.1, 0.9, 0.6, 0.38, 0.18];
    case "beast":
      return [0.95, 1.2, 1.3, 1.05, 0.3];
    case "newt":
      return [1.0, 0.8, 0.95, 0.9, 0.65, 0.42, 0.22];
    case "tortoise":
      return [0.6, 1.0, 1.0, 0.25];
    case "insect":
      return [0.7, 0.85, 0.45, 1.05, 0.8];
    case "beetle":
      return [0.6, 0.95, 1.25, 1.0];
    case "spider":
      return [0.85, 1.0, 1.5];
    case "crab":
      return [0.5, 1.0, 0.5];
  }
}

/** How much longer or shorter than the plain chain each kind is. */
const STRETCH: Readonly<Record<Kind, number>> = {
  worm: 1.2,
  snake: 1.55,
  fish: 1.0,
  eel: 1.45,
  hopper: 0.78,
  lizard: 1.3,
  beast: 0.92,
  newt: 1.15,
  tortoise: 0.85,
  insect: 1.0,
  beetle: 0.9,
  spider: 0.8,
  crab: 0.7,
};

/** Where each kind's leg pairs grow and rest: joint, aim, and length and thickness in radii. */
const LEGS: Readonly<Record<Kind, readonly (readonly [number, number, number, number])[]>> = {
  worm: [],
  snake: [],
  fish: [],
  eel: [],
  hopper: [[1, -0.55, 3.4, 0.75]],
  lizard: [
    [2, 0.5, 2.4, 0.42],
    [4, -0.3, 2.4, 0.42],
  ],
  beast: [
    [1, 0.4, 1.9, 0.7],
    [3, -0.3, 1.9, 0.7],
  ],
  newt: [
    [2, 0.5, 1.9, 0.45],
    [4, -0.3, 1.9, 0.45],
  ],
  tortoise: [
    [1, 0.65, 1.5, 0.7],
    [2, -0.65, 1.5, 0.7],
  ],
  insect: [
    [1, 0.75, 2.6, 0.3],
    [1, 0.05, 2.6, 0.3],
    [2, -0.7, 2.8, 0.3],
  ],
  beetle: [
    [1, 0.7, 2.0, 0.36],
    [2, 0.05, 2.0, 0.36],
    [2, -0.7, 2.1, 0.36],
  ],
  spider: [
    [1, 0.95, 3.4, 0.26],
    [1, 0.35, 3.6, 0.26],
    [1, -0.3, 3.6, 0.26],
    [1, -0.9, 3.4, 0.26],
  ],
  crab: [
    [1, 0.45, 2.6, 0.34],
    [1, 0.05, 2.8, 0.34],
    [1, -0.35, 2.8, 0.34],
    [1, -0.8, 2.5, 0.34],
  ],
};

export function bodyPlan(seed: CreatureSeed, options: BodyOptions = FIRST_LOOK): BodyPlan {
  const base = options.scale * LENGTH_PER_UNIT_MASS * Math.cbrt(seed.mass);
  const swims = seed.aquatic >= SWIMS_FROM;
  const pace =
    options.pace * (PACE_BASE + PACE_PER_SPEED * (swims ? seed.swimSpeed : seed.landSpeed));
  const body = colour(seed.hue, 0.55);
  const dark = colour(seed.hue, 0.3);
  const parts: Part[] = [];
  const part = (
    shape: Shape,
    joint: number,
    along: number,
    across: number,
    tint: number,
    layer: number,
    forward = 0,
    side = 0,
    turn = 0,
  ): void => {
    parts.push({ shape, joint, along, across, forward, side, turn, colour: tint, layer, lift: 0 });
  };
  /** The same part on both sides of the body. */
  const pair = (
    shape: Shape,
    joint: number,
    along: number,
    across: number,
    tint: number,
    layer: number,
    forward: number,
    side: number,
    turn = 0,
  ): void => {
    part(shape, joint, along, across, tint, layer, forward, side, turn);
    part(shape, joint, along, across, tint, layer, forward, -side, -turn);
  };
  const girth = lerp(GIRTH_SLOW, GIRTH_FAST, seed.speed);
  const reference = HEAD_RADIUS * base * girth;
  const eye = reference * lerp(EYE_MIN, EYE_MAX, seed.sense);
  const jaw =
    seed.jaw < JAW_FROM ? 0 : reference * lerp(JAW_MIN, JAW_MAX, above(seed.jaw, JAW_FROM));
  const jawColour = blend(dark, IVORY, seed.diet);
  const fin =
    seed.aquatic < FINS_FROM
      ? 0
      : reference * lerp(FIN_MIN, FIN_MAX, above(seed.aquatic, FINS_FROM));
  const finColour = colour(seed.hue, 0.72);
  const legLength = HEAD_RADIUS * base * lerp(LEG_SLOW, LEG_FAST, seed.speed);

  if (options.style === "circles") {
    // The first look: one chain for every animal.
    const segments = Math.min(Math.max(Math.round(3 + 2.2 * base), 4), 9);
    const taper = 0.55 + 0.2 * seed.aquatic;
    const radii = Array.from({ length: segments }, (_, i) => {
      const along = i / (segments - 1);
      return reference * (i === 1 ? 1.12 : 1 - taper * along ** 1.3);
    });
    const pattern = seed.pattern < 1 / 3 ? "plain" : seed.pattern < 2 / 3 ? "bands" : "spots";
    const shell = seed.armour < ARMOUR_FROM ? 0 : lerp(0.18, 0.5, above(seed.armour, ARMOUR_FROM));
    const last = segments - 1;
    if (fin > 0) {
      const at = Math.max(1, Math.round(last / 3));
      // Swept back from the shoulders, and a fluke across the tail tip.
      pair(
        "disc",
        at,
        fin,
        fin * 0.45,
        finColour,
        LAYER.under,
        -fin * 0.3,
        (radii[at] ?? 0) * 0.6 + fin * 0.4,
        2.2,
      );
      part(
        "disc",
        last,
        fin * 0.45,
        fin * 1.1,
        finColour,
        LAYER.under,
        -(radii[last] ?? 0) - fin * 0.18,
      );
    }
    if (jaw > 0) {
      // Pincers: rooted at the cheeks, closing toward the middle at the tips.
      pair(
        "bar",
        0,
        Math.hypot(jaw, reference * 0.45),
        Math.max(reference * 0.45, 0.05),
        jawColour,
        LAYER.under,
        reference * 0.5 + jaw / 2,
        reference * 0.375,
        -Math.atan2(reference * 0.45, jaw),
      );
    }
    for (let i = last; i >= 0; i--) {
      const radius = radii[i] ?? 0;
      if (shell > 0)
        part(
          "disc",
          i,
          2 * radius * (1 + shell),
          2 * radius * (1 + shell),
          colour(seed.hue, 0.18),
          LAYER.under,
        );
      const banded = pattern === "bands" && i % 2 === 1;
      part(
        "disc",
        i,
        2 * radius,
        2 * radius,
        banded ? colour(seed.hue + 0.08, 0.4) : body,
        LAYER.body,
      );
      if (pattern === "spots" && i > 0)
        part("disc", i, radius * 0.9, radius * 0.9, colour(seed.hue + 0.08, 0.8), LAYER.mark);
    }
    pair("disc", 0, 2 * eye, 2 * eye, EYE, LAYER.face, reference * 0.35, reference * 0.55);
    const pairs = Math.round(seed.limbPairs);
    const legs: LegPlan[] = [];
    for (let index = 0; index < pairs; index++) {
      const joint = Math.min(
        1 + Math.round((index * (segments - 3)) / Math.max(pairs - 1, 1)),
        segments - 2,
      );
      for (const side of [1, -1] as const) {
        legs.push({
          joint,
          side,
          length: legLength,
          thickness: Math.max((radii[joint] ?? 0) * 0.45, 0.04),
          aim: 0.38,
          colour: dark,
          edge: 0,
          foot: 0,
        });
      }
    }
    return finish({
      kind: "chain",
      length: base,
      spacing: base / last,
      joints: segments,
      radii,
      parts,
      legs,
      swims,
      pace,
      colour: body,
    });
  }

  const kind = kindOf(seed);
  const length = base * STRETCH[kind];
  const shares = widths(kind, base);
  const joints = shares.length;
  const spacing = length / (joints - 1);
  const radii = shares.map((share) => share * reference);
  const last = joints - 1;
  const light = colour(seed.hue, 0.7);
  const mark = colour(seed.hue + 0.08, 0.38);
  const pale = colour(seed.hue + 0.08, 0.8);
  const shellColour = colour(seed.hue, 0.24);
  const head = radii[0] ?? reference;

  // The trunk: an oval at every joint, long enough to run into the next. A worm is ringed.
  const { pattern, shade } = patternOf(seed.pattern);
  const ring = kind === "worm" ? blend(body, dark, 0.28) : body;
  // Under a shell or a carapace the trunk is not what catches the light.
  const covered = kind === "tortoise" || kind === "beetle" || kind === "crab";
  for (let i = last; i >= 1; i--) {
    const radius = radii[i] ?? 0;
    part(
      "disc",
      i,
      Math.max(2 * radius, spacing * 1.3),
      2 * radius,
      i % 2 === 0 ? ring : body,
      covered ? LAYER.under : LAYER.body,
    );
  }
  // The one mass the markings go on, for the kinds that have one: a shell, a carapace.
  let canvas: Part | null = null;

  // What is particular to the kind: shell, abdomen, carapace, tail.
  if (kind === "tortoise" || kind === "beetle") {
    const across = (kind === "tortoise" ? 3.1 : 2.9) * reference;
    const along = spacing * (joints - 2) + 1.6 * reference;
    const middle = kind === "tortoise" ? 1 : 2;
    part("disc", middle, along, across, shellColour, LAYER.body, -spacing * 0.5);
    canvas = parts[parts.length - 1] ?? null;
    part(
      "disc",
      middle,
      along * 0.8,
      across * 0.78,
      blend(body, shellColour, 0.35),
      LAYER.light,
      -spacing * 0.5,
    );
    if (kind === "beetle") {
      // Wing cases meet along the back; the plate behind the head is the pronotum.
      part(
        "bar",
        middle,
        along * 0.82,
        Math.max(reference * 0.16, 0.03),
        shellColour,
        LAYER.mark,
        -spacing * 0.5,
      );
      part("disc", 1, 1.5 * reference, 2.2 * reference, shellColour, LAYER.body);
    } else {
      // Scutes: a cross of seams over the dome.
      part(
        "bar",
        middle,
        along * 0.74,
        Math.max(reference * 0.14, 0.03),
        shellColour,
        LAYER.mark,
        -spacing * 0.5,
      );
      part(
        "bar",
        middle,
        across * 0.72,
        Math.max(reference * 0.14, 0.03),
        shellColour,
        LAYER.mark,
        -spacing * 0.5,
        0,
        Math.PI / 2,
      );
      part(
        "wedge",
        last,
        reference * 0.9,
        reference * 0.6,
        body,
        LAYER.under,
        -reference * 0.5,
        0,
        Math.PI,
      );
    }
  } else if (kind === "crab") {
    // Wider than long, eyes on stalks, and the arms that carry the claws.
    part("disc", 1, 2.3 * reference, 3.6 * reference, body, LAYER.body);
    canvas = parts[parts.length - 1] ?? null;
    part(
      "disc",
      1,
      1.7 * reference,
      2.9 * reference,
      blend(body, light, 0.5),
      LAYER.light,
      -0.1 * reference,
    );
    const claw = reference * (0.7 + 0.6 * seed.jaw);
    pair(
      "bar",
      1,
      1.7 * reference,
      0.5 * reference,
      dark,
      LAYER.under,
      1.2 * reference,
      1.5 * reference,
      -0.5,
    );
    pair(
      "wedge",
      1,
      claw * 1.4,
      claw,
      jawColour,
      LAYER.body,
      2.1 * reference,
      1.15 * reference,
      -0.2,
    );
    pair(
      "bar",
      0,
      0.9 * reference,
      Math.max(0.16 * reference, 0.03),
      dark,
      LAYER.under,
      0.5 * reference,
      0.5 * reference,
    );
  } else if (kind === "spider") {
    part("disc", 2, 3.1 * reference, 3.0 * reference, body, LAYER.body, -0.2 * reference);
    part("disc", 2, 1.0 * reference, 1.1 * reference, mark, LAYER.mark, -0.3 * reference);
  } else if (kind === "insect") {
    // Three parts: head, thorax, and an abdomen that ends in a point.
    part("disc", 3, spacing * 2.3, 2.1 * reference, body, LAYER.body, -spacing * 0.45);
    part(
      "wedge",
      last,
      reference * 1.1,
      reference * 0.9,
      dark,
      LAYER.under,
      -reference * 0.9,
      0,
      Math.PI,
    );
    pair(
      "bar",
      0,
      1.9 * reference,
      Math.max(0.12 * reference, 0.03),
      dark,
      LAYER.under,
      head + 0.7 * reference,
      0.55 * reference,
      0.5,
    );
  } else if (kind === "beast") {
    part("disc", 2, spacing * 2.5, 2.7 * reference, body, LAYER.body, spacing * 0.35);
    part(
      "bar",
      last,
      spacing * 1.2,
      Math.max(0.3 * reference, 0.04),
      dark,
      LAYER.under,
      -spacing * 0.2,
    );
  } else if (kind === "hopper") {
    // A thigh at each hip, where the one pair of legs is all muscle.
    pair(
      "disc",
      1,
      2.0 * reference,
      1.3 * reference,
      blend(body, dark, 0.3),
      LAYER.under,
      -0.5 * reference,
      1.2 * reference,
      0.5,
    );
  }

  // The head.
  const hunter = seed.diet >= 0.65;
  if (kind === "snake" || kind === "lizard" || (kind === "beast" && hunter) || kind === "newt") {
    const blunt = kind === "newt" ? 0.75 : 1;
    part("disc", 0, 2 * head, 2 * head, body, LAYER.body);
    part("wedge", 0, 2.2 * head * blunt, 2 * head, body, LAYER.body, head * (0.6 + 0.5 * blunt));
  } else if (kind === "beast") {
    part("disc", 0, 2 * head, 2 * head, body, LAYER.body);
    part("bar", 0, 1.1 * head, 1.25 * head, body, LAYER.body, 0.95 * head);
    if (seed.sense >= 0.3)
      pair("wedge", 0, 0.9 * head, 0.7 * head, dark, LAYER.under, -0.5 * head, 0.85 * head, 2.3);
  } else if (kind === "fish" || kind === "eel") {
    part("disc", 0, 2.4 * head, 2 * head, body, LAYER.body, 0.2 * head);
  } else if (kind === "beetle" || kind === "tortoise") {
    // Poking out from under the shell.
    part("disc", 0, 2 * head, 2 * head, blend(body, dark, 0.3), LAYER.under);
  } else {
    part("disc", 0, 2 * head, 2 * head, body, LAYER.body);
  }

  // Jaws: pincers on the kinds with a shell of their own, tusks on the others.
  if (jaw > 0 && kind !== "crab") {
    if (kind === "beetle") {
      part("wedge", 0, jaw * 1.5, head * 0.9, dark, LAYER.under, head + jaw * 0.6);
    } else if (kind === "insect" || kind === "spider" || kind === "worm") {
      pair(
        "bar",
        0,
        Math.hypot(jaw, head * 0.45),
        Math.max(head * 0.42, 0.05),
        jawColour,
        LAYER.under,
        head * 0.5 + jaw / 2,
        head * 0.375,
        -Math.atan2(head * 0.45, jaw),
      );
    } else {
      pair(
        "wedge",
        0,
        jaw * 0.9,
        Math.max(head * 0.42, 0.05),
        jawColour,
        LAYER.mark,
        head * 1.1 + jaw * 0.2,
        head * 0.5,
        0.25,
      );
    }
  }

  // Fins, for whatever swims.
  if (fin > 0) {
    const at = Math.max(1, Math.round(last / 3));
    const root = radii[at] ?? reference;
    pair(
      "wedge",
      at,
      fin,
      fin * 0.6,
      finColour,
      LAYER.under,
      -fin * 0.2,
      root * 0.7 + fin * 0.3,
      2.0,
    );
    const tail = radii[last] ?? 0;
    if (kind === "fish") {
      // A forked tail and a ridge down the back.
      pair(
        "wedge",
        last,
        fin * 1.3,
        fin * 0.7,
        finColour,
        LAYER.under,
        -tail - fin * 0.5,
        fin * 0.3,
        -0.45,
      );
      part(
        "bar",
        2,
        spacing * 1.6,
        Math.max(reference * 0.22, 0.03),
        dark,
        LAYER.mark,
        spacing * 0.3,
      );
    } else if (kind === "eel" || kind === "newt") {
      for (let i = kind === "eel" ? 2 : Math.ceil(last / 2); i <= last; i++) {
        part("bar", i, spacing * 1.1, Math.max((radii[i] ?? 0) * 0.5, 0.03), finColour, LAYER.mark);
      }
      part("wedge", last, fin * 0.9, fin * 0.8, finColour, LAYER.under, -tail - fin * 0.3);
    } else if (kind !== "crab" && kind !== "spider") {
      part("wedge", last, fin * 0.8, fin * 1.0, finColour, LAYER.under, -tail - fin * 0.3);
    }
  }

  // Plates on a back that is armoured but not under one shell.
  if (seed.armour >= ARMOUR_FROM && kind !== "tortoise" && kind !== "beetle") {
    const strength = above(seed.armour, ARMOUR_FROM);
    for (let i = 1; i < last; i++) {
      const radius = radii[i] ?? 0;
      if (kind === "crab" && i !== 1) continue;
      part(
        "bar",
        i,
        Math.max(spacing * 0.45, 0.04),
        radius * lerp(0.9, 1.7, strength),
        shellColour,
        LAYER.mark,
      );
    }
  }

  // Markings. They go on stations down the back: along the one mass if the kind has
  // one, else on the widest part at each joint between the head and the tail tip.
  interface Station {
    joint: number;
    forward: number;
    /** Half the width of the body here, and how far along it this station reaches. */
    half: number;
    span: number;
  }
  const stations: Station[] = [];
  const along = (mass: Part): void => {
    const count = Math.max(1, Math.round(mass.along / spacing));
    for (let k = 0; k < count; k++) {
      // From the front of the mass to its back; an oval narrows toward both ends.
      const t = 0.5 - (k + 0.5) / count;
      stations.push({
        joint: mass.joint,
        forward: mass.forward + t * mass.along,
        half: (mass.across / 2) * 0.92 * Math.sqrt(Math.max(1 - (2 * t) ** 2, 0.2)),
        span: mass.along / count,
      });
    }
  };
  if (canvas !== null) {
    along(canvas);
  } else {
    for (let i = 1; i <= Math.max(last - 1, 1); i++) {
      const masses = parts.filter(
        (mass) => mass.joint === i && mass.layer === LAYER.body && mass.shape === "disc",
      );
      const widest = masses.reduce<Part | null>(
        (best, mass) => (best === null || mass.across > best.across ? mass : best),
        null,
      );
      if (widest !== null) along(widest);
    }
  }
  // The colour of the marking: darker, paler, or a colour from across the wheel.
  const accent =
    [mark, pale, colour(seed.hue + 0.5, 0.6), colour(seed.hue + 0.33, 0.45)][
      Math.floor(shade * 4)
    ] ?? mark;
  const thin = 1 / options.pixels;
  stations.forEach((station, index) => {
    const { joint, forward, half, span } = station;
    const flip = index % 2 === 0 ? 1 : -1;
    const dot = (size: number, tint: number, ahead = 0, aside = 0): void =>
      part("disc", joint, half * size, half * size, tint, LAYER.mark, forward + ahead, aside);
    switch (pattern) {
      case "plain":
      case "saddle":
        break;
      case "stripe":
        part("bar", joint, span * 1.1, Math.max(half * 0.5, thin), accent, LAYER.mark, forward);
        break;
      case "twin":
        pair(
          "bar",
          joint,
          span * 1.1,
          Math.max(half * 0.3, thin),
          accent,
          LAYER.mark,
          forward,
          half * 0.5,
        );
        break;
      case "bands":
        if (index % 2 === 0)
          part("disc", joint, span * 0.9, half * 1.9, accent, LAYER.mark, forward);
        break;
      case "bars":
        // Two bars across the back, leaning the way a tiger's do.
        for (const ahead of [0.22, -0.22]) {
          part(
            "bar",
            joint,
            half * 1.5,
            Math.max(span * 0.16, thin),
            accent,
            LAYER.mark,
            forward + ahead * span,
            0,
            Math.PI / 2 + 0.3 * flip,
          );
        }
        break;
      case "spots":
        dot(0.9, accent, 0, half * 0.35 * flip);
        break;
      case "rings":
        dot(1.2, mark, 0, half * 0.25 * flip);
        dot(0.62, pale, 0, half * 0.25 * flip);
        break;
      case "fade":
        // From the body's colour at the shoulders to the marking's at the tail.
        part(
          "disc",
          joint,
          span * 1.25,
          half * 1.96,
          blend(body, accent, index / Math.max(stations.length - 1, 1)),
          LAYER.mark,
          forward,
        );
        break;
      case "chevrons":
        part("wedge", joint, span * 0.95, half * 1.7, accent, LAYER.mark, forward, 0, Math.PI);
        break;
      case "speckle":
        dot(0.36, mark, span * 0.28, half * 0.5);
        dot(0.3, pale, -span * 0.1, -half * 0.55);
        dot(0.34, mark, -span * 0.32, half * 0.15 * flip);
        break;
      case "eyespots":
        break;
    }
  });
  const widest = stations.reduce<Station | null>(
    (best, station) => (best === null || station.half > best.half ? station : best),
    null,
  );
  if (pattern === "saddle" && stations.length > 0) {
    const at = stations[Math.floor(stations.length / 3)] ?? stations[0];
    if (at !== undefined) {
      part("disc", at.joint, at.span * 1.7, at.half * 1.7, accent, LAYER.mark, at.forward);
    }
    // And a mask over the head.
    part("disc", 0, head * 1.3, head * 1.5, mark, LAYER.mark, -head * 0.15);
  }
  if (pattern === "eyespots" && widest !== null) {
    // Two false eyes on the widest part of the back: dark, pale, and a dark middle.
    for (const [size, tint] of [
      [1.05, mark],
      [0.72, pale],
      [0.3, mark],
    ] as const) {
      pair(
        "disc",
        widest.joint,
        widest.half * size,
        widest.half * size,
        tint,
        LAYER.mark,
        widest.forward,
        widest.half * 0.45,
      );
    }
  }

  // Eyes: on stalks for a crab, a cluster for a spider, on the sides for the rest. Their
  // size goes by the head they sit on, which is small on a beetle or a crab.
  const sighted = 2 * head * lerp(EYE_MIN, EYE_MAX, seed.sense);
  const stalked = reference * lerp(EYE_MIN, EYE_MAX, seed.sense);
  if (kind === "crab") {
    pair("disc", 0, stalked, stalked, EYE, LAYER.face, 0.95 * reference, 0.5 * reference);
  } else if (kind === "spider") {
    pair("disc", 0, 0.7 * sighted, 0.7 * sighted, EYE, LAYER.face, head * 0.55, head * 0.3);
    pair("disc", 0, 0.6 * sighted, 0.6 * sighted, EYE, LAYER.face, head * 0.25, head * 0.62);
  } else if (kind !== "worm" || seed.sense >= 0.5) {
    const bulge = kind === "hopper" || kind === "fish" ? 0.85 : 0.6;
    pair("disc", 0, sighted, sighted, EYE, LAYER.face, head * 0.3, head * bulge);
    if (sighted * options.pixels >= GLINT_FROM_PX) {
      // A glint, on the side of each eye the light comes from.
      pair(
        "disc",
        0,
        sighted * 0.36,
        sighted * 0.36,
        0xffffff,
        LAYER.face,
        head * 0.3,
        head * bulge,
      );
      for (const glint of parts.slice(-2)) glint.lift = sighted * 0.22;
    }
  }

  const legs: LegPlan[] = [];
  for (const [joint, aim, reach, thick] of LEGS[kind]) {
    for (const side of [1, -1] as const) {
      legs.push({
        joint,
        side,
        length: (reach / 2.3) * legLength,
        thickness: Math.max(thick * reference, 0.04),
        aim,
        colour: dark,
        edge: 0,
        foot: 0,
      });
    }
  }

  const plan = finish({
    kind,
    length,
    spacing,
    joints,
    radii,
    parts,
    legs,
    swims,
    pace,
    colour: body,
  });
  if (options.style === "lit") lightUp(plan, light, 1 / options.pixels);
  return plan;
}

/** Put the parts in drawing order. */
function finish(plan: BodyPlan): BodyPlan {
  plan.parts.sort((a, b) => a.layer - b.layer);
  return plan;
}

/**
 * lit: a dark edge around the whole animal, `edge` cells wide, and a lighter back toward
 * the light. Legs thick enough to carry them get an edge and a foot.
 */
function lightUp(plan: BodyPlan, light: number, edge: number): void {
  const extra: Part[] = [];
  for (const part of plan.parts) {
    if (part.layer !== LAYER.body && part.layer !== LAYER.under) continue;
    extra.push({
      ...part,
      along: part.along + 2 * edge,
      across: part.across + 2 * edge,
      colour: OUTLINE,
      layer: LAYER.outline,
    });
    // Only the masses of the body catch the light, not what sticks out of it.
    if (part.layer !== LAYER.body || part.shape !== "disc") continue;
    const small = Math.min(part.along, part.across);
    if (small < 3 * edge) continue;
    extra.push({
      ...part,
      along: part.along * 0.5,
      across: part.across * 0.5,
      colour: blend(part.colour, light, 0.5),
      layer: LAYER.light,
      lift: small * 0.14,
    });
  }
  plan.parts.push(...extra);
  finish(plan);
  for (const leg of plan.legs) {
    if (leg.thickness >= LEG_EDGE_FROM_PX * edge) leg.edge = edge;
    if (leg.thickness >= FOOT_FROM_PX * edge) leg.foot = leg.thickness * 0.62;
  }
}

/** Sprites a creature is made of, without building it. */
export function spriteCount(plan: BodyPlan): number {
  let legs = 0;
  // Two bones a leg, each with its edge if the leg has one, a foot, and the foot's edge.
  for (const leg of plan.legs)
    legs += (leg.edge > 0 ? 4 : 2) + (leg.foot > 0 ? (leg.edge > 0 ? 2 : 1) : 0);
  return plan.parts.length + legs;
}
