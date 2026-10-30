import { describe, expect, it } from "vitest";
import { PULSE_S, PlaceMarker, RING_REACH, ringAt, ringPixels } from "../../src/marker";
import { VIEWS } from "../../src/landscape";

describe("the ring round a chronicle entry's place (R5)", () => {
  it("is the art pixels whose middles lie from its inner radius to its outer", () => {
    const ring = ringPixels(4, 6);
    expect(ring.length).toBeGreaterThan(0);
    for (const { x, y } of ring) {
      expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(4);
      expect(Math.hypot(x, y)).toBeLessThan(6);
    }
  });

  it("fits against the next band without a gap or an overlap", () => {
    const key = ({ x, y }: { x: number; y: number }): string => `${x},${y}`;
    const inner = ringPixels(3.5, 5.5).map(key);
    const outer = ringPixels(5.5, 6.5).map(key);
    const whole = ringPixels(3.5, 6.5).map(key);
    expect(inner.filter((pixel) => outer.includes(pixel))).toEqual([]);
    expect([...inner, ...outer].sort()).toEqual([...whole].sort());
  });

  it("swells from the pin to its widest once a pulse, by whole pixels, and starts again", () => {
    for (const view of VIEWS) {
      const [from, to] = RING_REACH[view];
      let last = -1;
      for (let t = 0; t < PULSE_S - 1e-6; t += PULSE_S / 50) {
        const { radius } = ringAt(t, view);
        expect(Number.isInteger(radius)).toBe(true);
        expect(radius).toBeGreaterThanOrEqual(from);
        expect(radius).toBeLessThanOrEqual(to);
        expect(radius).toBeGreaterThanOrEqual(last);
        last = radius;
      }
      expect(ringAt(0, view).radius).toBe(from);
      expect(last).toBe(to);
      expect(ringAt(PULSE_S + 0.1, view)).toEqual(ringAt(0.1, view));
    }
  });

  it("fades by steps as it swells: whole at first, fainter at the last", () => {
    expect(ringAt(0, "map").alpha).toBe(1);
    expect(ringAt(PULSE_S * 0.5, "map").alpha).toBe(1);
    expect(ringAt(PULSE_S * 0.9, "map").alpha).toBeLessThan(1);
    expect(ringAt(PULSE_S * 0.9, "map").alpha).toBeGreaterThan(0);
  });

  it("reaches further the closer the view", () => {
    expect(RING_REACH.middle[1]).toBeGreaterThan(RING_REACH.map[1]);
    expect(RING_REACH.local[1]).toBeGreaterThan(RING_REACH.middle[1]);
  });
});

describe("the place marker on screen (PlaceMarker)", () => {
  const cells = { x0: 100, y0: 50, x1: 116, y1: 59 };
  const origin = { x: -3200, y: -1600 };

  it("shows nothing without a place", () => {
    const marker = new PlaceMarker();
    marker.update(0.1, null, "map", cells, 4, { x: 0, y: 0 });
    expect(marker.container.visible).toBe(false);
  });

  it("stands on the place on the map, wherever it is, on a whole art pixel", () => {
    const marker = new PlaceMarker();
    marker.update(0.1, { x: 10.6, y: 20.3 }, "map", cells, 4, { x: 2, y: 3 });
    expect(marker.container.visible).toBe(true);
    expect(marker.container.x).toBe(2 + Math.floor(10.6 * 4));
    expect(marker.container.y).toBe(3 + Math.floor(20.3 * 4));
  });

  it("shows in a closer view only when the place is in sight", () => {
    const marker = new PlaceMarker();
    marker.update(0.1, { x: 108, y: 55 }, "local", cells, 32, origin);
    expect(marker.container.visible).toBe(true);
    expect(marker.container.x).toBe(origin.x + 108 * 32);
    // Just past the edge it still shows (its ring reaches in); far off it does not.
    marker.update(0.1, { x: 116.5, y: 55 }, "local", cells, 32, origin);
    expect(marker.container.visible).toBe(true);
    marker.update(0.1, { x: 130, y: 55 }, "local", cells, 32, origin);
    expect(marker.container.visible).toBe(false);
    marker.update(0.1, { x: 108, y: 40 }, "middle", cells, 8, origin);
    expect(marker.container.visible).toBe(false);
  });

  it("starts its pulse again at a new place", () => {
    const marker = new PlaceMarker();
    const ring = marker.container.children[0];
    marker.update(0, { x: 108, y: 55 }, "local", cells, 32, origin);
    marker.update(PULSE_S * 0.9, { x: 108, y: 55 }, "local", cells, 32, origin);
    expect(ring?.alpha).toBeLessThan(1);
    marker.update(0.01, { x: 109, y: 55 }, "local", cells, 32, origin);
    expect(ring?.alpha).toBe(1);
  });
});
