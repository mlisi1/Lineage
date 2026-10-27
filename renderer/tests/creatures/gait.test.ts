import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import type { Look } from "../../src/creatures/body";
import type { Point, Stiffness } from "../../src/creatures/chain";
import { GENE_COUNT } from "../../src/creatures/genome";
import { CreatureLayer } from "../../src/creatures/layer";
import type { CreatureSeed } from "../../src/creatures/seed";
import { MID_BODY } from "../../src/creatures/views";
import { mulberry32 } from "../../src/rng";
import { installCanvas } from "./canvas";

installCanvas();

const STEP_S = 1 / 30;
const ATLAS = {
  plants: new Map<string, Texture>(),
  disc: Texture.WHITE,
  white: Texture.WHITE,
  wedge: Texture.WHITE,
};

/** What the test reads of the layer's own animals. */
interface Inside {
  creatures: {
    legs: {
      plan: { joint: number; side: number };
      foot: Point;
      swinging: boolean;
      phase: number;
    }[];
    gait: number;
    joints: Point[];
    heading: number;
    stiffness: Stiffness;
  }[];
}

function seed(change: Partial<Look> = {}): CreatureSeed {
  return {
    mass: 2,
    limbPairs: 2,
    landSpeed: 3,
    swimSpeed: 1,
    diet: 0.2,
    speed: 0.5,
    armour: 0,
    sense: 0.4,
    aquatic: 0,
    jaw: 0.5,
    hue: 0.9,
    pattern: 0,
    ...change,
    x: 10,
    y: 10,
    genome: Array.from({ length: GENE_COUNT }, () => 0.5),
    species: 1,
    slots: 0,
    torpid: false,
  };
}

/** A layer with one animal of `look` walking from (10, 10) to (16, 10), and its legs each frame. */
function walk(look: Partial<Look>, seconds: number) {
  const layer = new CreatureLayer(ATLAS, [], () => true, mulberry32(2), MID_BODY, "anchored");
  layer.show("bodies");
  layer.place(0, seed(look));
  layer.update(STEP_S);
  layer.send(0, 16, 10);
  const creature = (layer as unknown as Inside).creatures[0];
  if (creature === undefined) throw new Error("not placed");
  const frames: { swinging: boolean[]; feet: Point[]; gait: number }[] = [];
  for (let t = 0; t < seconds; t += STEP_S) {
    layer.update(STEP_S);
    frames.push({
      swinging: creature.legs.map((leg) => leg.swinging),
      feet: creature.legs.map((leg) => ({ ...leg.foot })),
      gait: creature.gait,
    });
  }
  return { creature, frames, layer };
}

describe("legs stepping in turn", () => {
  it("never lifts all of a walker's feet at once, and lifts each in its turn", () => {
    for (const limbPairs of [1, 2, 3]) {
      const { creature, frames } = walk({ limbPairs }, 6);
      const legs = creature.legs.length;
      expect(legs).toBe(2 * limbPairs);
      let stepped = 0;
      for (const { swinging } of frames) {
        const up = swinging.filter(Boolean).length;
        expect(up).toBeLessThan(legs);
        stepped = Math.max(stepped, up);
      }
      expect(stepped).toBeGreaterThan(0);
      for (let leg = 0; leg < legs; leg++) {
        expect(frames.some(({ swinging }) => swinging[leg] === true)).toBe(true);
      }
    }
  });

  it("never lifts the two feet of a pair together, and swings diagonal feet together", () => {
    const { creature, frames } = walk({ limbPairs: 2 }, 6);
    const [frontLeft, frontRight, hindLeft, hindRight] = creature.legs;
    // The front pair's two sides half a cycle apart; diagonal feet nearly in step.
    expect(Math.abs((frontLeft?.phase ?? 0) - (frontRight?.phase ?? 0))).toBeCloseTo(0.5);
    expect(frontLeft?.plan.side).not.toBe(frontRight?.plan.side);
    expect(Math.abs((frontLeft?.phase ?? 0) - (hindRight?.phase ?? 0))).toBeLessThan(0.1);
    // The same side's feet of the two pairs half a cycle apart, the hind a little later.
    const sameSide = Math.abs((frontLeft?.phase ?? 0) - (hindLeft?.phase ?? 0));
    expect(sameSide).toBeGreaterThan(0.4);
    expect(sameSide).toBeLessThan(0.6);
    for (const { swinging } of frames) {
      expect(swinging[0] === true && swinging[1] === true).toBe(false);
      expect(swinging[2] === true && swinging[3] === true).toBe(false);
    }
  });

  it("keeps a foot where it landed while it stands: no foot slides along the ground", () => {
    const { frames } = walk({ limbPairs: 2 }, 6);
    for (let k = 1; k < frames.length; k++) {
      const before = frames[k - 1];
      const now = frames[k];
      if (before === undefined || now === undefined) continue;
      now.swinging.forEach((swinging, leg) => {
        if (swinging || before.swinging[leg] === true) return;
        expect(now.feet[leg]).toEqual(before.feet[leg]);
      });
    }
  });

  it("goes through its gait as it walks, and comes to rest with every foot down", () => {
    const { creature, frames, layer } = walk({ limbPairs: 2 }, 3);
    const gaits = new Set(frames.slice(0, 30).map(({ gait }) => Math.round(gait * 20)));
    expect(gaits.size).toBeGreaterThan(5);
    expect(frames.some(({ swinging }) => swinging.some(Boolean))).toBe(true);
    // Arrived, it stops; within a few seconds every foot is down.
    for (let t = 0; t < 20; t += STEP_S) layer.update(STEP_S);
    layer.pin(0, 16, 10, 0);
    for (let t = 0; t < 3; t += STEP_S) layer.update(STEP_S);
    expect(creature.legs.every((leg) => !leg.swinging)).toBe(true);
  });

  it("standing still, keeps every part where a full pose puts it, only its chest breathing", () => {
    const { creature, layer } = walk({ limbPairs: 2 }, 3);
    for (let t = 0; t < 20; t += STEP_S) layer.update(STEP_S);
    layer.pin(0, 16, 10, 0);
    for (let t = 0; t < 3; t += STEP_S) layer.update(STEP_S);
    const inside = creature as unknown as {
      sprites: { x: number; y: number; rotation: number; scale: { x: number; y: number } }[];
      plan: { parts: { joint: number }[] };
      chest: number;
      posed: Float64Array | null;
    };
    const drawn = (): number[][] =>
      inside.sprites.map((sprite) => [sprite.x, sprite.y, sprite.rotation, sprite.scale.x]);
    // A still frame: posed from what it was posed from before, so not posed again.
    layer.update(STEP_S);
    const kept = drawn();
    expect(inside.posed).not.toBeNull();
    // Posed in full the next frame (what it was posed from forgotten): the same, part for part.
    inside.posed = null;
    layer.update(STEP_S);
    expect(drawn()).toEqual(kept);
  });
});

describe("a body turning back on itself", () => {
  /** The signed angle (radians) from `a` to `b`, in (−π, π]. */
  const turnBetween = (a: number, b: number): number =>
    Math.atan2(Math.sin(b - a), Math.cos(b - a));
  /** The most any joint bends from the one in front, beyond the neck. */
  const mostBend = (joints: readonly Point[]): number => {
    let most = 0;
    for (let i = 2; i < joints.length; i++) {
      const [a, b, c] = [joints[i - 2], joints[i - 1], joints[i]] as Point[];
      const ahead = Math.atan2((a?.y ?? 0) - (b?.y ?? 0), (a?.x ?? 0) - (b?.x ?? 0));
      const behind = Math.atan2((b?.y ?? 0) - (c?.y ?? 0), (b?.x ?? 0) - (c?.x ?? 0));
      most = Math.max(most, Math.abs(turnBetween(behind, ahead)));
    }
    return most;
  };

  it("never comes round onto itself, and is within its kind's bend once it walks on", () => {
    for (const look of [
      { limbPairs: 0, aquatic: 0 },
      { limbPairs: 2 },
      { limbPairs: 3, armour: 0.8 },
    ]) {
      const { creature, layer } = walk(look, 2);
      const spacing = (creature as unknown as { plan: { spacing: number } }).plan.spacing;
      // Sent straight back the way it came.
      layer.send(0, 4, 10.2);
      for (let t = 0; t < 4; t += STEP_S) {
        layer.update(STEP_S);
        const { joints } = creature;
        // No joint comes near another but its neighbours (ADR 0022: 1.2 spacings).
        for (let i = 0; i < joints.length; i++) {
          for (let j = i + 2; j < joints.length; j++) {
            const a = joints[i] as Point;
            const b = joints[j] as Point;
            expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(1.2 * spacing);
          }
        }
      }
      // It did turn round, and walking on straight it is within its limits.
      expect(Math.cos(creature.heading)).toBeLessThan(0);
      expect(mostBend(creature.joints)).toBeLessThanOrEqual(creature.stiffness.bend + 1e-4);
    }
  });

  // While it turns, a joint may bend a little past its kind's limit for a moment and is
  // eased back (`followChain` is given the frame's `dtS`, `STRAIGHTEN_RATE`), a soft turn
  // the owner keeps (2026-10-25); never far past, and back within as it walks on.
  it("bends a joint only a little past its kind's limit while it turns, and eases it back", () => {
    for (const look of [
      { limbPairs: 0, aquatic: 0 },
      { limbPairs: 2 },
      { limbPairs: 3, armour: 0.8 },
    ]) {
      const { creature, layer } = walk(look, 2);
      layer.send(0, 4, 10.2);
      let over = 0;
      for (let t = 0; t < 4; t += STEP_S) {
        layer.update(STEP_S);
        over = Math.max(over, mostBend(creature.joints) - creature.stiffness.bend);
      }
      expect(over).toBeLessThan(0.25);
      expect(mostBend(creature.joints)).toBeLessThanOrEqual(creature.stiffness.bend + 1e-4);
    }
  });
});
