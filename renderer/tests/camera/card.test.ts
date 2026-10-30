import { describe, expect, it } from "vitest";
import {
  ARMOURED_FROM,
  CARD_IN_S,
  CARD_OUT_S,
  GRAZER_UP_TO_DIET,
  HUNTER_FROM_DIET,
  ICONS,
  LARGE_FROM_MASS,
  NameCard,
  SMALL_BELOW_MASS,
  WATER_LOVING_FROM,
  buildWord,
  cardSize,
  describe as describeCard,
  dietWord,
  paintCard,
  sizeWord,
  type Card,
  type CardFacts,
} from "../../src/card";
import { CANDLE, DAYLIGHT, lampKey } from "../../src/captions";
import { GENE_COUNT, Gene, type GeneName, type Genome } from "../../src/creatures/genome";
import { PORTRAIT_SIZE } from "../../src/creatures/portrait";
import { RARE_LOOKS } from "../../src/creatures/rare";
import type { Pixels } from "../../src/terrain/pixels";
import { fakeCanvas } from "../support/canvas";

fakeCanvas();

/** A genome of middling genes, but for `genes`. */
function genomeWith(genes: Partial<Record<GeneName, number>> = {}): Genome {
  const genome = new Array<number>(GENE_COUNT).fill(0.5);
  for (const [name, value] of Object.entries(genes)) genome[Gene[name as GeneName]] = value;
  return genome;
}

function factsOf(extra: Partial<CardFacts> = {}): CardFacts {
  return {
    id: 1,
    name: "Malebi",
    genome: genomeWith({ DIET: 0.1, AQUATIC: 0.1 }),
    mass: 1,
    limbPairs: 2,
    signatures: [],
    body: 0xaa6633,
    mark: 0x332211,
    ...extra,
  };
}

/** The colours of a picture, as 0xRRGGBB, with how many opaque pixels have each. */
function colours(picture: { rgba: Uint8ClampedArray }): Map<number, number> {
  const out = new Map<number, number>();
  for (let at = 0; at < picture.rgba.length; at += 4) {
    if (picture.rgba[at + 3] !== 255) continue;
    const colour =
      ((picture.rgba[at] ?? 0) << 16) |
      ((picture.rgba[at + 1] ?? 0) << 8) |
      (picture.rgba[at + 2] ?? 0);
    out.set(colour, (out.get(colour) ?? 0) + 1);
  }
  return out;
}

describe("the name card's words", () => {
  it("sizes an animal by its mass: small, mid-sized, large", () => {
    expect(sizeWord(0.25)).toBe("small");
    expect(sizeWord(SMALL_BELOW_MASS - 0.01)).toBe("small");
    expect(sizeWord(SMALL_BELOW_MASS)).toBe("mid-sized");
    expect(sizeWord(LARGE_FROM_MASS - 0.01)).toBe("mid-sized");
    expect(sizeWord(LARGE_FROM_MASS)).toBe("large");
    expect(sizeWord(16)).toBe("large");
  });

  it("names its diet by the sim's own classes", () => {
    expect(GRAZER_UP_TO_DIET).toBe(0.35);
    expect(HUNTER_FROM_DIET).toBe(0.65);
    expect(dietWord(0)).toBe("grazer");
    expect(dietWord(0.35)).toBe("grazer");
    expect(dietWord(0.36)).toBe("omnivore");
    expect(dietWord(0.64)).toBe("omnivore");
    expect(dietWord(0.65)).toBe("hunter");
    expect(dietWord(1)).toBe("hunter");
  });

  it("gives its build in one word, what shows most first", () => {
    // A shell before anything else, whatever its legs.
    expect(buildWord(genomeWith({ ARMOUR: ARMOURED_FROM }), 0)).toBe("armoured");
    expect(buildWord(genomeWith({ ARMOUR: 0.9, SPEED: 0.9 }), 3)).toBe("armoured");
    // Then the number of legs, where it is not four.
    expect(buildWord(genomeWith({ ARMOUR: 0 }), 1)).toBe("two-legged");
    expect(buildWord(genomeWith({ ARMOUR: 0 }), 3)).toBe("six-legged");
    expect(buildWord(genomeWith({ ARMOUR: 0 }), 4)).toBe("eight-legged");
    expect(buildWord(genomeWith({ ARMOUR: 0 }), 5)).toBe("eight-legged");
    // Four legs: how long they are, by speed; a plain four-legged body has no word.
    expect(buildWord(genomeWith({ ARMOUR: 0, SPEED: 0.8 }), 2)).toBe("long-legged");
    expect(buildWord(genomeWith({ ARMOUR: 0, SPEED: 0.1 }), 2)).toBe("short-legged");
    expect(buildWord(genomeWith({ ARMOUR: 0, SPEED: 0.5 }), 2)).toBeNull();
    // Legless: finned in the water, else by how fast it goes.
    expect(buildWord(genomeWith({ ARMOUR: 0, AQUATIC: 0.5 }), 0)).toBe("finned");
    expect(buildWord(genomeWith({ ARMOUR: 0, AQUATIC: 0, SPEED: 0.8 }), 0)).toBe("swift");
    expect(buildWord(genomeWith({ ARMOUR: 0, AQUATIC: 0, SPEED: 0.1 }), 0)).toBe("sluggish");
    expect(buildWord(genomeWith({ ARMOUR: 0, AQUATIC: 0, SPEED: 0.5 }), 0)).toBe("legless");
    // Leg pairs as drawn, rounded.
    expect(buildWord(genomeWith({ ARMOUR: 0, SPEED: 0.5 }), 2.4)).toBeNull();
  });

  it("puts size, build and diet in at most three words", () => {
    const card = describeCard(
      factsOf({ mass: 4, genome: genomeWith({ ARMOUR: 0, SPEED: 0.9, DIET: 0.1, AQUATIC: 0 }) }),
    );
    expect(card.traits).toBe("large long-legged grazer");
    const plain = describeCard(
      factsOf({ mass: 1, genome: genomeWith({ ARMOUR: 0, SPEED: 0.5, DIET: 0.8, AQUATIC: 0 }) }),
    );
    expect(plain.traits).toBe("mid-sized hunter");
    expect(plain.name).toBe("Malebi");
    expect(plain.id).toBe(1);
  });
});

describe("the name card's icons", () => {
  it("shows the water drop for an animal at home in the water", () => {
    expect(
      describeCard(factsOf({ genome: genomeWith({ AQUATIC: WATER_LOVING_FROM }) })).icons,
    ).toEqual(["water"]);
    expect(describeCard(factsOf({ genome: genomeWith({ AQUATIC: 0.39 }) })).icons).toEqual([]);
  });

  it("shows each rare gene it carries, in the wire's order, after the water", () => {
    const card = describeCard(
      factsOf({ genome: genomeWith({ AQUATIC: 0.9 }), signatures: ["venom", "gills", "elder"] }),
    );
    expect(card.icons).toEqual(["water", "venom", "gills", "elder"]);
  });

  it("has an icon for every rare gene the renderer draws, and leaves out ones it does not know", () => {
    for (const look of RARE_LOOKS) expect(Object.hasOwn(ICONS, look), look).toBe(true);
    const card = describeCard(factsOf({ signatures: ["burrow", "glow", "toString"] }));
    expect(card.icons).toEqual(["glow"]);
  });

  it("shows glow as the one night trait: the genome has no nocturnal gene", () => {
    const card = describeCard(factsOf({ signatures: ["glow"] }));
    expect(card.icons).toContain("glow");
    expect(card.traits).not.toMatch(/night|nocturnal/);
  });

  it("draws every icon seven pixels square, each letter a colour of its own key", () => {
    for (const [name, icon] of Object.entries(ICONS)) {
      expect(icon.rows, name).toHaveLength(7);
      for (const row of icon.rows) {
        expect(row, name).toHaveLength(7);
        for (const letter of row) {
          if (letter !== ".")
            expect(Object.hasOwn(icon.colours, letter), `${name} ${letter}`).toBe(true);
        }
      }
    }
  });
});

describe("the name card painted", () => {
  const card: Card = {
    id: 1,
    name: "Malebi",
    traits: "large long-legged grazer",
    icons: ["water"],
  };
  /** A portrait of one colour, see-through at its corners. */
  const portrait: Pixels = (() => {
    const rgba = new Uint8ClampedArray(PORTRAIT_SIZE * PORTRAIT_SIZE * 4);
    for (let y = 10; y < 30; y++) {
      for (let x = 10; x < 30; x++) rgba.set([0x12, 0x9e, 0xd4, 255], (y * PORTRAIT_SIZE + x) * 4);
    }
    return { width: PORTRAIT_SIZE, height: PORTRAIT_SIZE, rgba };
  })();

  it("is the size it says, with room for its plate, words and icons", () => {
    const picture = paintCard(card);
    expect({ width: picture.width, height: picture.height }).toEqual(cardSize(card));
    expect(picture.width).toBeGreaterThan(PORTRAIT_SIZE + 44);
    expect(picture.height).toBeGreaterThan(PORTRAIT_SIZE);
  });

  it("grows with a long name, and with icons under the words", () => {
    const long = { ...card, name: "Malebimalebimalebimalebi" };
    expect(cardSize(long).width).toBeGreaterThan(cardSize(card).width);
    const many = { ...card, traits: "a b c d e f g", icons: [] };
    expect(cardSize(many).height).toBeGreaterThan(cardSize({ ...card, icons: [] }).height);
  });

  it("writes 'Unnamed' before a name comes", () => {
    expect(cardSize({ ...card, name: "" }).width).toBe(
      cardSize({ ...card, name: "Unnamed" }).width,
    );
    expect(paintCard({ ...card, name: "" })).toEqual(paintCard({ ...card, name: "Unnamed" }));
  });

  it("lays the portrait on its plate, and an empty plate without one", () => {
    expect(colours(paintCard(card, portrait)).get(0x129ed4)).toBe(20 * 20);
    expect(colours(paintCard(card)).has(0x129ed4)).toBe(false);
  });

  it("draws its icons on it", () => {
    const blue = 0x4f8fd0;
    expect(colours(paintCard(card)).get(blue)).toBeGreaterThan(0);
    expect(colours(paintCard({ ...card, icons: [] })).has(blue)).toBe(false);
  });

  it("throws a see-through shadow down and right, and is otherwise opaque inside its frame", () => {
    const picture = paintCard(card);
    const alpha = (x: number, y: number): number =>
      picture.rgba[4 * (y * picture.width + x) + 3] ?? 0;
    expect(alpha(0, 0)).toBe(255);
    expect(alpha(picture.width - 1, picture.height - 1)).toBeGreaterThan(0);
    expect(alpha(picture.width - 1, picture.height - 1)).toBeLessThan(255);
    // Its top-right and bottom-left corners are clear of the shadow.
    expect(alpha(picture.width - 1, 0)).toBe(0);
    expect(alpha(0, picture.height - 1)).toBe(0);
  });
});

describe("the name card on screen (NameCard)", () => {
  const facts = factsOf();

  it("slides in when following starts and is open after its time", () => {
    const shown = new NameCard(512, 300);
    expect(shown.state.phase).toBe("hidden");
    shown.update(1 / 30, facts);
    expect(shown.state.phase).toBe("sliding-in");
    expect(shown.state.name).toBe("Malebi");
    for (let t = 0; t < CARD_IN_S + 0.1; t += 1 / 30) shown.update(1 / 30, facts);
    expect(shown.state.phase).toBe("open");
    expect(shown.state.open).toBe(1);
    expect(shown.element.style.display).toBe("block");
  });

  it("slides out when the view leaves the animal, and hides", () => {
    const shown = new NameCard(512, 300);
    for (let t = 0; t < CARD_IN_S + 0.1; t += 1 / 30) shown.update(1 / 30, facts);
    shown.update(1 / 30, null);
    expect(shown.state.phase).toBe("sliding-out");
    for (let t = 0; t < CARD_OUT_S + 0.1; t += 1 / 30) shown.update(1 / 30, null);
    expect(shown.state.phase).toBe("hidden");
    expect(shown.element.style.display).toBe("none");
  });

  it("slides the old card out before the next animal's comes in", () => {
    const shown = new NameCard(512, 300);
    for (let t = 0; t < CARD_IN_S + 0.1; t += 1 / 30) shown.update(1 / 30, facts);
    const other = factsOf({ id: 2, name: "Nemafa" });
    shown.update(1 / 30, other);
    expect(shown.state.phase).toBe("sliding-out");
    expect(shown.state.name).toBe("Malebi");
    for (let t = 0; t < CARD_OUT_S + 0.2; t += 1 / 30) shown.update(1 / 30, other);
    expect(shown.state.name).toBe("Nemafa");
    expect(shown.state.phase).toBe("sliding-in");
  });

  it("is lit by the lantern, and says whether a portrait is on it", () => {
    const shown = new NameCard(512, 300);
    shown.update(1 / 30, facts);
    expect(shown.state.lamp).toBe(lampKey(DAYLIGHT));
    expect(shown.state.portrait).toBe(false);
    shown.update(1 / 30, { ...facts, portrait: null }, CANDLE);
    expect(shown.state.lamp).toBe(lampKey(CANDLE));
  });

  it("slides by whole art pixels", () => {
    const shown = new NameCard(512, 300);
    for (let k = 0; k < 20; k++) {
      shown.update(1 / 30, facts);
      const left = Number.parseFloat(shown.element.style.left ?? "0");
      const pixels = (left / 100) * 512;
      expect(pixels).toBeCloseTo(Math.round(pixels), 6);
    }
  });
});
