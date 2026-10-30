/**
 * A pixel font for captions (R3): capitals and digits 7 art pixels tall, lower case with
 * ascenders and two rows of descenders, drawn a pixel at a time so that text keeps the
 * scene's hard edges at any whole-number scale, and looks the same on every machine
 * (a system font, shrunk to art pixels, would smear and differ from one browser to the
 * next). Glyphs are rows of `#` (ink) and `.` (paper), top row first.
 *
 * Two cuts (R5): the caption font, for the date's ribbon and the name card, and the
 * scroll's hand, larger, for the chronicle's entries (`HAND_FONT`).
 */

/** Rows of a glyph: 7 above the baseline, 2 below it. */
export const GLYPH_ROWS = 9;
/** Rows from the top to the baseline. */
export const BASELINE = 7;
/** Blank columns between letters, and the width of a space. */
const SPACING = 1;
const SPACE = 3;

export const GLYPHS: Readonly<Record<string, string>> = {
  A: ".###./#...#/#...#/#####/#...#/#...#/#...#",
  B: "####./#...#/#...#/####./#...#/#...#/####.",
  C: ".###./#...#/#..../#..../#..../#...#/.###.",
  D: "####./#...#/#...#/#...#/#...#/#...#/####.",
  E: "#####/#..../#..../####./#..../#..../#####",
  F: "#####/#..../#..../####./#..../#..../#....",
  G: ".###./#...#/#..../#.###/#...#/#...#/.####",
  H: "#...#/#...#/#...#/#####/#...#/#...#/#...#",
  I: "###/.#./.#./.#./.#./.#./###",
  J: "..###/...#./...#./...#./#..#./#..#./.##..",
  K: "#...#/#..#./#.#../##.../#.#../#..#./#...#",
  L: "#..../#..../#..../#..../#..../#..../#####",
  M: "#...#/##.##/#.#.#/#.#.#/#...#/#...#/#...#",
  N: "#...#/##..#/#.#.#/#..##/#...#/#...#/#...#",
  O: ".###./#...#/#...#/#...#/#...#/#...#/.###.",
  P: "####./#...#/#...#/####./#..../#..../#....",
  Q: ".###./#...#/#...#/#...#/#.#.#/#..#./.##.#",
  R: "####./#...#/#...#/####./#.#../#..#./#...#",
  S: ".####/#..../#..../.###./....#/....#/####.",
  T: "#####/..#../..#../..#../..#../..#../..#..",
  U: "#...#/#...#/#...#/#...#/#...#/#...#/.###.",
  V: "#...#/#...#/#...#/#...#/#...#/.#.#./..#..",
  W: "#...#/#...#/#...#/#.#.#/#.#.#/#.#.#/.#.#.",
  X: "#...#/#...#/.#.#./..#../.#.#./#...#/#...#",
  Y: "#...#/#...#/.#.#./..#../..#../..#../..#..",
  Z: "#####/....#/...#./..#../.#.../#..../#####",
  a: "...../...../.###./....#/.####/#...#/.####",
  b: "#..../#..../####./#...#/#...#/#...#/####.",
  c: "..../..../.###/#.../#.../#.../.###",
  d: "....#/....#/.####/#...#/#...#/#...#/.####",
  e: "...../...../.###./#...#/#####/#..../.###.",
  f: "..##/.#../###./.#../.#../.#../.#..",
  g: "...../...../.####/#...#/#...#/#...#/.####/....#/.###.",
  h: "#..../#..../####./#...#/#...#/#...#/#...#",
  i: "#/./#/#/#/#/#",
  j: "..#/.../..#/..#/..#/..#/..#/#.#/.#.",
  k: "#.../#.../#..#/#.#./##../#.#./#..#",
  l: "#./#./#./#./#./#./.#",
  m: "...../...../##.#./#.#.#/#.#.#/#.#.#/#.#.#",
  n: "...../...../####./#...#/#...#/#...#/#...#",
  o: "...../...../.###./#...#/#...#/#...#/.###.",
  p: "...../...../####./#...#/#...#/#...#/####./#..../#....",
  q: "...../...../.####/#...#/#...#/#...#/.####/....#/....#",
  r: "..../..../#.##/##../#.../#.../#...",
  s: "...../...../.####/#..../.###./....#/####.",
  t: ".#../.#../###./.#../.#../.#../..##",
  u: "...../...../#...#/#...#/#...#/#...#/.####",
  v: "...../...../#...#/#...#/#...#/.#.#./..#..",
  w: "...../...../#...#/#...#/#.#.#/#.#.#/.#.#.",
  x: "...../...../#...#/.#.#./..#../.#.#./#...#",
  y: "...../...../#...#/#...#/#...#/#...#/.####/....#/.###.",
  z: "...../...../#####/...#./..#../.#.../#####",
  "0": ".###./#...#/#..##/#.#.#/##..#/#...#/.###.",
  "1": "..#../.##../..#../..#../..#../..#../.###.",
  "2": ".###./#...#/....#/...#./..#../.#.../#####",
  "3": "####./....#/....#/.###./....#/....#/####.",
  "4": "...#./..##./.#.#./#..#./#####/...#./...#.",
  "5": "#####/#..../####./....#/....#/#...#/.###.",
  "6": ".###./#..../#..../####./#...#/#...#/.###.",
  "7": "#####/....#/...#./..#../.#.../.#.../.#...",
  "8": ".###./#...#/#...#/.###./#...#/#...#/.###.",
  "9": ".###./#...#/#...#/.####/....#/....#/.###.",
  ".": "./././././././#",
  ",": "../../../../../../.#/#.",
  ":": "././#/./././#",
  ";": "../../.#/../../../.#/#.",
  "!": "#/#/#/#/#/./#",
  "?": ".###./#...#/....#/...#./..#../...../..#..",
  "'": "#/#/././././.",
  '"': "#.#/#.#/.../.../.../.../...",
  "-": ".../.../.../###/.../.../...",
  "–": "..../..../..../####/..../..../....",
  "(": ".#/#./#./#./#./#./.#",
  ")": "#./.#/.#/.#/.#/.#/#.",
  "%": "##.../##..#/...#./..#../.#.../#..##/...##",
  "/": "....#/...#./...#./..#../.#.../.#.../#....",
  "+": "...../..#../..#../#####/..#../..#../.....",
  "&": ".##../#..#./#.#../.#.../#.#.#/#..#./.##.#",
  "°": ".#./#.#/.#./.../.../.../...",
};

/** Characters typography has that the font draws as their plain twins. */
const PLAIN: Readonly<Record<string, string>> = {
  "’": "'",
  "‘": "'",
  "“": '"',
  "”": '"',
  "—": "–",
  "…": "...",
};

export interface Glyph {
  width: number;
  /** Ink, row by row: `rows[r][c]` true where the pixel is inked. */
  rows: readonly (readonly boolean[])[];
}

/** How a pixel font is cut: its glyphs, and how they sit and are spaced. */
export interface FontCut {
  glyphs: Readonly<Record<string, string>>;
  /** Rows of a glyph, above and below the baseline. */
  rows: number;
  /** Blank columns between letters, and the width of a space. */
  spacing: number;
  space: number;
}

/** A pixel font: glyphs of `#` and `.` rows, drawn, measured and wrapped. */
export class PixelFont {
  private readonly parsed = new Map<string, Glyph>();

  constructor(readonly cut: FontCut) {}

  /** Rows of a glyph, above and below the baseline. */
  get rows(): number {
    return this.cut.rows;
  }

  /** The glyph of one character; an unknown one is drawn as `?`. */
  glyph(character: string): Glyph {
    const known = this.parsed.get(character);
    if (known !== undefined) return known;
    if (character === " ") return { width: this.cut.space, rows: [] };
    const { glyphs, rows: height } = this.cut;
    const source = glyphs[character] ?? glyphs["?"] ?? "";
    const lines = source.split("/");
    const width = Math.max(...lines.map((line) => line.length));
    const rows = Array.from({ length: height }, (_, r) =>
      Array.from({ length: width }, (_, c) => lines[r]?.[c] === "#"),
    );
    const made = { width, rows };
    this.parsed.set(character, made);
    return made;
  }

  /** Art pixels `text` is wide, letters spaced as `draw` spaces them. */
  measure(text: string): number {
    let width = 0;
    for (const character of plain(text)) width += this.glyph(character).width + this.cut.spacing;
    return Math.max(width - this.cut.spacing, 0);
  }

  /**
   * `text` broken into lines no wider than `width` art pixels, at spaces where it can be;
   * the first `narrower` lines are `indent` pixels narrower (beside a drop cap).
   */
  wrap(text: string, width: number, indent = 0, narrower = 0): string[] {
    const lines: string[] = [];
    const room = (): number => (lines.length < narrower ? width - indent : width);
    let line = "";
    for (const word of plain(text)
      .split(/\s+/)
      .filter((part) => part !== "")) {
      const tried = line === "" ? word : `${line} ${word}`;
      if (this.measure(tried) <= room() || line === "") {
        line = tried;
      } else {
        lines.push(line);
        line = word;
      }
      // A word too long for a line alone is cut where it runs over.
      while (this.measure(line) > room()) {
        let cut = line.length - 1;
        while (cut > 1 && this.measure(line.slice(0, cut)) > room()) cut--;
        lines.push(line.slice(0, cut));
        line = line.slice(cut);
      }
    }
    if (line !== "") lines.push(line);
    return lines;
  }

  /**
   * Ink `text` with its top-left at (x, y): `put` is called once per inked pixel. Returns
   * the width drawn.
   */
  draw(text: string, x: number, y: number, put: (x: number, y: number) => void): number {
    let left = x;
    for (const character of plain(text)) {
      const { width, rows } = this.glyph(character);
      rows.forEach((row, r) => {
        row.forEach((inked, c) => {
          if (inked) put(left + c, y + r);
        });
      });
      left += width + this.cut.spacing;
    }
    return Math.max(left - x - this.cut.spacing, 0);
  }
}

/** `text` in the characters the font has. */
export function plain(text: string): string {
  return [...text].map((character) => PLAIN[character] ?? character).join("");
}

/** The caption font: R3's, the name card's and the date's. */
export const CAPTION_FONT = new PixelFont({
  glyphs: GLYPHS,
  rows: GLYPH_ROWS,
  spacing: SPACING,
  space: SPACE,
});

/** The glyph of one character in the caption font; an unknown one is drawn as `?`. */
export function glyph(character: string): Glyph {
  return CAPTION_FONT.glyph(character);
}

/** Art pixels `text` is wide in the caption font. */
export function measure(text: string): number {
  return CAPTION_FONT.measure(text);
}

/** `text` broken into lines of the caption font no wider than `width` art pixels. */
export function wrap(text: string, width: number): string[] {
  return CAPTION_FONT.wrap(text, width);
}

/** Ink `text` in the caption font with its top-left at (x, y); returns the width drawn. */
export function draw(
  text: string,
  x: number,
  y: number,
  put: (x: number, y: number) => void,
): number {
  return CAPTION_FONT.draw(text, x, y, put);
}

/**
 * The scroll's hand (R5): the chronicle's entries in a larger cut of the same letters,
 * capitals and digits 9 art pixels tall, lower case 6 with ascenders to the capitals'
 * height and three rows of descenders, so that an entry reads from across the desk.
 */
export const HAND_GLYPHS: Readonly<Record<string, string>> = {
  A: "..##../.#..#./#....#/#....#/#....#/######/#....#/#....#/#....#",
  B: "#####./#....#/#....#/#....#/#####./#....#/#....#/#....#/#####.",
  C: ".####./#....#/#...../#...../#...../#...../#...../#....#/.####.",
  D: "####../#...#./#....#/#....#/#....#/#....#/#....#/#...#./####..",
  E: "#####/#..../#..../#..../####./#..../#..../#..../#####",
  F: "#####/#..../#..../#..../####./#..../#..../#..../#....",
  G: ".####./#....#/#...../#...../#..###/#....#/#....#/#....#/.####.",
  H: "#....#/#....#/#....#/#....#/######/#....#/#....#/#....#/#....#",
  I: "###/.#./.#./.#./.#./.#./.#./.#./###",
  J: "..###/...#./...#./...#./...#./...#./#..#./#..#./.##..",
  K: "#....#/#...#./#..#../#.#.../##..../#.#.../#..#../#...#./#....#",
  L: "#..../#..../#..../#..../#..../#..../#..../#..../#####",
  M: "#.....#/##...##/#.#.#.#/#..#..#/#.....#/#.....#/#.....#/#.....#/#.....#",
  N: "#....#/##...#/##...#/#.#..#/#.#..#/#..#.#/#..#.#/#...##/#....#",
  O: ".####./#....#/#....#/#....#/#....#/#....#/#....#/#....#/.####.",
  P: "#####./#....#/#....#/#....#/#####./#...../#...../#...../#.....",
  Q: ".####./#....#/#....#/#....#/#....#/#....#/#..#.#/#...#./.###.#",
  R: "#####./#....#/#....#/#....#/#####./#..#../#...#./#....#/#....#",
  S: ".####./#....#/#...../#...../.####./.....#/.....#/#....#/.####.",
  T: "#####/..#../..#../..#../..#../..#../..#../..#../..#..",
  U: "#....#/#....#/#....#/#....#/#....#/#....#/#....#/#....#/.####.",
  V: "#....#/#....#/#....#/#....#/#....#/.#..#./.#..#./..##../..##..",
  W: "#.....#/#.....#/#.....#/#.....#/#..#..#/#..#..#/#.#.#.#/##...##/#.....#",
  X: "#....#/#....#/.#..#./.#..#./..##../.#..#./.#..#./#....#/#....#",
  Y: "#...#/#...#/#...#/.#.#./..#../..#../..#../..#../..#..",
  Z: "######/.....#/....#./....#./...#../..#.../.#..../#...../######",
  a: "...../...../...../.###./....#/.####/#...#/#...#/.####",
  b: "#..../#..../#..../####./#...#/#...#/#...#/#...#/####.",
  c: "...../...../...../.###./#...#/#..../#..../#...#/.###.",
  d: "....#/....#/....#/.####/#...#/#...#/#...#/#...#/.####",
  e: "...../...../...../.###./#...#/#####/#..../#...#/.###.",
  f: "..##/.#../.#../####/.#../.#../.#../.#../.#..",
  g: "...../...../...../.####/#...#/#...#/#...#/#...#/.####/....#/#...#/.###.",
  h: "#..../#..../#..../####./#...#/#...#/#...#/#...#/#...#",
  i: "./#/./#/#/#/#/#/#",
  j: ".../..#/.../..#/..#/..#/..#/..#/..#/..#/##.",
  k: "#..../#..../#..../#...#/#..#./###../#.#../#..#./#...#",
  l: "#./#./#./#./#./#./#./#./.#",
  m: "......./......./......./######./#..#..#/#..#..#/#..#..#/#..#..#/#..#..#",
  n: "...../...../...../####./#...#/#...#/#...#/#...#/#...#",
  o: "...../...../...../.###./#...#/#...#/#...#/#...#/.###.",
  p: "...../...../...../####./#...#/#...#/#...#/#...#/####./#..../#..../#....",
  q: "...../...../...../.####/#...#/#...#/#...#/#...#/.####/....#/....#/....#",
  r: "..../..../..../#.##/##../#.../#.../#.../#...",
  s: "...../...../...../.####/#..../.###./....#/....#/####.",
  t: "..../.#../.#../###./.#../.#../.#../.#../..##",
  u: "...../...../...../#...#/#...#/#...#/#...#/#...#/.####",
  v: "...../...../...../#...#/#...#/#...#/.#.#./.#.#./..#..",
  w: "......./......./......./#.....#/#.....#/#..#..#/#..#..#/#.#.#.#/.#...#.",
  x: "...../...../...../#...#/.#.#./..#../..#../.#.#./#...#",
  y: "...../...../...../#...#/#...#/#...#/#...#/#...#/.####/....#/#...#/.###.",
  z: "...../...../...../#####/...#./..#../.#.../#..../#####",
  "0": ".###./#...#/#...#/#..##/#.#.#/##..#/#...#/#...#/.###.",
  "1": "..#../.##../#.#../..#../..#../..#../..#../..#../#####",
  "2": ".###./#...#/....#/....#/...#./..#../.#.../#..../#####",
  "3": ".###./#...#/....#/....#/..##./....#/....#/#...#/.###.",
  "4": "...#./..##./.#.#./#..#./#..#./#####/...#./...#./...#.",
  "5": "#####/#..../#..../####./....#/....#/....#/#...#/.###.",
  "6": ".###./#...#/#..../#..../####./#...#/#...#/#...#/.###.",
  "7": "#####/....#/....#/...#./...#./..#../..#../..#../..#..",
  "8": ".###./#...#/#...#/#...#/.###./#...#/#...#/#...#/.###.",
  "9": ".###./#...#/#...#/#...#/.####/....#/....#/#...#/.###.",
  ".": "././././././././#",
  ",": "../../../../../../../../.#/#.",
  ":": "././././#/./././#",
  ";": "../../../../.#/../../../.#/#.",
  "!": "#/#/#/#/#/#/#/./#",
  "?": ".###./#...#/....#/....#/...#./..#../..#../...../..#..",
  "'": "#/#/././././././.",
  '"': "#.#/#.#/.../.../.../.../.../.../...",
  "-": "..../..../..../..../..../####/..../..../....",
  "–": "...../...../...../...../...../#####/...../...../.....",
  "(": ".#/#./#./#./#./#./#./#./.#",
  ")": "#./.#/.#/.#/.#/.#/.#/.#/#.",
  "%": "##.../##..#/...#./...#./..#../.#.../.#.../#..##/...##",
  "/": "....#/....#/...#./...#./..#../.#.../.#.../#..../#....",
  "+": "...../...../...../..#../..#../#####/..#../..#../.....",
  "&": ".##../#..#./#..#./.##../.#.../#.#.#/#..#./#..#./.##.#",
  "°": ".#./#.#/.#./.../.../.../.../.../...",
};

/** Rows of a glyph of the hand: 9 above the baseline, 3 below it. */
export const HAND_ROWS = 12;
/** Rows from the top to the hand's baseline (the capitals' height). */
export const HAND_BASELINE = 9;
/** Blank columns between the hand's letters, and the width of its space. */
const HAND_SPACING = 1;
const HAND_SPACE = 4;

/** The scroll's hand: the chronicle's entries. */
export const HAND_FONT = new PixelFont({
  glyphs: HAND_GLYPHS,
  rows: HAND_ROWS,
  spacing: HAND_SPACING,
  space: HAND_SPACE,
});
