/**
 * Animals in the rain (R5): drawn only, from the sky the stream already sends.
 *
 *   shaking off   an animal out in a rain spell (rain, thunder, a thunderstorm, the rain
 *                 power's soaking) shakes itself once when it ends: it stops, a quick shiver
 *                 runs down its body from the head to the tail, and a small spray of drops
 *                 flies off either side. Each animal at its own moment within a few seconds,
 *                 so the herd shakes one after another, not together
 *   huddling      in a thunderstorm animals hunch against it: lower to the ground (their
 *                 parts drawn less lifted toward the light, their feet drawn in), their
 *                 heads drawn back and down, walking slower in shorter steps
 *
 * Swimmers, the torpid, sleepers and animals in deep water are left alone; neither changes
 * where the sim has an animal. A moment is taken from the animal's own breathing offset, so
 * no random draw is added; nothing allocates per frame.
 */
import { Container, Sprite, type Texture } from "pixi.js";
import type { SkyMessage } from "../protocol";
import { cellHash } from "../terrain/pixels";
import type { Point } from "./chain";

/** What falls, as the animals take it: nothing, rain of any kind, or a thunderstorm. */
export type Downpour = "dry" | "rain" | "storm";

/** The sky's `rain` as the animals take it: cloud drops nothing. */
export function downpourOf(rain: SkyMessage["rain"]): Downpour {
  if (rain === "storm") return "storm";
  return rain === "none" || rain === "cloud" ? "dry" : "rain";
}

/** Seconds over which the herd shakes off after a spell, the first at once, the last this late. */
const SHAKE_SPREAD_S = 4;
/** Seconds a shake lasts, and how often the body swings from side to side meanwhile (a second). */
export const SHAKE_S = 0.7;
const SHAKE_HZ = 9;
/** How far the body swings aside at the height of a shake: shares of each joint's radius. */
const SHAKE_SWING = 0.45;
/** The shiver runs from the head down the body: radians of lag from one joint to the next. */
const SHAKE_LAG = 0.9;
/** Drops thrown from the body: every so many seconds of a shake, one from each side. */
const SPRAY_EVERY_S = 0.06;

/** An animal's rain: out in it, waiting to shake, shaking. */
export interface Drench {
  /** It was out in the spell that is falling, or that just ended. */
  soaked: boolean;
  /** Seconds before it shakes (negative: no shake to come). */
  wait: number;
  /** Seconds into its shake (negative: not shaking). */
  age: number;
  /** How hunched it is against a thunderstorm (0–1), eased. */
  huddle: number;
}

export function drenchOf(): Drench {
  return { soaked: false, wait: -1, age: -1, huddle: 0 };
}

/**
 * Move an animal's rain on by `dtS`: `falling` what falls now, `before` what fell last
 * frame, `exposed` whether it is out in it (a land animal awake and not in deep water),
 * `moment` its own number (0–1). Returns whether it shakes now.
 */
export function drench(
  state: Drench,
  falling: Downpour,
  before: Downpour,
  exposed: boolean,
  moment: number,
  dtS: number,
): boolean {
  if (falling !== "dry" && exposed) state.soaked = true;
  if (falling === "dry" && before !== "dry" && state.soaked) {
    // The spell is over: it will shake, at its own moment.
    state.soaked = false;
    state.wait = SHAKE_SPREAD_S * moment;
  }
  if (falling !== "dry") state.wait = -1;
  if (state.wait >= 0) {
    state.wait -= dtS;
    if (state.wait < 0) state.age = exposed ? 0 : -1;
  }
  if (state.age >= 0) {
    state.age += dtS;
    if (state.age >= SHAKE_S || !exposed) state.age = -1;
  }
  return state.age >= 0;
}

/** How quickly (per second) an animal hunches as a thunderstorm comes, and stands as it goes. */
const HUDDLE_RATE = 0.8;

/** Ease an animal's hunch toward `goal` (0–1) over `dtS`. */
export function huddleToward(state: Drench, goal: number, dtS: number): number {
  const step = HUDDLE_RATE * dtS;
  state.huddle =
    goal > state.huddle ? Math.min(state.huddle + step, goal) : Math.max(state.huddle - step, goal);
  return state.huddle;
}

/** Hunched against a storm: its parts this much less lifted, its feet drawn in this much more. */
export const HUDDLE_LOW = 0.6;
export const HUDDLE_TUCK = 0.35;
/** Its steps this much shorter, its pace this much slower. */
export const HUDDLE_STRIDE = 0.4;
export const HUDDLE_SLOW = 0.45;
/** Its head drawn back toward its body by this share of a spacing, its neck by half as much. */
export const HUDDLE_HEAD = 0.45;

/** How far aside joint `index` of a shaking body is moved, as a share of its radius (signed). */
export function shiverAt(age: number, index: number): number {
  const t = Math.min(Math.max(age / SHAKE_S, 0), 1);
  // It builds and fades within the shake, strongest a little after the start.
  const envelope = Math.sin(Math.PI * Math.sqrt(t));
  return SHAKE_SWING * envelope * Math.sin(2 * Math.PI * SHAKE_HZ * age - SHAKE_LAG * index);
}

/** Whether a shake that went from `before` to `after` seconds throws drops now. */
export function sprays(before: number, after: number): boolean {
  return before >= 0 && Math.floor(after / SPRAY_EVERY_S) > Math.floor(before / SPRAY_EVERY_S);
}

/** Drops: how many may fly at once, seconds one flies, how far (cells) out and up it goes. */
const DROPS = 48;
const DROP_S = 0.35;
const DROP_OUT = 0.5;
const DROP_UP = 0.18;
/** A drop leaves the body this share of its radius out from the joint. */
const DROP_EDGE = 0.8;
/** A drop's colour: the pale blue of water against the light. */
const DROP_COLOUR = 0xd8ecff;

/** The spray shaken off wet animals: a few pooled sprites, none made while it runs. */
export class Spray {
  /** Add this to the layer, over the animals. */
  // Its own render group (R5): sprites shown and hidden here every frame rebuild only this
  // group's draw list, not the scene's with its thousands of plants.
  readonly container = new Container({ isRenderGroup: true });
  private readonly sprites: Sprite[] = [];
  private readonly flying: { age: number; x: number; y: number; dx: number; dy: number }[] = [];
  private next = 0;
  private thrown = 0;

  /** Drops of `texture` (`texels` across) drawn `cells` across. */
  constructor(texture: Texture, cells: number, texels: number) {
    for (let k = 0; k < DROPS; k++) {
      const sprite = new Sprite({ texture, anchor: 0.5 });
      sprite.scale.set(cells / texels);
      sprite.tint = DROP_COLOUR;
      sprite.visible = false;
      this.sprites.push(sprite);
      this.flying.push({ age: DROP_S, x: 0, y: 0, dx: 0, dy: 0 });
      this.container.addChild(sprite);
    }
  }

  /**
   * Throw a drop from `from` (cells) out to the side of a body facing `heading`, `side`
   * (−1 or 1), from the edge of a body `reach` (cells) in radius there, further for a larger one.
   */
  throw(from: Point, heading: number, side: number, reach: number): void {
    const k = this.next;
    this.next = (this.next + 1) % DROPS;
    const sprite = this.sprites[k];
    const flying = this.flying[k];
    if (sprite === undefined || flying === undefined) return;
    this.thrown += 1;
    // Out to the side, a little ahead or behind, each drop its own way.
    const spread = cellHash(this.thrown, k, 541) - 0.5;
    const out = (DROP_OUT + reach) * (0.6 + 0.6 * cellHash(this.thrown, k, 542));
    const way = heading + side * (Math.PI / 2 + spread);
    flying.age = 0;
    // From the edge of the body, not its middle.
    flying.x = from.x + Math.cos(way) * reach * DROP_EDGE;
    flying.y = from.y + Math.sin(way) * reach * DROP_EDGE;
    flying.dx = Math.cos(way) * out;
    flying.dy = Math.sin(way) * out;
    sprite.visible = true;
    sprite.alpha = 1;
  }

  /** Move the drops on by `dtS` seconds: out, up and down again. */
  update(dtS: number): void {
    for (let k = 0; k < DROPS; k++) {
      const flying = this.flying[k];
      const sprite = this.sprites[k];
      if (flying === undefined || sprite === undefined || flying.age >= DROP_S) continue;
      flying.age += dtS;
      const t = Math.min(flying.age / DROP_S, 1);
      const arc = 4 * t * (1 - t) * DROP_UP;
      sprite.position.set(flying.x + flying.dx * t, flying.y + flying.dy * t - arc);
      sprite.alpha = t < 0.7 ? 1 : 0.5;
      if (t >= 1) sprite.visible = false;
    }
  }
}
