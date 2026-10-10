/**
 * Chain-of-circles creatures: a head that wanders, body segments that follow it, eyes,
 * and legs that step. Everything is a sprite of the atlas (tinted discs and stretched
 * squares), so a creature costs no geometry rebuild, only transforms.
 */
import { Container, Sprite } from "pixi.js";
import { DISC_SIZE, type Atlas } from "./atlas";
import { followChain, solveKnee, type Point } from "./chain";
import type { CreatureSeed } from "./fixture";
import type { Random } from "./rng";

/** Body length in cells of a creature of mass 1; it grows with the cube root of mass. */
const LENGTH_PER_UNIT_MASS = 1.1;
const MIN_SEGMENTS = 4;
const MAX_SEGMENTS = 9;
/** Head radius as a share of body length, and how thin the tail gets. */
const HEAD_RADIUS = 0.17;
const TAIL_TAPER = 0.55;
/** Walking speed in cells per second: far faster than the sim, to keep bodies moving. */
const SPEED_BASE = 0.6;
const SPEED_PER_LAND_SPEED = 0.4;
/** Wandering: how fast the turn rate drifts and settles (per second). */
const TURN_JITTER = 6;
const TURN_DAMPING = 1.5;
const AVOID_TURN = 3.5;
const LOOK_AHEAD_CELLS = 1.2;
/** Legs: length relative to head radius, and how briskly a foot swings to its target. */
const LEG_LENGTH = 2.2;
const STEP_RATE = 16;
const EYE_COLOUR = 0x1b1b1b;
/** Texels across the white square of the atlas. */
const WHITE_TEXELS = 2;

interface Leg {
  joint: number;
  side: 1 | -1;
  length: number;
  foot: Point;
  target: Point;
  upper: Sprite;
  lower: Sprite;
}

interface Creature {
  joints: Point[];
  radii: number[];
  spacing: number;
  heading: number;
  turn: number;
  speed: number;
  avoid: 1 | -1;
  discs: Sprite[];
  eyes: Sprite[];
  legs: Leg[];
  sprites: Sprite[];
}

/** hue 0–1 → 0xRRGGBB at fixed saturation, with `light` as lightness (0–1). */
function colour(hue: number, light: number): number {
  const saturation = 0.5;
  const chroma = (1 - Math.abs(2 * light - 1)) * saturation;
  const sector = (((hue % 1) + 1) % 1) * 6;
  const second = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, second, 0]
      : sector < 2
        ? [second, chroma, 0]
        : sector < 3
          ? [0, chroma, second]
          : sector < 4
            ? [0, second, chroma]
            : sector < 5
              ? [second, 0, chroma]
              : [chroma, 0, second];
  const lift = light - chroma / 2;
  const byte = (value: number): number => Math.round((value + lift) * 255);
  return (byte(r) << 16) | (byte(g) << 8) | byte(b);
}

export class CreatureLayer {
  readonly container = new Container();
  private readonly creatures: Creature[] = [];
  private active = 0;
  // Scratch points, reused every frame so the animation allocates nothing.
  private readonly hip: Point = { x: 0, y: 0 };
  private readonly knee: Point = { x: 0, y: 0 };

  constructor(
    private readonly atlas: Atlas,
    private readonly seeds: readonly CreatureSeed[],
    private readonly walkable: (x: number, y: number) => boolean,
    private readonly random: Random,
  ) {}

  /** Number of sprites the active creatures are made of. */
  get spriteCount(): number {
    let total = 0;
    for (const creature of this.creatures.slice(0, this.active)) total += creature.sprites.length;
    return total;
  }

  /** Animate exactly `count` creatures; more are created on demand, extras are hidden. */
  setCount(count: number): void {
    while (this.creatures.length < count) this.creatures.push(this.spawn(this.creatures.length));
    this.creatures.forEach((creature, index) => {
      const visible = index < count;
      for (const sprite of creature.sprites) sprite.visible = visible;
    });
    this.active = count;
  }

  update(dtS: number): void {
    for (let index = 0; index < this.active; index++) {
      const creature = this.creatures[index];
      if (creature !== undefined) this.step(creature, dtS);
    }
  }

  private spawn(index: number): Creature {
    const seed = this.seeds[index % this.seeds.length];
    if (seed === undefined) throw new Error("the fixture has no creatures");
    const random = this.random;
    // Past the fixture's creatures, reuse them a few cells away.
    const clone = index >= this.seeds.length;
    const x = seed.x + (clone ? (random() - 0.5) * 8 : 0);
    const y = seed.y + (clone ? (random() - 0.5) * 8 : 0);

    const length = LENGTH_PER_UNIT_MASS * Math.cbrt(seed.mass);
    const segments = Math.min(Math.max(Math.round(3 + 2.2 * length), MIN_SEGMENTS), MAX_SEGMENTS);
    const spacing = length / (segments - 1);
    const heading = random() * Math.PI * 2;
    const joints: Point[] = [];
    const radii: number[] = [];
    for (let i = 0; i < segments; i++) {
      joints.push({
        x: x - Math.cos(heading) * spacing * i,
        y: y - Math.sin(heading) * spacing * i,
      });
      const along = i / (segments - 1);
      // A slightly thicker chest behind the head, then a taper to the tail.
      const profile = i === 1 ? 1.12 : 1 - TAIL_TAPER * along ** 1.3;
      radii.push(HEAD_RADIUS * length * profile);
    }

    const sprites: Sprite[] = [];
    const add = (sprite: Sprite): Sprite => {
      sprites.push(sprite);
      this.container.addChild(sprite);
      return sprite;
    };
    const body = colour(seed.hue, 0.55);
    const dark = colour(seed.hue, 0.3);
    const stripe = colour(seed.hue + 0.08, 0.42);

    // Legs first, so the body covers the hips.
    const legs: Leg[] = [];
    const pairs = Math.round(seed.limbPairs);
    const legLength = LEG_LENGTH * HEAD_RADIUS * length;
    for (let pair = 0; pair < pairs; pair++) {
      const joint = Math.min(
        1 + Math.round((pair * (segments - 3)) / Math.max(pairs - 1, 1)),
        segments - 2,
      );
      for (const side of [1, -1] as const) {
        const bone = (): Sprite => {
          const sprite = add(new Sprite({ texture: this.atlas.white, anchor: { x: 0, y: 0.5 } }));
          sprite.tint = dark;
          return sprite;
        };
        legs.push({
          joint,
          side,
          length: legLength,
          foot: { x, y },
          target: { x, y },
          upper: bone(),
          lower: bone(),
        });
      }
    }
    // Tail first, so the head ends up on top.
    const discs: Sprite[] = [];
    for (let i = segments - 1; i >= 0; i--) {
      const sprite = add(new Sprite({ texture: this.atlas.disc, anchor: 0.5 }));
      sprite.tint = seed.pattern > 0.15 && i % 2 === 1 ? stripe : body;
      sprite.scale.set((2 * (radii[i] ?? 0)) / DISC_SIZE);
      discs[i] = sprite;
    }
    const eyes = [0, 1].map(() => {
      const sprite = add(new Sprite({ texture: this.atlas.disc, anchor: 0.5 }));
      sprite.tint = EYE_COLOUR;
      sprite.scale.set((0.6 * (radii[0] ?? 0)) / DISC_SIZE);
      return sprite;
    });

    return {
      joints,
      radii,
      spacing,
      heading,
      turn: 0,
      speed: SPEED_BASE + SPEED_PER_LAND_SPEED * seed.landSpeed,
      avoid: random() < 0.5 ? 1 : -1,
      discs,
      eyes,
      legs,
      sprites,
    };
  }

  private step(creature: Creature, dtS: number): void {
    const head = creature.joints[0];
    if (head === undefined) return;
    const random = this.random;

    // Wander, turning away from water and the map edge.
    creature.turn += ((random() * 2 - 1) * TURN_JITTER - creature.turn * TURN_DAMPING) * dtS;
    let dirX = Math.cos(creature.heading);
    let dirY = Math.sin(creature.heading);
    const blocked = !this.walkable(
      head.x + dirX * LOOK_AHEAD_CELLS,
      head.y + dirY * LOOK_AHEAD_CELLS,
    );
    creature.heading += (blocked ? creature.avoid * AVOID_TURN : creature.turn) * dtS;
    dirX = Math.cos(creature.heading);
    dirY = Math.sin(creature.heading);
    const stride = creature.speed * dtS;
    const stuck = !this.walkable(head.x, head.y);
    if (!blocked || stuck) {
      head.x += dirX * stride;
      head.y += dirY * stride;
    }
    followChain(creature.joints, creature.spacing);

    for (let i = 0; i < creature.joints.length; i++) {
      const joint = creature.joints[i];
      if (joint !== undefined) creature.discs[i]?.position.set(joint.x, joint.y);
    }
    const radius = creature.radii[0] ?? 0;
    for (let i = 0; i < creature.eyes.length; i++) {
      const side = i === 0 ? 1 : -1;
      creature.eyes[i]?.position.set(
        head.x + dirX * radius * 0.35 - dirY * radius * 0.55 * side,
        head.y + dirY * radius * 0.35 + dirX * radius * 0.55 * side,
      );
    }
    for (const leg of creature.legs) this.walk(creature, leg, dtS);
  }

  private walk(creature: Creature, leg: Leg, dtS: number): void {
    const joint = creature.joints[leg.joint];
    const lead = creature.joints[leg.joint - 1];
    if (joint === undefined || lead === undefined) return;
    // The body's direction at this joint, and the side the leg is on.
    const span = Math.hypot(lead.x - joint.x, lead.y - joint.y) || 1;
    const forwardX = (lead.x - joint.x) / span;
    const forwardY = (lead.y - joint.y) / span;
    const sideX = -forwardY * leg.side;
    const sideY = forwardX * leg.side;
    const radius = creature.radii[leg.joint] ?? 0;
    const hip = this.hip;
    hip.x = joint.x + sideX * radius * 0.7;
    hip.y = joint.y + sideY * radius * 0.7;
    const restX = hip.x + sideX * leg.length * 0.75 + forwardX * leg.length * 0.3;
    const restY = hip.y + sideY * leg.length * 0.75 + forwardY * leg.length * 0.3;
    // A planted foot stays put until the body has left it behind, then swings ahead.
    if (Math.hypot(leg.target.x - restX, leg.target.y - restY) > leg.length * 0.8) {
      leg.target.x = restX + forwardX * leg.length * 0.5;
      leg.target.y = restY + forwardY * leg.length * 0.5;
    }
    const swing = Math.min(1, dtS * STEP_RATE);
    leg.foot.x += (leg.target.x - leg.foot.x) * swing;
    leg.foot.y += (leg.target.y - leg.foot.y) * swing;

    const bone = leg.length * 0.6;
    solveKnee(hip, leg.foot, bone, bone, leg.side, this.knee);
    const thickness = Math.max(radius * 0.45, 0.04);
    this.place(leg.upper, hip, this.knee, thickness);
    this.place(leg.lower, this.knee, leg.foot, thickness * 0.8);
  }

  /** Stretch a white square from `from` to `to`. */
  private place(sprite: Sprite, from: Point, to: Point, thickness: number): void {
    sprite.position.set(from.x, from.y);
    sprite.rotation = Math.atan2(to.y - from.y, to.x - from.x);
    sprite.scale.set(
      Math.hypot(to.x - from.x, to.y - from.y) / WHITE_TEXELS,
      thickness / WHITE_TEXELS,
    );
  }
}
