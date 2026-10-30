/**
 * An animal eating (R5, the owner's first animation): the stream says who ate plants or
 * algae and who ate meat in the last tick (`grazing`, `feeding` on the creatures message).
 * One that eats stands where it is, and its head works: a grazer dips it to the ground in
 * quick nibbles, a flake of green at its mouth each time; one feeding on meat tugs it from
 * side to side and back, a fleck of red now and then. Only the head is moved, the neck
 * half as far so that it stays on, for the drawing: the chain the body follows is left as
 * it was.
 */
import { Container, Sprite, type Texture } from "pixi.js";
import type { Point } from "./chain";

/** What an animal is eating: nothing, plants (or algae), meat. */
export type Food = "none" | "plants" | "meat";

/** A grazer's nibbles: this many a second, reaching this share of a body spacing forward. */
const NIBBLES_PER_S = 2.2;
const NIBBLE_REACH = 0.8;
/** Nibbles come in bursts: this many beats, the last a pause to chew. */
const NIBBLES_IN_A_ROW = 4;
/** Meat is tugged at: this many tugs a second, this far aside and back (shares of a spacing). */
const TUGS_PER_S = 1.4;
const TUG_ASIDE = 0.6;
const TUG_BACK = 0.3;
/** A fleck is thrown from the mouth this far into a nibble or a tug, every so many. */
const FLECK_AT = 0.95;
const FLECK_EVERY = { plants: 2, meat: 2 } as const;
/** Seconds a fleck lasts, and how far (cells) it rises and drifts aside meanwhile. */
const FLECK_S = 0.45;
const FLECK_RISE = 0.3;
const FLECK_DRIFT = 0.12;
/** Flecks: the green of a bitten leaf and the red of meat, and how many may be out at once. */
const FLECK_COLOUR = { plants: 0x7fbf4a, meat: 0xb83a3a } as const;
const FLECKS = 48;

/**
 * Where the head is moved to at `timeS` (cells, along and across the way it faces), for an
 * animal eating `food` whose joints are `spacing` apart; `offset` (0–1) keeps animals apart.
 * The phase (0–1) of the nibble or tug is given too, for the flecks.
 */
export function bite(
  food: Food,
  timeS: number,
  offset: number,
  spacing: number,
): { forward: number; aside: number; phase: number; count: number } {
  if (food === "none") return { forward: 0, aside: 0, phase: 0, count: 0 };
  const rate = food === "plants" ? NIBBLES_PER_S : TUGS_PER_S;
  const turns = timeS * rate + offset;
  const count = Math.floor(turns);
  const phase = turns - count;
  if (food === "plants") {
    // Down quickly, up more slowly: the head reaches forward to the grass and comes back,
    // three times, then a pause to chew with the head up.
    const resting = count % NIBBLES_IN_A_ROW === NIBBLES_IN_A_ROW - 1;
    const reach = resting ? 0 : phase < 0.35 ? phase / 0.35 : 1 - (phase - 0.35) / 0.65;
    return {
      forward: NIBBLE_REACH * spacing * reach,
      aside: 0,
      phase,
      count: resting ? -1 : count,
    };
  }
  const swing = Math.sin(2 * Math.PI * phase);
  return {
    forward: -TUG_BACK * spacing * Math.abs(swing),
    aside: TUG_ASIDE * spacing * swing,
    phase,
    count,
  };
}

/** The flecks thrown by eating animals: a few pooled sprites, none made while it runs. */
export class Flecks {
  /** Add this to the layer, over the animals. */
  // Its own render group (R5): sprites shown and hidden here every frame rebuild only this
  // group's draw list, not the scene's with its thousands of plants.
  readonly container = new Container({ isRenderGroup: true });
  private readonly sprites: Sprite[] = [];
  private readonly flying: { age: number; x: number; y: number; dx: number }[] = [];
  private next = 0;

  /** Flecks of `pixel` (a white texel) drawn `cells` across. */
  constructor(texture: Texture, cells: number, texels: number) {
    for (let k = 0; k < FLECKS; k++) {
      const sprite = new Sprite({ texture, anchor: 0.5 });
      sprite.scale.set(cells / texels);
      sprite.visible = false;
      this.sprites.push(sprite);
      this.flying.push({ age: FLECK_S, x: 0, y: 0, dx: 0 });
      this.container.addChild(sprite);
    }
  }

  /** Throw a fleck of `food` from `mouth` (cells), drifting `side` (−1 or 1). */
  throw(food: Food, mouth: Point, side: number): void {
    if (food !== "none") this.fling(FLECK_COLOUR[food], mouth, side);
  }

  /** Throw a fleck of `colour` from `from` (cells), drifting `side` (R5: a hunter's dust too). */
  fling(colour: number, from: Point, side: number): void {
    const k = this.next;
    this.next = (this.next + 1) % FLECKS;
    const sprite = this.sprites[k];
    const flying = this.flying[k];
    if (sprite === undefined || flying === undefined) return;
    sprite.tint = colour;
    sprite.visible = true;
    sprite.alpha = 1;
    flying.age = 0;
    flying.x = from.x;
    flying.y = from.y;
    flying.dx = side * FLECK_DRIFT;
  }

  /** Move the flecks on by `dtS` seconds. */
  update(dtS: number): void {
    this.sprites.forEach((sprite, k) => {
      const flying = this.flying[k];
      if (flying === undefined || flying.age >= FLECK_S) return;
      flying.age += dtS;
      const t = Math.min(flying.age / FLECK_S, 1);
      sprite.position.set(flying.x + flying.dx * t, flying.y - FLECK_RISE * t);
      sprite.alpha = t < 0.6 ? 1 : 0.5;
      if (t >= 1) sprite.visible = false;
    });
  }
}

/** Whether a nibble or tug that has just passed `FLECK_AT` throws a fleck. */
export function flecks(food: Food, before: number, after: number, count: number): boolean {
  if (food === "none") return false;
  return before < FLECK_AT && after >= FLECK_AT && count >= 0 && count % FLECK_EVERY[food] === 0;
}
