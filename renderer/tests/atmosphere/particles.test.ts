import { describe, expect, it } from "vitest";
import { Container, Texture } from "pixi.js";
import { PARK_FRAMES, RowPool, dropAt, puffAt, type Plume } from "../../src/atmosphere/particles";
import { HALO_SIZE, HALO_STEPS, haloAlpha } from "../../src/atmosphere/sprites";

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

describe("what stands among the plants", () => {
  it("goes into the row of its foot, later ones drawn over earlier, the rest hidden", () => {
    const fallback = new Container();
    const guests = Array.from({ length: 8 }, () => new Container());
    const rows = { guests, rowsPerCell: 2 };
    const pool = new RowPool(fallback);
    pool.begin();
    const a = pool.next(Texture.WHITE, rows, 1.2); // row 2
    const b = pool.next(Texture.WHITE, rows, 1.4); // row 2, after a
    const c = pool.next(Texture.WHITE, rows, 99); // the last row
    pool.end();
    expect(a.parent).toBe(guests[2]);
    expect(guests[2]?.children.indexOf(b)).toBeGreaterThan(guests[2]?.children.indexOf(a) ?? 9);
    expect(c.parent).toBe(guests[7]);
    // On the map, no rows: the fallback; a sprite not asked for again is hidden.
    pool.begin();
    const d = pool.next(Texture.WHITE, null, 1.2);
    pool.end();
    expect(d.parent).toBe(fallback);
    // Not drawn: see-through at once, hidden once long unused (`PARK_FRAMES`).
    expect(b.alpha).toBe(0);
    for (let k = 0; k < PARK_FRAMES; k++) {
      pool.begin();
      pool.next(Texture.WHITE, null, 1.2);
      pool.end();
    }
    expect(b.visible).toBe(false);
  });

  it("stays last in its row in the order asked, and is not moved when it is there already", () => {
    const guests = [new Container()];
    const rows = { guests, rowsPerCell: 1 };
    const pool = new RowPool(new Container());
    const frame = (): [unknown, unknown] => {
      pool.begin();
      const first = pool.next(Texture.WHITE, rows, 0.5);
      const second = pool.next(Texture.WHITE, rows, 0.5);
      pool.end();
      return [first, second];
    };
    const [first, second] = frame();
    // An animal comes into the row after them: next frame they go after it again.
    const animal = new Container();
    guests[0]?.addChild(animal);
    frame();
    expect(guests[0]?.children).toEqual([animal, first, second]);
    // Nothing changed: nothing is taken out and put back (no draw list rebuilt for it).
    let moved = 0;
    guests[0]?.on("childRemoved", () => (moved += 1));
    frame();
    frame();
    expect(moved).toBe(0);
    expect(guests[0]?.children).toEqual([animal, first, second]);
  });
});
