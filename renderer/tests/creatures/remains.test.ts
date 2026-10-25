import { Sprite, type Container } from "pixi.js";
import { describe, expect, it } from "vitest";
import { EGG_S, MOMENT_S, NEWBORN_S, Nursery } from "../../src/creatures/nursery";
import {
  DYING,
  Remains,
  TINT_STEPS,
  bonePixel,
  boneTexture,
  mixColour,
  remainsOpacity,
  type BodyView,
  type Laid,
} from "../../src/creatures/remains";
import { installCanvas } from "./canvas";

installCanvas();

const HOUR_MS = 3_600_000;

/** The sprites shown under `container`. */
function shown(container: Container): Sprite[] {
  const out: Sprite[] = [];
  const walk = (node: Container): void => {
    for (const child of node.children) {
      if (!child.visible) continue;
      if (child instanceof Sprite) out.push(child);
      else walk(child);
    }
  };
  walk(container);
  return out;
}

const lying: Laid = { x: 10, y: 5, heading: 0.3, length: 1.2, width: 0.5 };
const at: Record<BodyView, Laid> = { middle: lying, local: lying };

describe("how a death is drawn", () => {
  it("goes by its cause: a kill or a blast at once, old age slowly, the drowned sinking", () => {
    const lasts = (cause: keyof typeof DYING): number => DYING[cause].still + DYING[cause].goes;
    expect(lasts("killed")).toBeLessThan(lasts("starved"));
    expect(lasts("blast")).toBeLessThan(lasts("killed"));
    expect(lasts("old_age")).toBeGreaterThan(lasts("starved"));
    expect(DYING.drowned.sinks).toBe(true);
    expect(Object.values(DYING).filter((how) => how.sinks)).toHaveLength(1);
    // Wasted pale, charred dark, blue with the water.
    expect(DYING.starved.tint).toBe(DYING.old_age.tint);
    expect(DYING.burnt.tint).toBeLessThan(0x404040);
    expect(DYING.drowned.tint & 0xff).toBeGreaterThan((DYING.drowned.tint >> 16) & 0xff);
    expect(TINT_STEPS).toBeGreaterThan(1);
  });

  it("mixes colours channel by channel", () => {
    expect(mixColour(0x000000, 0xffffff, 0)).toBe(0x000000);
    expect(mixColour(0x000000, 0xffffff, 1)).toBe(0xffffff);
    expect(mixColour(0x204060, 0x406080, 0.5)).toBe(0x305070);
  });

  it("leaves remains whole for half a sim-day, then fading in steps, gone after a day", () => {
    expect(remainsOpacity(0)).toBe(1);
    expect(remainsOpacity(12 * HOUR_MS)).toBe(1);
    expect(remainsOpacity(13 * HOUR_MS)).toBe(1);
    expect(remainsOpacity(15.5 * HOUR_MS)).toBe(0.75);
    expect(remainsOpacity(23 * HOUR_MS)).toBe(0.25);
    expect(remainsOpacity(24 * HOUR_MS)).toBe(0);
    let before = 1;
    for (let ms = 0; ms <= 25 * HOUR_MS; ms += HOUR_MS / 4) {
      const now = remainsOpacity(ms);
      expect(now).toBeLessThanOrEqual(before);
      expect([0, 0.25, 0.5, 0.75, 1]).toContain(now);
      before = now;
    }
  });

  it("draws bones: a skull at the head, a spine down the middle, nothing beyond the body", () => {
    const length = 20;
    const width = 8;
    expect(bonePixel(length, width, 0.86 * length, 1)).toBeGreaterThanOrEqual(0);
    for (let u = 2; u < 14; u++)
      expect(bonePixel(length, width, u + 0.5, 0)).toBeGreaterThanOrEqual(0);
    expect(bonePixel(length, width, 10, 9)).toBe(-1);
    expect(bonePixel(length, width, -2, 0)).toBe(-1);
    expect(bonePixel(length, width, length + 2, 0)).toBe(-1);
    // Ribs reach out from the chest (curving back a little), and not from the tail.
    let ribs = 0;
    let tail = 0;
    for (let u = 0; u < length; u += 0.5) {
      if (bonePixel(length, width, u, 2.5) >= 0) {
        if (u > 0.3 * length) ribs += 1;
        else tail += 1;
      }
    }
    expect(ribs).toBeGreaterThan(0);
    expect(tail).toBe(0);
  });

  it("makes each carcass's bones once, at least a few pixels long, charred apart", () => {
    const bones = boneTexture(12, 4, 3, false);
    expect(boneTexture(12, 4, 3, false)).toBe(bones);
    expect(boneTexture(12, 4, 3, true)).not.toBe(bones);
    expect(boneTexture(12, 4, 4, false)).not.toBe(bones);
    expect(bones.width).toBe(16);
    expect(boneTexture(2, 1, 0, false).width).toBe(7 + 4);
  });
});

describe("what deaths and landings leave", () => {
  it("leaves bones where it fell, drawn in the views that draw bodies and not on the map", () => {
    const remains = new Remains();
    remains.now = 1000;
    remains.died("starved", at);
    remains.update(0.1, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(1);
    remains.update(0.1, "map", 2);
    expect(shown(remains.floor)).toHaveLength(0);
    remains.update(0.1, "local", 32);
    expect(shown(remains.floor)).toHaveLength(1);
  });

  it("leaves nothing of the drowned and the blasted, only their going", () => {
    const remains = new Remains();
    remains.died("drowned", at);
    remains.died("blast", at);
    remains.update(0.2, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(0);
    // The drowned's rings and bubbles rise where it sank.
    expect(shown(remains.over).length).toBeGreaterThan(0);
    remains.update(3, "middle", 8);
    expect(shown(remains.over)).toHaveLength(0);
  });

  it("throws up a scuffle of dust over a kill, after the hunter strikes", () => {
    const remains = new Remains();
    remains.died("killed", at, 0.5);
    remains.update(0.3, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(0);
    expect(shown(remains.over)).toHaveLength(0);
    remains.update(0.4, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(1);
    const dust = shown(remains.over);
    expect(dust.length).toBeGreaterThan(0);
    expect(dust.every((puff) => puff.tint === 0xcbb998)).toBe(true);
    remains.update(1, "middle", 8);
    expect(shown(remains.over)).toHaveLength(0);
  });

  it("puffs green among the dust of a venomous kill", () => {
    const remains = new Remains();
    remains.died("killed", at, 0, true);
    remains.update(0.1, "middle", 8);
    const tints = new Set(shown(remains.over).map((puff) => puff.tint));
    expect(tints.has(0xa8dc5a)).toBe(true);
    expect(tints.has(0xcbb998)).toBe(true);
  });

  it("lets the remains go after a sim-day, and keeps at most the latest 48", () => {
    const remains = new Remains();
    remains.now = 0;
    remains.died("old_age", at);
    remains.now = 23 * HOUR_MS;
    remains.update(0.1, "middle", 8);
    expect(shown(remains.floor)[0]?.alpha).toBe(0.25);
    remains.now = 24 * HOUR_MS;
    remains.update(0.1, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(0);
    for (let k = 0; k < 60; k++) remains.died("starved", at);
    remains.update(0.1, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(48);
  });

  it("forgets remains when time goes back, or a world ends", () => {
    const remains = new Remains();
    remains.now = 5 * HOUR_MS;
    remains.died("burnt", at);
    remains.now = HOUR_MS;
    remains.update(0.1, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(0);
    remains.died("burnt", at);
    remains.clear();
    remains.update(0.1, "middle", 8);
    expect(shown(remains.floor)).toHaveLength(0);
  });

  it("splashes an animal landed from the sea, in a wet patch that dries away", () => {
    const remains = new Remains();
    remains.landed(at);
    remains.update(0.1, "local", 32);
    expect(shown(remains.floor)).toHaveLength(1);
    const drops = shown(remains.over).length;
    expect(drops).toBeGreaterThan(10);
    const wet = shown(remains.floor)[0]?.alpha ?? 0;
    remains.update(4, "local", 32);
    expect(shown(remains.floor)[0]?.alpha ?? 1).toBeLessThan(wet);
    expect(shown(remains.over)).toHaveLength(0);
    remains.update(4.1, "local", 32);
    expect(shown(remains.floor)).toHaveLength(0);
  });
});

describe("a birth", () => {
  it("raises three hearts one after another, after its delay, then they are gone", () => {
    const nursery = new Nursery(32);
    nursery.love({ x: 4, y: 4 }, 0.5);
    nursery.update(0.4);
    expect(shown(nursery.container)).toHaveLength(0);
    nursery.update(0.2);
    expect(shown(nursery.container)).toHaveLength(1);
    nursery.update(0.9);
    expect(shown(nursery.container)).toHaveLength(3);
    // Each rises: the first is higher than the last.
    const [first, , last] = shown(nursery.container);
    expect(first?.position.y ?? 0).toBeLessThan(last?.position.y ?? 0);
    nursery.update(1.5);
    expect(shown(nursery.container)).toHaveLength(0);
  });

  it("lays an egg the newborn's size that rocks, cracks and comes apart with bits thrown off", () => {
    const nursery = new Nursery(32);
    nursery.lay({ x: 4, y: 4 }, 0.5, 0.2);
    nursery.update(0.1);
    expect(shown(nursery.container)).toHaveLength(0);
    nursery.update(0.2);
    const [egg] = shown(nursery.container);
    // 0.5 cells × 0.9 at 32 pixels a cell: 14 pixels across, 1.3 times as tall.
    expect(egg?.texture.width).toBe(14);
    expect(egg?.texture.height).toBe(18);
    const whole = egg?.texture;
    nursery.update(EGG_S - 0.2);
    // Cracked toward its end.
    expect(shown(nursery.container)[0]?.texture).not.toBe(whole);
    nursery.update(0.15);
    // Two halves of shell and six bits.
    expect(shown(nursery.container)).toHaveLength(8);
    nursery.update(0.6);
    expect(shown(nursery.container)).toHaveLength(0);
  });

  it("never lays an egg smaller than five pixels, and forgets everything when cleared", () => {
    const nursery = new Nursery(8);
    nursery.lay({ x: 1, y: 1 }, 0.1);
    nursery.love({ x: 1, y: 1 });
    nursery.update(0.01);
    expect(shown(nursery.container).some((sprite) => sprite.texture.width === 5)).toBe(true);
    nursery.clear();
    nursery.update(0.01);
    expect(shown(nursery.container)).toHaveLength(0);
  });

  it("has the mother stand over her newborn longer than it takes to come into being", () => {
    expect(MOMENT_S).toBeGreaterThan(NEWBORN_S);
  });
});
