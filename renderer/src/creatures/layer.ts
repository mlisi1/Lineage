/**
 * Creatures: a head that wanders, a chain of joints that follows it, and on that chain
 * whatever the body plan asks for: parts that ride the joints and legs that step.
 * Everything is a sprite of the atlas (tinted discs, wedges and stretched squares), so a
 * creature costs no geometry rebuild, only transforms.
 */
import { AlphaFilter, Container, Sprite, type Texture } from "pixi.js";
import { DISC_SIZE, type Atlas } from "./atlas";
import { FIRST_LOOK, LAYER, bodyPlan, type BodyOptions, type BodyPlan, type LegPlan } from "./body";
import type { CellRect } from "../terrain/land";
import {
  curl,
  followChain,
  neckDirection,
  pivot,
  solveKnee,
  stiffness,
  withinTurn,
  type Point,
  type Stiffness,
} from "./chain";
import { breath, clearAnchor, drive, newMotion, reanchor, stepOut, type Motion } from "./motion";
import { DYING, TINT_STEPS, mixColour, type Dying } from "./remains";
import { kindFor, speciesPlans, type SpeciesPlan } from "./species";
import {
  opacityUnderWater,
  seaKey,
  shadowUnderWater,
  underWater,
  type SeaAt,
  type WaterLook,
} from "./water";
import type { CreatureSeed } from "./seed";
import type { Footprints, Passable } from "./habitat";
import { dotOf, dotSize } from "./markers";
import {
  RIPPLES,
  SWASH_SEA,
  bobAt,
  effortOf,
  paceIn,
  rippleAt,
  ringTexture,
  wetOf,
  type Wet,
} from "./wading";
import { MAP_TILE } from "../terrain/ground";
import type { Random } from "../rng";

/** Wandering: how fast the turn rate drifts and settles (per second). */
const TURN_JITTER = 6;
const TURN_DAMPING = 1.5;
const AVOID_TURN = 3.5;
const LOOK_AHEAD_CELLS = 1.2;
/**
 * Legs step in turn: the body goes once through its gait cycle for every so many lengths
 * of its shortest stepping leg that it walks, and each foot swings in its own part of the
 * cycle and stands still the rest of it.
 */
const STRIDE_LEGS = 1.5;
/** The share of the cycle a foot spends in the air. */
const SWING_SHARE = 0.4;
/**
 * The feet of a pair swing half a cycle apart, and so do the same side's feet of
 * neighbouring pairs (diagonal pairs together: a trot, a tripod); each pair behind the
 * first lifts this much of a cycle later than its diagonal partner in front.
 */
const PAIR_LAG = 0.06;
/** How high a foot is lifted at the middle of its swing, in leg lengths (toward the light). */
const FOOT_LIFT = 0.1;
/**
 * A body standing or creeping still steps at least once in so many seconds while a foot
 * is in the air or farther than `SETTLE_OFF` leg lengths from where it should stand, so
 * that it comes to rest with every foot down under it.
 */
const SETTLE_CYCLE_S = 0.8;
const SETTLE_OFF = 0.25;
/** A foot farther than so many leg lengths from its place (put somewhere new, or back in view) is put there. */
const SNAP_LEGS = 3;
/** The most of a cycle one frame may advance, so that a long frame skips no foot's swing. */
const MAX_ADVANCE = 0.25;
/** How quickly (per second) the share of the cycle that comes from walking follows it. */
const STRIDING_RATE = 6;
/** Texels across the white square of the atlas. */
const WHITE_TEXELS = 2;
/** How far (cells) a creature that starts where it cannot live is moved to where it can. */
const SETTLE_REACH = 48;
/** On the map a creature is a dot (`creatures/markers.ts`) with this dark edge. */
const MARKER_EDGE = 0x1b1b1b;
/** Toward the light: up and to the left. */
const LIGHT = Math.SQRT1_2;
/**
 * Flippers row: so many strokes to a body length travelled, swinging this far (radians)
 * either side of where they rest, which is a little behind straight out to the side.
 */
const STROKES_PER_LENGTH = 1.1;
const STROKE_SWING = 0.55;
const FLIPPER_REST = 0.3;
/** Where along its length a flipper is joined to the body. */
const FLIPPER_ROOT = 0.12;
/**
 * A webbed foot: how far past the end of the leg its middle is, in foot radii, and how
 * long (the way the shin points) and wide it is against a round foot.
 */
const WEB_AHEAD = 0.5;
const WEB_LONG = 0.9;
const WEB_WIDE = 1.2;

/** How a layer's creatures are shown: as bodies, as dots on the map, or not at all. */
export type Showing = "bodies" | "markers" | "hidden";

/**
 * How they move: `wander` roams freely (the benchmark, which has no sim behind it);
 * `anchored` keeps each near the place the sim gives it (`anchor`), with life of its own
 * between sim ticks (`motion.ts`).
 */
export type Life = "wander" | "anchored";
/** A glint in an eye: it keeps more of itself under water. */
const GLINT = 0xffffff;
/** A torpid animal breathes this many times slower. */
const TORPID_BREATH = 3;
/** At a full breath the chest is this much wider. */
const BREATH_WIDENS = 0.08;

interface Leg {
  plan: LegPlan;
  foot: Point;
  target: Point;
  /** The two bones of a leg; a flipper is one blade, in `upper`. */
  upper: Sprite;
  lower: Sprite | null;
  /** The dark edge round the two bones and the foot, on legs thick enough for one. */
  edges: Sprite[];
  /** The foot at the end of the leg, on legs thick enough to show one. */
  sole: Sprite | null;
  /** The foot is webbed: a paddle set across the way the leg points. */
  webbed: boolean;
  /** Its foot has been put down once; until then it is put where it rests, not swung there. */
  planted: boolean;
  /** Where in the gait cycle its swing starts (0 to 1). */
  phase: number;
  /** The foot is in the air, swinging from `lift` to `target`. */
  swinging: boolean;
  lift: Point;
}

interface Creature {
  plan: BodyPlan;
  container: Container;
  marker: Container;
  joints: Point[];
  /** How far its body bends at each joint, and its head from its body. */
  stiffness: Stiffness;
  heading: number;
  turn: number;
  avoid: 1 | -1;
  /** How far through a stroke its flippers are, in radians. */
  stroke: number;
  /** How far through its gait cycle its legs are (0 to 1), and the cells walked to one cycle. */
  gait: number;
  stride: number;
  /** Cells walked since its legs were last placed. */
  walked: number;
  /** The share of the gait cycle's advance that comes from walking (smoothed), not settling. */
  striding: number;
  /** A foot is in the air or out of its place, so the legs step even standing still. */
  unsettled: boolean;
  /** Where it may go, if it is kept somewhere. */
  pen: CreatureSeed["pen"];
  /** One sprite per part of the plan, in the same order. */
  sprites: Sprite[];
  legs: Leg[];
  /** Within the view of the last update, so worth drawing. */
  inView: boolean;
  /** With anchored life: where the sim has it and what it is doing there. */
  motion: Motion | null;
  /** Its mass, which sets how slowly it breathes. */
  mass: number;
  /** Lying torpid: curled up, still, breathing slowly. */
  torpid: boolean;
  /** Held where `pin` put it (debugging the look: an animal placed by hand), not moving. */
  pinned?: boolean;
  /** Put or sent by hand (`pin`, `send`): the sim's places for it are ignored from then on. */
  staged?: boolean;
  /** Every sprite of the body with its colour and opacity out of water. */
  paints: { sprite: Sprite; colour: number; alpha: number }[];
  /** The water it was last coloured for (`seaKey`), -1 for none. */
  seaKey: number;
  /** A walker in the water (R5, `creatures/wading.ts`): how hard it is for it (0–1). */
  effort: number;
  /** Whether the water holds it, and how fast it goes there against on land. */
  wet: Wet;
  waterPace: number;
  /** The rings that spread from it in the water, made the first time it wades. */
  ripples: Sprite[] | null;
  /** Its legs' sprites and the joint each of its parts rides, made the first time it wades. */
  legSprites: Set<Sprite> | null;
  /** Glass: what draws the body see-through, once it needs one. */
  glass?: AlphaFilter;
  /** The joint at its widest, which breathes; and how far into a breath it started. */
  chest: number;
  breathOffset: number;
  /** Arriving (R4, the ark): seconds into its arrival and how long it takes, while it lasts. */
  arriving?: { age: number; lasts: number };
}

/** Ripples round a walker in the water: the foam's white. */
const RIPPLE_TINT = 0xf4fbff;
/**
 * What the plants answer about where they stand (R5, `PlantLayer.over`): the row of the
 * first (backmost) tree or bush whose drawing overlaps `box`, among those whose foot lies
 * from as far behind row `from` to as far in front of row `to` as a plant's drawing
 * reaches; -1 if none.
 */
export interface Occluders {
  over(box: CellRect, from: number, to: number): number;
}

/** Steps of opacity an arriving creature comes into being in (and a dead one fades in). */
const ARRIVE_STEPS = 4;
/** A creature that died, going where it fell (`remove`). */
interface Departing {
  creature: Creature;
  how: Dying;
  /** Seconds since it died. */
  age: number;
  /** Its sprites in the order they go: legs first, then from the tail to the head. */
  order: Sprite[];
  /** How many of `order` are gone, and the colour step it was last painted at. */
  gone: number;
  tinted: number;
}

export class CreatureLayer {
  /** Whether the swash covers the beach at a place now (R5, wet feet); none, never. */
  swash: ((x: number, y: number) => boolean) | null = null;
  /** Creatures not standing among plants, and every marker. Add this to the world. */
  readonly container = new Container();
  /** Creatures that died, going where they fell. */
  private departing: Departing[] = [];
  /** By slot; a slot the stream's cast has emptied (`remove`) is undefined. */
  private readonly creatures: (Creature | undefined)[] = [];
  private active = 0;
  private only: number | null = null;
  private showing: Showing = "bodies";
  // Scratch, reused every frame so the animation allocates nothing.
  private readonly hip: Point = { x: 0, y: 0 };
  private readonly knee: Point = { x: 0, y: 0 };
  private readonly foot: Point = { x: 0, y: 0 };
  private readonly dirX = new Float32Array(16);
  private readonly dirY = new Float32Array(16);
  private readonly angle = new Float32Array(16);
  /** Seconds since the layer began: the clock breaths keep. */
  private clock = 0;
  /** The trees and bushes anchored animals keep clear of (R5), if any. */
  private footprints: Footprints | null = null;

  constructor(
    private readonly atlas: Atlas,
    private readonly seeds: readonly CreatureSeed[],
    private readonly passable: Passable,
    private readonly random: Random,
    private readonly body: BodyOptions = FIRST_LOOK,
    private readonly life: Life = "wander",
    /** The water at a place: swimmers are coloured as seen through it. */
    private readonly sea: SeaAt | null = null,
    /** How they are seen through it. */
    private readonly water: WaterLook = "hue",
  ) {
    this.plans = speciesPlans(seeds);
  }

  /** What each species among the seeds is drawn as (one plan per species). */
  private plans: ReadonlyMap<number, SpeciesPlan>;

  /**
   * Draw the species among `members` by their plans from now on (the census changed):
   * animals placed after this take their species' kind from them; those drawn keep theirs.
   */
  replan(members: readonly CreatureSeed[]): void {
    this.plans = speciesPlans(members);
  }

  /** What each species is drawn as now (R5: the name card's portrait draws its animal so). */
  get speciesPlans(): ReadonlyMap<number, SpeciesPlan> {
    return this.plans;
  }

  /** Draw the species by `plans` from now on (R5: a portrait takes the scene's own). */
  usePlans(plans: ReadonlyMap<number, SpeciesPlan>): void {
    this.plans = plans;
  }

  /**
   * Put `seed` in slot `index`, in place of whoever was there: a creature of the stream's
   * cast (R3), which comes and goes as the sim's animals are born and die. With anchored
   * life it then lives near the place `seed` gives until `anchor` moves it.
   */
  place(index: number, seed: CreatureSeed): void {
    this.remove(index);
    const creature = this.spawnFrom(seed, false);
    this.creatures[index] = creature;
    this.active = Math.max(this.active, index + 1);
    this.reveal(creature, index);
  }

  /**
   * Draw slot `index`'s creature again from `seed` where it is, going on as it was (R5:
   * its colours change when the species alive do, a young one grows): the same place,
   * heading and motion, a new body.
   */
  rebuild(index: number, seed: CreatureSeed): void {
    const old = this.creatures[index];
    if (old === undefined) {
      this.place(index, seed);
      return;
    }
    const creature = this.spawnFrom(seed, false);
    const head = old.joints[0] ?? { x: seed.x, y: seed.y };
    creature.joints.forEach((joint, i) => {
      joint.x = head.x - Math.cos(old.heading) * creature.plan.spacing * i;
      joint.y = head.y - Math.sin(old.heading) * creature.plan.spacing * i;
    });
    if (seed.torpid) curl(creature.joints, creature.plan.spacing, old.heading);
    creature.heading = old.heading;
    creature.turn = old.turn;
    creature.avoid = old.avoid;
    creature.motion = old.motion;
    creature.inView = old.inView;
    if (old.arriving !== undefined) creature.arriving = old.arriving;
    // Where the old one stood among the plants, the new one stands.
    const host = old.container.parent;
    if (host !== null && host !== creature.container.parent) {
      host.addChildAt(creature.container, host.getChildIndex(old.container));
    }
    creature.container.visible = old.container.visible;
    creature.marker.visible = old.marker.visible;
    creature.container.alpha = old.container.alpha;
    creature.marker.alpha = old.marker.alpha;
    this.creatures[index] = creature;
    this.destroy(old);
  }

  /**
   * Empty slot `index`: its creature is taken off the screen for good, at once, or (one
   * that died, `fade`) going where it fell, as `how` says (`creatures/remains.ts`): it lies
   * still, its colours turning, then its parts go in steps, legs first, then from the tail
   * to the head. No filter: whole sprites go, so nothing shows through anything.
   */
  remove(index: number, fade = false, how: Dying = DYING.unknown): void {
    const creature = this.creatures[index];
    if (creature === undefined) return;
    this.creatures[index] = undefined;
    if (fade && (creature.container.visible || creature.marker.visible)) {
      const legs = new Set(
        creature.legs.flatMap((leg) => [
          leg.upper,
          ...(leg.lower === null ? [] : [leg.lower]),
          ...leg.edges,
          ...(leg.sole === null ? [] : [leg.sole]),
        ]),
      );
      const parts = creature.plan.parts;
      const body = creature.sprites
        .map((sprite, i) => ({ sprite, joint: parts[i]?.joint ?? 0 }))
        .sort((a, b) => b.joint - a.joint)
        .map(({ sprite }) => sprite);
      // What is not of the body (ripples, a shadow) goes at once, and a sunk body's legs.
      for (const ring of creature.ripples ?? []) ring.visible = false;
      for (const { sprite, alpha } of creature.paints) if (alpha < 1) sprite.visible = false;
      if (how.sinks) for (const sprite of legs) sprite.visible = false;
      this.departing.push({
        creature,
        how,
        age: 0,
        order: [...legs, ...body],
        gone: 0,
        tinted: 0,
      });
      return;
    }
    this.destroy(creature);
  }

  private destroy(creature: Creature): void {
    creature.container.destroy({ children: true });
    creature.marker.destroy({ children: true });
    creature.glass?.destroy();
  }

  /** The dead going where they fell, step by step, until they are gone. */
  private depart(dtS: number): void {
    // Kept in place, so that a frame makes no new list.
    let kept = 0;
    for (const leaving of this.departing) {
      if (this.going(leaving, dtS)) this.departing[kept++] = leaving;
    }
    this.departing.length = kept;
  }

  /** Move `leaving` on by `dtS`: whether it is still there. */
  private going(leaving: Departing, dtS: number): boolean {
    leaving.age += dtS;
    const { creature, how, order } = leaving;
    const lasts = how.still + how.goes;
    if (leaving.age >= lasts) {
      this.destroy(creature);
      return false;
    }
    // Its colours turn while it lies still, in a few steps.
    const step = Math.min(
      Math.floor((leaving.age / Math.max(how.still, 0.01)) * TINT_STEPS) + 1,
      TINT_STEPS,
    );
    if (how.tinted > 0 && step !== leaving.tinted) {
      leaving.tinted = step;
      const share = (how.tinted * step) / TINT_STEPS;
      for (const { sprite, colour, alpha } of creature.paints) {
        if (alpha >= 1) sprite.tint = mixColour(colour, how.tint, share);
      }
    }
    // Then its parts go, legs first, then from the tail to the head.
    const share = Math.max(leaving.age - how.still, 0) / Math.max(how.goes, 0.01);
    const gone = Math.min(Math.floor(share * (order.length + 1)), order.length);
    for (; leaving.gone < gone; leaving.gone++) {
      const sprite = order[leaving.gone];
      if (sprite !== undefined) sprite.visible = false;
    }
    // On the map its dot fades in steps.
    creature.marker.alpha =
      Math.ceil((1 - leaving.age / lasts) * ARRIVE_STEPS) / (ARRIVE_STEPS + 1);
    return true;
  }

  /**
   * The creature in slot `index` arrives (R4, the ark's newcomers): it comes into being
   * over `seconds`, see-through at first, in a few steps as pixel art does.
   */
  arrive(index: number, seconds: number): void {
    const creature = this.creatures[index];
    if (creature === undefined) return;
    creature.arriving = { age: 0, lasts: seconds };
    this.materialise(creature);
  }

  private materialise(creature: Creature): void {
    const arriving = creature.arriving;
    if (arriving === undefined) return;
    const done = arriving.age >= arriving.lasts;
    const opacity = done
      ? 1
      : (Math.floor((arriving.age / arriving.lasts) * ARRIVE_STEPS) + 1) / (ARRIVE_STEPS + 1);
    creature.marker.alpha = opacity;
    if (done) {
      creature.arriving = undefined;
      creature.container.filters = [];
      creature.seaKey = -2; // colour it for the water it is in again
      return;
    }
    creature.glass ??= new AlphaFilter();
    creature.glass.alpha = opacity;
    creature.container.filters = [creature.glass];
  }

  /** Whether slot `index` holds a creature. */
  has(index: number): boolean {
    return this.creatures[index] !== undefined;
  }

  /** Creature `index` lies torpid (curled up, still) or wakes. */
  setTorpid(index: number, torpid: boolean): void {
    const creature = this.creatures[index];
    if (creature === undefined || creature.torpid === torpid) return;
    creature.torpid = torpid;
    if (torpid) curl(creature.joints, creature.plan.spacing, creature.heading);
  }

  /**
   * From now on anchored walkers keep clear of `footprints` (R5: the trees and bushes of
   * the plants they stand among), or of nothing with null. Swimmers pass under what stands
   * in the sea.
   */
  standAmong(footprints: Footprints | null): void {
    this.footprints = footprints;
  }

  /**
   * Whether a creature can stand at (x, y): on its ground, and (a walker) clear of the
   * trees and bushes by the width of its body.
   */
  private clear(creature: Creature, x: number, y: number): boolean {
    const { plan } = creature;
    if (!this.passable(x, y, plan.swims)) return false;
    const footprints = plan.swims ? null : this.footprints;
    return footprints === null || !footprints.blocked(x, y, plan.radii[creature.chest] ?? 0);
  }

  /**
   * Where the sim now has creature `index`, in cells. An anchored creature walks there
   * (or is put there, if too far to walk); a wandering one ignores it.
   */
  anchor(index: number, x: number, y: number): void {
    const creature = this.creatures[index];
    // One staged by hand keeps to what it was given, whatever the sim says meanwhile.
    if (creature?.staged === true) return;
    const motion = creature?.motion;
    const head = creature?.joints[0];
    if (creature === undefined || motion === undefined || motion === null || head === undefined) {
      return;
    }
    const { plan } = creature;
    const walker = { head, heading: creature.heading, pace: plan.pace, length: plan.length };
    if (reanchor(motion, walker, x, y)) {
      // Put there, beside the trunk or bush it may be in (R5): the body comes along in a
      // line behind the head.
      if (this.passable(x, y, plan.swims)) {
        clearAnchor(motion, (x, y) => this.clear(creature, x, y), plan.length);
      }
      const { anchor } = motion;
      creature.joints.forEach((joint, i) => {
        joint.x = anchor.x - Math.cos(creature.heading) * plan.spacing * i;
        joint.y = anchor.y - Math.sin(creature.heading) * plan.spacing * i;
      });
    }
  }

  /** Where the sim has creature `index` (anchored), or where its head is (wandering). */
  anchorOf(index: number): Point | null {
    const creature = this.creatures[index];
    return creature?.motion?.anchor ?? creature?.joints[0] ?? null;
  }

  /** Number of sprites the active creatures are made of. */
  get spriteCount(): number {
    let total = 0;
    for (const creature of this.creatures.slice(0, this.active)) {
      total += creature?.container.children.length ?? 0;
    }
    return total;
  }

  /** Animate exactly `count` creatures; more are created on demand, extras are hidden. */
  setCount(count: number): void {
    while (this.creatures.length < count) this.creatures.push(this.spawn(this.creatures.length));
    this.active = count;
    this.refresh();
  }

  /** Show the creatures as bodies, as dots, or not at all; `only` picks a single one. */
  show(showing: Showing, only: number | null = null): void {
    if (this.showing === showing && this.only === only) return;
    this.showing = showing;
    this.only = only;
    this.refresh();
  }

  /** The middle of creature `index`'s body, in cells. */
  centre(index: number): Point {
    const joints = this.creatures[index]?.joints ?? [];
    return joints[Math.floor(joints.length / 2)] ?? { x: 0, y: 0 };
  }

  /** Creature `index`'s joints from the head back, and the body's radius at each (cells; R4's glow). */
  spine(index: number): { joints: readonly Point[]; radii: readonly number[] } {
    const creature = this.creatures[index];
    return { joints: creature?.joints ?? [], radii: creature?.plan.radii ?? [] };
  }

  /** The box creature `index`'s body fills, in cells: what must show through what covers it. */
  box(index: number): CellRect {
    const creature = this.creatures[index];
    const box = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
    creature?.joints.forEach((joint, i) => {
      const radius = creature.plan.radii[i] ?? 0;
      box.x0 = Math.min(box.x0, joint.x - radius);
      box.x1 = Math.max(box.x1, joint.x + radius);
      box.y0 = Math.min(box.y0, joint.y - radius);
      box.y1 = Math.max(box.y1, joint.y + radius);
    });
    return box;
  }

  /**
   * Stand every creature among the plants: `guests` holds one container per row,
   * `rowsPerCell` of them to the cell, and a creature goes in the row of its lowest
   * point, so that what grows in front of it covers it. With null they go back to the
   * layer's own container.
   */
  /**
   * The highest point of slot `index`'s body (cells): what stands in a row after it covers
   * some part of it, its head behind a bush included (R5, `PlantLayer.fade`).
   */
  topOf(index: number): number {
    let highest = Infinity;
    for (const joint of this.creatures[index]?.joints ?? []) highest = Math.min(highest, joint.y);
    return highest;
  }

  /**
   * Put slot `index`'s animal at (x, y) facing `heading` (radians), its body straight
   * behind its head, and hold it there (debugging the look: an animal placed exactly where
   * it is to be seen, as among bushes). Its legs stand where they rest.
   */
  pin(index: number, x: number, y: number, heading: number): void {
    const creature = this.creatures[index];
    if (creature === undefined) return;
    creature.pinned = true;
    creature.staged = true;
    creature.heading = heading;
    creature.joints.forEach((joint, i) => {
      joint.x = x - Math.cos(heading) * creature.plan.spacing * i;
      joint.y = y - Math.sin(heading) * creature.plan.spacing * i;
    });
    for (const leg of creature.legs) leg.planted = false;
    if (creature.motion !== null) {
      creature.motion.anchor.x = x;
      creature.motion.anchor.y = y;
    }
  }

  /**
   * Let slot `index`'s animal go from where it is to (x, y) as it goes to where the sim has
   * it, steering round plants on the way (debugging the look: a walk staged by hand).
   */
  send(index: number, x: number, y: number): void {
    const creature = this.creatures[index];
    if (creature === undefined || creature.motion === null) return;
    creature.pinned = false;
    creature.staged = true;
    creature.motion.anchor.x = x;
    creature.motion.anchor.y = y;
    creature.motion.mode = "travel";
    creature.motion.goal.x = x;
    creature.motion.goal.y = y;
  }

  /** The lowest point of slot `index`'s body (cells): the row `hostIn` stands it in. */
  footOf(index: number): number {
    let lowest = -Infinity;
    for (const joint of this.creatures[index]?.joints ?? []) lowest = Math.max(lowest, joint.y);
    return lowest;
  }

  hostIn(
    guests: readonly Container[] | null,
    rowsPerCell = 1,
    occluders: Occluders | null = null,
  ): void {
    for (let index = 0; index < this.active; index++) {
      const creature = this.creatures[index];
      if (creature === undefined) continue;
      if (guests === null) {
        if (creature.container.parent !== this.container)
          this.container.addChild(creature.container);
        continue;
      }
      const last = guests.length - 1;
      const rowOf = (y: number): number => Math.min(Math.max(Math.floor(y * rowsPerCell), 0), last);
      let lowest = 0;
      let highest = last;
      for (const joint of creature.joints) {
        const row = rowOf(joint.y);
        lowest = Math.max(lowest, row);
        highest = Math.min(highest, row);
      }
      // An animal is seen from above, so a tree's or a bush's leaves are over it wherever
      // the plant's drawing overlaps it, whichever side of the plant its feet are (R5:
      // drawn by the row of its feet alone, an animal in front of a bush or across one
      // seemed to lie on top of it). It goes in the row before the first plant that
      // overlaps it; grass and small things keep to the rows of its feet.
      let row = lowest;
      if (
        occluders !== null &&
        creature.inView &&
        !creature.plan.swims &&
        creature.arriving === undefined
      ) {
        const under = occluders.over(this.box(index), highest, lowest);
        if (under >= 0) row = Math.min(lowest, Math.max(under - 1, 0));
      }
      const host = guests[row] ?? this.container;
      if (creature.container.parent !== host) host.addChild(creature.container);
    }
  }

  /**
   * Move every creature on by `dtS` seconds. Bodies are worked out only for those in
   * `view` (all of them when it is left out), and not at all with `posed` false, as when
   * they are shown as dots: the others walk on as a head and a chain.
   */
  update(dtS: number, view?: CellRect, posed = true): void {
    this.clock += dtS;
    this.depart(dtS);
    for (let index = 0; index < this.active; index++) {
      const creature = this.creatures[index];
      if (creature === undefined) continue;
      // A torpid animal lies where it is; the others move.
      const head =
        creature.torpid || creature.pinned
          ? (creature.joints[0] ?? { x: 0, y: 0 })
          : creature.motion === null
            ? this.wander(creature, dtS)
            : this.live(creature, dtS);
      // In sight, with room for the whole body to stick into the picture.
      const reach = creature.plan.length + 1;
      const inView =
        view === undefined ||
        (head.x >= view.x0 - reach &&
          head.x <= view.x1 + reach &&
          head.y >= view.y0 - reach &&
          head.y <= view.y1 + reach);
      if (inView && posed) {
        this.pose(creature, dtS);
        if (creature.plan.swims && creature.arriving === undefined) this.wet(creature, head);
        else if (creature.motion !== null && creature.arriving === undefined) {
          this.wade(creature, head);
        }
      }
      if (creature.arriving !== undefined) {
        creature.arriving.age += dtS;
        this.materialise(creature);
      }
      if (creature.inView !== inView) {
        creature.inView = inView;
        this.reveal(creature, index);
      }
    }
  }

  private refresh(): void {
    this.creatures.forEach((creature, index) => {
      if (creature !== undefined) this.reveal(creature, index);
    });
  }

  /** Show a creature or not: by the count, the choice of one, the way of showing, the view. */
  private reveal(creature: Creature, index: number): void {
    const chosen = index < this.active && (this.only ?? index) === index;
    creature.container.visible = chosen && this.showing === "bodies" && creature.inView;
    creature.marker.visible = chosen && this.showing === "markers";
  }

  /** The nearest cell to (x, y) this body can live in, searching outward in rings. */
  private settle(x: number, y: number, swims: boolean): Point {
    for (let reach = 0; reach <= SETTLE_REACH; reach++) {
      for (let dy = -reach; dy <= reach; dy++) {
        for (let dx = -reach; dx <= reach; dx++) {
          // Only the ring at this distance: the inside was searched already.
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== reach) continue;
          if (this.passable(x + dx, y + dy, swims)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return { x, y };
  }

  private spawn(index: number): Creature {
    const seed = this.seeds[index % this.seeds.length];
    if (seed === undefined) throw new Error("the fixture has no creatures");
    // Past the fixture's creatures, reuse them a few cells away.
    return this.spawnFrom(seed, index >= this.seeds.length);
  }

  private spawnFrom(seed: CreatureSeed, clone: boolean): Creature {
    const random = this.random;
    const plan = bodyPlan(seed, this.body, kindFor(seed, this.plans));
    const { x, y } = this.settle(
      seed.x + (clone ? (random() - 0.5) * 8 : 0),
      seed.y + (clone ? (random() - 0.5) * 8 : 0),
      plan.swims,
    );
    const heading = random() * Math.PI * 2;
    const joints = Array.from({ length: plan.joints }, (_, i) => ({
      x: x - Math.cos(heading) * plan.spacing * i,
      y: y - Math.sin(heading) * plan.spacing * i,
    }));
    if (seed.torpid) curl(joints, plan.spacing, heading);

    const container = new Container();
    this.container.addChild(container);
    // Legs first: the body covers the hips. All their edges go under all of the legs.
    const bar = (tint: number): Sprite => {
      const sprite = new Sprite({ texture: this.atlas.white, anchor: { x: 0, y: 0.5 } });
      sprite.tint = tint;
      return container.addChild(sprite);
    };
    /** A foot: round, or with `webbed` a paddle, an oval wider than it is long. */
    const round = (tint: number, radius: number, webbed = false): Sprite => {
      const sprite = new Sprite({ texture: this.atlas.disc, anchor: 0.5 });
      sprite.tint = tint;
      const across = (2 * radius) / DISC_SIZE;
      if (webbed) sprite.scale.set(across * WEB_LONG, across * WEB_WIDE);
      else sprite.scale.set(across);
      return container.addChild(sprite);
    };
    /** A flipper: an oval blade, held near one end; `margin` wider all round for its edge. */
    const blade = (tint: number, length: number, width: number, margin = 0): Sprite => {
      const long = length + 2 * margin;
      const sprite = new Sprite({
        texture: this.atlas.disc,
        anchor: { x: (FLIPPER_ROOT * length + margin) / long, y: 0.5 },
      });
      sprite.tint = tint;
      sprite.scale.set(long / DISC_SIZE, (width + 2 * margin) / DISC_SIZE);
      return container.addChild(sprite);
    };
    const edges = plan.legs.map((leg): Sprite[] => {
      // The dark edge of a leg is the colour of the outline round the body.
      const edge = plan.outline;
      if (leg.edge === 0) return [];
      if (leg.fin === 1) return [blade(edge, leg.length, leg.thickness, leg.edge)];
      const bones = [bar(edge), bar(edge)];
      return leg.foot > 0 ? [...bones, round(edge, leg.foot + leg.edge, leg.fin > 0)] : bones;
    });
    const legs = plan.legs.map((leg, index): Leg => {
      const flipper = leg.fin === 1;
      // Legs come in pairs, front first: the pair's two sides half a cycle apart, and
      // each pair against the one in front, so that diagonal feet swing together.
      const pair = Math.floor(index / 2);
      const phase = ((pair % 2) * 0.5 + (leg.side === 1 ? 0 : 0.5) + pair * PAIR_LAG) % 1;
      return {
        plan: leg,
        foot: { x, y },
        target: { x, y },
        upper: flipper ? blade(leg.sole, leg.length, leg.thickness) : bar(leg.colour),
        lower: flipper ? null : bar(leg.colour),
        edges: edges[index] ?? [],
        sole: !flipper && leg.foot > 0 ? round(leg.sole, leg.foot, leg.fin > 0) : null,
        webbed: leg.fin > 0,
        planted: false,
        phase,
        swinging: false,
        lift: { x, y },
      };
    });
    // The gait is measured in the shortest leg that steps (flippers row, `walk`).
    const steppers = plan.legs.filter((leg) => leg.fin < 1).map((leg) => leg.length);
    const shortest = steppers.length > 0 ? Math.min(...steppers) : 0;
    const textures: Record<string, [Texture, number]> = {
      disc: [this.atlas.disc, DISC_SIZE],
      wedge: [this.atlas.wedge, DISC_SIZE],
      bar: [this.atlas.white, WHITE_TEXELS],
    };
    const sprites = plan.parts.map((part) => {
      const [texture, texels] = textures[part.shape] ?? [this.atlas.disc, DISC_SIZE];
      const sprite = new Sprite({ texture, anchor: 0.5 });
      sprite.tint = part.colour;
      sprite.alpha = part.alpha ?? 1;
      sprite.scale.set(part.along / texels, part.across / texels);
      return container.addChild(sprite);
    });

    // The dot that stands for it on the map: its colour, with a dark edge.
    const marker = new Container();
    // The young are the smallest dots, whatever they will grow to.
    const young = seed.growth !== undefined && seed.growth < 1;
    const dot = dotOf(young ? "small" : dotSize(seed.mass), plan.swims);
    for (const [texture, tint] of [
      [dot.edge, MARKER_EDGE],
      [dot.fill, plan.colour],
    ] as const) {
      const pixels = new Sprite({ texture, anchor: 0.5 });
      pixels.tint = tint;
      pixels.scale.set(1 / MAP_TILE);
      marker.addChild(pixels);
    }
    marker.visible = false;
    this.container.addChild(marker);

    return {
      plan,
      motion: this.life === "anchored" ? newMotion({ x, y }, heading) : null,
      chest: plan.radii.indexOf(Math.max(...plan.radii)),
      breathOffset: random(),
      mass: seed.mass,
      torpid: seed.torpid,
      paints: container.children
        .filter((child): child is Sprite => child instanceof Sprite)
        .map((sprite) => ({ sprite, colour: sprite.tint, alpha: sprite.alpha })),
      seaKey: -1,
      effort: effortOf(seed.aquatic),
      wet: "dry",
      waterPace: 1,
      ripples: null,
      legSprites: null,
      pen: seed.pen,
      container,
      marker,
      joints,
      stiffness: stiffness(plan.kind, plan.joints, plan.spacing),
      heading,
      turn: 0,
      avoid: random() < 0.5 ? 1 : -1,
      stroke: random() * Math.PI * 2,
      gait: random(),
      stride: STRIDE_LEGS * shortest,
      walked: 0,
      striding: 0,
      unsettled: true,
      sprites,
      legs,
      inView: true,
    };
  }

  /** Colour a swimmer as seen through the water at its head, when that water changes. */
  private wet(creature: Creature, head: Point): void {
    const sea = this.sea?.(head.x, head.y) ?? null;
    const key = seaKey(sea);
    if (key === creature.seaKey) return;
    creature.seaKey = key;
    for (const { sprite, colour, alpha } of creature.paints) {
      if (sea === null) {
        sprite.tint = colour;
        sprite.alpha = alpha;
      } else if (alpha < 1) {
        // The one see-through part is its shadow on the bottom.
        sprite.alpha = shadowUnderWater(alpha, sea);
      } else {
        sprite.tint = underWater(colour, sea, colour === GLINT, this.water);
      }
    }
    // Glass: the body is see-through as one, so that its parts do not show through each other.
    const opacity = sea === null ? 1 : opacityUnderWater(sea, this.water);
    if (opacity < 1) {
      creature.glass ??= new AlphaFilter();
      creature.glass.alpha = opacity;
      creature.container.filters = [creature.glass];
    } else {
      creature.container.filters = [];
    }
  }

  /**
   * A walker in the water (R5, `creatures/wading.ts`): wading in the shallows its legs are
   * under the water; out of its depth they are gone from sight and its body is sunk but for
   * its head, and it bobs; ripples spread from it either way, and it goes slower, all as
   * much as the water is hard for it.
   */
  private wade(creature: Creature, head: Point): void {
    const water = this.sea?.(head.x, head.y) ?? null;
    const inWater = wetOf(water?.below ?? 0);
    // On the beach, the swash may run over its feet (R5, the owner: wet feet at high tide).
    const wet: Wet = inWater === "dry" && this.swash?.(head.x, head.y) === true ? "feet" : inWater;
    const sea = wet === "feet" ? SWASH_SEA : water;
    const { effort } = creature;
    creature.wet = wet;
    creature.waterPace = paceIn(wet, effort);
    if (wet === "dry" && creature.ripples === null) return;
    // Colours change only when the water does.
    const key =
      wet === "dry" ? -1 : (wet === "feet" ? 500 : wet === "shallow" ? 1000 : 2000) + seaKey(sea);
    if (key !== creature.seaKey) {
      creature.seaKey = key;
      creature.legSprites ??= new Set(
        creature.legs.flatMap((leg) => [
          leg.upper,
          ...(leg.lower === null ? [] : [leg.lower]),
          ...leg.edges,
          ...(leg.sole === null ? [] : [leg.sole]),
        ]),
      );
      const jointOf = new Map(
        creature.sprites.map((sprite, i) => [sprite, creature.plan.parts[i]?.joint ?? 0]),
      );
      for (const { sprite, colour, alpha } of creature.paints) {
        const leg = creature.legSprites.has(sprite);
        const sunk = sea !== null && (leg || (wet === "deep" && (jointOf.get(sprite) ?? 0) > 0));
        if (wet === "deep" && leg) {
          sprite.alpha = 0;
        } else if (sunk && alpha >= 1) {
          sprite.tint = underWater(colour, sea, false, this.water);
          sprite.alpha = alpha;
        } else {
          sprite.tint = colour;
          // Its shadow on the ground does not fall on the water.
          sprite.alpha = alpha < 1 && wet !== "dry" ? 0 : alpha;
        }
      }
    }
    creature.container.y = bobAt(wet, effort, this.clock, creature.breathOffset);
    // Rings spread from its widest part.
    const chest = creature.joints[creature.chest] ?? head;
    if (wet !== "dry" && creature.ripples === null) {
      creature.ripples = Array.from({ length: RIPPLES }, () => {
        const ring = new Sprite({ texture: ringTexture(3), anchor: 0.5 });
        ring.tint = RIPPLE_TINT;
        return creature.container.addChildAt(ring, 0);
      });
    }
    creature.ripples?.forEach((ring, k) => {
      const ripple = rippleAt(wet, effort, creature.plan.length, this.clock, k);
      ring.visible = ripple !== null;
      if (ripple === null) return;
      ring.texture = ringTexture(ripple.across * this.body.pixels);
      ring.scale.set(1 / this.body.pixels);
      ring.alpha = ripple.alpha;
      ring.position.set(chest.x, chest.y - creature.container.y);
    });
  }

  /** Anchored: live near where the sim has it, and pull the chain after the head. */
  private live(creature: Creature, dtS: number): Point {
    const { plan, joints, motion } = creature;
    const head = joints[0] ?? { x: 0, y: 0 };
    if (motion === null) return head;
    const { stiffness: stiff } = creature;
    const walker = {
      head,
      heading: creature.heading,
      pace: plan.pace * creature.waterPace,
      length: plan.length,
      // A body that turns on the spot lets its head turn as it likes, and comes round after.
      neck: stiff.pivots ? undefined : neckDirection(joints, creature.heading),
      bend: stiff.neck,
      turning: stiff.turning,
    };
    const ground = (x: number, y: number): boolean => this.passable(x, y, plan.swims);
    const free = (x: number, y: number): boolean => this.clear(creature, x, y);
    // Where the sim has it is drawn beside the plant it may be in, not on it (R5).
    const { anchor } = motion;
    if (ground(anchor.x, anchor.y)) clearAnchor(motion, free, plan.length);
    // Paused with its tail in a bush or on a trunk: it steps out.
    const tail = joints[joints.length - 1];
    if (motion.mode === "pause" && tail !== undefined && ground(tail.x, tail.y)) {
      if (!free(tail.x, tail.y) && free(head.x, head.y)) stepOut(motion, walker, free);
    }
    const stride = drive(motion, walker, dtS, this.random, free, ground);
    creature.heading = walker.heading;
    creature.walked += stride;
    if (stiff.pivots) pivot(joints, creature.heading, stiff.neck);
    creature.stroke += (stride / plan.length) * STROKES_PER_LENGTH * 2 * Math.PI;
    followChain(joints, plan.spacing, stiff, creature.heading, dtS);
    creature.marker.position.set(head.x, head.y);
    return head;
  }

  /** Walk the head on and pull the chain after it. Returns the head. */
  private wander(creature: Creature, dtS: number): Point {
    const { plan, joints } = creature;
    const head = joints[0] ?? { x: 0, y: 0 };
    const random = this.random;

    // Wander, turning away from where this body cannot go.
    creature.turn += ((random() * 2 - 1) * TURN_JITTER - creature.turn * TURN_DAMPING) * dtS;
    let dirX = Math.cos(creature.heading);
    let dirY = Math.sin(creature.heading);
    const { pen } = creature;
    const free = (x: number, y: number): boolean =>
      this.passable(x, y, plan.swims) &&
      (pen === undefined || (x >= pen.x0 && x <= pen.x1 && y >= pen.y0 && y <= pen.y1));
    const blocked = !free(head.x + dirX * LOOK_AHEAD_CELLS, head.y + dirY * LOOK_AHEAD_CELLS);
    creature.heading += (blocked ? creature.avoid * AVOID_TURN : creature.turn) * dtS;
    // The head turns no further from the body than its neck lets it, and the body comes
    // round after; stopped in front of what it cannot cross, or short and stiff, it turns
    // on the spot.
    const { stiffness: stiff } = creature;
    if (blocked || stiff.pivots) {
      pivot(joints, creature.heading, stiff.neck);
    } else {
      creature.heading = withinTurn(
        creature.heading,
        neckDirection(joints, creature.heading),
        stiff.neck,
      );
    }
    dirX = Math.cos(creature.heading);
    dirY = Math.sin(creature.heading);
    const stride = plan.pace * dtS;
    const stuck = !free(head.x, head.y);
    if (!blocked || stuck) {
      head.x += dirX * stride;
      head.y += dirY * stride;
      creature.walked += stride;
      creature.stroke += (stride / plan.length) * STROKES_PER_LENGTH * 2 * Math.PI;
    }
    followChain(joints, plan.spacing, creature.stiffness, creature.heading, dtS);
    creature.marker.position.set(head.x, head.y);
    return head;
  }

  /** Put every part and leg of the body where the chain now is. */
  private pose(creature: Creature, dtS: number): void {
    const { plan, joints } = creature;
    // Which way the body points at each joint: the head where it is going, the others
    // toward the joint in front.
    this.dirX[0] = Math.cos(creature.heading);
    this.dirY[0] = Math.sin(creature.heading);
    this.angle[0] = creature.heading;
    for (let i = 1; i < joints.length; i++) {
      const joint = joints[i];
      const lead = joints[i - 1];
      if (joint === undefined || lead === undefined) continue;
      const span = Math.hypot(lead.x - joint.x, lead.y - joint.y) || 1;
      this.dirX[i] = (lead.x - joint.x) / span;
      this.dirY[i] = (lead.y - joint.y) / span;
      this.angle[i] = Math.atan2(lead.y - joint.y, lead.x - joint.x);
    }

    for (let i = 0; i < plan.parts.length; i++) {
      const part = plan.parts[i];
      const sprite = creature.sprites[i];
      const joint = part === undefined ? undefined : joints[part.joint];
      if (part === undefined || sprite === undefined || joint === undefined) continue;
      const forwardX = this.dirX[part.joint] ?? 1;
      const forwardY = this.dirY[part.joint] ?? 0;
      // To the body's left is its direction turned a quarter.
      sprite.position.set(
        joint.x + forwardX * part.forward - forwardY * part.side - part.lift * LIGHT,
        joint.y + forwardY * part.forward + forwardX * part.side - part.lift * LIGHT,
      );
      sprite.rotation = (this.angle[part.joint] ?? 0) + part.turn;
      // The chest breathes: its masses (not what lies on them) widen and narrow.
      if (part.joint === creature.chest && part.layer > LAYER.ground && part.layer <= LAYER.light) {
        const clock = creature.torpid ? this.clock / TORPID_BREATH : this.clock;
        const full = breath(clock, creature.mass, creature.breathOffset);
        const texels = part.shape === "bar" ? WHITE_TEXELS : DISC_SIZE;
        sprite.scale.y = (part.across / texels) * (1 + BREATH_WIDENS * full);
      }
    }
    this.step(creature, dtS);
    creature.unsettled = false;
    for (const leg of creature.legs) this.walk(creature, leg);
  }

  /**
   * Move the gait cycle on: by the distance walked, and while a foot is in the air or out
   * of place at least at a settling pace, so a body that stops still brings its feet in.
   */
  private step(creature: Creature, dtS: number): void {
    const walked = creature.stride > 0 ? creature.walked / creature.stride : 0;
    creature.walked = 0;
    const settling = creature.unsettled ? dtS / SETTLE_CYCLE_S : 0;
    const advance = Math.min(Math.max(walked, settling), MAX_ADVANCE);
    if (advance > 0) {
      const share = Math.min(1, walked / advance);
      creature.striding += (share - creature.striding) * Math.min(1, dtS * STRIDING_RATE);
    } else {
      creature.striding = 0;
    }
    creature.gait = (creature.gait + advance) % 1;
  }

  private walk(creature: Creature, leg: Leg): void {
    const { joint: at, side, length, thickness, aim } = leg.plan;
    const joint = creature.joints[at];
    if (joint === undefined) return;
    // The body's direction at this joint, and the side the leg is on.
    const forwardX = this.dirX[at] ?? 1;
    const forwardY = this.dirY[at] ?? 0;
    const sideX = -forwardY * side;
    const sideY = forwardX * side;
    const radius = creature.plan.radii[at] ?? 0;
    const hip = this.hip;
    hip.x = joint.x + sideX * radius * 0.7;
    hip.y = joint.y + sideY * radius * 0.7;
    if (leg.lower === null) {
      // A flipper: it swings about where it is joined, each pair a little after the one in front.
      const swing = Math.sin(creature.stroke - at * 0.9) * STROKE_SWING;
      const rotation =
        (this.angle[at] ?? 0) + side * (Math.PI / 2 + FLIPPER_REST - 0.4 * aim + swing);
      for (const sprite of [leg.upper, ...leg.edges]) {
        sprite.position.set(hip.x, hip.y);
        sprite.rotation = rotation;
      }
      return;
    }
    const out = Math.cos(aim) * length * 0.8;
    const ahead = Math.sin(aim) * length * 0.8;
    const restX = hip.x + sideX * out + forwardX * ahead;
    const restY = hip.y + sideY * out + forwardY * ahead;
    // A foot lands ahead of where it rests by half of what the body walks while it
    // stands, so it is as far behind when it lifts again.
    const lead = ((1 - SWING_SHARE) * creature.stride * creature.striding) / 2;
    const landX = restX + forwardX * lead;
    const landY = restY + forwardY * lead;
    if (!leg.planted || Math.hypot(leg.foot.x - restX, leg.foot.y - restY) > length * SNAP_LEGS) {
      leg.foot.x = restX;
      leg.foot.y = restY;
      leg.planted = true;
      leg.swinging = false;
    }
    // Its own part of the cycle: the foot swings from where it lifted to where it lands
    // (which moves on with the body), then stands where it landed until its turn comes again.
    const into = (creature.gait - leg.phase + 1) % 1;
    const swinging = into < SWING_SHARE;
    let raised = 0;
    if (swinging) {
      if (!leg.swinging) {
        leg.lift.x = leg.foot.x;
        leg.lift.y = leg.foot.y;
      }
      const t = into / SWING_SHARE;
      const eased = t * t * (3 - 2 * t);
      leg.target.x = landX;
      leg.target.y = landY;
      leg.foot.x = leg.lift.x + (landX - leg.lift.x) * eased;
      leg.foot.y = leg.lift.y + (landY - leg.lift.y) * eased;
      raised = Math.sin(Math.PI * t) * FOOT_LIFT * length * LIGHT;
      creature.unsettled = true;
    } else if (leg.swinging) {
      // Down where it was going, firmly: it does not slide while it stands.
      leg.foot.x = leg.target.x;
      leg.foot.y = leg.target.y;
    }
    leg.swinging = swinging;
    if (Math.hypot(leg.foot.x - landX, leg.foot.y - landY) > length * SETTLE_OFF) {
      creature.unsettled = true;
    }
    // A foot in the air is drawn lifted toward the light; where it stands is unchanged.
    const foot = this.foot;
    foot.x = leg.foot.x - raised;
    foot.y = leg.foot.y - raised;

    const bone = length * 0.6;
    solveKnee(hip, foot, bone, bone, side, this.knee);
    this.stretch(leg.upper, hip, this.knee, thickness);
    this.stretch(leg.lower, this.knee, foot, thickness * 0.8);
    const [upperEdge, lowerEdge, soleEdge] = leg.edges;
    const edge = 2 * leg.plan.edge;
    if (upperEdge !== undefined) this.stretch(upperEdge, hip, this.knee, thickness + edge);
    if (lowerEdge !== undefined) this.stretch(lowerEdge, this.knee, foot, thickness * 0.8 + edge);
    // A webbed foot lies ahead of the leg's end, across the way the shin points.
    const reach = leg.webbed ? leg.plan.foot * WEB_AHEAD : 0;
    const shin = Math.atan2(foot.y - this.knee.y, foot.x - this.knee.x);
    for (const sprite of [soleEdge, leg.sole]) {
      if (sprite === undefined || sprite === null) continue;
      sprite.position.set(foot.x + Math.cos(shin) * reach, foot.y + Math.sin(shin) * reach);
      if (leg.webbed) sprite.rotation = shin;
    }
  }

  /** Stretch a white square from `from` to `to`. */
  private stretch(sprite: Sprite, from: Point, to: Point, thickness: number): void {
    sprite.position.set(from.x, from.y);
    sprite.rotation = Math.atan2(to.y - from.y, to.x - from.x);
    sprite.scale.set(
      Math.hypot(to.x - from.x, to.y - from.y) / WHITE_TEXELS,
      thickness / WHITE_TEXELS,
    );
  }
}
