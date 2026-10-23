/**
 * The name card (R5): while the local view follows an animal, a small field-guide card in
 * the screen's top-left corner gives its species' name and what its genes make of it. The
 * owner's choices (2026-10-22): its traits in words where words read well (size, build,
 * diet: "large long-legged grazer", at most three words), and small pixel icons for what
 * words do badly (at home in the water, each rare gene it carries). The phone's
 * follow-a-creature (S3) shows the same card.
 *
 * The look (the owner, 2026-10-23: the card and the chronicle's scroll different, both
 * better): not parchment but a naturalist's card. Cream card in a thin wooden frame lit
 * from the upper left, the species' name on a sage heading band, and below it a plate
 * with a portrait of the animal itself, drawn from its genes in its own colours by the
 * scene's own creature layer (`creatures/portrait.ts`), its trait words beside it one to a
 * ruled line, the icons under them. It slides in from the screen's left edge when
 * following starts and back out when the view leaves the animal, turns to another, or
 * goes to visit the place of a chronicle entry (it would name an animal off screen).
 *
 * The corner: the chronicle's scroll (`captions.ts`) unrolls at the foot of the screen,
 * across its middle, so the top is free; the left, the side a page is read from.
 *
 * The words and icons are pure (`describe`), and so is the painting (`paintCard`);
 * `NameCard` puts it on screen. It is lit by the same lantern as the chronicle's scroll
 * (`lantern` in `captions.ts`): dim and warm at night, a little red in the end of a world.
 * It is painted once per animal and lantern step, and slides as a whole.
 */
import {
  DAYLIGHT,
  SHADOW_ALPHA,
  SHADOW_COLOUR,
  lampKey,
  lightPicture,
  type Picture,
} from "./captions";
import type { Rgb } from "./atmosphere/light";
import { PORTRAIT_SIZE } from "./creatures/portrait";
import { geneOf, type Genome } from "./creatures/genome";
import { SUNLIT } from "./palette";
import { GLYPH_ROWS, draw, measure } from "./pixelfont";
import type { Pixels } from "./terrain/pixels";

/** What the scene knows of the animal followed (`Herd.cardOf`). */
export interface CardFacts {
  id: number;
  /** Its species' name; empty if no name came yet. */
  name: string;
  /** Its own genes, in `Gene` order. */
  genome: Genome;
  /** Its mass as drawn: as its genes build it (`Phenotype.mass`), a giant's doubled. */
  mass: number;
  /** Its leg pairs (`Phenotype.limbPairs`). */
  limbPairs: number;
  /** The signatures of the rare genes it carries (`rare` on the wire), in bit order. */
  signatures: readonly string[];
  /** Its body and marking colours as drawn (0xRRGGBB). */
  body: number;
  mark: number;
  /**
   * Its portrait, drawn by the scene's creature layer (`creatures/portrait.ts`),
   * `PORTRAIT_SIZE` square; none, an empty plate. The same object while it looks the same.
   */
  portrait?: Pixels | null;
}

// --- Words ---------------------------------------------------------------------------

/** Below this mass an animal is "small"; from the next one, "large" (mass units, 0.25–16). */
export const SMALL_BELOW_MASS = 0.7;
export const LARGE_FROM_MASS = 3;
/**
 * Diet gene up to which an animal is a grazer, and from which a hunter; between, an
 * omnivore. The sim's own classes (`[chronicle] herbivore_max_diet`, `predator_min_diet`).
 */
export const GRAZER_UP_TO_DIET = 0.35;
export const HUNTER_FROM_DIET = 0.65;
/** From this armour gene the plates show as a shell (`SHELL_FROM` in `body.ts`). */
export const ARMOURED_FROM = 0.55;
/** From this aquatic gene a legless body is drawn with fins (`FINS_FROM` in `body.ts`). */
export const FINNED_FROM = 0.3;
/**
 * A body with two leg pairs is "long-legged" from this speed gene, "short-legged" up to the
 * next: `body.ts` draws the legs longer with speed.
 */
export const LONG_LEGGED_FROM = 0.7;
export const SHORT_LEGGED_UP_TO = 0.2;
/** A legless body is "swift" from this speed gene, "sluggish" up to the next. */
export const SWIFT_FROM = 0.7;
export const SLUGGISH_UP_TO = 0.2;
/** From this aquatic gene an animal is at home in the water: the water icon. */
export const WATER_LOVING_FROM = 0.4;

/** "small", "mid-sized" or "large", by mass. */
export function sizeWord(mass: number): string {
  if (mass < SMALL_BELOW_MASS) return "small";
  return mass >= LARGE_FROM_MASS ? "large" : "mid-sized";
}

/** "grazer", "omnivore" or "hunter", by the diet gene. */
export function dietWord(diet: number): string {
  if (diet <= GRAZER_UP_TO_DIET) return "grazer";
  return diet >= HUNTER_FROM_DIET ? "hunter" : "omnivore";
}

/**
 * One word for the body's build, what shows most first: a shell, then the number of legs
 * where it is not four, then how long the legs are (or, legless, how fast it goes). Null
 * for a plain four-legged body.
 */
export function buildWord(genome: Genome, limbPairs: number): string | null {
  const pairs = Math.round(limbPairs);
  const speed = geneOf(genome, "SPEED");
  if (geneOf(genome, "ARMOUR") >= ARMOURED_FROM) return "armoured";
  if (pairs === 0) {
    if (geneOf(genome, "AQUATIC") >= FINNED_FROM) return "finned";
    if (speed >= SWIFT_FROM) return "swift";
    return speed <= SLUGGISH_UP_TO ? "sluggish" : "legless";
  }
  if (pairs === 1) return "two-legged";
  if (pairs === 3) return "six-legged";
  if (pairs >= 4) return "eight-legged";
  if (speed >= LONG_LEGGED_FROM) return "long-legged";
  return speed <= SHORT_LEGGED_UP_TO ? "short-legged" : null;
}

// --- Icons ---------------------------------------------------------------------------

/**
 * The icons, seven art pixels square, rows top first: a letter is a colour of the icon's
 * own key, `.` the paper. Lit from the upper left, as the scene.
 */
interface Icon {
  rows: readonly string[];
  colours: Readonly<Record<string, number>>;
}

/** Outlines and dark marks on the icons: plum-brown, as the scroll's ink. */
const ICON_DARK = 0x3a2030;

export const ICONS = {
  /** At home in the water (the aquatic gene): a drop. */
  water: {
    rows: ["...d...", "..dbd..", "..dbd..", ".dLbbd.", "dLbbbbd", "dbbbbsd", ".ddddd."],
    colours: { d: 0x2b4a7a, b: 0x4f8fd0, L: 0xa8d8f0, s: 0x3a6aa8 },
  },
  /** Venom: two fangs dripping. */
  venom: {
    rows: ["kkkkkkk", "kwk.kwk", "kwk.kws", ".k...k.", ".g...g.", "gLg.gLg", "gGg.gGg"],
    colours: { k: ICON_DARK, w: SUNLIT, s: 0xd9c08a, g: 0x6fb03a, L: 0xb8e86a, G: 0x3f7a2a },
  },
  /** Warning colours (toxic): a yellow sign with a mark of exclamation. */
  warning: {
    rows: ["...k...", "..kyk..", ".kyKyk.", ".kyKyk.", "kyyyyyk", "kyyKyyk", "kkkkkkk"],
    colours: { k: ICON_DARK, y: 0xf2c641, K: ICON_DARK },
  },
  /** Giant: an arrow up. */
  giant: {
    rows: ["...r...", "..rrR..", ".rrrrR.", "rrrrrrR", "..rrR..", "..rrR..", "..rRR.."],
    colours: { r: 0xd0603a, R: 0x8a3424 },
  },
  /** Elder (long life): an hourglass. */
  elder: {
    rows: ["kkkkkkk", ".k...k.", "..kSk..", "...k...", "..kSk..", ".kSSSk.", "kkkkkkk"],
    colours: { k: 0x8c5634, S: 0xe0a24a },
  },
  /** Gills (amphibious: walks and swims): a frog's face, its eyes on top. */
  gills: {
    rows: [".oo.oo.", "owkowko", "oLgggGo", "ogggggo", "ommmmmo", ".oGGGo.", "..ooo.."],
    colours: {
      o: 0x2f5a2a,
      w: SUNLIT,
      k: ICON_DARK,
      g: 0x8cc84b,
      L: 0xc8e88a,
      G: 0x5f9a38,
      m: 0x2f5a2a,
    },
  },
  /** Coat (sleeps the winter through): a snowflake. */
  coat: {
    rows: ["...c...", ".c.c.c.", "..cwc..", "ccwwwcc", "..cwc..", ".c.c.c.", "...c..."],
    colours: { c: 0x3f78b8, w: 0xa8d8f0 },
  },
  /** Leaves (feeds on sunlight): a leaf. */
  leaves: {
    rows: [".....ll", "...lLLl", "..lLLsl", ".lLlssl", ".lssl..", ".ll....", "l......"],
    colours: { l: 0x3f7a30, L: 0x9ad06a, s: 0x5aa344 },
  },
  /** Glow (sees and is seen in the dark): a light in a night sky. */
  glow: {
    rows: [".nnnnn.", "nnnynnn", "nnnynnn", "nyyWyyn", "nnnynnn", "nnnynnn", ".nnnnn."],
    colours: { n: 0x2e2a5c, y: 0xffd75a, W: SUNLIT },
  },
} as const satisfies Readonly<Record<string, Icon>>;

export type IconName = keyof typeof ICONS;

/** Art pixels an icon is across, and between two icons. */
const ICON_SIZE = 7;
const ICON_GAP = 2;

// --- The card ------------------------------------------------------------------------

/** What the card says. */
export interface Card {
  id: number;
  name: string;
  /** Size, build and diet, at most three words. */
  traits: string;
  icons: IconName[];
}

/** The card of the animal `facts` tells of. */
export function describe(facts: CardFacts): Card {
  const build = buildWord(facts.genome, facts.limbPairs);
  const words = [sizeWord(facts.mass), ...(build === null ? [] : [build])];
  words.push(dietWord(geneOf(facts.genome, "DIET")));
  const icons: IconName[] = [];
  if (geneOf(facts.genome, "AQUATIC") >= WATER_LOVING_FROM) icons.push("water");
  for (const signature of facts.signatures) {
    if (Object.hasOwn(ICONS, signature)) icons.push(signature as IconName);
  }
  return { id: facts.id, name: facts.name, traits: words.join(" "), icons };
}

// --- Its colours -----------------------------------------------------------------------

/** The frame: its dark outer edge, and the wood lit (top, left), as cut, and in shade (bottom, right). */
const FRAME_EDGE = 0x3e2418;
const FRAME_LIT = 0xc48c52;
const FRAME_WOOD = 0x9a6236;
const FRAME_SHADE = 0x6b3f22;
/** The card, and its shade under the frame's top and left edges. */
const CARD = 0xfaf3e1;
const CARD_SHADE = 0xe7dabd;
/** The heading band: sage, lit along its top, a dark rule along its foot; the name on it. */
const BAND = 0x5b8259;
const BAND_LIT = 0x7ca372;
const BAND_RULE = 0x3b5a3f;
const NAME_INK = SUNLIT;
/** The plate the portrait lies on: a pale wash in a hairline border. */
const PLATE_WASH = 0xe5ebd0;
const PLATE_EDGE = 0xae9c74;
/** The trait words, and the faint rules they stand on. */
const WORD_INK = 0x4a2c26;
const RULE = 0xe2d3b3;

// --- Its measures (art pixels) -----------------------------------------------------------

/** The frame: the dark edge, then the wood. */
const EDGE = 1;
const WOOD = 2;
const FRAME = EDGE + WOOD;
/** The band: its lit row, the room above and below the name, its rule. */
const BAND_LIT_ROWS = 1;
const BAND_ABOVE = 2;
const BAND_BELOW = 1;
const BAND_RULE_ROWS = 1;
const BAND_HEIGHT = BAND_LIT_ROWS + BAND_ABOVE + GLYPH_ROWS + BAND_BELOW + BAND_RULE_ROWS;
/** Card round what is written and drawn on it. */
const MARGIN = 4;
/** The plate: the portrait in a one-pixel border. */
const PLATE_BORDER = 1;
const PLATE = PORTRAIT_SIZE + 2 * PLATE_BORDER;
/** Between the plate and the words. */
const COLUMN_GAP = 5;
/** Rows between one word's line and the next, and from a word's top to its rule. */
const WORD_PITCH = GLYPH_ROWS + 2;
const RULE_BELOW = GLYPH_ROWS;
/** Between the last word and the icons. */
const ICONS_ABOVE = 3;
/** The narrowest the column of words is, so that a short card is not a stub. */
const COLUMN_MIN = 44;
/** The card's shadow falls this far down and right. */
const SHADOW = 2;
/** What the heading says before a name has come. */
const NAMELESS = "Unnamed";

// --- The card ------------------------------------------------------------------------

/** The trait words, one to a line. */
function wordsOf(card: Card): string[] {
  return card.traits.split(" ").filter((word) => word !== "");
}

/** Art pixels across the row of icons. */
function iconsWidth(card: Card): number {
  return card.icons.length === 0 ? 0 : card.icons.length * (ICON_SIZE + ICON_GAP) - ICON_GAP;
}

/** Rows the words and icons take, below the band. */
function columnHeight(card: Card): number {
  const words = wordsOf(card).length * WORD_PITCH;
  return card.icons.length === 0 ? words : words + ICONS_ABOVE + ICON_SIZE;
}

/** The size of the card, its shadow included, in art pixels. */
export function cardSize(card: Card): { width: number; height: number } {
  const column = Math.max(COLUMN_MIN, iconsWidth(card), ...wordsOf(card).map(measure));
  const inner = Math.max(
    MARGIN + PLATE + COLUMN_GAP + column + MARGIN,
    2 * MARGIN + measure(card.name === "" ? NAMELESS : card.name),
  );
  const body = MARGIN + Math.max(PLATE, columnHeight(card)) + MARGIN;
  return { width: inner + 2 * FRAME + SHADOW, height: BAND_HEIGHT + body + 2 * FRAME + SHADOW };
}

/** The card, painted whole, with `portrait` (`PORTRAIT_SIZE` square) on its plate, if any. */
export function paintCard(card: Card, portrait: Pixels | null = null): Picture {
  const { width, height } = cardSize(card);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, colour: number, alpha = 255): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = 4 * (y * width + x);
    rgba[at] = (colour >> 16) & 255;
    rgba[at + 1] = (colour >> 8) & 255;
    rgba[at + 2] = colour & 255;
    rgba[at + 3] = alpha;
  };
  const outer = { width: width - SHADOW, height: height - SHADOW };
  // The shadow: the card moved down and right, see-through.
  for (let y = SHADOW; y < height; y++)
    for (let x = SHADOW; x < width; x++) put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
  // The frame: a dark edge, then wood lit on the top and left pieces, shaded on the others;
  // its inner row is the plain wood.
  for (let y = 0; y < outer.height; y++) {
    for (let x = 0; x < outer.width; x++) {
      const ring = Math.min(x, y, outer.width - 1 - x, outer.height - 1 - y);
      if (ring >= FRAME) continue;
      if (ring < EDGE) {
        put(x, y, FRAME_EDGE);
        continue;
      }
      const lit = Math.min(x, y) === ring;
      put(x, y, ring < FRAME - 1 ? (lit ? FRAME_LIT : FRAME_SHADE) : FRAME_WOOD);
    }
  }
  // The card inside it, shaded a column along the frame's left piece and a row under the band.
  const left = FRAME;
  const top = FRAME;
  const right = outer.width - FRAME;
  const bottom = outer.height - FRAME;
  for (let y = top; y < bottom; y++)
    for (let x = left; x < right; x++)
      put(x, y, x === left || y === top + BAND_HEIGHT ? CARD_SHADE : CARD);
  // The heading band and the name on it.
  for (let y = top; y < top + BAND_HEIGHT; y++) {
    const row = y - top;
    const colour =
      row < BAND_LIT_ROWS ? BAND_LIT : row >= BAND_HEIGHT - BAND_RULE_ROWS ? BAND_RULE : BAND;
    for (let x = left; x < right; x++) put(x, y, colour);
  }
  const name = card.name === "" ? NAMELESS : card.name;
  draw(name, left + MARGIN, top + BAND_LIT_ROWS + BAND_ABOVE, (x, y) => put(x, y, NAME_INK));
  // The plate, and the portrait on it, its shadow laid over the wash.
  const plateLeft = left + MARGIN;
  const plateTop = top + BAND_HEIGHT + MARGIN;
  for (let y = 0; y < PLATE; y++) {
    for (let x = 0; x < PLATE; x++) {
      const border = Math.min(x, y, PLATE - 1 - x, PLATE - 1 - y) < PLATE_BORDER;
      put(plateLeft + x, plateTop + y, border ? PLATE_EDGE : PLATE_WASH);
    }
  }
  if (portrait !== null) {
    const ox = plateLeft + PLATE_BORDER;
    const oy = plateTop + PLATE_BORDER;
    for (let y = 0; y < Math.min(portrait.height, PORTRAIT_SIZE); y++) {
      for (let x = 0; x < Math.min(portrait.width, PORTRAIT_SIZE); x++) {
        const from = 4 * (y * portrait.width + x);
        const alpha = (portrait.rgba[from + 3] ?? 0) / 255;
        if (alpha <= 0) continue;
        const to = 4 * ((oy + y) * width + ox + x);
        for (let channel = 0; channel < 3; channel++) {
          const under = rgba[to + channel] ?? 0;
          rgba[to + channel] = under + ((portrait.rgba[from + channel] ?? 0) - under) * alpha;
        }
      }
    }
  }
  // The words, one to a ruled line, and the icons under them.
  const columnLeft = plateLeft + PLATE + COLUMN_GAP;
  wordsOf(card).forEach((word, line) => {
    const y = plateTop + line * WORD_PITCH;
    for (let x = columnLeft; x < right - MARGIN; x++) put(x, y + RULE_BELOW, RULE);
    draw(word, columnLeft, y, (x, y) => put(x, y, WORD_INK));
  });
  let iconLeft = columnLeft;
  const iconTop = plateTop + wordsOf(card).length * WORD_PITCH + ICONS_ABOVE;
  for (const icon of card.icons) {
    bitmap(ICONS[icon].rows, ICONS[icon].colours, iconLeft, iconTop, put);
    iconLeft += ICON_SIZE + ICON_GAP;
  }
  return { width, height, rgba };
}

/** Draw a bitmap of `rows` (a letter per colour of `colours`, `.` none) with its top-left at (x, y). */
function bitmap(
  rows: readonly string[],
  colours: Readonly<Record<string, number>>,
  x: number,
  y: number,
  put: (x: number, y: number, colour: number) => void,
): void {
  rows.forEach((row, r) => {
    [...row].forEach((letter, c) => {
      const colour = colours[letter];
      if (colour !== undefined) put(x + c, y + r, colour);
    });
  });
}

/** Seconds for the card to slide in, and back out. */
export const CARD_IN_S = 0.7;
export const CARD_OUT_S = 0.45;
/** Art pixels between the card and the screen's top and left edges. */
const CORNER = 6;

export type CardPhase = "hidden" | "sliding-in" | "open" | "sliding-out";

/** Eased both ways, so that a card turned back half-way does not jump. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The card on screen: a canvas of its own laid over the scene (`element`), placed and
 * sized in shares of the screen's art pixels, as the captions' scroll. It is painted once
 * per animal, portrait and lantern step, and slides as a whole, by whole art pixels.
 */
export class NameCard {
  readonly element = document.createElement("canvas");
  private shown: { card: Card; key: string; portrait: Pixels | null } | null = null;
  /** How far in, before easing (0–1), and whether it is coming in. */
  private progress = 0;
  private opening = false;
  private painted: { key: string; portrait: Pixels | null; lamp: number } | null = null;
  /** The art pixel its left edge was last put at. */
  private placedAt: number | null = null;
  private lamp: Rgb = DAYLIGHT;

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
  ) {
    const style = this.element.style;
    style.position = "absolute";
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
    this.element.dataset.testid = "card";
  }

  /**
   * What the card shows now (`window.__card`, tests, S3): how far in, the lamp it is lit
   * by (0xRRGGBB, 0xffffff by day), and whether a portrait is on its plate.
   */
  get state(): { phase: CardPhase; open: number; lamp: number; portrait: boolean } & Partial<Card> {
    const open = smooth(this.progress);
    const lamp = lampKey(this.lamp);
    if (this.shown === null) return { phase: "hidden", open: 0, lamp, portrait: false };
    const phase: CardPhase = this.opening
      ? this.progress >= 1
        ? "open"
        : "sliding-in"
      : "sliding-out";
    return {
      phase,
      open,
      lamp,
      portrait: this.shown.portrait !== null,
      ...this.shown.card,
      icons: [...this.shown.card.icons],
    };
  }

  /** Move on by `dtS` with `facts` the animal to show, or null for none, lit by `lamp`. */
  update(dtS: number, facts: CardFacts | null, lamp: Rgb = DAYLIGHT): void {
    this.lamp = lamp;
    const wanted = facts === null ? null : describe(facts);
    const key = wanted === null ? null : JSON.stringify(wanted);
    if (this.shown !== null && this.shown.key !== key) {
      // Another animal, or none: this one slides out first.
      this.opening = false;
      this.progress = Math.max(this.progress - dtS / CARD_OUT_S, 0);
      if (this.progress <= 0) this.shown = null;
    } else if (this.shown === null && wanted !== null && facts !== null && key !== null) {
      this.shown = { card: wanted, key, portrait: facts.portrait ?? null };
      this.opening = true;
      this.progress = 0;
    } else if (this.shown !== null && facts !== null) {
      // The same card: its portrait may have been drawn anew (colours ranked, growth).
      this.shown.portrait = facts.portrait ?? null;
      this.opening = true;
      this.progress = Math.min(this.progress + dtS / CARD_IN_S, 1);
    }
    this.paint();
  }

  private paint(): void {
    const open = smooth(this.progress);
    if (this.shown === null || open <= 0) {
      this.element.style.display = "none";
      this.painted = null;
      this.placedAt = null;
      return;
    }
    const { card, key, portrait } = this.shown;
    const lamp = lampKey(this.lamp);
    const last = this.painted;
    const { element } = this;
    const share = (value: number, of: number): string => `${(100 * value) / of}%`;
    if (last?.key !== key || last.portrait !== portrait || last.lamp !== lamp) {
      this.painted = { key, portrait, lamp };
      const picture = paintCard(card, portrait);
      lightPicture(picture, this.lamp);
      if (element.width !== picture.width || element.height !== picture.height) {
        element.width = picture.width;
        element.height = picture.height;
        element.style.top = share(CORNER, this.screenHeight);
        element.style.width = share(picture.width, this.screenWidth);
        element.style.height = share(picture.height, this.screenHeight);
      }
      element
        .getContext("2d")
        ?.putImageData(new ImageData(picture.rgba, picture.width, picture.height), 0, 0);
    }
    // In from past the screen's left edge, by whole art pixels.
    const at = Math.round(CORNER - (1 - open) * (element.width + CORNER));
    if (at !== this.placedAt) {
      this.placedAt = at;
      element.style.left = share(at, this.screenWidth);
    }
    element.style.display = "block";
  }
}
