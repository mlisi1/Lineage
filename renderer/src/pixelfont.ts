/**
 * A pixel font for captions (R3): capitals and digits 7 art pixels tall, lower case with
 * ascenders and two rows of descenders, drawn a pixel at a time so that text keeps the
 * scene's hard edges at any whole-number scale, and looks the same on every machine
 * (a system font, shrunk to art pixels, would smear and differ from one browser to the
 * next). Glyphs are rows of `#` (ink) and `.` (paper), top row first.
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

const parsed = new Map<string, Glyph>();

/** The glyph of one character; an unknown one is drawn as `?`. */
export function glyph(character: string): Glyph {
  const known = parsed.get(character);
  if (known !== undefined) return known;
  if (character === " ") return { width: SPACE, rows: [] };
  const source = GLYPHS[character] ?? GLYPHS["?"] ?? "";
  const lines = source.split("/");
  const width = Math.max(...lines.map((line) => line.length));
  const rows = Array.from({ length: GLYPH_ROWS }, (_, r) =>
    Array.from({ length: width }, (_, c) => lines[r]?.[c] === "#"),
  );
  const made = { width, rows };
  parsed.set(character, made);
  return made;
}

/** `text` in the characters the font has. */
export function plain(text: string): string {
  return [...text].map((character) => PLAIN[character] ?? character).join("");
}

/** Art pixels `text` is wide, letters spaced as `draw` spaces them. */
export function measure(text: string): number {
  let width = 0;
  for (const character of plain(text)) width += glyph(character).width + SPACING;
  return Math.max(width - SPACING, 0);
}

/** `text` broken into lines no wider than `width` art pixels, at spaces where it can be. */
export function wrap(text: string, width: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of plain(text)
    .split(/\s+/)
    .filter((part) => part !== "")) {
    const tried = line === "" ? word : `${line} ${word}`;
    if (measure(tried) <= width || line === "") {
      line = tried;
    } else {
      lines.push(line);
      line = word;
    }
    // A word too long for a line alone is cut where it runs over.
    while (measure(line) > width) {
      let cut = line.length - 1;
      while (cut > 1 && measure(line.slice(0, cut)) > width) cut--;
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
export function draw(
  text: string,
  x: number,
  y: number,
  put: (x: number, y: number) => void,
): number {
  let left = x;
  for (const character of plain(text)) {
    const { width, rows } = glyph(character);
    rows.forEach((row, r) => {
      row.forEach((inked, c) => {
        if (inked) put(left + c, y + r);
      });
    });
    left += width + SPACING;
  }
  return Math.max(left - x - SPACING, 0);
}
