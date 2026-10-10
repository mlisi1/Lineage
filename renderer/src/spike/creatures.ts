/**
 * Chain-of-circles creatures: a head that wanders, body segments that follow it, and on
 * that chain whatever the genes ask for: legs that step, a shell, bands or spots, eyes,
 * mandibles, fins. Everything is a sprite of the atlas (tinted discs and stretched
 * squares), so a creature costs no geometry rebuild, only transforms.
 */
import { Container, Sprite } from "pixi.js";
import { DISC_SIZE, type Atlas } from "./atlas";
import { bodyPlan, type BodyPlan } from "./body";
import { followChain, solveKnee, type Point } from "./chain";
import type { CreatureSeed } from "./fixture";
import type { Passable } from "./habitat";
import type { Random } from "./rng";

/** Wandering: how fast the turn rate drifts and settles (per second). */
const TURN_JITTER = 6;
const TURN_DAMPING = 1.5;
const AVOID_TURN = 3.5;
const LOOK_AHEAD_CELLS = 1.2;
/** How briskly a foot swings to its target. */
const STEP_RATE = 16;
const EYE_COLOUR = 0x1b1b1b;
/** Texels across the white square of the atlas. */
const WHITE_TEXELS = 2;
/** How far (cells) a creature that starts where it cannot live is moved to where it can. */
const SETTLE_REACH = 48;
/** Side fins sit a third of the way down the body and sweep back. */
const FIN_SWEEP = { side: 0.8, back: 0.6 };
const FIN_WIDTH = 0.45;

interface Leg {
  joint: number;
  side: 1 | -1;
  foot: Point;
  target: Point;
  upper: Sprite;
  lower: Sprite;
}

interface Creature {
  plan: BodyPlan;
  container: Container;
  joints: Point[];
  heading: number;
  turn: number;
  avoid: 1 | -1;
  discs: Sprite[];
  shells: Sprite[];
  spots: Sprite[];
  eyes: Sprite[];
  jaws: Sprite[];
  sideFins: Sprite[];
  fluke: Sprite | null;
  legs: Leg[];
  sprites: number;
}

export class CreatureLayer {
  readonly container = new Container();
  private readonly creatures: Creature[] = [];
  private active = 0;
  private only: number | null = null;
  // Scratch points, reused every frame so the animation allocates nothing.
  private readonly hip: Point = { x: 0, y: 0 };
  private readonly knee: Point = { x: 0, y: 0 };
  private readonly tip: Point = { x: 0, y: 0 };

  constructor(
    private readonly atlas: Atlas,
    private readonly seeds: readonly CreatureSeed[],
    private readonly passable: Passable,
    private readonly random: Random,
  ) {}

  /** Number of sprites the active creatures are made of. */
  get spriteCount(): number {
    let total = 0;
    for (const creature of this.creatures.slice(0, this.active)) total += creature.sprites;
    return total;
  }

  /** Animate exactly `count` creatures; more are created on demand, extras are hidden. */
  setCount(count: number): void {
    while (this.creatures.length < count) this.creatures.push(this.spawn(this.creatures.length));
    this.active = count;
    this.show();
  }

  /** Draw only creature `index` (a portrait), or all of them again with null. */
  solo(index: number | null): void {
    if (this.only === index) return;
    this.only = index;
    this.show();
  }

  /** The middle of creature `index`'s body, in cells. */
  centre(index: number): Point {
    const joints = this.creatures[index]?.joints ?? [];
    return joints[Math.floor(joints.length / 2)] ?? { x: 0, y: 0 };
  }

  update(dtS: number): void {
    for (let index = 0; index < this.active; index++) {
      const creature = this.creatures[index];
      if (creature !== undefined) this.step(creature, dtS);
    }
  }

  private show(): void {
    this.creatures.forEach((creature, index) => {
      creature.container.visible = index < this.active && (this.only ?? index) === index;
    });
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
    const random = this.random;
    const plan = bodyPlan(seed);
    // Past the fixture's creatures, reuse them a few cells away.
    const clone = index >= this.seeds.length;
    const { x, y } = this.settle(
      seed.x + (clone ? (random() - 0.5) * 8 : 0),
      seed.y + (clone ? (random() - 0.5) * 8 : 0),
      plan.swims,
    );

    const heading = random() * Math.PI * 2;
    const joints = plan.radii.map((_, i) => ({
      x: x - Math.cos(heading) * plan.spacing * i,
      y: y - Math.sin(heading) * plan.spacing * i,
    }));

    const container = new Container();
    this.container.addChild(container);
    let sprites = 0;
    const add = (texture: "disc" | "white", tint: number): Sprite => {
      const sprite =
        texture === "disc"
          ? new Sprite({ texture: this.atlas.disc, anchor: 0.5 })
          : new Sprite({ texture: this.atlas.white, anchor: { x: 0, y: 0.5 } });
      sprite.tint = tint;
      sprites += 1;
      return container.addChild(sprite);
    };
    const disc = (tint: number, radius: number): Sprite => {
      const sprite = add("disc", tint);
      sprite.scale.set((2 * radius) / DISC_SIZE);
      return sprite;
    };
    const { colours, radii } = plan;
    const segments = radii.length;

    // Back to front: what is added first is covered by what comes later.
    const legs: Leg[] = [];
    for (const joint of plan.legJoints) {
      for (const side of [1, -1] as const) {
        legs.push({
          joint,
          side,
          foot: { x, y },
          target: { x, y },
          upper: add("white", colours.dark),
          lower: add("white", colours.dark),
        });
      }
    }
    const finned = plan.finLength > 0;
    const sideFins = finned ? [add("disc", colours.fin), add("disc", colours.fin)] : [];
    const fluke = finned ? add("disc", colours.fin) : null;
    const jaws = plan.jawLength > 0 ? [add("white", colours.jaw), add("white", colours.jaw)] : [];
    // Tail first, so the head ends up on top; all of the shell under all of the body,
    // so it shows as an outline around the whole animal.
    const shells: Sprite[] = [];
    if (plan.shell > 0) {
      for (let i = segments - 1; i >= 0; i--) {
        shells[i] = disc(colours.shell, (radii[i] ?? 0) * (1 + plan.shell));
      }
    }
    const discs: Sprite[] = [];
    for (let i = segments - 1; i >= 0; i--) {
      const banded = plan.pattern === "bands" && i % 2 === 1;
      discs[i] = disc(banded ? colours.band : colours.body, radii[i] ?? 0);
    }
    const spots: Sprite[] = [];
    if (plan.pattern === "spots") {
      for (let i = 1; i < segments; i++) spots[i] = disc(colours.spot, (radii[i] ?? 0) * 0.45);
    }
    const eyes = [disc(EYE_COLOUR, plan.eyeRadius), disc(EYE_COLOUR, plan.eyeRadius)];

    return {
      plan,
      container,
      joints,
      heading,
      turn: 0,
      avoid: random() < 0.5 ? 1 : -1,
      discs,
      shells,
      spots,
      eyes,
      jaws,
      sideFins,
      fluke,
      legs,
      sprites,
    };
  }

  private step(creature: Creature, dtS: number): void {
    const { plan, joints } = creature;
    const head = joints[0];
    if (head === undefined) return;
    const random = this.random;

    // Wander, turning away from where this body cannot go.
    creature.turn += ((random() * 2 - 1) * TURN_JITTER - creature.turn * TURN_DAMPING) * dtS;
    let dirX = Math.cos(creature.heading);
    let dirY = Math.sin(creature.heading);
    const blocked = !this.passable(
      head.x + dirX * LOOK_AHEAD_CELLS,
      head.y + dirY * LOOK_AHEAD_CELLS,
      plan.swims,
    );
    creature.heading += (blocked ? creature.avoid * AVOID_TURN : creature.turn) * dtS;
    dirX = Math.cos(creature.heading);
    dirY = Math.sin(creature.heading);
    const stride = plan.pace * dtS;
    const stuck = !this.passable(head.x, head.y, plan.swims);
    if (!blocked || stuck) {
      head.x += dirX * stride;
      head.y += dirY * stride;
    }
    followChain(joints, plan.spacing);

    for (let i = 0; i < joints.length; i++) {
      const joint = joints[i];
      if (joint === undefined) continue;
      creature.discs[i]?.position.set(joint.x, joint.y);
      creature.shells[i]?.position.set(joint.x, joint.y);
      creature.spots[i]?.position.set(joint.x, joint.y);
    }
    const radius = plan.radii[0] ?? 0;
    for (const [i, side] of ([1, -1] as const).entries()) {
      creature.eyes[i]?.position.set(
        head.x + dirX * radius * 0.35 - dirY * radius * 0.55 * side,
        head.y + dirY * radius * 0.35 + dirX * radius * 0.55 * side,
      );
      const jaw = creature.jaws[i];
      if (jaw !== undefined) {
        // Pincers: rooted at the cheeks, closing towards the middle at the tips.
        const hip = this.hip;
        hip.x = head.x + dirX * radius * 0.5 - dirY * radius * 0.6 * side;
        hip.y = head.y + dirY * radius * 0.5 + dirX * radius * 0.6 * side;
        const tip = this.tip;
        tip.x = head.x + dirX * (radius * 0.5 + plan.jawLength) - dirY * radius * 0.15 * side;
        tip.y = head.y + dirY * (radius * 0.5 + plan.jawLength) + dirX * radius * 0.15 * side;
        this.place(jaw, hip, tip, Math.max(radius * 0.45, 0.05));
      }
    }
    this.fins(creature);
    for (const leg of creature.legs) this.walk(creature, leg, dtS);
  }

  /** Two side fins swept back from the shoulders and a fluke across the tail tip. */
  private fins(creature: Creature): void {
    const { plan, joints } = creature;
    if (plan.finLength === 0) return;
    const at = Math.max(1, Math.round((joints.length - 1) / 3));
    const joint = joints[at];
    const lead = joints[at - 1];
    if (joint !== undefined && lead !== undefined) {
      const span = Math.hypot(lead.x - joint.x, lead.y - joint.y) || 1;
      const forwardX = (lead.x - joint.x) / span;
      const forwardY = (lead.y - joint.y) / span;
      const radius = plan.radii[at] ?? 0;
      for (const [i, side] of ([1, -1] as const).entries()) {
        const sideX = -forwardY * side;
        const sideY = forwardX * side;
        const axisX = sideX * FIN_SWEEP.side - forwardX * FIN_SWEEP.back;
        const axisY = sideY * FIN_SWEEP.side - forwardY * FIN_SWEEP.back;
        const fin = creature.sideFins[i];
        if (fin === undefined) continue;
        fin.position.set(
          joint.x + sideX * radius * 0.6 + (axisX * plan.finLength) / 2,
          joint.y + sideY * radius * 0.6 + (axisY * plan.finLength) / 2,
        );
        fin.rotation = Math.atan2(axisY, axisX);
        fin.scale.set(plan.finLength / DISC_SIZE, (plan.finLength * FIN_WIDTH) / DISC_SIZE);
      }
    }
    const tail = joints[joints.length - 1];
    const before = joints[joints.length - 2];
    if (creature.fluke !== null && tail !== undefined && before !== undefined) {
      const span = Math.hypot(tail.x - before.x, tail.y - before.y) || 1;
      const backX = (tail.x - before.x) / span;
      const backY = (tail.y - before.y) / span;
      const reach = (plan.radii[joints.length - 1] ?? 0) + plan.finLength * FIN_WIDTH * 0.4;
      creature.fluke.position.set(tail.x + backX * reach, tail.y + backY * reach);
      creature.fluke.rotation = Math.atan2(backY, backX);
      // Short along the body, wide across it.
      creature.fluke.scale.set(
        (plan.finLength * FIN_WIDTH) / DISC_SIZE,
        (plan.finLength * 1.1) / DISC_SIZE,
      );
    }
  }

  private walk(creature: Creature, leg: Leg, dtS: number): void {
    const { plan } = creature;
    const joint = creature.joints[leg.joint];
    const lead = creature.joints[leg.joint - 1];
    if (joint === undefined || lead === undefined) return;
    // The body's direction at this joint, and the side the leg is on.
    const span = Math.hypot(lead.x - joint.x, lead.y - joint.y) || 1;
    const forwardX = (lead.x - joint.x) / span;
    const forwardY = (lead.y - joint.y) / span;
    const sideX = -forwardY * leg.side;
    const sideY = forwardX * leg.side;
    const radius = plan.radii[leg.joint] ?? 0;
    const length = plan.legLength;
    const hip = this.hip;
    hip.x = joint.x + sideX * radius * 0.7;
    hip.y = joint.y + sideY * radius * 0.7;
    const restX = hip.x + sideX * length * 0.75 + forwardX * length * 0.3;
    const restY = hip.y + sideY * length * 0.75 + forwardY * length * 0.3;
    // A planted foot stays put until the body has left it behind, then swings ahead.
    if (Math.hypot(leg.target.x - restX, leg.target.y - restY) > length * 0.8) {
      leg.target.x = restX + forwardX * length * 0.5;
      leg.target.y = restY + forwardY * length * 0.5;
    }
    const swing = Math.min(1, dtS * STEP_RATE);
    leg.foot.x += (leg.target.x - leg.foot.x) * swing;
    leg.foot.y += (leg.target.y - leg.foot.y) * swing;

    const bone = length * 0.6;
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
