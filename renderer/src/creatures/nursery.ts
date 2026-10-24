/**
 * A birth (R5, the owner's second animation): the stream says to whom each newborn was
 * born (`born` entries with `parent`, the mother). The newborn comes into being beside its
 * mother's head, facing her; she stands over it and lowers her head to it twice, and a few
 * small hearts rise from between them. A mother of a large brood (her BROOD gene) lays: the
 * young one is first an egg that rocks, cracks and opens, the shell's bits thrown off, and
 * the newborn is there in its place.
 *
 * Everything here is a pooled sprite placed afresh each frame (`SpritePool`), at the art
 * pixels of the view; the textures are made once for each size and kept for the page's life.
 */
import { CanvasSource, Container, Rectangle, Texture } from "pixi.js";
import { placeCentred, SpritePool } from "../atmosphere/particles";
import { cellHash } from "../terrain/pixels";
import type { Point } from "./chain";

/** Seconds the mother stands over her newborn once it is there. */
export const MOMENT_S = 2.6;
/** Seconds a newborn takes to come into being beside her, and one out of an egg. */
export const NEWBORN_S = 0.6;
export const HATCH_S = 0.25;
/** Seconds an egg lies before it opens. */
export const EGG_S = 1.6;
/** Mothers whose broods are at least this large (young to a brood) lay eggs. */
export const EGG_BROOD = 3;
/** The newborn's head lies this far (cells) beyond where the mother's head and its own meet. */
export const BESIDE_GAP = 0.12;
/**
 * The places tried for it round her head (radians from the way she faces): ahead first,
 * then more and more to either side.
 */
export const BESIDE_ANGLES = [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8] as const;
/** She lowers her head this many body spacings toward it, once in so many seconds. */
export const NUZZLE_REACH = 0.7;
export const NUZZLE_S = 1.3;

/** Hearts: how many, seconds between them, how long each rises and how far (art pixels). */
const HEARTS = 3;
const HEART_EVERY_S = 0.45;
const HEART_S = 1.3;
const HEART_RISE_PX = 14;
/** Hearts start this many art pixels above the place between them, a little to either side. */
const HEART_ABOVE_PX = 4;
const HEART_SPREAD_PX = 5;
/** A heart sways by one art pixel this many times a second, and blinks out over its last share. */
const HEART_SWAYS_PER_S = 2;
const HEART_BLINK_SHARE = 0.25;
/** The heart, in art pixels: outline (o), pink (p), its glint (w). */
const HEART = [".oo.oo.", "opwpppo", "opppppo", ".opppo.", "..opo..", "...o..."] as const;
const HEART_COLOURS = { o: "#6b2a3a", p: "#e8607a", w: "#ffd6de" } as const;

/** An egg is this share of the newborn's length across, at least so many art pixels, and taller than wide. */
const EGG_SHARE = 0.9;
const EGG_LEAST_PX = 5;
const EGG_TALL = 1.3;
/** It rocks by an art pixel at these times into its wait (seconds, from and to). */
const ROCKS: readonly (readonly [number, number])[] = [
  [0.35, 0.6],
  [0.95, 1.25],
];
/** Seconds between the rocks' sideways steps. */
const ROCK_STEP_S = 0.07;
/** A crack shows over this last share of its wait. */
const CRACKED_SHARE = 0.4;
/**
 * At the hatch its shell comes apart over this many seconds, fading in steps: the top is
 * lifted off to one side by so many art pixels, the bottom slides away to the other.
 */
const SPLIT_S = 0.45;
const SPLIT_STEPS = 3;
const TOP_LIFT_PX = 6;
const APART_PX = 4;
/** Bits of shell thrown off at the hatch: how many, seconds they fly, art pixels thrown. */
const BITS = 6;
const BITS_S = 0.5;
const BITS_THROW_PX = 9;
/** The egg's colours: shell, its shade, its outline, speckles, the glint. */
const EGG_COLOURS = {
  shell: "#f2e8cf",
  shade: "#d6c6a2",
  outline: "#4a3a30",
  speck: "#a08868",
  glint: "#ffffff",
} as const;
/** A pixel of the shell below this height (−1 top, 1 bottom) is speckled with this chance. */
const SPECKS_FROM = 0.1;
const SPECKLED = 0.12;
/** The bits of shell thrown off. */
const BIT_COLOUR = 0xf2e8cf;

interface Hearts {
  at: Point;
  /** Seconds since they began (negative: not yet). */
  age: number;
  salt: number;
  /** How many rise. */
  count: number;
}

interface Egg {
  at: Point;
  /** Seconds since it was laid (negative: not yet). */
  age: number;
  /** Art pixels across. */
  wide: number;
  salt: number;
}

/** The hearts, eggs and shells of the births in one view's layer. */
export class Nursery {
  /** Add this to the layer, over the animals. */
  readonly container = new Container();
  private readonly pool = new SpritePool("normal");
  private readonly hearts: Hearts[] = [];
  private readonly eggs: Egg[] = [];
  private salts = 0;

  /** For a view of `tile` art pixels to the cell. */
  constructor(private readonly tile: number) {
    this.container.addChild(this.pool.container);
  }

  /** `count` hearts rise from `at` (cells), beginning in `delayS` seconds. */
  love(at: Point, delayS = 0, count = HEARTS): void {
    this.hearts.push({ at: { x: at.x, y: at.y }, age: -delayS, salt: ++this.salts, count });
  }

  /**
   * An egg is laid at `at` for a newborn `length` cells long, in `delayS` seconds (R5: after
   * its parents touch heads, `family.ts`); it opens `EGG_S` after that.
   */
  lay(at: Point, length: number, delayS = 0): void {
    const wide = Math.max(EGG_LEAST_PX, Math.round(length * EGG_SHARE * this.tile));
    this.eggs.push({ at: { x: at.x, y: at.y }, age: -delayS, wide, salt: ++this.salts });
  }

  /** Forget everything (the view's animals are put afresh). */
  clear(): void {
    this.hearts.length = 0;
    this.eggs.length = 0;
  }

  /** Move on by `dtS` and draw. */
  update(dtS: number): void {
    const tile = this.tile;
    this.pool.begin();
    let kept = 0;
    for (const hearts of this.hearts) {
      hearts.age += dtS;
      if (hearts.age < (hearts.count - 1) * HEART_EVERY_S + HEART_S) this.hearts[kept++] = hearts;
    }
    this.hearts.length = kept;
    kept = 0;
    for (const egg of this.eggs) {
      egg.age += dtS;
      if (egg.age < EGG_S + Math.max(SPLIT_S, BITS_S)) this.eggs[kept++] = egg;
    }
    this.eggs.length = kept;
    for (const egg of this.eggs) this.drawEgg(egg, tile);
    for (const hearts of this.hearts) {
      for (let k = 0; k < hearts.count; k++) {
        const age = hearts.age - k * HEART_EVERY_S;
        if (age < 0 || age >= HEART_S) continue;
        const share = age / HEART_S;
        // Blinking out at the end, as pixel art does.
        if (share > 1 - HEART_BLINK_SHARE && Math.floor(age * 12) % 2 === 1) continue;
        const side = (cellHash(k, hearts.salt, 741) * 2 - 1) * HEART_SPREAD_PX;
        const sway = Math.floor(age * HEART_SWAYS_PER_S * 2) % 2 === 0 ? 0 : 1;
        const rise = HEART_ABOVE_PX + HEART_RISE_PX * share;
        const texture = heartTexture();
        const sprite = this.pool.next(texture);
        placeCentred(
          sprite,
          hearts.at.x + (side + sway) / tile,
          hearts.at.y - rise / tile,
          tile,
          texture.width,
          texture.height,
        );
        sprite.tint = 0xffffff;
        sprite.alpha = 1;
      }
    }
    this.pool.end();
  }

  private drawEgg(egg: Egg, tile: number): void {
    const { at, age, wide } = egg;
    const tall = Math.round(wide * EGG_TALL);
    if (age < 0) return;
    if (age < EGG_S) {
      // Lying, rocking now and then, cracked toward the end.
      const rocking = ROCKS.some(([from, to]) => age >= from && age < to);
      const step = rocking ? (Math.floor(age / ROCK_STEP_S) % 2 === 0 ? -1 : 1) : 0;
      const cracked = age >= EGG_S * (1 - CRACKED_SHARE);
      const texture = eggTexture(wide, cracked ? "cracked" : "whole");
      const sprite = this.pool.next(texture);
      placeCentred(sprite, at.x + step / tile, at.y, tile, texture.width, texture.height);
      sprite.tint = 0xffffff;
      sprite.alpha = 1;
      return;
    }
    const since = age - EGG_S;
    if (since < SPLIT_S) {
      // The shell comes apart, its halves going either way and fading in steps.
      const share = since / SPLIT_S;
      const side = cellHash(egg.salt, 0, 753) < 0.5 ? -1 : 1;
      const alpha = Math.ceil((1 - share) * SPLIT_STEPS) / SPLIT_STEPS;
      for (const half of ["bottom", "top"] as const) {
        const texture = eggTexture(wide, half);
        const sprite = this.pool.next(texture);
        const top = half === "top";
        const aside = Math.round(APART_PX * share) * (top ? side : -side);
        const lift = top ? Math.round(TOP_LIFT_PX * Math.sin(Math.PI * share)) : 0;
        placeCentred(
          sprite,
          at.x + aside / tile,
          at.y - lift / tile,
          tile,
          texture.width,
          texture.height,
        );
        sprite.tint = 0xffffff;
        sprite.alpha = alpha;
      }
    }
    if (since < BITS_S) {
      // Bits of its top thrown off every way, up and falling back.
      const phase = since / BITS_S;
      for (let k = 0; k < BITS; k++) {
        const angle = 2 * Math.PI * (k / BITS + 0.3 * cellHash(k, egg.salt, 751));
        const throwPx = BITS_THROW_PX * (0.5 + 0.5 * cellHash(k, egg.salt, 752));
        const out = (throwPx * phase) / tile;
        const up = (throwPx * 4 * phase * (1 - phase)) / tile;
        const bit = this.pool.next(Texture.WHITE);
        placeCentred(
          bit,
          at.x + out * Math.cos(angle),
          at.y - tall / 2 / tile + out * Math.sin(angle) * 0.5 - up,
          tile,
          k % 2 === 0 ? 2 : 1,
        );
        bit.tint = BIT_COLOUR;
        bit.alpha = 1;
      }
    }
  }
}

let heart: Texture | null = null;

/** The heart's texture, made once. */
function heartTexture(): Texture {
  if (heart !== null) return heart;
  heart = painted(HEART[0].length, HEART.length, (x, y) => {
    const key = HEART[y]?.[x];
    return key === "o" || key === "p" || key === "w" ? HEART_COLOURS[key] : null;
  });
  return heart;
}

const eggs = new Map<string, Texture>();

/**
 * An egg `wide` art pixels across, narrower at the top: whole, cracked across, or the
 * `top` or `bottom` of it once it has come apart, along the crack's jagged edge.
 */
function eggTexture(wide: number, state: "whole" | "cracked" | "top" | "bottom"): Texture {
  const key = `${wide}:${state}`;
  const known = eggs.get(key);
  if (known !== undefined) return known;
  const tall = Math.round(wide * EGG_TALL);
  // Where the crack runs: a zigzag a little above the middle, a pixel up and down.
  const crack = (x: number): number => Math.round(tall * 0.45) + (x % 2 === 0 ? 0 : -1);
  const inside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= wide || y >= tall) return false;
    if (state === "bottom" && y < crack(x)) return false;
    if (state === "top" && y >= crack(x)) return false;
    const v = ((y + 0.5) / tall) * 2 - 1;
    const u = ((x + 0.5) / wide) * 2 - 1;
    // An egg's outline: a circle squeezed at the top.
    const half = Math.sqrt(Math.max(0, 1 - v * v)) * (0.88 + 0.12 * v);
    return Math.abs(u) <= half;
  };
  const texture = painted(wide, tall, (x, y) => {
    if (!inside(x, y)) return null;
    const edge = !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1);
    if (edge) return EGG_COLOURS.outline;
    if (state === "cracked" && y === crack(x)) return EGG_COLOURS.outline;
    const u = ((x + 0.5) / wide) * 2 - 1;
    const v = ((y + 0.5) / tall) * 2 - 1;
    if (Math.abs(u + 0.35) < 1.5 / wide && Math.abs(v + 0.4) < 1.5 / tall) return EGG_COLOURS.glint;
    // Speckled below its middle only, so that no two specks look out of it like eyes.
    if (v > SPECKS_FROM && cellHash(x, y, 761) < SPECKLED) return EGG_COLOURS.speck;
    return u + 0.6 * v > 0.45 ? EGG_COLOURS.shade : EGG_COLOURS.shell;
  });
  eggs.set(key, texture);
  return texture;
}

/** A `wide` × `tall` texture of art pixels, each the colour `colourAt` gives (none: clear). */
function painted(
  wide: number,
  tall: number,
  colourAt: (x: number, y: number) => string | null,
): Texture {
  const canvas = document.createElement("canvas");
  canvas.width = wide;
  canvas.height = tall;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the nursery");
  for (let y = 0; y < tall; y++) {
    for (let x = 0; x < wide; x++) {
      const colour = colourAt(x, y);
      if (colour === null) continue;
      context.fillStyle = colour;
      context.fillRect(x, y, 1, 1);
    }
  }
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  return new Texture({ source, frame: new Rectangle(0, 0, wide, tall) });
}
