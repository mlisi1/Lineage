/**
 * Captions (R3, ADR 0020): the chronicle's notable entries, each on a parchment scroll
 * at the foot of the screen. A scroll unrolls from its middle, both rolls moving apart,
 * stays open for as long as the entry takes to read, and rolls up again; entries that
 * come together wait their turn. The scroll is pixel art at the scene's art pixels, in the
 * cosy palette: warm paper, wooden rolls, outlines in each thing's own darkest tone
 * leaning to plum.
 *
 * It is illuminated (R5, the owner's choice, 2026-10-23; `illumination.ts`): the date is
 * lettered on a red ribbon pinned across the paper's top edge, and the entry opens with
 * an icon of its kind of event and an initial two lines tall in its species' colour (or
 * vermilion), the rest in the scroll's hand (`HAND_FONT`, larger than the caption font),
 * in balanced lines (at least two, at most three) so that a short entry has a short scroll.
 *
 * The scroll is a page element over the canvas, so the scene's tint does not reach it: it
 * is lit like a lantern instead (the owner, 2026-10-23, R5). By day it is as painted; as
 * the light falls the paper dims and warms like parchment by a candle, with a touch of the
 * sky's own colour (rose at dusk, moonlit blue at night), and in the end of a world it
 * takes a little of the fires' red. Every colour of the painting is multiplied by the same
 * lamp, so the ink keeps its contrast with the paper and the entry stays readable.
 *
 * The queue and the painting are pure; `Captions` puts the painting on screen.
 */
import { daylight, mixRgb, multiplyRgb, packRgb, type Rgb } from "./atmosphere/light";
import {
  ICON_SIZE,
  VERMILION,
  iconOf,
  initialHeight,
  initialWidth,
  paintIcon,
  paintInitial,
  paintRibbon,
  ribbonHeight,
  ribbonWidth,
  splitInitial,
  type IconName,
} from "./illumination";
import { HAND_FONT, HAND_ROWS } from "./pixelfont";
import type { ChronicleMessage } from "./protocol";

/** Seconds to unroll, to roll up, and between one scroll and the next. */
export const UNROLL_S = 0.8;
export const ROLL_UP_S = 0.6;
export const GAP_S = 1.5;
/** Seconds a scroll stays open: this, and this much per character (an unhurried reader). */
export const READ_BASE_S = 4;
export const READ_PER_CHARACTER_S = 0.07;
/** Entries waiting beyond this many: the least important (then the oldest) are dropped. */
export const MOST_WAITING = 4;

/**
 * Art pixels of the widest the writing may be (icon, initial and text; the screen is 512
 * across), the paper's margin round it, and between one line of the hand and the next.
 */
const TEXT_WIDTH = 420;
const MARGIN_X = 8;
const MARGIN_Y = 5;
const LINE_GAP = 2;
/** Art pixels between the icon and the initial, and between the initial and its lines. */
const ICON_GAP = 4;
const INITIAL_GAP = 3;
/** Lines of text beside the initial; the lines after them run under it. */
const BESIDE_INITIAL = 2;
/**
 * The date's ribbon: art pixels from the paper's left to it, how far it rises above the
 * paper's top edge (it is pinned across it), and the paper between it and the writing.
 */
const RIBBON_INDENT = 4;
const RIBBON_RISE = 4;
const RIBBON_GAP = 3;
/** The rolls: art pixels across, how far they reach above and below the paper, and their knobs. */
const ROLL_WIDTH = 10;
const ROLL_OVER = 3;
const KNOB = 3;
/** The knobs are this many art pixels across; the scroll's shadow falls this far down and right. */
const KNOB_WIDTH = 4;
const SHADOW = 2;
/** Columns of shaded paper where it curls into a roll. */
const CURL = 2;
/** At most so many lines of text; an entry longer than that is cut with an ellipsis. */
const MOST_LINES = 3;

/** The scroll's colours (0xRRGGBB), the name card's too (`card.ts`). */
export const INK = 0x5a3424;
export const FADED_INK = 0x9a6b44;
export const PAPER = 0xf7e6bc;
export const PAPER_SHADE = 0xe9cf98;
export const PAPER_EDGE = 0x8f5b3a;
/** A roll across, left to right: lit from the upper left, as everything in the scene. */
export const ROLL = [
  0x5a2e2a, 0xc48e52, 0xf2d496, 0xfbe7b5, 0xeac684, 0xdcae6c, 0xcf9c5b, 0xb07a45, 0x8c5634,
  0x5a2e2a,
] as const;
export const ROLL_EDGE = 0x5a2e2a;
export const KNOB_RAMP = [0x4a2420, 0xb5733f, 0x8a4e2a, 0x4a2420] as const;
/** The shadow under the scroll: the scene's ground shadow, see-through. */
export const SHADOW_COLOUR = 0x10081c;
export const SHADOW_ALPHA = 90;

// --- The lantern ---------------------------------------------------------------------

/** The lamp of a daylit scroll: its colours as painted. */
export const DAYLIGHT: Rgb = [1, 1, 1];
/** Candlelight on the paper on the darkest night: dimmer, and warm (red, green, blue multipliers). */
export const CANDLE: Rgb = [0.8, 0.62, 0.42];
/** How much of the sky's own hue (its tint at full strength) tinges the lamp: a touch. */
export const SKY_HUE_SHARE = 0.12;
/** In the end of a world, how much of the sky's hue (the fires' red) it takes instead. */
export const END_HUE_SHARE = 0.3;
/**
 * The sky's brightness (its tint's luma) that counts as full day, and as the darkest:
 * in the end of a world the scroll darkens with the red and black sky rather than the hour.
 */
const DAY_LUMA = 0.95;
const DARK_LUMA = 0.3;
/**
 * In the end of a world the fires light the scroll as a candle would: how far toward
 * candlelight it goes under the reddest sky, and how red a sky that is (its red less its
 * blue, as R4's blood-red tint has it).
 */
const FIRELIT = 0.7;
const REDDEST = 0.7;
/** The lamp is kept in this many steps a channel: the scroll is repainted only when one is crossed. */
export const LAMP_LEVELS = 64;

function luma(rgb: Rgb): number {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

function smoothstep(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/**
 * The lamp the scrolls are lit by (red, green and blue multipliers, in `LAMP_LEVELS`
 * steps), from the atmosphere's light of the moment: the sim's `light` (eased, as the
 * scene shows it), the `tint` laid over the scene (0xRRGGBB), and whether a world is
 * `ending`. Darker as the light falls (or, in the end of a world, as the sky does), from
 * the painted colours by day to candlelight at night.
 */
export function lantern(light: number, tint: number, ending: boolean): Rgb {
  const sky: Rgb = [((tint >> 16) & 255) / 255, ((tint >> 8) & 255) / 255, (tint & 255) / 255];
  let dark = 1 - smoothstep(daylight(light));
  if (ending) {
    const dim = smoothstep((DAY_LUMA - luma(sky)) / (DAY_LUMA - DARK_LUMA));
    const fire = FIRELIT * smoothstep((sky[0] - sky[2]) / REDDEST);
    dark = Math.max(dark, dim, fire);
  }
  const brightest = Math.max(...sky);
  const hue: Rgb =
    brightest > 0 ? [sky[0] / brightest, sky[1] / brightest, sky[2] / brightest] : DAYLIGHT;
  const share = (ending ? END_HUE_SHARE : SKY_HUE_SHARE) * dark;
  const lamp = multiplyRgb(mixRgb(DAYLIGHT, CANDLE, dark), mixRgb(DAYLIGHT, hue, share));
  const step = (value: number): number => Math.round(value * LAMP_LEVELS) / LAMP_LEVELS;
  return [step(lamp[0]), step(lamp[1]), step(lamp[2])];
}

/** The lamp as 0xRRGGBB (read-outs, and to tell one step from the next). */
export function lampKey(lamp: Rgb): number {
  return packRgb(lamp);
}

/**
 * Light `picture` by `lamp`, in place: every solid pixel's colour multiplied by it. The
 * see-through shadow is left as it is, a shadow on the scene, which has its own light.
 */
export function lightPicture(picture: Picture, lamp: Rgb): void {
  if (lamp[0] >= 1 && lamp[1] >= 1 && lamp[2] >= 1) return;
  const { rgba } = picture;
  for (let at = 0; at < rgba.length; at += 4) {
    if (rgba[at + 3] !== 255) continue;
    rgba[at] = (rgba[at] ?? 0) * lamp[0];
    rgba[at + 1] = (rgba[at + 1] ?? 0) * lamp[1];
    rgba[at + 2] = (rgba[at + 2] ?? 0) * lamp[2];
  }
}

/** A notable entry as the scroll shows it. */
export interface Caption {
  number: number;
  importance: number;
  text: string;
  /** What kind of event it tells of (the chronicle's `kind`): its icon; a quill if none. */
  kind?: string;
  /** The species it is about; 0 or none for none. Its initial is in the species' colour. */
  species?: number;
  /** The date it was written, as the clock gave it (YYYY-MM-DD); null if no clock came. */
  date: string | null;
}

export type Phase = "unroll" | "open" | "roll-up" | "gap";

/** What the scroll shows now: which caption and how far open (0 rolled up, 1 open). */
export interface Showing {
  caption: Caption | null;
  open: number;
}

/** How long `caption` stays open. */
export function readingTime(caption: Caption): number {
  return READ_BASE_S + READ_PER_CHARACTER_S * caption.text.length;
}

/** The order captions wait in, and how long each is shown. */
export class CaptionQueue {
  private readonly waiting: Caption[] = [];
  private shown: Caption | null = null;
  private phase: Phase = "gap";
  private t = GAP_S;

  /** The notable entries of `message`, written on `date`, join the queue. */
  take(message: ChronicleMessage, date: string | null): void {
    for (const entry of message.entries) {
      if (entry.importance < message.notable_importance) continue;
      this.waiting.push({
        number: entry.number,
        importance: entry.importance,
        text: entry.text,
        kind: entry.kind,
        species: entry.species,
        date,
      });
    }
    while (this.waiting.length > MOST_WAITING) {
      // The least important goes, the oldest of those first.
      let drop = 0;
      this.waiting.forEach((caption, index) => {
        if (caption.importance < (this.waiting[drop]?.importance ?? Infinity)) drop = index;
      });
      this.waiting.splice(drop, 1);
    }
  }

  get length(): number {
    return this.waiting.length;
  }

  get state(): { phase: Phase; caption: Caption | null } {
    return { phase: this.phase, caption: this.shown };
  }

  update(dtS: number): Showing {
    this.t += dtS;
    // A long frame may cross more than one phase.
    for (;;) {
      if (this.phase === "gap") {
        if (this.t < GAP_S) break;
        const next = this.waiting.shift();
        if (next === undefined) {
          this.t = GAP_S;
          break;
        }
        this.shown = next;
        this.next("unroll", GAP_S);
      } else if (this.phase === "unroll") {
        if (this.t < UNROLL_S) break;
        this.next("open", UNROLL_S);
      } else if (this.phase === "open") {
        const read = this.shown === null ? 0 : readingTime(this.shown);
        if (this.t < read) break;
        this.next("roll-up", read);
      } else {
        if (this.t < ROLL_UP_S) break;
        this.shown = null;
        this.next("gap", ROLL_UP_S);
      }
    }
    return { caption: this.shown, open: this.openness() };
  }

  private next(phase: Phase, spent: number): void {
    this.phase = phase;
    this.t -= spent;
  }

  private openness(): number {
    if (this.shown === null) return 0;
    // Eased: quick at first, slowing as the rolls reach the ends.
    if (this.phase === "unroll") return easeOut(Math.min(this.t / UNROLL_S, 1));
    if (this.phase === "roll-up") return 1 - easeIn(Math.min(this.t / ROLL_UP_S, 1));
    return this.phase === "open" ? 1 : 0;
  }
}

function easeOut(t: number): number {
  return 1 - (1 - t) ** 3;
}

function easeIn(t: number): number {
  return t ** 3;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "2027-08-12" as "12 August 2027"; anything else as it is. */
export function longDate(date: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (match === null) return date;
  const [, year, month, day] = match;
  return `${Number(day)} ${MONTHS[Number(month) - 1] ?? month} ${year}`;
}

/** How a caption is laid out on the open scroll, in art pixels from the writing's top-left. */
export interface Layout {
  icon: IconName;
  /** The date in capitals for its ribbon; null if no clock came. */
  date: string | null;
  /** The initial (a letter, or a short number; "" for none), and the lines after it. */
  initial: string;
  lines: string[];
  /** Where the initial and each line start across. */
  initialLeft: number;
  lineLefts: number[];
  /** How far the writing (with the ribbon) reaches across, and down below the ribbon. */
  width: number;
  height: number;
}

/** Captions laid out already: a scroll is painted every frame while it unrolls. */
const layouts = new WeakMap<Caption, Layout>();

/** The pitch of the hand's lines. */
const LINE_PITCH = HAND_ROWS + LINE_GAP;

/**
 * How `caption` is written: its icon, its initial and the lines of the rest, beside the
 * initial for the first `BESIDE_INITIAL` and under it after, at most `MOST_LINES`.
 */
export function layOut(caption: Caption): Layout {
  const known = layouts.get(caption);
  if (known !== undefined) return known;
  const { initial, rest } = splitInitial(caption.text);
  const initialLeft = ICON_SIZE + ICON_GAP;
  const besideWidth = initial === "" ? 0 : initialWidth(initial) + INITIAL_GAP;
  // Lines under the initial start where it does.
  const text = rest.trimStart();
  const wrapAt = (room: number): string[] =>
    HAND_FONT.wrap(text, room, besideWidth, BESIDE_INITIAL);
  let room = TEXT_WIDTH - initialLeft;
  let lines = wrapAt(room);
  // Balanced lines: the narrowest scroll that takes no more lines than the widest, and at
  // least as many as stand beside the initial (an entry of a few words too), so that the
  // initial has its lines beside it and a short entry a short scroll.
  const words = text.split(/\s+/).filter((word) => word !== "").length;
  const wanted = Math.min(Math.max(lines.length, BESIDE_INITIAL), MOST_LINES, words);
  if (lines.length <= wanted) {
    let fits = room;
    let narrow = besideWidth;
    while (fits - narrow > 1) {
      const tried = Math.floor((fits + narrow) / 2);
      if (wrapAt(tried).length <= wanted) fits = tried;
      else narrow = tried;
    }
    room = fits;
    lines = wrapAt(room);
  }
  if (lines.length > MOST_LINES) {
    lines = lines.slice(0, MOST_LINES);
    const lastRoom = MOST_LINES <= BESIDE_INITIAL ? room - besideWidth : room;
    let last = lines[MOST_LINES - 1] ?? "";
    while (last.length > 0 && HAND_FONT.measure(`${last}...`) > lastRoom) last = last.slice(0, -1);
    lines[MOST_LINES - 1] = `${last.trimEnd()}...`;
  }
  const lineLefts = lines.map((_, index) =>
    index < BESIDE_INITIAL ? initialLeft + besideWidth : initialLeft,
  );
  const date = caption.date === null ? null : longDate(caption.date).toUpperCase();
  let width = date === null ? 0 : RIBBON_INDENT + ribbonWidth(date) - MARGIN_X;
  lines.forEach((line, index) => {
    width = Math.max(width, (lineLefts[index] ?? 0) + HAND_FONT.measure(line));
  });
  width = Math.max(width, initialLeft + besideWidth);
  const textHeight = (Math.max(lines.length, 1) - 1) * LINE_PITCH + HAND_ROWS;
  const height = Math.max(textHeight, initial === "" ? ICON_SIZE : initialHeight(), ICON_SIZE);
  const layout = {
    icon: iconOf(caption.kind ?? ""),
    date,
    initial,
    lines,
    initialLeft,
    lineLefts,
    width,
    height,
  };
  layouts.set(caption, layout);
  return layout;
}

/** The lines a caption is written in: its date as on its ribbon, then the lines of its text after the initial. */
export function linesOf(caption: Caption): { date: string | null; lines: string[] } {
  const { date, lines } = layOut(caption);
  return { date, lines };
}

export interface Picture {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** Art pixels from the paper's top edge to the writing: below the ribbon, if there is one. */
function writingTop(layout: Layout): number {
  return layout.date === null ? MARGIN_Y : ribbonHeight() - RIBBON_RISE + RIBBON_GAP;
}

/** The size of the scroll for `caption`, fully open, in art pixels. */
export function scrollSize(caption: Caption): { width: number; height: number } {
  const layout = layOut(caption);
  const paper = writingTop(layout) + layout.height + MARGIN_Y;
  return {
    width: layout.width + 2 * MARGIN_X + 2 * ROLL_WIDTH + SHADOW,
    height: paper + 2 * (ROLL_OVER + KNOB) + SHADOW,
  };
}

/**
 * Paint the scroll of `caption`, `open` of the way open (0–1), at its full size; its
 * initial in `colour` (0xRRGGBB: its species', or vermilion when it names none).
 */
export function paintScroll(caption: Caption, open: number, colour = VERMILION): Picture {
  const { width, height } = scrollSize(caption);
  const rgba = new Uint8ClampedArray(width * height * 4);
  const put = (x: number, y: number, colour: number, alpha = 255): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const at = 4 * (y * width + x);
    rgba[at] = (colour >> 16) & 255;
    rgba[at + 1] = (colour >> 8) & 255;
    rgba[at + 2] = colour & 255;
    rgba[at + 3] = alpha;
  };
  // The scroll itself, without its shadow.
  const outer = { width: width - SHADOW, height: height - SHADOW };
  const middle = Math.floor(outer.width / 2);
  const paperTop = ROLL_OVER + KNOB;
  const paperBottom = outer.height - ROLL_OVER - KNOB - 1;
  // How much paper shows, in whole pixels either side of the middle.
  const fullHalf = middle - ROLL_WIDTH;
  const half = Math.round(fullHalf * Math.min(Math.max(open, 0), 1));
  const left = middle - half;
  const right = middle + half;

  // The shadow first: the paper and the rolls, moved down and right, see-through.
  for (let x = left - ROLL_WIDTH + SHADOW; x < right + ROLL_WIDTH + SHADOW; x++) {
    const roll = x < left + SHADOW || x >= right + SHADOW;
    const top = (roll ? KNOB : paperTop) + SHADOW;
    const bottom = (roll ? outer.height - KNOB - 1 : paperBottom) + SHADOW;
    for (let y = top; y <= bottom; y++) put(x, y, SHADOW_COLOUR, SHADOW_ALPHA);
  }
  // The paper: an edge at top and bottom, the lower rows a shade darker, and darker
  // still where it curls into the rolls.
  for (let x = left; x < right; x++) {
    const curl = x < left + CURL || x >= right - CURL;
    for (let y = paperTop; y <= paperBottom; y++) {
      const edge = y === paperTop || y === paperBottom;
      const shade = curl || y >= paperBottom - 2 || y === paperTop + 1;
      put(x, y, edge ? PAPER_EDGE : shade ? PAPER_SHADE : PAPER);
    }
  }
  // The writing, laid out for the open scroll and shown where the paper is.
  const layout = layOut(caption);
  const onPaper = (x: number, y: number, colour: number): void => {
    if (x >= left && x < right) put(x, y, colour);
  };
  const ink = (colour: number) => (x: number, y: number) => onPaper(x, y, colour);
  const x0 = ROLL_WIDTH + MARGIN_X;
  const y0 = paperTop + writingTop(layout);
  if (layout.date !== null) {
    paintRibbon(layout.date, ROLL_WIDTH + RIBBON_INDENT, paperTop - RIBBON_RISE, INK, onPaper);
  }
  // The icon beside the initial, halfway down it (or the first line, if there is none).
  const besideHeight = layout.initial === "" ? HAND_ROWS : initialHeight();
  paintIcon(layout.icon, x0, y0 + Math.floor((besideHeight - ICON_SIZE) / 2), onPaper);
  paintInitial(layout.initial, colour, x0 + layout.initialLeft, y0, INK, PAPER, onPaper);
  layout.lines.forEach((line, index) => {
    HAND_FONT.draw(line, x0 + (layout.lineLefts[index] ?? 0), y0 + index * LINE_PITCH, ink(INK));
  });

  // The rolls at both ends of the paper shown, with knobs above and below.
  for (const rollLeft of [left - ROLL_WIDTH, right]) {
    const top = KNOB;
    const bottom = outer.height - KNOB - 1;
    for (let column = 0; column < ROLL_WIDTH; column++) {
      const x = rollLeft + column;
      // Rounded ends: the outermost columns are a pixel shorter at each end.
      const inset = column === 0 || column === ROLL_WIDTH - 1 ? 1 : 0;
      for (let row = top + inset; row <= bottom - inset; row++) {
        const end = row === top + inset || row === bottom - inset;
        put(x, row, end ? ROLL_EDGE : (ROLL[column] ?? ROLL_EDGE));
      }
    }
    const knob = rollLeft + Math.floor((ROLL_WIDTH - KNOB_WIDTH) / 2);
    for (let k = 0; k < KNOB; k++) {
      KNOB_RAMP.forEach((colour, column) => {
        // The knob's outer row is its edge colour all along: a rounded cap.
        const tip = k === 0 && column > 0 && column < KNOB_WIDTH - 1;
        put(knob + column, k, tip ? (KNOB_RAMP[0] ?? colour) : colour);
        put(knob + column, outer.height - 1 - k, tip ? (KNOB_RAMP[0] ?? colour) : colour);
      });
    }
  }
  return { width, height, rgba };
}

/** Art pixels between the scroll and the foot of the screen. */
const FOOT = 6;

/**
 * The scroll on screen: a canvas of its own laid over the scene (`element`, to add to the
 * box the scene's canvas is in), placed and sized in shares of the screen's art pixels so
 * that it scales with the scene. It is not drawn in the scene's canvas, which slides by
 * fractions of a pixel as the camera moves (`main.ts`): the scroll keeps still.
 */
export class Captions {
  readonly element = document.createElement("canvas");
  private readonly queue = new CaptionQueue();
  private painted: { number: number; open: number; lamp: number } | null = null;
  private lamp: Rgb = DAYLIGHT;
  /** The colour of the initial of the caption shown, looked up once when it comes out. */
  private initial: { number: number; colour: number } | null = null;

  /**
   * `colourOf` gives a species' colour as the herd draws it (0xRRGGBB), or null if the
   * species is not known (gone, or not yet seen): the initial is then vermilion.
   */
  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
    private readonly colourOf: (species: number) => number | null = () => null,
  ) {
    const style = this.element.style;
    style.position = "absolute";
    style.imageRendering = "pixelated";
    style.pointerEvents = "none";
    style.display = "none";
    this.element.dataset.testid = "scroll";
  }

  take(message: ChronicleMessage, date: string | null): void {
    this.queue.take(message, date);
  }

  /**
   * What the scroll shows, the lamp it is lit by (0xRRGGBB, 0xffffff by day), the icon its
   * entry opens with and the colour of its initial (null while none is shown).
   */
  get state(): {
    phase: Phase;
    caption: Caption | null;
    waiting: number;
    lamp: number;
    icon: IconName | null;
    initial: number | null;
  } {
    const { phase, caption } = this.queue.state;
    return {
      phase,
      caption,
      waiting: this.queue.length,
      lamp: lampKey(this.lamp),
      icon: caption === null ? null : iconOf(caption.kind ?? ""),
      initial: caption === null ? null : this.initialColour(caption),
    };
  }

  /** The colour of `caption`'s initial: its species', as first seen, or vermilion. */
  private initialColour(caption: Caption): number {
    if (this.initial?.number !== caption.number) {
      const species = caption.species ?? 0;
      const colour = species > 0 ? this.colourOf(species) : null;
      this.initial = { number: caption.number, colour: colour ?? VERMILION };
    }
    return this.initial.colour;
  }

  /** Move on by `dtS`, the scroll lit by `lamp` (`lantern`). */
  update(dtS: number, lamp: Rgb = DAYLIGHT): void {
    this.lamp = lamp;
    const { caption, open } = this.queue.update(dtS);
    if (caption === null || open <= 0) {
      this.element.style.display = "none";
      this.painted = null;
      return;
    }
    const key = lampKey(lamp);
    const painted = this.painted;
    if (painted?.number === caption.number && painted.open === open && painted.lamp === key) {
      return;
    }
    this.painted = { number: caption.number, open, lamp: key };
    const picture = paintScroll(caption, open, this.initialColour(caption));
    lightPicture(picture, lamp);
    this.show(picture);
  }

  private show(picture: Picture): void {
    const { element } = this;
    if (element.width !== picture.width || element.height !== picture.height) {
      element.width = picture.width;
      element.height = picture.height;
      const share = (value: number, of: number): string => `${(100 * value) / of}%`;
      const x = Math.round((this.screenWidth - picture.width) / 2);
      const y = this.screenHeight - FOOT - picture.height;
      element.style.left = share(x, this.screenWidth);
      element.style.top = share(y, this.screenHeight);
      element.style.width = share(picture.width, this.screenWidth);
      element.style.height = share(picture.height, this.screenHeight);
    }
    element
      .getContext("2d")
      ?.putImageData(new ImageData(picture.rgba, picture.width, picture.height), 0, 0);
    element.style.display = "block";
  }
}
