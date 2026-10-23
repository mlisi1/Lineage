/**
 * The illuminated scroll (R5, the owner's choice, 2026-10-23): what makes the chronicle's
 * scroll (`captions.ts`) more than a line of text. Each entry opens with a small pixel
 * icon for the kind of event it tells of (`ICON_OF_KIND`, from the chronicle's `kind` on
 * the wire) and an illuminated first letter two lines tall (`paintInitial`), and its date
 * is lettered on a ribbon (`paintRibbon`).
 *
 * The icons are hand-made bitmaps, 15 art pixels square, rows top first: a letter is a
 * colour of `ICON_COLOURS`, `.` the paper. They are in the cosy palette, lit from the upper
 * left as the scene, and outlined in the scroll's ink. Everything here paints through a
 * `put` callback, so it is pure and as cheap as the scroll: painted once per entry and per
 * lantern step.
 */
import { blend } from "./creatures/body";
import { GOLD, PLUM } from "./palette";
import { BASELINE, CAPTION_FONT, HAND_BASELINE, HAND_FONT } from "./pixelfont";

/** Paint one art pixel of a picture; the painter clips it. */
export type Put = (x: number, y: number, colour: number) => void;

// --- Icons ---------------------------------------------------------------------------

/** Art pixels an icon is across and down. */
export const ICON_SIZE = 15;

/** The icons' colours (0xRRGGBB), by the letter that stands for each in the bitmaps. */
export const ICON_COLOURS: Readonly<Record<string, number>> = {
  /** Outlines: the scroll's ink. */
  k: 0x5a3424,
  /** Sunlit white. */
  w: 0xfff1b8,
  /** Bone and eggshell. */
  b: 0xe0cfa0,
  /** Bone in shade. */
  B: 0xb09a70,
  /** Lit stone. */
  S: 0xd8d0c4,
  /** Stone. */
  s: 0xa8a098,
  /** Stone in shade. */
  t: 0x7a7068,
  /** Lit leaves. */
  L: 0xb8e86a,
  /** Leaves. */
  g: 0x6fb03a,
  /** Leaves in shade. */
  G: 0x3f7a2a,
  /** Lit gold, and the hottest flame. */
  Y: 0xffe08a,
  /** Gold. */
  y: 0xf2c641,
  /** Gold in shade. */
  O: 0xc0862a,
  /** Flame orange. */
  o: 0xf0a030,
  /** Flame red, and the arrow's. */
  r: 0xd0603a,
  /** Deep red. */
  R: 0x8a3424,
  /** Lit water. */
  a: 0xa8d8f0,
  /** Water. */
  u: 0x4f8fd0,
  /** Deep water. */
  U: 0x2b4a7a,
  /** Lit wood and earth. */
  n: 0xe0b070,
  /** Wood and earth. */
  c: 0xc48e52,
  /** Wood and earth in shade. */
  C: 0x8c5634,
  /** Lit pink. */
  p: 0xffb0b0,
  /** Heart red, and icing. */
  h: 0xe85a6a,
  /** Heart red in shade. */
  H: 0xa83040,
  /** The night sea. */
  N: 0x2e2a5c,
  /** Glints on the night sea. */
  m: 0x5a56a0,
};

/** The icons, by name. */
export const ICONS = {
  /** An extinction: a skull. */
  skull: [
    "...............",
    "....kkkkkkk....",
    "...kwwwwwwbk...",
    "..kwwwwwwwwbk..",
    "..kwwwwwwwwbk..",
    "..kwkkkwkkkbk..",
    "..kwkkkwkkkbk..",
    "..kbwwwkwwwbk..",
    "..kbbwwwwwbbk..",
    "...kbbbbbbbk...",
    "....kwkwkwk....",
    "....kbkbkbk....",
    ".....kkkkk.....",
    "...............",
    "...............",
  ],
  /** The last creature on the island: a gravestone on the grass. */
  grave: [
    "...............",
    ".....kkkkk.....",
    "....kSSSSsk....",
    "...kSSSSSssk...",
    "...kSSkSkssk...",
    "...kSkkkkksk...",
    "...kSSkSkssk...",
    "...kSSkSkssk...",
    "...kSSSSSssk...",
    "...kSSSSssstk..",
    "...kSssssstk...",
    "..kkkkkkkkkkk..",
    ".kgLgLgkGgGgGk.",
    "..kkkkkkkkkkk..",
    "...............",
  ],
  /** A new species branched off: a seedling of two leaves. */
  sprout: [
    "...............",
    "..........kkk..",
    ".kkk.....kLLgk.",
    "kLLgk...kLggGk.",
    "kLggGk.kLggGk..",
    ".kgggGkkgGGk...",
    "..kGGGkgGkk....",
    "...kkkkgk......",
    "......kgk......",
    "......kgk......",
    "....kkkgkkk....",
    "...kCcccccCk...",
    "..kCCccccCCCk..",
    "..kkkkkkkkkkk..",
    "...............",
  ],
  /** The first life on the island: an egg, cracking. */
  egg: [
    "...............",
    "......kkk......",
    ".....kwwbk.....",
    "....kwwwbBk....",
    "...kwwwwbbBk...",
    "...kwwwwbbBk...",
    "..kwwwbbbbbBk..",
    "..kkwkkbkkbkk..",
    "..kbkbbkbbkBk..",
    "..kbbbbbbbBBk..",
    "..kbbbbbbBBBk..",
    "...kbbbBBBBk...",
    "....kBBBBBk....",
    ".....kkkkk.....",
    "...............",
  ],
  /** A first (hunters, swimmers, a forest, a rare gene, a fire): a medal on its ribbon. */
  medal: [
    "..kkk.....kkk..",
    "..khhk...kuuk..",
    "...khhk.kuuk...",
    "....khhkuuk....",
    ".....khkuk.....",
    ".....kkkkk.....",
    "....kYYYyOk....",
    "...kYYwYyyOk...",
    "..kYYyyYyyyOk..",
    "..kYyYYYYYyOk..",
    "..kYyyYYYyyOk..",
    "..kYyYyyyYyOk..",
    "...kyyyyyyOk...",
    "....kOOOOOk....",
    ".....kkkkk.....",
  ],
  /** A god power, at the owner's call: the sun. */
  sun: [
    ".......y.......",
    "...y...Y...y...",
    "....y..y..y....",
    ".....kkkkk.....",
    "....kYYYYyk....",
    ".y.kYYwYYyyk.y.",
    "..kYYwwYyyyOk..",
    "yYkYYYYyyyyOkYy",
    "..kYYYyyyyyOk..",
    ".y.kYyyyyyOk.y.",
    "....kyyyyOOk...",
    ".....kkkkk.....",
    "....y..y..y....",
    "...y...Y...y...",
    ".......y.......",
  ],
  /** A volcano: a cone with lava running down it. */
  volcano: [
    "......o.r......",
    ".....r.o.R.....",
    "......kkk......",
    ".....korok.....",
    "....kCkokCk....",
    "....kCrorCCk...",
    "...kcCrorCCk...",
    "...kcccrCCCCk..",
    "..kccrcCrCCCk..",
    "..kcccccrCCCCk.",
    ".kcccccCCCrCCk.",
    ".knccccCCCCCCk.",
    "kkkkkkkkkkkkkkk",
    ".uuuuuuuuuuuuu.",
    "...............",
  ],
  /** A fire: a flame. */
  flame: [
    ".......k.......",
    "......kok......",
    "......kok......",
    ".....kYok.k....",
    "....kYYorkok...",
    "...kYYwYorrk...",
    "...kYwwYYork...",
    "..kYYwYYYyork..",
    "..kYwwYyYyork..",
    "..kYwwYyyyork..",
    "..kYYwYyyorrk..",
    "..kryYYyyorRk..",
    "...kryyyorRk...",
    "....kkkkkkk....",
    "...............",
  ],
  /** An earthquake: the ground broken, one side fallen, shaking. */
  crack: [
    "...............",
    "...............",
    ".k.....k.....k.",
    "k.k...k.k...k.k",
    "...............",
    ".kkkkkkk.......",
    "kLgLgggk.kkkkkk",
    "kgggGGGkkLgggGk",
    "kcccCCkkkgGGGGk",
    "kcccCkk.kcccCCk",
    "kCCCCk..kccCCCk",
    "kCCCCk.kkCCCCCk",
    "kkkkkk.kkkkkkkk",
    "...............",
    "...............",
  ],
  /** A meteor: a rock falling in a streak of fire. */
  meteor: [
    "...............",
    "...........Yy..",
    ".........Y.....",
    ".......YYo..y..",
    ".....YYoor.....",
    "...YYoorrk.....",
    "..Yoorrkkkkk...",
    "..oorrkYYYyOk..",
    "...rr.kYwwyyOk.",
    "......kYwwyyOk.",
    "......kYyyyyOk.",
    "......kyyyyOOk.",
    ".......kyyOOk..",
    "........kkkk...",
    "...............",
  ],
  /** The sea cut the land: two islands with the sea between. */
  split: [
    "...............",
    ".kkkkk...kkkkk.",
    "kLgggGk.kgggGGk",
    "kgggGGk.kggGGGk",
    "kcCCCCk.kCCCCCk",
    ".kCCCk...kCCCk.",
    "..kkk.....kkk..",
    "...............",
    ".....k...k.....",
    ".uu.kau.kau.uu.",
    "uUUuuUUuuUUuuUU",
    "...............",
    ".uu..uu..uu..uu",
    "uUUuuUUuuUUuuUU",
    "...............",
  ],
  /** A strait closed: a land bridge over the sea. */
  bridge: [
    "...............",
    "...............",
    "..kkkkkkkkkkk..",
    ".kLgggggggggGk.",
    "kLggGkkkkkGgGGk",
    "kgGCk.....kCGGk",
    "kcCk.......kCCk",
    "kcCk.......kCCk",
    "kcCk.......kCCk",
    "kCCk.......kCCk",
    "kkkk.uu.uu.kkkk",
    ".uu.uUUuUUu.uu.",
    "uUUuu.....uuUUu",
    "...............",
    "...............",
  ],
  /** Strangers landed: a boat on the sea. */
  boat: [
    ".......k.......",
    ".......kk......",
    ".......kwk.....",
    ".......kwwk....",
    ".......kwwbk...",
    ".......kwwbBk..",
    ".......kwbbBBk.",
    ".......kkkkkkk.",
    ".......k.......",
    "kkkkkkkkkkkkkkk",
    "kncccccccccccCk",
    ".kccccccccCCCk.",
    "..kCCCCCCCCCk..",
    ".uukkkkkkkkkuu.",
    "uUUuuUUuuUUuuUU",
  ],
  /** A record: a crown. */
  crown: [
    "...............",
    "...............",
    ".k.....k.....k.",
    "kYk...kYk...kYk",
    "kYYk.kYYyk.kyOk",
    "kYYykYYyyykyyOk",
    "kYYyyyyyyyyyyOk",
    "kYyyyyyyyyyyyOk",
    "kYykkkykkkykyOk",
    "kYkhkykukykhkOk",
    "kYykkkykkkykyOk",
    "kyyyyyyyyyyyOOk",
    "kOOOOOOOOOOOOOk",
    "kkkkkkkkkkkkkkk",
    "...............",
  ],
  /** A species thrives: a heart. */
  heart: [
    "...............",
    "...............",
    "..kkkk...kkkk..",
    ".kpphhk.khhhHk.",
    "kpwphhhkhhhhHHk",
    "kpphhhhhhhhhHHk",
    "khhhhhhhhhhhHHk",
    "khhhhhhhhhhHHHk",
    ".khhhhhhhhhHHk.",
    "..khhhhhhhHHk..",
    "...khhhhhHHk...",
    "....khhhHHk....",
    ".....khHHk.....",
    "......kHk......",
    ".......k.......",
  ],
  /** A species dwindles: an arrow down. */
  down: [
    "...............",
    ".....kkkkk.....",
    ".....krrrRk....",
    ".....krrrRk....",
    ".....krrrRk....",
    ".....krrrRk....",
    ".....krrrRk....",
    ".kkkkkrrrRkkkk.",
    ".krrrrrrrrrrRk.",
    "..krrrrrrrrRk..",
    "...krrrrrrRk...",
    "....krrrrRk....",
    ".....krrRk.....",
    "......kRk......",
    ".......k.......",
  ],
  /** A species crossed to new land: footprints. */
  feet: [
    "...............",
    ".........k.k.k.",
    ".........kkkkk.",
    "........kcccCk.",
    "........kcccCk.",
    ".k.k.k...kCCk..",
    ".kkkkk....kk...",
    "kcccCk.........",
    "kcccCk...k.k.k.",
    ".kCCk....kkkkk.",
    "..kk....kcccCk.",
    "........kcccCk.",
    ".........kCCk..",
    "..........kk...",
    "...............",
  ],
  /** An anniversary: a cake with a candle. */
  cake: [
    ".......o.......",
    "......oYo......",
    "......kYk......",
    ".......k.......",
    "......kwk......",
    "......khk......",
    "..kkkkkhkkkkk..",
    ".kwwwwwwwwwwbk.",
    ".kphphphphphpk.",
    ".khwhphhhwhhHk.",
    ".kbwwwwbwwwbBk.",
    ".kbbbbbbbbbbBk.",
    ".kBBBBBBBBBBBk.",
    "kkkkkkkkkkkkkkk",
    "...............",
  ],
  /** A dark age (the owner long away): the moon. */
  moon: [
    "...............",
    ".......kkkk....",
    ".....kkwwbk....",
    "....kwwwbk.....",
    "...kwwwbk....y.",
    "...kwwbbk...yYy",
    "..kwwwbk.....y.",
    "..kwwwbk.......",
    "..kwwwbbk......",
    "..kbwwbbbk.....",
    "...kbbbbbBk..y.",
    "...kbbbbBBBkk..",
    "....kkBBBBBk...",
    "......kkkkk....",
    "...............",
  ],
  /** The sun returned after a dark age: a sunrise over the sea. */
  sunrise: [
    "...............",
    ".......y.......",
    "..y....Y....y..",
    "...y.......y...",
    ".......kk......",
    ".....kkYYkk....",
    "....kYYwYyyk...",
    ".y.kYYwYyyyOk.y",
    "...kYYYyyyyOk..",
    "..kYYyyyyyyyOk.",
    "kkkkkkkkkkkkkkk",
    ".aaaaaaaauuuuu.",
    "..uuuuUUuuuUU..",
    "....UUuuuuUU...",
    "...............",
  ],
  /** A world ends: a red sun setting over a dark sea. */
  sunset: [
    "...............",
    "...............",
    "....r.r.r.r....",
    ".....kkkkk.....",
    "....korrrRk....",
    "...korrrrrRk...",
    "..korrrrrrRRk..",
    "..kroorrrrRRk..",
    "kkkkkkkkkkkkkkk",
    ".NNmNNNNNmNNNN.",
    "..NNNNmNNNNNN..",
    ".NmNNNNNNNmNNN.",
    "...NNNNNNNNN...",
    "...............",
    "...............",
  ],
  /** A new world begins: an island rising from the sea. */
  island: [
    "...............",
    ".......L.......",
    ".....kLgL......",
    "......kgk.kk...",
    "....kk.k.kgLk..",
    "...kgLk.kgggGk.",
    "..kLggGkgggGGk.",
    "..kgggGGGgGGGk.",
    ".kcccccccCCCCCk",
    "kncccccccCCCCCk",
    "kkkkkkkkkkkkkkk",
    ".aauuuuuuuuuaa.",
    "uUUuuUUuuUUuuUU",
    "...............",
    "...............",
  ],
  /** A season turns: a leaf. */
  leaf: [
    "...............",
    "..........kkkk.",
    ".......kkkLLgk.",
    ".....kkLLLLggk.",
    "....kLLLLLgggk.",
    "...kLLLLggggGk.",
    "...kLLLggggGGk.",
    "..kLLggggGGGk..",
    "..kLggggGGGk...",
    "..kgggGGGkk....",
    "..kggkkkk......",
    ".kkkk..........",
    ".k.............",
    "k..............",
    "...............",
  ],
  /** Any other entry: a quill. */
  quill: [
    "...............",
    ".......kk......",
    "......kSSk.....",
    ".....kwSSk.....",
    "....kwSSk......",
    "...kSwSSk......",
    "...kSSSk.......",
    "..kSSSk........",
    "..kSSk.........",
    "..kSk..........",
    ".kRk...........",
    ".kk............",
    "...............",
    "...............",
    "...............",
  ],
} as const satisfies Readonly<Record<string, readonly string[]>>;
export type IconName = keyof typeof ICONS;

/**
 * The icon of each kind of entry the chronicle writes (`lineage_sim.chronicle.Kind`). A
 * god power has one icon whatever the power, the sun of the owner's presence; a first has
 * one whatever came first. A kind not listed here gets `FALLBACK_ICON`.
 */
export const ICON_OF_KIND: Readonly<Record<string, IconName>> = {
  first_life: "egg",
  last_creature: "grave",
  world_end: "sunset",
  world_begin: "island",
  first: "medal",
  arrival: "boat",
  speciation: "sprout",
  extinction: "skull",
  record: "crown",
  boom: "heart",
  crash: "down",
  migration: "feet",
  split: "split",
  rejoin: "bridge",
  fire: "flame",
  volcano: "volcano",
  earthquake: "crack",
  meteor: "meteor",
  god_power: "sun",
  anniversary: "cake",
  dark_age: "moon",
  dawn: "sunrise",
  season: "leaf",
};

/** The icon of an entry of a kind the renderer does not know: a quill, writing. */
export const FALLBACK_ICON: IconName = "quill";

/** The icon an entry of `kind` opens with. */
export function iconOf(kind: string): IconName {
  return Object.hasOwn(ICON_OF_KIND, kind) ? (ICON_OF_KIND[kind] ?? FALLBACK_ICON) : FALLBACK_ICON;
}

/** Paint icon `name` with its top-left at (x, y). */
export function paintIcon(name: IconName, x: number, y: number, put: Put): void {
  ICONS[name].forEach((row, r) => {
    [...row].forEach((key, c) => {
      const colour = ICON_COLOURS[key];
      if (colour !== undefined) put(x + c, y + r, colour);
    });
  });
}

// --- The illuminated initial ---------------------------------------------------------

/** The initial's letter is the hand's, drawn this many times larger: 18 art pixels tall. */
export const INITIAL_SCALE = 2;
/** Art pixels of the initial's frame, and of the fill between the frame and the letter. */
const INITIAL_FRAME = 1;
const INITIAL_PAD = 2;
/** An entry that opens with a number longer than this has no initial (digits). */
export const INITIAL_MOST_DIGITS = 3;
/** Art pixels between the digits of a number's initial. */
const INITIAL_DIGIT_GAP = 2;
/**
 * The ink of the initial of an entry that names no species: vermilion, as the capitals of
 * old books.
 */
export const VERMILION = 0xb8402e;
/**
 * A species' colour lighter than this (luma, 0–1) is darkened toward plum for its initial,
 * so that the letter knocked out of it in paper still reads; one darker than the next is
 * lightened toward gold, so that its frame of ink still shows.
 */
const LIGHTEST_FILL = 0.5;
const DARKEST_FILL = 0.18;
/** How far the fill's lit edge (top, left) goes toward gold, and its shaded edge toward plum. */
const INITIAL_LIT = 0.35;
const INITIAL_SHADE = 0.35;
/** How far the letter's shadow on the fill (down and right of it) goes toward plum. */
const LETTER_SHADOW = 0.5;
/** Steps toward plum or gold that a species' colour may take for its initial, and how far each goes. */
const FILL_STEPS = 8;
const FILL_STEP = 0.2;
/** The letter's pixels are kept by `y * KEY_STRIDE + x`: wider than any scroll. */
const KEY_STRIDE = 4096;
/** The gold of the initial's corners: a small flourish. */
const INITIAL_GOLD = 0xf2c641;

/** Art pixels the initial is tall: two lines of the hand, its frame a row below the second's capitals. */
export function initialHeight(): number {
  return 2 * INITIAL_FRAME + 2 * INITIAL_PAD + INITIAL_SCALE * HAND_BASELINE;
}

/**
 * An entry's text parted into its initial and the rest: the first letter, or a number of
 * at most `INITIAL_MOST_DIGITS` digits it opens with; an empty initial if it opens with
 * anything else.
 */
export function splitInitial(text: string): { initial: string; rest: string } {
  const trimmed = text.trimStart();
  const digits = /^\d+/.exec(trimmed)?.[0] ?? "";
  if (digits.length > 0) {
    return digits.length <= INITIAL_MOST_DIGITS
      ? { initial: digits, rest: trimmed.slice(digits.length) }
      : { initial: "", rest: trimmed };
  }
  const first = trimmed[0] ?? "";
  return /[A-Za-z]/.test(first)
    ? { initial: first.toUpperCase(), rest: trimmed.slice(1) }
    : { initial: "", rest: trimmed };
}

/** Art pixels the initial `initial` is across (0 for none). */
export function initialWidth(initial: string): number {
  if (initial === "") return 0;
  let letters = 0;
  for (const character of initial) letters += HAND_FONT.glyph(character).width * INITIAL_SCALE;
  letters += (initial.length - 1) * INITIAL_DIGIT_GAP;
  return 2 * INITIAL_FRAME + 2 * INITIAL_PAD + letters;
}

function luma(colour: number): number {
  const r = (colour >> 16) & 255;
  const g = (colour >> 8) & 255;
  const b = colour & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
}

/** The fill of an initial in `colour` (0xRRGGBB): kept between the lightest and darkest that read. */
export function initialFill(colour: number): number {
  let fill = colour;
  // A few steps toward plum or gold: enough for any colour the herd draws.
  for (let step = 0; step < FILL_STEPS && luma(fill) > LIGHTEST_FILL; step++) {
    fill = blend(fill, PLUM, FILL_STEP);
  }
  for (let step = 0; step < FILL_STEPS && luma(fill) < DARKEST_FILL; step++) {
    fill = blend(fill, GOLD, FILL_STEP);
  }
  return fill;
}

/**
 * Paint the initial `initial` with its top-left at (x, y): a square of `colour` (the
 * species', or vermilion) framed in `ink`, lit at its top and left and shaded at its
 * bottom and right, the letter knocked out of it in `paper` with a shadow, and a gold stud
 * at each corner.
 */
export function paintInitial(
  initial: string,
  colour: number,
  x: number,
  y: number,
  ink: number,
  paper: number,
  put: Put,
): void {
  const width = initialWidth(initial);
  if (width === 0) return;
  const height = initialHeight();
  const fill = initialFill(colour);
  const lit = blend(fill, GOLD, INITIAL_LIT);
  const shade = blend(fill, PLUM, INITIAL_SHADE);
  const shadow = blend(fill, PLUM, LETTER_SHADOW);
  // The letter's pixels, so that its shadow can fall where it is not.
  const letter = new Set<number>();
  let left = x + INITIAL_FRAME + INITIAL_PAD;
  const top = y + INITIAL_FRAME + INITIAL_PAD;
  for (const character of initial) {
    const glyph = HAND_FONT.glyph(character);
    glyph.rows.forEach((row, r) => {
      row.forEach((inked, c) => {
        if (!inked) return;
        for (let dy = 0; dy < INITIAL_SCALE; dy++) {
          for (let dx = 0; dx < INITIAL_SCALE; dx++) {
            letter.add((top + r * INITIAL_SCALE + dy) * KEY_STRIDE + left + c * INITIAL_SCALE + dx);
          }
        }
      });
    });
    left += glyph.width * INITIAL_SCALE + INITIAL_DIGIT_GAP;
  }
  const right = x + width - 1;
  const bottom = y + height - 1;
  for (let py = y; py <= bottom; py++) {
    for (let px = x; px <= right; px++) {
      const corner = (px === x || px === right) && (py === y || py === bottom);
      const frame = px === x || px === right || py === y || py === bottom;
      let paint: number;
      if (corner) paint = INITIAL_GOLD;
      else if (frame) paint = ink;
      else if (letter.has(py * KEY_STRIDE + px)) paint = paper;
      else if (letter.has((py - 1) * KEY_STRIDE + px - 1)) paint = shadow;
      else if (py === y + INITIAL_FRAME || px === x + INITIAL_FRAME) paint = lit;
      else if (py === bottom - INITIAL_FRAME || px === right - INITIAL_FRAME) paint = shade;
      else paint = fill;
      put(px, py, paint);
    }
  }
  // The flourish: a gold pixel inside each corner, diagonal from its stud.
  put(x + INITIAL_FRAME, y + INITIAL_FRAME, INITIAL_GOLD);
  put(right - INITIAL_FRAME, y + INITIAL_FRAME, INITIAL_GOLD);
  put(x + INITIAL_FRAME, bottom - INITIAL_FRAME, INITIAL_GOLD);
  put(right - INITIAL_FRAME, bottom - INITIAL_FRAME, INITIAL_GOLD);
}

// --- The date's ribbon ---------------------------------------------------------------

/** The ribbon's reds: lit, the band, its shade, and the tails folded behind it. */
export const RIBBON_LIT = 0xd8664a;
export const RIBBON = 0xb84a3a;
export const RIBBON_SHADE = 0x8a3024;
export const RIBBON_TAIL = 0x6e2620;
/** The ribbon's lettering: warm white, as the scene's small lit marks. */
export const RIBBON_LETTERS = 0xfff1b8;
/** Art pixels of the band's frame of ink, and of the band round its letters: across at each end, and the rows above and below. */
const RIBBON_FRAME = 1;
const RIBBON_PAD_X = 4;
const RIBBON_PAD_Y = 2;
/** Art pixels the notch at the end of each tail is cut in. */
const NOTCH_DEPTH = 2;
/** The tails: art pixels each shows beyond the band, and how far they hang below its top. */
const TAIL_OUT = 5;
const TAIL_DROP = 2;

/** Art pixels the ribbon is tall: its frame, its padding and a line of capitals. */
export function ribbonHeight(): number {
  return 2 * RIBBON_FRAME + 2 * RIBBON_PAD_Y + BASELINE;
}

/** Art pixels the ribbon of `date` is across, tails and all. */
export function ribbonWidth(date: string): number {
  return CAPTION_FONT.measure(date) + 2 * (RIBBON_PAD_X + RIBBON_FRAME + TAIL_OUT);
}

/**
 * Paint the ribbon lettered with `date` (in capitals: the caption font's capitals have no
 * descenders) with its top-left at (x, y): a red band framed in `ink`, lit along its top,
 * with a tail folded behind it at each end, cut in a notch.
 */
export function paintRibbon(date: string, x: number, y: number, ink: number, put: Put): void {
  const width = ribbonWidth(date);
  const height = ribbonHeight();
  const bandLeft = x + TAIL_OUT;
  const bandRight = x + width - 1 - TAIL_OUT;
  const bottom = y + height - 1;
  // The tails first, behind the band: lower by `TAIL_DROP`, each with a notch at its end.
  const middle = y + TAIL_DROP + Math.floor((height - 1) / 2);
  for (const [from, to, outer] of [
    [x, bandLeft + RIBBON_FRAME, x],
    [bandRight - RIBBON_FRAME, x + width - 1, x + width - 1],
  ] as const) {
    for (let px = from; px <= to; px++) {
      // The notch: a V cut into the outer end, its sides inked.
      const depth = Math.abs(px - outer);
      for (let py = y + TAIL_DROP; py <= bottom + TAIL_DROP; py++) {
        const off = Math.abs(py - middle);
        if (depth < NOTCH_DEPTH && off < NOTCH_DEPTH - depth) continue;
        const edge =
          py === y + TAIL_DROP ||
          py === bottom + TAIL_DROP ||
          px === outer ||
          (depth <= NOTCH_DEPTH && off === NOTCH_DEPTH - depth);
        put(px, py, edge ? ink : RIBBON_TAIL);
      }
    }
  }
  // The band over them.
  for (let py = y; py <= bottom; py++) {
    for (let px = bandLeft; px <= bandRight; px++) {
      const frame = py === y || py === bottom || px === bandLeft || px === bandRight;
      const colour = frame
        ? ink
        : py === y + RIBBON_FRAME
          ? RIBBON_LIT
          : py === bottom - RIBBON_FRAME
            ? RIBBON_SHADE
            : RIBBON;
      put(px, py, colour);
    }
  }
  CAPTION_FONT.draw(
    date,
    bandLeft + RIBBON_FRAME + RIBBON_PAD_X,
    y + RIBBON_FRAME + RIBBON_PAD_Y,
    (px, py) => put(px, py, RIBBON_LETTERS),
  );
}
