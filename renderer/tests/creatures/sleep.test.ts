import { Sprite, Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import { stiffness, type Point } from "../../src/creatures/chain";
import { GENE_COUNT, Gene } from "../../src/creatures/genome";
import { leash, newMotion, reanchor } from "../../src/creatures/motion";
import {
  Snores,
  breathClock,
  breathDepth,
  carrySleep,
  depthOf,
  doze,
  nightActive,
  rouse,
  sleeperOf,
  tuckOf,
  wakeNow,
  type Dozer,
  type Night,
} from "../../src/creatures/sleep";
import {
  SHAKE_S,
  Spray,
  downpourOf,
  drench,
  drenchOf,
  huddleToward,
  shiverAt,
  sprays,
  type Downpour,
} from "../../src/creatures/weather";
import { installCanvas } from "./canvas";

installCanvas();

const STEP_S = 1 / 30;
const FACE = 9;
const DAY: Night = { depth: 0, rising: false };
const NIGHT: Night = { depth: 1, rising: false };

function genome(change: Partial<Record<keyof typeof Gene, number>> = {}): number[] {
  const genes = Array.from({ length: GENE_COUNT }, () => 0.5);
  for (const [name, value] of Object.entries(change))
    genes[Gene[name as keyof typeof Gene]] = value;
  return genes;
}

/** A walker of six joints at (10, 10) facing east, standing still, with two eyes and a glint. */
function sleeper(genes = genome(), rare: ("glow" | "leaves")[] = [], swims = false): Dozer {
  const parts = [
    { layer: 2, lift: 0 },
    { layer: FACE, lift: 0 },
    { layer: FACE, lift: 0 },
    { layer: FACE, lift: 0.1 },
  ];
  const sprites = parts.map(() => {
    const sprite = new Sprite(Texture.WHITE);
    sprite.scale.y = 2;
    return sprite;
  });
  const joints: Point[] = Array.from({ length: 6 }, (_, i) => ({ x: 10 - 0.2 * i, y: 10 }));
  const motion = newMotion({ x: 10, y: 10 }, 0);
  motion.mode = "pause";
  motion.timer = 1000;
  return {
    joints,
    heading: 0,
    plan: { spacing: 0.2, length: 1 },
    motion,
    torpid: false,
    sleep: sleeperOf(
      genes,
      rare,
      { swims, joints: 6, parts, stiffness: stiffness("lizard", 6, 0.2) },
      sprites,
      FACE,
    ),
  };
}

/** Doze `animal` for `seconds` in `night`. */
function night(animal: Dozer, seconds: number, at: Night = NIGHT, dry = true): boolean {
  let held = false;
  for (let t = 0; t < seconds; t += STEP_S) held = doze(animal, at, STEP_S, dry, false);
  return held;
}

describe("sleep at night", () => {
  it("reads the night's depth from the sim's light", () => {
    expect(depthOf(1)).toBe(0);
    expect(depthOf(0)).toBe(1);
    expect(depthOf(0.6)).toBeGreaterThan(depthOf(0.8));
  });

  it("keeps the glowing, the keen-sensed and the swimmers awake", () => {
    expect(nightActive(genome(), [], false)).toBe(false);
    expect(nightActive(genome(), ["glow"], false)).toBe(true);
    expect(nightActive(genome({ SENSE: 0.8 }), [], false)).toBe(true);
    expect(nightActive(genome({ SENSE: 0.79 }), [], false)).toBe(false);
    expect(nightActive(genome(), [], true)).toBe(true);
  });

  it("knows its eyes from the glints in them, and has a moment of its own", () => {
    const animal = sleeper();
    expect(animal.sleep.eyes).toHaveLength(2);
    expect(animal.sleep.glints).toHaveLength(1);
    expect(animal.sleep.open).toEqual([2, 2]);
    expect(animal.sleep.moment).toBeGreaterThanOrEqual(0);
    expect(animal.sleep.moment).toBeLessThan(1);
    // The same genes, the same moment; others, another.
    expect(sleeper().sleep.moment).toBe(animal.sleep.moment);
    expect(sleeper(genome({ HUE: 0.1 })).sleep.moment).not.toBe(animal.sleep.moment);
  });

  it("curls as far as its body bends, the stiff less, and never past 0.6 of a turn", () => {
    const parts: { layer: number; lift: number }[] = [];
    const turns = (kind: "snake" | "lizard" | "beetle"): number =>
      sleeperOf(
        genome(),
        [],
        { swims: false, joints: 8, parts, stiffness: stiffness(kind, 8, 0.2) },
        [],
        FACE,
      ).turns;
    expect(turns("snake")).toBeCloseTo(0.6);
    expect(turns("beetle")).toBeLessThan(turns("lizard"));
    expect(turns("lizard")).toBeLessThanOrEqual(0.6);
  });

  it("stays up by day", () => {
    const animal = sleeper();
    expect(night(animal, 5, DAY)).toBe(false);
    expect(animal.sleep.asleep).toBe(false);
    expect(animal.sleep.share).toBe(0);
  });

  it("lies down at night, curls up, shuts its eyes, and keeps its head where it was", () => {
    const animal = sleeper();
    expect(night(animal, 0.5)).toBe(true);
    expect(animal.sleep.asleep).toBe(true);
    expect(animal.sleep.share).toBeGreaterThan(0);
    expect(animal.sleep.share).toBeLessThan(1);
    night(animal, 5);
    expect(animal.sleep.share).toBe(1);
    expect(animal.sleep.shut).toBe(true);
    expect(animal.sleep.eyes.map((eye) => eye.scale.y)).toEqual([0.6, 0.6]);
    expect(animal.sleep.glints[0]?.visible).toBe(false);
    expect(animal.joints[0]).toEqual({ x: 10, y: 10 });
    // Curled: the tail is nearer the head than a straight body's 1 cell.
    const tail = animal.joints[5] as Point;
    expect(Math.hypot(tail.x - 10, tail.y - 10)).toBeLessThan(0.9);
  });

  it("falls asleep at its own moment as the dusk deepens", () => {
    const early = sleeper(genome({ HUE: 0.11 }));
    const late = sleeper(genome({ HUE: 0.12 }));
    early.sleep.moment = 0;
    late.sleep.moment = 1;
    const dusk: Night = { depth: 0.6, rising: false };
    night(early, 1, dusk);
    night(late, 1, dusk);
    expect(early.sleep.asleep).toBe(true);
    expect(late.sleep.asleep).toBe(false);
    night(late, 1, NIGHT);
    expect(late.sleep.asleep).toBe(true);
  });

  it("does not fall asleep as the light rises, in the water, arriving or walking", () => {
    const dawn = sleeper();
    night(dawn, 2, { depth: 1, rising: true });
    expect(dawn.sleep.asleep).toBe(false);
    const wet = sleeper();
    night(wet, 2, NIGHT, false);
    expect(wet.sleep.asleep).toBe(false);
    const arriving = sleeper();
    doze(arriving, NIGHT, STEP_S, true, true);
    expect(arriving.sleep.asleep).toBe(false);
    const walking = sleeper();
    (walking.motion ?? newMotion({ x: 0, y: 0 }, 0)).mode = "travel";
    night(walking, 2);
    expect(walking.sleep.asleep).toBe(false);
  });

  it("never sleeps when it is an owl or lies torpid, and stands at once if it was lying", () => {
    const owl = sleeper(genome(), ["glow"]);
    night(owl, 3);
    expect(owl.sleep.asleep).toBe(false);
    const torpid = sleeper();
    night(torpid, 3);
    torpid.torpid = true;
    expect(doze(torpid, NIGHT, STEP_S, true, false)).toBe(false);
    expect(torpid.sleep.share).toBe(0);
    expect(torpid.sleep.shut).toBe(false);
  });

  it("wakes at dawn, getting up quicker than it lay down", () => {
    const animal = sleeper();
    night(animal, 5);
    night(animal, 0.4, DAY);
    expect(animal.sleep.asleep).toBe(false);
    expect(animal.sleep.share).toBeGreaterThan(0);
    night(animal, 0.4, DAY);
    expect(animal.sleep.share).toBe(0);
    expect(animal.sleep.shut).toBe(false);
    expect(animal.sleep.eyes.map((eye) => eye.scale.y)).toEqual([2, 2]);
  });

  it("gets up at once when the sim moves it on, and stays up a while", () => {
    const animal = sleeper();
    night(animal, 5);
    const motion = animal.motion;
    if (motion === null) throw new Error("no motion");
    motion.anchor.x = 10 + 2 * leash(1) + 0.1;
    doze(animal, NIGHT, STEP_S, true, false);
    expect(animal.sleep.asleep).toBe(false);
    expect(animal.sleep.restless).toBeGreaterThan(2);
    night(animal, 0.5);
    expect(animal.sleep.share).toBe(0);
    // Back where the sim has it, it does not settle until its restlessness is over.
    reanchor(motion, { head: animal.joints[0] as Point, heading: 0, pace: 1, length: 1 }, 10, 10);
    motion.mode = "pause";
    night(animal, 1);
    expect(animal.sleep.asleep).toBe(false);
    night(animal, 7);
    expect(animal.sleep.asleep).toBe(true);
  });

  it("is lying at once when the view has just come back", () => {
    const animal = sleeper();
    expect(doze(animal, NIGHT, STEP_S, true, false, true)).toBe(true);
    expect(animal.sleep.share).toBe(1);
  });

  it("breathes slower and deeper and tucks its feet in, lying down", () => {
    const animal = sleeper();
    const { sleep } = animal;
    expect(breathDepth(sleep)).toBe(1);
    expect(tuckOf(sleep)).toBe(1);
    const awake = breathClock(sleep, 1);
    expect(awake).toBeCloseTo(1);
    sleep.share = 1;
    expect(breathClock(sleep, 1) - awake).toBeCloseTo(1 / 1.8);
    expect(breathDepth(sleep)).toBeCloseTo(1.6);
    expect(tuckOf(sleep)).toBeCloseTo(0.3);
  });

  it("is woken by hand at once, or roused to stay up a while", () => {
    const animal = sleeper();
    night(animal, 5);
    wakeNow(animal.sleep);
    expect(animal.sleep).toMatchObject({ asleep: false, share: 0, shut: false });
    const roused = sleeper();
    night(roused, 5);
    rouse(roused.sleep);
    expect(roused.sleep.asleep).toBe(false);
    expect(roused.sleep.restless).toBeGreaterThanOrEqual(3);
    // Standing awake already: rousing changes nothing.
    const up = sleeper();
    rouse(up.sleep);
    expect(up.sleep.restless).toBe(0);
  });

  it("carries its sleep over to a new drawing of it", () => {
    const old = sleeper();
    night(old, 5);
    const fresh = sleeper();
    carrySleep(fresh.sleep, old.sleep);
    expect(fresh.sleep).toMatchObject({ asleep: true, share: 1, shut: true });
    expect(fresh.sleep.eyes.map((eye) => eye.scale.y)).toEqual([0.6, 0.6]);
  });

  it("snores a z now and then over the head of the animal followed, rising", () => {
    const snores = new Snores();
    const seen = () => snores.container.children.filter((sprite) => sprite.visible);
    snores.update(0.1, null, 1 / 32);
    expect(seen()).toHaveLength(0);
    // Asleep: the first z after a short wait, then one every 2.4 s, at most three at once.
    const head = { x: 5, y: 5 };
    snores.update(1.3, head, 1 / 32);
    expect(seen()).toHaveLength(1);
    const first = seen()[0]?.position.y ?? 0;
    snores.update(1, head, 1 / 32);
    expect(seen()[0]?.position.y ?? 0).toBeLessThan(first);
    for (let t = 0; t < 10; t += 0.1) snores.update(0.1, head, 1 / 32);
    expect(seen().length).toBeLessThanOrEqual(3);
    snores.clear();
    expect(seen()).toHaveLength(0);
  });
});

describe("animals in the rain", () => {
  it("takes cloud for dry, a thunderstorm for a storm, any other rain for rain", () => {
    expect(downpourOf("none")).toBe("dry");
    expect(downpourOf("cloud")).toBe("dry");
    expect(downpourOf("storm")).toBe("storm");
    expect(downpourOf("rain")).toBe("rain");
    expect(downpourOf("soaking")).toBe("rain");
    expect(downpourOf("thunder")).toBe("rain");
  });

  /** The seconds after a spell ends at which an animal of `moment` shakes, and for how long. */
  function shake(moment: number, exposed = true): { at: number; lasts: number } | null {
    const state = drenchOf();
    let before: Downpour = "dry";
    for (let t = 0; t < 1; t += STEP_S) {
      drench(state, "rain", before, exposed, moment, STEP_S);
      before = "rain";
    }
    let at: number | null = null;
    let lasts = 0;
    for (let t = 0; t < 8; t += STEP_S) {
      if (drench(state, "dry", before, true, moment, STEP_S)) {
        at ??= t;
        lasts += STEP_S;
      }
      before = "dry";
    }
    return at === null ? null : { at, lasts };
  }

  it("shakes itself once when the rain ends, each animal at its own moment", () => {
    const first = shake(0);
    const later = shake(0.5);
    expect(first?.at).toBeLessThan(0.1);
    expect(later?.at).toBeCloseTo(2, 1);
    expect(first?.lasts).toBeCloseTo(SHAKE_S, 1);
  });

  it("does not shake if it was not out in the rain", () => {
    expect(shake(0.2, false)).toBeNull();
  });

  it("waits to shake no longer once the rain comes back", () => {
    const state = drenchOf();
    drench(state, "rain", "dry", true, 0.5, STEP_S);
    drench(state, "dry", "rain", true, 0.5, STEP_S);
    expect(state.wait).toBeGreaterThan(0);
    drench(state, "storm", "dry", true, 0.5, STEP_S);
    expect(state.wait).toBe(-1);
  });

  it("hunches as a storm comes and stands as it goes, slowly", () => {
    const state = drenchOf();
    expect(huddleToward(state, 1, 0.5)).toBeCloseTo(0.4);
    expect(huddleToward(state, 1, 5)).toBe(1);
    expect(huddleToward(state, 0, 0.25)).toBeCloseTo(0.8);
    expect(huddleToward(state, 0, 5)).toBe(0);
  });

  it("shivers from the head down the body, building and fading within the shake", () => {
    expect(shiverAt(0, 0)).toBeCloseTo(0);
    expect(shiverAt(SHAKE_S, 3)).toBeCloseTo(0);
    let most = 0;
    for (let age = 0; age <= SHAKE_S; age += 0.005) {
      for (let i = 0; i < 6; i++) most = Math.max(most, Math.abs(shiverAt(age, i)));
    }
    expect(most).toBeGreaterThan(0.3);
    expect(most).toBeLessThanOrEqual(0.45);
    // The tail swings after the head: not in step with it.
    expect(shiverAt(0.2, 0)).not.toBeCloseTo(shiverAt(0.2, 4));
  });

  it("throws drops every few hundredths of a second while it shakes", () => {
    expect(sprays(0, 0.07)).toBe(true);
    expect(sprays(0.07, 0.1)).toBe(false);
    expect(sprays(-0.01, 0.07)).toBe(false);
    let thrown = 0;
    for (let age = 0; age < SHAKE_S; age += STEP_S) if (sprays(age, age + STEP_S)) thrown += 1;
    // One every 0.06 s of a 0.7 s shake.
    expect(thrown).toBeGreaterThanOrEqual(11);
    expect(thrown).toBeLessThanOrEqual(12);
  });

  it("throws drops off its side that arc out and are gone", () => {
    const spray = new Spray(Texture.WHITE, 0.05, 1);
    const seen = () => spray.container.children.filter((sprite) => sprite.visible);
    // Facing east, thrown to its left (+y).
    spray.throw({ x: 5, y: 5 }, 0, 1, 0.2);
    expect(seen()).toHaveLength(1);
    spray.update(0.2);
    expect(seen()[0]?.position.y ?? 0).toBeGreaterThan(5);
    spray.update(0.2);
    expect(seen()).toHaveLength(0);
  });
});
