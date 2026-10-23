/**
 * Deaths and landings in the scene (R5): what the stream's `died` and `landed` say, drawn.
 *
 * A death shows its cause. The body stops where it fell, its colours turn toward the
 * cause's (`DYING`), and it goes in a few steps as pixel art does, legs first, then from
 * the tail to the head; under it lie its remains, which fade over about a sim-day.
 *
 *   starved   it lies still, wasted pale, and goes; small bones are left
 *   old_age   the same, slower and gentler: a peaceful end
 *   killed    a scuffle of dust over it, and it is gone at once; bones are left
 *   drowned   it sinks, blue with the water, legs gone first, bubbles and rings rising;
 *             nothing is left (the sim leaves no carrion in the sea)
 *   burnt     charred dark, and gone under R4's puff of ash; charred bones are left
 *   blast     gone at once (a meteor, a cone or crater rising under it): nothing is left
 *
 * The remains are drawn by the renderer, one carcass per death where the body lay, not
 * read from the sim's carrion grid (which is not on the wire, and which a hunter's meal
 * and the scavengers empty cell by cell rather than body by body).
 *
 * An animal that landed from the sea (founders, strangers, the ark's) comes out of the
 * water: it is there at once, under a splash of drops thrown off it, with rings spreading
 * in a wet patch round its feet that dries away.
 *
 * Everything is a pooled sprite placed afresh each frame (`SpritePool`); the bones are
 * textures made once for each size and direction and kept for the page's life.
 */
import { CanvasSource, Container, Rectangle, Texture } from "pixi.js";
import { placeCentred, puffAt, SpritePool } from "../atmosphere/particles";
import type { CreaturesMessage } from "../protocol";
import { cellHash } from "../terrain/pixels";
import { ringTexture } from "./wading";

/** What an animal died of, as the stream says (`died`). */
export type Cause = NonNullable<CreaturesMessage["died"]>[number]["cause"];

/** How a dying body goes (`CreatureLayer.remove`). */
export interface Dying {
  /** Seconds it lies still where it fell, its colours turning toward `tint`. */
  still: number;
  /** Seconds its parts take to go, legs first, then from the tail to the head. */
  goes: number;
  /** The colour it turns toward, and how far (0–1). */
  tint: number;
  tinted: number;
  /** Its legs go at once (sunk out of sight). */
  sinks: boolean;
}

/** Wasted pale: the starved and the old turn toward it. */
const PALE = 0xb8ab98;
/** Charred: the burnt. */
const CHAR = 0x2a2220;
/** The sea it sinks into: the drowned turn toward it. */
const DEEP = 0x2c5f7c;

/** How each cause's body goes; `unknown` for streams recorded before causes were sent. */
export const DYING: Readonly<Record<Cause | "unknown", Dying>> = {
  starved: { still: 0.8, goes: 1.2, tint: PALE, tinted: 0.45, sinks: false },
  old_age: { still: 1.6, goes: 1.8, tint: PALE, tinted: 0.3, sinks: false },
  killed: { still: 0.15, goes: 0.35, tint: PALE, tinted: 0, sinks: false },
  drowned: { still: 0.3, goes: 1.6, tint: DEEP, tinted: 0.7, sinks: true },
  burnt: { still: 0.4, goes: 0.6, tint: CHAR, tinted: 0.8, sinks: false },
  blast: { still: 0, goes: 0.15, tint: CHAR, tinted: 0, sinks: false },
  unknown: { still: 0, goes: 0.8, tint: PALE, tinted: 0, sinks: false },
};

/** Steps the colours of a dying body turn in (each a recolouring of its sprites). */
export const TINT_STEPS = 3;

/** Where an animal is drawn in one view's layer: its middle, heading, length and width (cells). */
export interface Laid {
  x: number;
  y: number;
  heading: number;
  length: number;
  width: number;
}

/** The two views that draw bodies. */
export type BodyView = "middle" | "local";

/** Sim time the remains last; they fade over the last `FADE_SHARE` of it, in steps. */
const REMAINS_MS = 86_400_000;
const FADE_SHARE = 0.5;
const FADE_STEPS = 4;
/** At most this many remains are kept: the oldest go first. */
const MOST_REMAINS = 48;
/** Bones: their colours, lit to shaded; the outline round them; the stain under them. */
const BONE = [0xf0e6cc, 0xcdbd9c, 0x9c8a70] as const;
const BONE_OUTLINE = 0x4a3a30;
const STAIN = 0x3a2c22;
const STAIN_ALPHA = 0.28;
/** Charred bones, for the burnt. */
const CHARRED = [0x6a5e58, 0x4a403c, 0x2e2826] as const;
/** Art pixels of the shortest bones drawn, and the bones' directions round the circle. */
const LEAST_BONES = 7;
const DIRECTIONS = 16;

/** The scuffle of a kill: seconds, puffs, dust's colour. */
const SCUFFLE_S = 0.9;
const SCUFFLE_PUFFS = 12;
const DUST = 0xcbb998;
/** The drowned's bubbles: seconds, how many, their white. */
const BUBBLES_S = 2.6;
const BUBBLES = 7;
const FOAM = 0xeef8ff;
/** A landing's splash: seconds the drops fly, how many, art pixels they are thrown. */
const SPLASH_S = 1.1;
const DROPS = 14;
const THROW_PX = 14;
const DROP = 0xd8f0ff;
/** Its rings, and the wet patch round its feet: seconds it takes to dry, its colour. */
const RINGS = 3;
const RING_S = 1.6;
const WET_S = 8;
const WET = 0x2a3a48;
const WET_ALPHA = 0.3;

interface Remain {
  cause: Cause;
  at: Record<BodyView, Laid>;
  /** Scene seconds when it died, and sim time. */
  bornS: number;
  bornMs: number;
  salt: number;
}

interface Landing {
  at: Record<BodyView, Laid>;
  bornS: number;
  salt: number;
}

/** Linear mix of two 0xRRGGBB colours. */
export function mixColour(from: number, to: number, share: number): number {
  const channel = (shift: number): number => {
    const a = (from >> shift) & 255;
    const b = (to >> shift) & 255;
    return Math.round(a + (b - a) * share) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/**
 * The opacity of remains `ageMs` old: whole for the first part of their time, then less
 * in `FADE_STEPS` steps; 0 once gone.
 */
export function remainsOpacity(ageMs: number): number {
  if (ageMs >= REMAINS_MS) return 0;
  const fadeFrom = REMAINS_MS * (1 - FADE_SHARE);
  if (ageMs <= fadeFrom) return 1;
  const left = (REMAINS_MS - ageMs) / (REMAINS_MS - fadeFrom);
  return Math.ceil(left * FADE_STEPS) / FADE_STEPS;
}

/**
 * Which of the bones' tones pixel (u, v) of a carcass `length` × `width` art pixels is,
 * in its own frame (u from the tail to the head, v across): 0–2 for the bones, lit to
 * shaded; -1 for none. A skull at the head with a dark socket, a row of vertebrae, ribs
 * curving back from the chest, a pelvis.
 */
export function bonePixel(length: number, width: number, u: number, v: number): number {
  const half = Math.max(width / 2, 1.5);
  const across = Math.abs(v);
  // The skull: an oval at the head, its socket on the lit side.
  const skullU = length * 0.86;
  const su = (u - skullU) / Math.max(length * 0.13, 1.2);
  const sv = v / Math.max(half * 0.55, 1.1);
  if (su * su + sv * sv <= 1) {
    if (Math.abs(su - 0.15) < 0.35 && sv < -0.1 && sv > -0.75) return 2;
    return sv > 0.4 ? 1 : 0;
  }
  // The spine: vertebrae along the middle, every other pixel shaded.
  if (u >= length * 0.08 && u < length * 0.74 && across < 0.6) {
    return Math.floor(u) % 2 === 0 ? 0 : 1;
  }
  // The ribs: every other row of the chest, curving back as they reach out.
  const chest0 = length * 0.38;
  const chest1 = length * 0.68;
  const back = across * 0.35;
  const ru = u + back;
  if (ru >= chest0 && ru < chest1 && across >= 1 && across <= half * 0.85) {
    if (Math.floor(ru - chest0) % 2 === 0) return across > half * 0.6 ? 1 : 0;
  }
  // The pelvis: a small block across the spine near the tail.
  if (Math.abs(u - length * 0.22) < 1 && across <= half * 0.45) return 1;
  return -1;
}

const boneTextures = new Map<string, Texture>();

/**
 * The carcass of an animal `length` art pixels long and `width` wide, lying along
 * direction `direction` of `DIRECTIONS` (0: head to the right), `charred` or not: its
 * bones with a dark outline on a faint stain. Made once and kept.
 */
export function boneTexture(
  length: number,
  width: number,
  direction: number,
  charred: boolean,
): Texture {
  const long = Math.max(Math.round(length), LEAST_BONES);
  const wide = Math.max(Math.round(width), 3);
  const key = `${long}:${wide}:${direction}:${charred ? 1 : 0}`;
  const known = boneTextures.get(key);
  if (known !== undefined) return known;
  const size = long + 4;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for remains");
  const image = context.createImageData(size, size);
  const angle = (direction / DIRECTIONS) * 2 * Math.PI;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const tones = charred ? CHARRED : BONE;
  const toneAt = (x: number, y: number): number => {
    // The pixel's middle, turned back into the carcass's own frame.
    const dx = x + 0.5 - size / 2;
    const dy = y + 0.5 - size / 2;
    const u = dx * cos + dy * sin + long / 2;
    const v = -dx * sin + dy * cos;
    return bonePixel(long, wide, u, v);
  };
  const put = (x: number, y: number, colour: number, alpha: number): void => {
    const at = (y * size + x) * 4;
    image.data[at] = colour >> 16;
    image.data[at + 1] = (colour >> 8) & 255;
    image.data[at + 2] = colour & 255;
    image.data[at + 3] = Math.round(alpha * 255);
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const tone = toneAt(x, y);
      if (tone >= 0) {
        put(x, y, tones[tone] ?? BONE_OUTLINE, 1);
        continue;
      }
      // The outline: next to a bone; the stain: within the body's oval.
      const edge =
        toneAt(x - 1, y) >= 0 ||
        toneAt(x + 1, y) >= 0 ||
        toneAt(x, y - 1) >= 0 ||
        toneAt(x, y + 1) >= 0;
      if (edge) {
        put(x, y, BONE_OUTLINE, 0.85);
        continue;
      }
      const dx = x + 0.5 - size / 2;
      const dy = y + 0.5 - size / 2;
      const u = (dx * cos + dy * sin) / (long / 2);
      const v = (-dx * sin + dy * cos) / Math.max(wide / 2 + 1, 2);
      if (u * u + v * v <= 1 && cellHash(x, y, 711) < 0.8) put(x, y, STAIN, STAIN_ALPHA);
    }
  }
  context.putImageData(image, 0, 0);
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const texture = new Texture({ source, frame: new Rectangle(0, 0, size, size) });
  boneTextures.set(key, texture);
  return texture;
}

/** The direction (of `DIRECTIONS`) nearest `heading` radians. */
function directionOf(heading: number): number {
  const turns = heading / (2 * Math.PI);
  return ((Math.round(turns * DIRECTIONS) % DIRECTIONS) + DIRECTIONS) % DIRECTIONS;
}

/** What deaths and landings leave in the scene. */
export class Remains {
  /** On the ground, under the plants (`Landscape.floor`): bones, wet patches. */
  readonly floor = new Container();
  /** Over the animals: dust, bubbles, drops. */
  readonly over = new Container();
  private readonly floorPool = new SpritePool("normal");
  private readonly overPool = new SpritePool("normal");
  private readonly remains: Remain[] = [];
  private readonly landings: Landing[] = [];
  private timeS = 0;
  private simMs = 0;
  private salts = 0;

  constructor() {
    this.floor.addChild(this.floorPool.container);
    this.over.addChild(this.overPool.container);
  }

  /** The sim's time as the stream last told it. */
  set now(ms: number) {
    this.simMs = ms;
  }

  /**
   * An animal died of `cause`, lying as `at` says in each view; what it leaves shows
   * `waitS` seconds from now (R5: a prey's, once its hunter strikes).
   */
  died(cause: Cause, at: Record<BodyView, Laid>, waitS = 0): void {
    const bornS = this.timeS + waitS;
    this.remains.push({ cause, at, bornS, bornMs: this.simMs, salt: ++this.salts });
    if (this.remains.length > MOST_REMAINS) this.remains.shift();
  }

  /** An animal landed from the sea, standing as `at` says in each view. */
  landed(at: Record<BodyView, Laid>): void {
    this.landings.push({ at, bornS: this.timeS, salt: ++this.salts });
  }

  /** Forget everything (a world ends). */
  clear(): void {
    this.remains.length = 0;
    this.landings.length = 0;
  }

  /** Move on by `dtS` and draw for `view` at `tile` art pixels to the cell (nothing on the map). */
  update(dtS: number, view: BodyView | "map", tile: number): void {
    this.timeS += dtS;
    // Both lists are in the order things happened: the oldest go from the front, and a
    // frame makes no new list.
    // Time that went back (a recording played again) leaves none behind.
    if (this.remains.some((remain) => remain.bornMs > this.simMs)) this.remains.length = 0;
    while (this.remains[0] !== undefined && this.simMs - this.remains[0].bornMs >= REMAINS_MS) {
      this.remains.shift();
    }
    const lasts = Math.max(WET_S, SPLASH_S, RING_S);
    while (this.landings[0] !== undefined && this.timeS - this.landings[0].bornS >= lasts) {
      this.landings.shift();
    }
    this.floorPool.begin();
    this.overPool.begin();
    if (view !== "map") {
      for (const remain of this.remains) this.drawRemain(remain, remain.at[view], tile);
      for (const landing of this.landings) this.drawLanding(landing, landing.at[view], tile);
    }
    this.floorPool.end();
    this.overPool.end();
  }

  private drawRemain(remain: Remain, at: Laid, tile: number): void {
    const { cause, salt } = remain;
    const age = this.timeS - remain.bornS;
    // Not yet: its hunter has still to strike.
    if (age < 0) return;
    // The drowned are lost to the sea, the blasted to the blast: no bones.
    if (cause !== "drowned" && cause !== "blast") {
      const opacity = remainsOpacity(this.simMs - remain.bornMs);
      if (opacity > 0) {
        const texture = boneTexture(
          at.length * tile,
          at.width * tile,
          directionOf(at.heading),
          cause === "burnt",
        );
        const bones = this.floorPool.next(texture);
        placeCentred(bones, at.x, at.y, tile, texture.width, texture.height);
        bones.tint = 0xffffff;
        bones.alpha = opacity;
      }
    }
    const grow = tile >= 32 ? 2 : 1;
    if (cause === "killed" && age < SCUFFLE_S) {
      // A scuffle: dust thrown up round it, thinning as it settles.
      const left = 1 - age / SCUFFLE_S;
      for (let slot = 0; slot < SCUFFLE_PUFFS; slot++) {
        const puff = puffAt(
          {
            x: at.x,
            y: at.y,
            spread: at.length * 0.5,
            rise: 6 * grow,
            drift: 4 * grow,
            life: 0.6,
            from: 3 * grow,
            to: 6 * grow,
            alpha: 0.9 * left,
            salt,
          },
          slot,
          age,
          tile,
        );
        if (puff.alpha <= 0.02) continue;
        const sprite = this.overPool.next(roundTexture(Math.round(puff.size)));
        placeCentred(sprite, puff.x, puff.y, tile, puff.size);
        sprite.tint = DUST;
        sprite.alpha = Math.ceil(puff.alpha * 3) / 3;
      }
    }
    if (cause === "drowned" && age < BUBBLES_S) {
      // Bubbles come up where it sank, each a ring that swells and pops, and rings spread.
      for (let k = 0; k < BUBBLES; k++) {
        const start = cellHash(k, salt, 721) * (BUBBLES_S - 0.6);
        const life = age - start;
        if (life < 0 || life > 0.6) continue;
        const angle = 2 * Math.PI * cellHash(k, salt, 722);
        const reach = at.length * 0.4 * Math.sqrt(cellHash(k, salt, 723));
        const across = (2 + 2 * (life / 0.6)) * grow;
        const bubble = this.overPool.next(ringTexture(across));
        placeCentred(
          bubble,
          at.x + reach * Math.cos(angle),
          at.y + reach * Math.sin(angle),
          tile,
          bubble.texture.width,
          bubble.texture.height,
        );
        bubble.tint = FOAM;
        bubble.alpha = 0.9;
      }
      this.rings(at, age, BUBBLES_S, tile, 0.5);
    }
  }

  private drawLanding(landing: Landing, at: Laid, tile: number): void {
    const age = this.timeS - landing.bornS;
    const grow = tile >= 32 ? 2 : 1;
    // The wet patch it stands in, drying away in steps.
    if (age < WET_S) {
      const left = Math.ceil((1 - age / WET_S) * FADE_STEPS) / FADE_STEPS;
      const across = (at.length + 0.6) * tile;
      const patch = this.floorPool.next(ovalTexture(Math.round(across)));
      placeCentred(patch, at.x, at.y, tile, patch.texture.width, patch.texture.height);
      patch.tint = WET;
      patch.alpha = WET_ALPHA * left;
    }
    this.rings(at, age, RING_S, tile, 0.9);
    if (age >= SPLASH_S) return;
    // Drops thrown off it every way, flying out and falling back (up on the screen, then down).
    const phase = age / SPLASH_S;
    for (let k = 0; k < DROPS; k++) {
      const angle = 2 * Math.PI * (k / DROPS + 0.3 * cellHash(k, landing.salt, 731));
      const throwPx = THROW_PX * grow * (0.5 + 0.5 * cellHash(k, landing.salt, 732));
      const out = (throwPx * phase) / tile;
      const up = (throwPx * 0.8 * 4 * phase * (1 - phase)) / tile;
      const drop = this.overPool.next(Texture.WHITE);
      placeCentred(
        drop,
        at.x + out * Math.cos(angle),
        at.y + out * Math.sin(angle) * 0.6 - up,
        tile,
        grow,
        grow * (phase < 0.5 ? 2 : 1),
      );
      drop.tint = DROP;
      drop.alpha = phase < 0.75 ? 1 : 0.5;
    }
  }

  /** Rings spreading from `at` over `lasts` seconds, each later than the one before. */
  private rings(at: Laid, age: number, lasts: number, tile: number, alpha: number): void {
    for (let k = 0; k < RINGS; k++) {
      const start = (k * lasts) / (RINGS + 1);
      const ringAge = (age - start) / (lasts - start);
      if (ringAge < 0 || ringAge >= 1) continue;
      const across = (at.length * (0.6 + 1.2 * ringAge) + 0.4) * tile;
      const ring = this.overPool.next(ringTexture(across));
      placeCentred(ring, at.x, at.y, tile, ring.texture.width, ring.texture.height);
      ring.tint = FOAM;
      ring.alpha = Math.ceil(alpha * (1 - ringAge) * 3) / 3;
    }
  }
}

const rounds = new Map<number, Texture>();

/** A filled pixel disc `across` art pixels wide, white (tinted by whoever draws it). */
export function roundTexture(across: number): Texture {
  const wide = Math.max(1, across);
  return filled(rounds, wide, wide);
}

const ovals = new Map<number, Texture>();

/** A filled pixel oval `across` art pixels wide and as flat as a ripple, white. */
function ovalTexture(across: number): Texture {
  const wide = Math.max(3, across);
  return filled(ovals, wide, Math.max(2, Math.round(wide * 0.6)));
}

function filled(cache: Map<number, Texture>, wide: number, tall: number): Texture {
  const known = cache.get(wide);
  if (known !== undefined) return known;
  const canvas = document.createElement("canvas");
  canvas.width = wide;
  canvas.height = tall;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for remains");
  context.fillStyle = "#ffffff";
  for (let y = 0; y < tall; y++) {
    for (let x = 0; x < wide; x++) {
      const u = (x + 0.5 - wide / 2) / (wide / 2);
      const v = (y + 0.5 - tall / 2) / (tall / 2);
      if (u * u + v * v <= 1) context.fillRect(x, y, 1, 1);
    }
  }
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const texture = new Texture({ source, frame: new Rectangle(0, 0, wide, tall) });
  cache.set(wide, texture);
  return texture;
}
