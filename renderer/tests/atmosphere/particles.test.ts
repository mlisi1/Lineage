import { describe, expect, it } from "vitest";
import { demoMessages, landNear, showsOf } from "../../src/atmosphere/demo";
import { dropAt, puffAt, type Plume } from "../../src/atmosphere/particles";
import { HALO_SIZE, HALO_STEPS, haloAlpha } from "../../src/atmosphere/sprites";
import type { Land } from "../../src/terrain/land";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { world } from "../spike/worlds";

const plume: Plume = {
  x: 10,
  y: 10,
  spread: 1,
  rise: 8,
  drift: 2,
  life: 4,
  from: 2,
  to: 10,
  alpha: 0.8,
  salt: 3,
};

describe("smoke, ash and rain", () => {
  it("puts a puff in the same place at the same moment", () => {
    expect(puffAt(plume, 2, 1.7, 8)).toEqual(puffAt(plume, 2, 1.7, 8));
    expect(puffAt(plume, 2, 1.7, 8)).not.toEqual(puffAt(plume, 3, 1.7, 8));
  });

  it("lets a puff rise, grow and fade, and start again", () => {
    // Find a moment just after slot 0 starts, then follow it.
    let start = 0;
    for (let t = 0; t < plume.life; t += 0.01) {
      if (puffAt(plume, 0, t, 8).size < puffAt(plume, 0, start, 8).size) start = t;
    }
    const young = puffAt(plume, 0, start + 0.5, 8);
    const old = puffAt(plume, 0, start + 3.5, 8);
    expect(old.y).toBeLessThan(young.y);
    expect(old.size).toBeGreaterThan(young.size);
    expect(old.alpha).toBeLessThan(young.alpha);
    for (let t = 0; t < 20; t += 0.37) {
      const puff = puffAt(plume, 1, t, 8);
      expect(puff.alpha).toBeGreaterThanOrEqual(0);
      expect(puff.alpha).toBeLessThanOrEqual(plume.alpha);
      expect(puff.size).toBeGreaterThanOrEqual(plume.from - 1e-9);
      expect(puff.size).toBeLessThanOrEqual(plume.to + 1e-9);
    }
  });

  it("lets drops fall down the screen and stay on it", () => {
    const fall = { speed: 160, slant: -40, salt: 7 };
    for (let slot = 0; slot < 50; slot++) {
      for (let t = 0; t < 5; t += 0.13) {
        const drop = dropAt(fall, slot, t, 514, 302);
        expect(drop.x).toBeGreaterThanOrEqual(0);
        expect(drop.x).toBeLessThan(514);
        expect(drop.y).toBeGreaterThanOrEqual(-4);
        expect(drop.y).toBeLessThanOrEqual(302 + 8);
      }
    }
    const a = dropAt(fall, 4, 1, 514, 302);
    const b = dropAt(fall, 4, 1.01, 514, 302);
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe("the halo", () => {
  it("is lit in steps, brightest in its middle, nothing in its corners", () => {
    const middle = haloAlpha(HALO_SIZE / 2, HALO_SIZE / 2);
    expect(middle).toBe(1);
    expect(haloAlpha(0, 0)).toBe(0);
    const steps = new Set<number>();
    for (let x = 0; x < HALO_SIZE; x++) steps.add(haloAlpha(x, HALO_SIZE / 2));
    expect(steps.size).toBeLessThanOrEqual(HALO_STEPS.length + 1);
  });
});

describe("the atmosphere on demand", () => {
  const land: Land = {
    ...world(["~~~~~~", "~~gg~~", "~~gg~~", "~~~~~~"]),
    ...LAND_PALETTE,
  };

  it("reads the shows asked for, and nothing else", () => {
    expect(showsOf("night, fire,bogus,meteor")).toEqual(["night", "fire", "meteor"]);
    expect(showsOf(null)).toEqual([]);
  });

  it("finds land near where it is asked", () => {
    expect(landNear(land, 0, 0)).toEqual({ x: 2.5, y: 1.5 });
  });

  it("makes a sky and the events of the shows", () => {
    const messages = demoMessages(["night", "fire", "rain", "meteor", "end"], land, 3, 2, 99);
    const [sky, events] = messages;
    expect(sky?.type).toBe("sky");
    if (sky?.type !== "sky") return;
    expect(sky.light).toBe(0.05);
    expect(sky.present).toBe(false);
    expect(sky.raining).toBe(true);
    expect(sky.burning.length).toBeGreaterThan(0);
    expect(sky.burning).toEqual([...sky.burning].sort((a, b) => a - b));
    expect(events?.type === "events" && events.events.map((event) => event.kind)).toEqual([
      "god_power",
      "crater",
      "world_ended",
    ]);
    expect(demoMessages(["day"], land, 3, 2, 0)).toHaveLength(1);
  });
});
