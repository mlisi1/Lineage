/**
 * The name card (R5): while the local view follows an animal, a small parchment scroll in
 * the screen's top-left corner gives its species' name and what its genes make of it. The
 * owner's choices (2026-10-22): its traits in words where words read well (size, build,
 * diet: "large long-legged grazer", at most three words), and small pixel icons for what
 * words do badly (at home in the water, each rare gene it carries); a swatch of its own
 * colours beside the name. The phone's follow-a-creature (S3) shows the same card.
 *
 * The corner: the chronicle's scroll (`captions.ts`) unrolls at the foot of the screen,
 * across its middle, so the top is free; the left, because the card unrolls from its left
 * roll, which stays by the screen's edge, as a page is read.
 *
 * The scroll is R3's (`captions.ts`): warm paper, wooden rolls lit from the upper left,
 * the caption font (`pixelfont.ts`). Icons are hand-made bitmaps, seven art pixels square,
 * in the cosy palette. The words and icons are pure (`describe`), and so is the painting
 * (`paintCard`); `NameCard` puts it on screen, unrolling when following starts and rolling
 * up when the view leaves the animal or the camera turns to another. It is lit by the
 * same lantern as the chronicle's scroll (`lantern` in `captions.ts`): dim and warm at
 * night, a little red in the end of a world.
 */
import {
  FADED_INK,
  INK,
  KNOB_RAMP,
  PAPER,
  PAPER_EDGE,
  PAPER_SHADE,
  ROLL,
  ROLL_EDGE,
  DAYLIGHT,
  SHADOW_ALPHA,
  SHADOW_COLOUR,
  lampKey,
  lightPicture,
  type Picture,
} from "./captions";
import type { Rgb } from "./atmosphere/light";
import { blend } from "./creatures/body";
import { geneOf, type Genome } from "./creatures/genome";
import { GOLD, PLUM, SUNLIT } from "./palette";
import { draw, measure } from "./pixelfont";

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

/** Art pixels of paper round the writing, and between the name and the traits. */
const MARGIN_X = 6;
const MARGIN_Y = 4;
const LINE_GAP = 2;
/** The swatch of the animal's colours: art pixels across, and before the name. */
const SWATCH = 7;
const SWATCH_GAP = 4;
/** Art pixels between the name and its icons. */
const ICONS_GAP = 5;
/** The rolls: art pixels across, how far they reach above and below the paper, their knobs. */
const ROLL_WIDTH = 7;
const ROLL_OVER = 2;
const KNOB = 2;
const KNOB_WIDTH = 4;
/** Which columns of the caption's roll (ten across) make the card's narrower one. */
const ROLL_COLUMNS = [0, 1, 2, 3, 5, 7, 9] as const;
/** The card's shadow falls this far down and right. */
const SHADOW = 2;
/** Columns of shaded paper where it curls into a roll. */
const CURL = 2;
/** Glyph rows of a line of text (capitals 7, descenders 2). */
const LINE = 9;
/** How far the swatch's body colour is lit toward gold, and its outline taken toward plum. */
const SWATCH_LIT = 0.45;
const SWATCH_OUTLINE = 0.6;

/** The swatch: the body colour (b), lit at the upper left (L), a marking across (m). */
const SWATCH_ROWS = [".kkkkk.", "kLLbbbk", "kLbbbmk", "kbbbmmk", "kbbmmbk", "kbmmbbk", ".kkkkk."];

/** Art pixels across the name line's swatch, name and icons, and across the traits. */
function contentWidth(card: Card): number {
  const icons =
    card.icons.length === 0 ? 0 : ICONS_GAP + card.icons.length * (ICON_SIZE + ICON_GAP) - ICON_GAP;
  return SWATCH + SWATCH_GAP + Math.max(measure(card.name) + icons, measure(card.traits));
}

/** The size of the card, fully open, in art pixels. */
export function cardSize(card: Card): { width: number; height: number } {
  const paper = 2 * MARGIN_Y + 2 * LINE + LINE_GAP;
  return {
    width: contentWidth(card) + 2 * MARGIN_X + 2 * ROLL_WIDTH + SHADOW,
    height: paper + 2 * (ROLL_OVER + KNOB) + SHADOW,
  };
}

/**
 * Paint the card, `open` of the way open (0–1), at its full size: its left roll stays at
 * the left and the right one moves out, the paper showing between them.
 */
export function paintCard(
  card: Card,
  colours: { body: number; mark: number },
  open: number,
): Picture {
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
  const paperTop = ROLL_OVER + KNOB;
  const paperBottom = outer.height - ROLL_OVER - KNOB - 1;
  const left = ROLL_WIDTH;
  const fullPaper = outer.width - 2 * ROLL_WIDTH;
  const right = left + Math.round(fullPaper * Math.min(Math.max(open, 0), 1));

  // The shadow: the paper and the rolls, moved down and right, see-through.
  for (let x = SHADOW; x < right + ROLL_WIDTH + SHADOW; x++) {
    const roll = x < left + SHADOW || x >= right + SHADOW;
    const top = (roll ? KNOB : paperTop) + SHADOW;
    const bottom = (roll ? outer.height - KNOB - 1 : paperBottom) + SHADOW;
    for (let y = top; y <= bottom; y++) put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
  }
  // The paper, as the caption's: an edge top and bottom, shaded where it curls.
  for (let x = left; x < right; x++) {
    const curl = x < left + CURL || x >= right - CURL;
    for (let y = paperTop; y <= paperBottom; y++) {
      const edge = y === paperTop || y === paperBottom;
      const shade = curl || y >= paperBottom - 2 || y === paperTop + 1;
      put(x, y, edge ? PAPER_EDGE : shade ? PAPER_SHADE : PAPER);
    }
  }
  // What is written and drawn on it, shown where the paper is.
  const onPaper = (x: number, y: number, colour: number): void => {
    if (x >= left && x < right) put(x, y, colour);
  };
  const ink = (colour: number) => (x: number, y: number) => onPaper(x, y, colour);
  const x0 = left + MARGIN_X;
  const y0 = paperTop + MARGIN_Y;
  const swatch: Readonly<Record<string, number>> = {
    k: blend(blend(colours.body, 0, 0.5), PLUM, SWATCH_OUTLINE),
    b: colours.body,
    L: blend(colours.body, GOLD, SWATCH_LIT),
    m: colours.mark,
  };
  bitmap(SWATCH_ROWS, swatch, x0, y0, onPaper);
  const textLeft = x0 + SWATCH + SWATCH_GAP;
  const nameWidth = draw(card.name, textLeft, y0, ink(INK));
  let iconLeft = textLeft + nameWidth + ICONS_GAP;
  for (const name of card.icons) {
    const icon: Icon = ICONS[name];
    bitmap(icon.rows, icon.colours, iconLeft, y0, onPaper);
    iconLeft += ICON_SIZE + ICON_GAP;
  }
  draw(card.traits, textLeft, y0 + LINE + LINE_GAP, ink(FADED_INK));

  // The rolls, with knobs above and below.
  for (const rollLeft of [0, right]) {
    const top = KNOB;
    const bottom = outer.height - KNOB - 1;
    ROLL_COLUMNS.forEach((source, column) => {
      const x = rollLeft + column;
      const inset = column === 0 || column === ROLL_WIDTH - 1 ? 1 : 0;
      for (let row = top + inset; row <= bottom - inset; row++) {
        const end = row === top + inset || row === bottom - inset;
        put(x, row, end ? ROLL_EDGE : (ROLL[source] ?? ROLL_EDGE));
      }
    });
    const knob = rollLeft + Math.floor((ROLL_WIDTH - KNOB_WIDTH) / 2);
    for (let k = 0; k < KNOB; k++) {
      KNOB_RAMP.forEach((colour, column) => {
        const tip = k === 0 && column > 0 && column < KNOB_WIDTH - 1;
        put(knob + column, k, tip ? (KNOB_RAMP[0] ?? colour) : colour);
        put(knob + column, outer.height - 1 - k, tip ? (KNOB_RAMP[0] ?? colour) : colour);
      });
    }
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

/** Seconds to unroll the card, and to roll it up. */
export const CARD_UNROLL_S = 0.7;
export const CARD_ROLL_UP_S = 0.45;
/** Art pixels between the card and the screen's top and left edges. */
const CORNER = 6;

export type CardPhase = "hidden" | "unrolling" | "open" | "rolling-up";

/** Eased both ways, so that a card turned back half-way does not jump. */
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/**
 * The card on screen: a canvas of its own laid over the scene (`element`), placed and
 * sized in shares of the screen's art pixels, as the captions' scroll.
 */
export class NameCard {
  readonly element = document.createElement("canvas");
  private shown: { card: Card; key: string; body: number; mark: number } | null = null;
  /** How far open, before easing (0–1), and whether it is opening. */
  private progress = 0;
  private opening = false;
  private painted: { key: string; open: number; lamp: number } | null = null;
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
   * What the card shows now (`window.__card`, tests, S3), and the lamp it is lit by
   * (0xRRGGBB, 0xffffff by day).
   */
  get state(): { phase: CardPhase; open: number; lamp: number } & Partial<Card> {
    const open = smooth(this.progress);
    const lamp = lampKey(this.lamp);
    if (this.shown === null) return { phase: "hidden", open: 0, lamp };
    const phase: CardPhase = this.opening
      ? this.progress >= 1
        ? "open"
        : "unrolling"
      : "rolling-up";
    return { phase, open, lamp, ...this.shown.card, icons: [...this.shown.card.icons] };
  }

  /** Move on by `dtS` with `facts` the animal to show, or null for none, lit by `lamp`. */
  update(dtS: number, facts: CardFacts | null, lamp: Rgb = DAYLIGHT): void {
    this.lamp = lamp;
    const wanted = facts === null ? null : describe(facts);
    const key = wanted === null ? null : JSON.stringify(wanted);
    if (this.shown !== null && this.shown.key !== key) {
      // Another animal, or none: roll this one up first.
      this.opening = false;
      this.progress = Math.max(this.progress - dtS / CARD_ROLL_UP_S, 0);
      if (this.progress <= 0) this.shown = null;
    } else if (this.shown === null && wanted !== null && facts !== null && key !== null) {
      this.shown = { card: wanted, key, body: facts.body, mark: facts.mark };
      this.opening = true;
      this.progress = 0;
    } else if (this.shown !== null && facts !== null) {
      // The same card: its colours may have been ranked anew.
      this.shown.body = facts.body;
      this.shown.mark = facts.mark;
      this.opening = true;
      this.progress = Math.min(this.progress + dtS / CARD_UNROLL_S, 1);
    }
    this.paint();
  }

  private paint(): void {
    const open = smooth(this.progress);
    if (this.shown === null || open <= 0) {
      this.element.style.display = "none";
      this.painted = null;
      return;
    }
    const { card, key, body, mark } = this.shown;
    const painted = `${key} ${body} ${mark}`;
    const lamp = lampKey(this.lamp);
    const last = this.painted;
    if (last?.key === painted && last.open === open && last.lamp === lamp) return;
    this.painted = { key: painted, open, lamp };
    const picture = paintCard(card, { body, mark }, open);
    lightPicture(picture, this.lamp);
    const { element } = this;
    if (element.width !== picture.width || element.height !== picture.height) {
      element.width = picture.width;
      element.height = picture.height;
      const share = (value: number, of: number): string => `${(100 * value) / of}%`;
      element.style.left = share(CORNER, this.screenWidth);
      element.style.top = share(CORNER, this.screenHeight);
      element.style.width = share(picture.width, this.screenWidth);
      element.style.height = share(picture.height, this.screenHeight);
    }
    element
      .getContext("2d")
      ?.putImageData(new ImageData(picture.rgba, picture.width, picture.height), 0, 0);
    element.style.display = "block";
  }
}
