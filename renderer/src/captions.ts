/**
 * Captions (R3, ADR 0020): the chronicle's notable entries, each on a parchment scroll
 * at the foot of the screen. A scroll unrolls from its middle, both rolls moving apart,
 * stays open for as long as the entry takes to read, and rolls up again; entries that
 * come together wait their turn. The scroll is pixel art at the scene's art pixels, its
 * text in the caption font (`pixelfont.ts`), in the cosy palette: warm paper, wooden
 * rolls, outlines in each thing's own darkest tone leaning to plum.
 *
 * The queue and the painting are pure; `Captions` puts the painting on screen.
 */
import { GLYPH_ROWS, draw, measure, wrap } from "./pixelfont";
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

/** Art pixels of text to a line, the paper's margin round it, and between lines. */
const TEXT_WIDTH = 264;
const MARGIN_X = 9;
const MARGIN_Y = 5;
const LINE_GAP = 1;
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
const MOST_LINES = 4;

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

/** A notable entry as the scroll shows it. */
export interface Caption {
  number: number;
  importance: number;
  text: string;
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

/** The lines a caption is written in: its date, then its text, at most `MOST_LINES` of it. */
export function linesOf(caption: Caption): { date: string | null; lines: string[] } {
  let lines = wrap(caption.text, TEXT_WIDTH);
  if (lines.length > MOST_LINES) {
    lines = lines.slice(0, MOST_LINES);
    let last = lines[MOST_LINES - 1] ?? "";
    while (last.length > 0 && measure(`${last}...`) > TEXT_WIDTH) last = last.slice(0, -1);
    lines[MOST_LINES - 1] = `${last.trimEnd()}...`;
  }
  return { date: caption.date === null ? null : longDate(caption.date), lines };
}

export interface Picture {
  width: number;
  height: number;
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** The size of the scroll for `caption`, fully open, in art pixels. */
export function scrollSize(caption: Caption): { width: number; height: number } {
  const { date, lines } = linesOf(caption);
  const rows = lines.length + (date === null ? 0 : 1);
  const paper = 2 * MARGIN_Y + rows * GLYPH_ROWS + (rows - 1) * LINE_GAP;
  return {
    width: TEXT_WIDTH + 2 * MARGIN_X + 2 * ROLL_WIDTH + SHADOW,
    height: paper + 2 * (ROLL_OVER + KNOB) + SHADOW,
  };
}

/** Paint the scroll of `caption`, `open` of the way open (0–1), at its full size. */
export function paintScroll(caption: Caption, open: number): Picture {
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
  const { date, lines } = linesOf(caption);
  const ink = (colour: number) => (x: number, y: number) => {
    if (x >= left && x < right) put(x, y, colour);
  };
  let y = paperTop + MARGIN_Y;
  const textLeft = ROLL_WIDTH + MARGIN_X;
  if (date !== null) {
    draw(date, textLeft, y, ink(FADED_INK));
    y += GLYPH_ROWS + LINE_GAP;
  }
  for (const line of lines) {
    draw(line, textLeft, y, ink(INK));
    y += GLYPH_ROWS + LINE_GAP;
  }

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
  private painted: { number: number; open: number } | null = null;

  constructor(
    private readonly screenWidth: number,
    private readonly screenHeight: number,
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

  get state(): { phase: Phase; caption: Caption | null; waiting: number } {
    return { ...this.queue.state, waiting: this.queue.length };
  }

  update(dtS: number): void {
    const { caption, open } = this.queue.update(dtS);
    if (caption === null || open <= 0) {
      this.element.style.display = "none";
      this.painted = null;
      return;
    }
    if (this.painted?.number === caption.number && this.painted.open === open) return;
    this.painted = { number: caption.number, open };
    this.show(paintScroll(caption, open));
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
