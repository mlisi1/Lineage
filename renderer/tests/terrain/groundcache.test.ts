import { describe, expect, it } from "vitest";
import { InlinePainter, type PaintRequest, type Painted } from "../../src/terrain/painter";
import { CLOSE_PIECES, PieceGround } from "../../src/terrain/grounds";
import { MemoryCache, NO_CACHE, type GroundCache } from "../../src/terrain/groundcache";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { fakeCanvas } from "../support/canvas";
import { world } from "../spike/worlds";

fakeCanvas();

/** Sixteen cells by eight: two of the local view's pieces side by side. */
const land = {
  ...world(["~~gggggggggggggg", "~sgggggggggggbbb", ...Array<string>(6).fill("~~gggggggggggccc")]),
  ...LAND_PALETTE,
};
const request = { style: "blended", grain: true } as const;
const everywhere = { x0: 0, y0: 0, x1: 16, y1: 8 };
const noShadows = (): undefined => undefined;

/**
 * A painter that keeps its paintings in `cache` (as the worker does) and counts what it
 * is asked for and what it paints anew.
 */
class Counting extends InlinePainter {
  asked = 0;
  painted = 0;

  constructor(cache: GroundCache = NO_CACHE) {
    super(cache);
  }

  override paint(paint: PaintRequest, priority?: number): Promise<Painted> {
    this.asked += 1;
    return super.paint(paint, priority).then((done) => {
      if (done.fresh === true) this.painted += 1;
      return done;
    });
  }
}

/** Let the cache and the painter answer (each a task or two), a frame at a time. */
async function settle(ground: PieceGround, view = everywhere): Promise<void> {
  for (let k = 0; k < 50 && !ground.ready(view); k++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    ground.tick(0);
  }
}

function groundOf(painter: Counting, cache = new MemoryCache()): PieceGround {
  painter.setLand(land);
  return new PieceGround(painter, 8, land, 0, CLOSE_PIECES, cache, 0);
}

describe("the ground kept between visits", () => {
  it("keeps every piece painted, and shows it again without painting it", async () => {
    const cache = new MemoryCache();
    const first = new Counting(cache);
    const ground = groundOf(first, cache);
    ground.update(1, request, noShadows, "day 1");
    ground.cover(everywhere);
    await settle(ground);
    expect(ground.ready(everywhere)).toBe(true);
    expect(first.painted).toBe(2);
    expect([...cache.kept.values()].map((kept) => kept.stamp)).toEqual(["day 1", "day 1"]);

    // A visit later (the page loaded again): the same day is shown as it was kept.
    const again = new Counting(cache);
    const later = groundOf(again, cache);
    later.update(1, request, noShadows, "day 1");
    later.cover(everywhere);
    await settle(later);
    expect(later.ready(everywhere)).toBe(true);
    expect(again.asked).toBe(0);
  });

  it("shows an older day's piece at once, and paints today's to come over it", async () => {
    const cache = new MemoryCache();
    const before = groundOf(new Counting(cache), cache);
    before.update(1, request, noShadows, "day 1");
    before.cover(everywhere);
    await settle(before);

    const painter = new Counting(cache);
    const ground = groundOf(painter, cache);
    ground.update(1, request, noShadows, "day 2");
    ground.cover(everywhere);
    // The older pieces come before anything is painted: no bare ground.
    await Promise.resolve();
    await Promise.resolve();
    ground.tick(0);
    expect(ground.container.children.length).toBe(2);
    expect(ground.ready(everywhere)).toBe(false);
    await settle(ground);
    expect(ground.ready(everywhere)).toBe(true);
    expect(painter.painted).toBe(2);
    expect([...cache.kept.values()].map((kept) => kept.stamp)).toEqual(["day 2", "day 2"]);
  });

  it("keeps what it is given as it was painted", async () => {
    const cache = new MemoryCache();
    const ground = groundOf(new Counting(cache), cache);
    ground.update(1, request, noShadows, "day 1");
    ground.cover(everywhere);
    await settle(ground);
    const painted = new InlinePainter();
    // (Painted again, without keeping: the same pixels as were kept.)
    painted.setLand(land);
    const { pixels } = await painted.paint({
      ...request,
      tile: 8,
      cells: { x0: 0, y0: 0, x1: 9, y1: 8 },
    });
    const kept = [...cache.kept.values()][0];
    expect(kept?.pixels.rgba).toEqual(pixels.rgba);
  });

  it("keeps nothing without a stamp, or without a cache", async () => {
    const cache = new MemoryCache();
    const unstamped = groundOf(new Counting(cache), cache);
    unstamped.update(1, request, noShadows);
    unstamped.cover(everywhere);
    await settle(unstamped);
    expect(cache.kept.size).toBe(0);

    const painter = new Counting();
    painter.setLand(land);
    const uncached = new PieceGround(painter, 8, land, 0, CLOSE_PIECES, NO_CACHE);
    uncached.update(1, request, noShadows, "day 1");
    uncached.cover(everywhere);
    await settle(uncached);
    expect(uncached.ready(everywhere)).toBe(true);
    expect(painter.asked).toBe(2);
  });

  it("paints the whole island ahead and keeps it, without showing it", async () => {
    const cache = new MemoryCache();
    const painter = new Counting(cache);
    const ground = groundOf(painter, cache);
    ground.update(1, request, noShadows, "day 1");
    // Nothing in view yet: every piece is painted ahead, kept and not shown.
    expect(await ground.prepaint()).toBe(2);
    expect(cache.kept.size).toBe(2);
    expect(ground.container.children.length).toBe(0);
    // Already kept for the day: nothing to paint again.
    expect(await ground.prepaint()).toBe(0);
    // Then the view finds them ready without painting.
    ground.cover(everywhere);
    await settle(ground);
    expect(ground.ready(everywhere)).toBe(true);
    expect(painter.painted).toBe(2);
  });

  it("stops painting ahead when another day comes", async () => {
    const cache = new MemoryCache();
    const ground = groundOf(new Counting(cache), cache);
    ground.update(1, request, noShadows, "day 1");
    const ahead = ground.prepaint();
    ground.update(2, request, noShadows, "day 2");
    expect(await ahead).toBeLessThan(2);
    expect([...cache.kept.values()].every((kept) => kept.stamp === "day 1")).toBe(true);
  });

  it("paints ahead only while it may, waiting while the frames come late", async () => {
    const cache = new MemoryCache();
    const ground = groundOf(new Counting(cache), cache);
    ground.update(1, request, noShadows, "day 1");
    let may = false;
    ground.mayPaintAhead = () => may;
    const ahead = ground.prepaint();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(cache.kept.size).toBe(0);
    may = true;
    expect(await ahead).toBe(2);
    expect(cache.kept.size).toBe(2);
  });
});
