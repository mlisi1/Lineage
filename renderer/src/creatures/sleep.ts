/**
 * Sleep at night (R5, the owner, 2026-10-23). The sim does not sleep: its animals move by
 * night as by day. On the screen, as the owner's light goes (dusk, `atmosphere/light.ts`)
 * most animals settle down where they stand, each at its own moment: they lie down, tuck
 * their legs under them, curl as far as their bodies bend, shut their eyes and breathe
 * slowly. Over dawn they wake, again each at its own moment, and get up.
 *
 * Some stay awake all night: those whose look is made for the dark (the glow gene) and
 * those with the keenest senses (`SENSE`); swimmers keep swimming. Nothing here is a sim
 * trait: it is drawn from the genes the animal already carries.
 *
 * Purely cosmetic: where the sim has an animal is still where it is. One that the sim moves
 * further than its leash while it sleeps wakes and walks there, and stays up a while before
 * it settles again. Pure functions and a small state per animal; nothing allocates per frame.
 */
import { Container, Sprite, Texture } from "pixi.js";
import { daylight } from "../atmosphere/light";
import { curl, type Point, type Stiffness } from "./chain";
import { Gene, type Genome } from "./genome";
import { leash, type Motion } from "./motion";
import type { RareLook } from "./rare";

/**
 * How deep in the night the light is for sleep (0 full day, 1 the darkest night): animals
 * fall asleep at their own moment between these depths, the earliest as the dusk's rose
 * deepens, the last as night comes.
 */
const SLEEP_FROM = 0.45;
const SLEEP_TO = 0.9;
/** One asleep wakes once the light has risen this far above the depth it fell asleep at. */
const WAKE_MARGIN = 0.12;
/** An animal with a `SENSE` gene this keen or keener stays awake at night. */
const NIGHT_SENSE = 0.8;
/** How far round a sleeper curls, as a share of how far its body bends when it walks. */
const SLEEP_BEND = 1.8;
/** The most a sleeper curls, in turns (a torpid animal curls 0.85). */
const SLEEP_TURNS = 0.6;
/** Seconds it takes to lie down and curl up, and to get up again. */
const LIE_DOWN_S = 1.6;
const GET_UP_S = 0.7;
/** Seconds it takes to get up when the sim has moved it on: it goes at once. */
const JUMP_UP_S = 0.3;
/** How quickly (per second) the body eases toward its pose lying down or getting up. */
const LIE_RATE = 2.5;
const RISE_RATE = 7;
/** The sim has moved a sleeper this many leashes from where it lies: it wakes and walks. */
const WAKE_LEASHES = 2;
/** Seconds one woken by the sim stays up before it may settle again: from, and up to this much more. */
const RESTLESS_S = 3;
const RESTLESS_MORE_S = 4;
/** A sleeper's feet are drawn this share of the way out from its hips: tucked under it. */
const TUCKED = 0.3;
/** Shut, an eye is drawn this share as wide across: a slit of a pixel. */
const EYE_SHUT = 0.3;
/** A sleeper breathes this many times slower, and this many times deeper. */
const SLEEP_BREATH = 1.8;
const SLEEP_DEEP = 1.6;
/** Its share of lying down past which its eyes are shut. */
const EYES_SHUT_AT = 0.5;

/** One animal's sleep. */
export interface Sleeper {
  /** Its own moment, 0–1: where between `SLEEP_FROM` and `SLEEP_TO` it falls asleep. */
  moment: number;
  /** It stays awake at night. */
  owl: boolean;
  /** How far it curls (turns), by its body. */
  turns: number;
  /** Asleep, or lying down to sleep; false while it gets up and while awake. */
  asleep: boolean;
  /** How far it is lying down, 0 standing to 1 curled up asleep. */
  share: number;
  /** Seconds it takes to get up this time. */
  rise: number;
  /** Seconds before it may settle again (woken by the sim's move). */
  restless: number;
  /** Its eyes and the glints in them (the face of its drawing), and whether they are shut. */
  eyes: Sprite[];
  glints: Sprite[];
  /** Each eye's width across as drawn open. */
  open: number[];
  shut: boolean;
  /** The pose it eases toward, a point per joint (made once). */
  pose: Point[];
  /** Its own breathing clock (seconds of breath), slowed while it lies down. */
  breath: number;
}

/** The scene's night as the animals take it: how deep (0–1), and whether the light is rising. */
export interface Night {
  depth: number;
  rising: boolean;
}

/** How deep in the night the sim's `light` is, for sleep: 0 in full day, 1 the darkest night. */
export function depthOf(light: number): number {
  return 1 - daylight(light);
}

/** A number 0–1 of a genome: the same animal has the same moment in every view. */
function momentOf(genome: Genome): number {
  let hash = 0x2545f491;
  for (const gene of genome) {
    hash = Math.imul(hash ^ Math.round(gene * 1e6), 0x9e3779b1);
    hash ^= hash >>> 15;
  }
  return (hash >>> 0) / 2 ** 32;
}

/** Whether an animal of these genes, rare looks and body stays awake at night. */
export function nightActive(genome: Genome, rare: readonly RareLook[], swims: boolean): boolean {
  return swims || rare.includes("glow") || (genome[Gene.SENSE] ?? 0) >= NIGHT_SENSE;
}

/**
 * The sleep of an animal of `genome`, `rare` looks and body: `parts` are its drawing's
 * parts with `sprites` in the same order; those of `face` layer are its eyes, with a glint
 * (lifted toward the light) in each if it is large enough for one.
 */
export function sleeperOf(
  genome: Genome,
  rare: readonly RareLook[],
  body: {
    swims: boolean;
    joints: number;
    parts: readonly { layer: number; lift: number }[];
    stiffness: Stiffness;
  },
  sprites: readonly Sprite[],
  face: number,
): Sleeper {
  const eyes: Sprite[] = [];
  const glints: Sprite[] = [];
  body.parts.forEach((part, i) => {
    const sprite = sprites[i];
    if (sprite === undefined || part.layer !== face) return;
    (part.lift > 0 ? glints : eyes).push(sprite);
  });
  const bend = body.stiffness.bend * Math.max(body.joints - 2, 1);
  return {
    moment: momentOf(genome),
    owl: nightActive(genome, rare, body.swims),
    turns: Math.min((SLEEP_BEND * bend) / (2 * Math.PI), SLEEP_TURNS),
    asleep: false,
    share: 0,
    rise: GET_UP_S,
    restless: 0,
    eyes,
    glints,
    open: eyes.map((eye) => eye.scale.y),
    shut: false,
    pose: Array.from({ length: body.joints }, () => ({ x: 0, y: 0 })),
    breath: 0,
  };
}

/** Carry `old`'s sleep over to `sleeper`, a new drawing of the same animal (`rebuild`). */
export function carrySleep(sleeper: Sleeper, old: Sleeper): void {
  sleeper.asleep = old.asleep;
  sleeper.share = old.share;
  sleeper.rise = old.rise;
  sleeper.restless = old.restless;
  sleeper.breath = old.breath;
  shutEyes(sleeper, old.shut);
}

/** Wake at once and stand (an animal placed or sent by hand). */
export function wakeNow(sleeper: Sleeper): void {
  sleeper.asleep = false;
  sleeper.share = 0;
  shutEyes(sleeper, false);
}

/** Get up at once and stay up a while (an animal sent somewhere by hand). */
export function rouse(sleeper: Sleeper): void {
  if (!sleeper.asleep && sleeper.share === 0) return;
  sleeper.asleep = false;
  sleeper.rise = JUMP_UP_S;
  sleeper.restless = RESTLESS_S + RESTLESS_MORE_S * sleeper.moment;
}

/**
 * Its breathing clock moved on by `dtS`: slower the further it lies down. Kept per
 * animal, so that slowing down does not jump its breath.
 */
export function breathClock(sleeper: Sleeper, dtS: number): number {
  sleeper.breath += dtS / (1 + (SLEEP_BREATH - 1) * sleeper.share);
  return sleeper.breath;
}

/** How deep it breathes: 1 awake, `SLEEP_DEEP` asleep. */
export function breathDepth(sleeper: Sleeper): number {
  return 1 + (SLEEP_DEEP - 1) * sleeper.share;
}

/** How far out from its hips its feet stand: 1 standing, `TUCKED` lying down. */
export function tuckOf(sleeper: Sleeper): number {
  return 1 - (1 - TUCKED) * sleeper.share;
}

/** Shut or open its eyes: a slit, and no glint. */
function shutEyes(sleeper: Sleeper, shut: boolean): void {
  if (sleeper.shut === shut) return;
  sleeper.shut = shut;
  sleeper.eyes.forEach((eye, i) => {
    const open = sleeper.open[i] ?? eye.scale.y;
    eye.scale.y = shut ? open * EYE_SHUT : open;
  });
  for (const glint of sleeper.glints) glint.visible = !shut;
}

/** What `doze` needs of an animal. */
export interface Dozer {
  joints: Point[];
  heading: number;
  plan: { spacing: number; length: number };
  motion: Motion | null;
  /** Lying torpid, hibernating: the sim's sleep, drawn by the layer itself. */
  torpid: boolean;
  /** Held by hand where it is (`pin`): it may sleep there whatever it was doing. */
  pinned?: boolean;
  sleep: Sleeper;
}

/**
 * Move `animal`'s sleep on by `dtS` seconds in `night`: it falls asleep or wakes, and its
 * body eases toward lying curled or standing. It does not fall asleep unless `dry` (no
 * animal sleeps in the water) and not `arriving` (the ark's newcomers). With `instant` it is at once as it would come to be (a view just come back).
 * True while its body is held where it lies (asleep, or getting up): the caller then
 * neither walks it nor lets it stroll.
 */
export function doze(
  animal: Dozer,
  night: Night,
  dtS: number,
  dry: boolean,
  arriving: boolean,
  instant = false,
): boolean {
  const { sleep, motion, joints } = animal;
  const scratch = sleep.pose;
  const head = joints[0];
  if (head === undefined || sleep.owl || motion === null || animal.torpid) {
    if (sleep.share > 0 || sleep.asleep) wakeNow(sleep);
    return false;
  }
  sleep.restless = Math.max(sleep.restless - dtS, 0);
  const threshold = SLEEP_FROM + (SLEEP_TO - SLEEP_FROM) * sleep.moment;
  const away = Math.hypot(head.x - motion.anchor.x, head.y - motion.anchor.y);
  const moved = away > leash(animal.plan.length) * WAKE_LEASHES && animal.pinned !== true;
  if (sleep.asleep) {
    if (moved || !dry) {
      // The sim has moved it on (or the water came): up at once, and off.
      sleep.asleep = false;
      sleep.rise = JUMP_UP_S;
      sleep.restless = RESTLESS_S + RESTLESS_MORE_S * sleep.moment;
    } else if (night.depth < threshold - WAKE_MARGIN) {
      sleep.asleep = false;
      sleep.rise = GET_UP_S;
    }
  } else if (
    night.depth >= threshold &&
    !night.rising &&
    sleep.restless <= 0 &&
    dry &&
    !arriving &&
    !moved &&
    (animal.pinned === true || motion.mode === "pause")
  ) {
    sleep.asleep = true;
  }
  const goal = sleep.asleep ? 1 : 0;
  if (sleep.share === goal && goal === 0) return false;
  const step = instant ? 1 : dtS / (sleep.asleep ? LIE_DOWN_S : sleep.rise);
  sleep.share = goal === 1 ? Math.min(sleep.share + step, 1) : Math.max(sleep.share - step, 0);
  shutEyes(sleep, sleep.share >= EYES_SHUT_AT && sleep.asleep);
  // The pose it eases toward: curled about its head, or straight behind it to get up.
  const { spacing } = animal.plan;
  for (let i = 0; i < joints.length; i++) {
    const point = scratch[i];
    if (point === undefined) continue;
    point.x = head.x - Math.cos(animal.heading) * spacing * i;
    point.y = head.y - Math.sin(animal.heading) * spacing * i;
  }
  if (sleep.asleep && scratch.length === joints.length) {
    curl(scratch, spacing, animal.heading, sleep.turns);
  }
  const rate = sleep.asleep ? LIE_RATE : RISE_RATE;
  const k = instant ? 1 : 1 - Math.exp(-rate * dtS);
  for (let i = 1; i < joints.length; i++) {
    const joint = joints[i];
    const point = scratch[i];
    if (joint === undefined || point === undefined) continue;
    joint.x += (point.x - joint.x) * k;
    joint.y += (point.y - joint.y) * k;
  }
  if (motion.mode !== "travel") {
    // Lying still it does not look about: when it gets up, it looks where it lay facing.
    motion.look = animal.heading;
    motion.facing = animal.heading;
  }
  return sleep.share > 0;
}

/** Snores: a "z" now and then over the animal followed while it sleeps, rising and fading. */
const SNORE_EVERY_S = 2.4;
/** Seconds a "z" rises for, and how far it goes up and to the right (art pixels). */
const SNORE_S = 2.2;
const SNORE_RISE_PX = 12;
const SNORE_DRIFT_PX = 5;
/** How far it sways either way as it rises (art pixels), and how often (sways a second). */
const SNORE_SWAY_PX = 1.5;
const SNORE_SWAY_HZ = 0.8;
/** It starts from this far above and right of the head (art pixels). */
const SNORE_FROM_PX = 3;
/** The share of its rise after which it is drawn larger, and then half see-through. */
const SNORE_GROWS_AT = 0.35;
const SNORE_FADES_AT = 0.75;
/** How many "z"s may be in the air at once. */
const SNORES = 3;
/** A "z": near white (the night's tint turns it moonlit), with a plum shadow below and right of it. */
const SNORE_INK = "#fffaf0";
const SNORE_SHADOW = "#3a2440";
/** The two "z"s, small then large: rows of texels, `#` ink and `.` nothing. */
const SMALL_Z = ["###", "..#", ".#.", "###"];
const LARGE_Z = ["####", "...#", "..#.", ".#..", "####"];

/** A "z" drawn with its shadow a texel below and to the right of it. */
function snoreTexture(rows: readonly string[]): Texture {
  const size = (rows[0]?.length ?? 0) + 1;
  const height = rows.length + 1;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context !== null) {
    const ink = (x: number, y: number): boolean => rows[y]?.[x] === "#";
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < size; x++) {
        if (ink(x, y)) context.fillStyle = SNORE_INK;
        else if (ink(x - 1, y - 1)) context.fillStyle = SNORE_SHADOW;
        else continue;
        context.fillRect(x, y, 1, 1);
      }
    }
  }
  return Texture.from({ resource: canvas, scaleMode: "nearest" });
}

export class Snores {
  /** Add this to the world, over the animals (in cells). */
  readonly container = new Container();
  private textures: [Texture, Texture] | null = null;
  private readonly sprites: Sprite[] = [];
  private readonly ages: number[] = [];
  private readonly from: Point[] = [];
  private wait = 0;
  private next = 0;

  /**
   * Move them on by `dtS`: `head` is where the head of the animal followed is while it
   * sleeps (cells), null while it is awake or none is followed; `pixel` is an art pixel in
   * cells in the view drawn.
   */
  update(dtS: number, head: Point | null, pixel: number): void {
    if (head !== null) {
      this.wait -= dtS;
      if (this.wait <= 0) {
        this.wait = SNORE_EVERY_S;
        this.puff(head, pixel);
      }
    } else {
      this.wait = SNORE_EVERY_S / 2;
    }
    this.sprites.forEach((sprite, k) => {
      const age = (this.ages[k] ?? SNORE_S) + dtS;
      this.ages[k] = age;
      const from = this.from[k];
      if (age >= SNORE_S || from === undefined) {
        sprite.visible = false;
        return;
      }
      const t = age / SNORE_S;
      const sway = Math.sin(2 * Math.PI * SNORE_SWAY_HZ * age) * SNORE_SWAY_PX;
      // Whole art pixels, as everything drawn in the scene.
      const x = Math.round(SNORE_DRIFT_PX * t + sway);
      const y = Math.round(SNORE_RISE_PX * t);
      sprite.position.set(from.x + x * pixel, from.y - y * pixel);
      const large = t >= SNORE_GROWS_AT;
      const texture = this.textures?.[large ? 1 : 0];
      if (texture !== undefined && sprite.texture !== texture) sprite.texture = texture;
      sprite.alpha = t >= SNORE_FADES_AT ? 0.5 : 1;
    });
  }

  private puff(head: Point, pixel: number): void {
    this.textures ??= [snoreTexture(SMALL_Z), snoreTexture(LARGE_Z)];
    while (this.sprites.length < SNORES) {
      const sprite = new Sprite({ texture: this.textures[0], anchor: { x: 0, y: 1 } });
      sprite.visible = false;
      this.sprites.push(sprite);
      this.ages.push(SNORE_S);
      this.from.push({ x: 0, y: 0 });
      this.container.addChild(sprite);
    }
    const k = this.next;
    this.next = (this.next + 1) % SNORES;
    const sprite = this.sprites[k];
    const from = this.from[k];
    if (sprite === undefined || from === undefined) return;
    from.x = head.x + SNORE_FROM_PX * pixel;
    from.y = head.y - SNORE_FROM_PX * pixel;
    this.ages[k] = 0;
    sprite.scale.set(pixel);
    sprite.texture = this.textures[0];
    sprite.visible = true;
  }

  /** Put every "z" away (the view changed). */
  clear(): void {
    for (const sprite of this.sprites) sprite.visible = false;
    this.ages.fill(SNORE_S);
  }
}
