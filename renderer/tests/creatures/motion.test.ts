import { describe, expect, it } from "vitest";
import { CLOSE_ZOOM, chunkVisible, viewAt } from "../../src/spike/camera";
import { followChain, solveKnee, type Point } from "../../src/creatures/chain";

const distance = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

describe("followChain", () => {
  it("keeps every joint at the spacing behind its leader", () => {
    const joints: Point[] = Array.from({ length: 6 }, (_, i) => ({ x: -i * 3, y: i * 0.7 }));
    const head = { ...(joints[0] as Point) };
    followChain(joints, 0.5);
    expect(joints[0]).toEqual(head); // the head is not moved
    for (let i = 1; i < joints.length; i++) {
      expect(distance(joints[i] as Point, joints[i - 1] as Point)).toBeCloseTo(0.5);
    }
  });

  it("trails the head when it moves", () => {
    // A body lying sideways; the head then walks a long way along +x.
    const joints: Point[] = Array.from({ length: 5 }, (_, i) => ({ x: 0, y: 0.4 * i }));
    for (let step = 0; step < 400; step++) {
      (joints[0] as Point).x += 0.1;
      followChain(joints, 0.4);
    }
    // The body has swung round into a line behind the head.
    for (let i = 1; i < joints.length; i++) {
      expect((joints[i] as Point).x).toBeCloseTo((joints[0] as Point).x - 0.4 * i, 2);
      expect((joints[i] as Point).y).toBeCloseTo(0, 2);
    }
  });

  it("separates joints that start on top of each other", () => {
    const joints: Point[] = Array.from({ length: 4 }, () => ({ x: 2, y: 2 }));
    followChain(joints, 0.3);
    for (let i = 1; i < joints.length; i++) {
      expect(distance(joints[i] as Point, joints[i - 1] as Point)).toBeCloseTo(0.3);
    }
  });
});

describe("solveKnee", () => {
  it("places the knee at bone length from hip and foot", () => {
    const hip = { x: 1, y: 2 };
    const foot = { x: 2.2, y: 2.9 };
    const knee = { x: 0, y: 0 };
    solveKnee(hip, foot, 1, 0.8, 1, knee);
    expect(distance(hip, knee)).toBeCloseTo(1);
    expect(distance(knee, foot)).toBeCloseTo(0.8);
    const other = { x: 0, y: 0 };
    solveKnee(hip, foot, 1, 0.8, -1, other);
    expect(distance(hip, other)).toBeCloseTo(1);
    expect(distance(knee, other)).toBeGreaterThan(0.1); // the two bends differ
  });

  it("stretches straight toward a foot out of reach", () => {
    const knee = { x: 0, y: 0 };
    solveKnee({ x: 0, y: 0 }, { x: 10, y: 0 }, 1, 1, 1, knee);
    expect(knee.x).toBeCloseTo(1, 2);
    expect(knee.y).toBeCloseTo(0, 2);
  });

  it("copes with a foot on the hip", () => {
    const knee = { x: Number.NaN, y: Number.NaN };
    solveKnee({ x: 3, y: 3 }, { x: 3, y: 3 }, 1, 1, 1, knee);
    expect(Number.isFinite(knee.x) && Number.isFinite(knee.y)).toBe(true);
    expect(distance({ x: 3, y: 3 }, knee)).toBeCloseTo(1);
  });
});

describe("viewAt", () => {
  it("fits the whole world in the wide shot at every art scale", () => {
    for (const artScale of [1, 2, 4]) {
      const view = viewAt("wide", 12.3, 1024 / artScale, 600 / artScale, 256, 150);
      expect(view.scale).toBe(4 / artScale);
      expect([view.x, view.y]).toEqual([0, 0]);
      expect(view.cells).toEqual({ x0: 0, y0: 0, x1: 256, y1: 150 });
    }
  });

  it("zooms the close-up and keeps it inside the world", () => {
    for (let t = 0; t < 300; t += 1.7) {
      const view = viewAt("close", t, 512, 300, 256, 150);
      expect(view.scale).toBe(2 * CLOSE_ZOOM);
      expect(view.cells.x1 - view.cells.x0).toBeCloseTo(256 / CLOSE_ZOOM);
      expect(view.cells.y1 - view.cells.y0).toBeCloseTo(150 / CLOSE_ZOOM);
      expect(view.cells.x0).toBeGreaterThanOrEqual(0);
      expect(view.cells.y0).toBeGreaterThanOrEqual(0);
      expect(view.cells.x1).toBeLessThanOrEqual(256);
      expect(view.cells.y1).toBeLessThanOrEqual(150);
      // The world's corner is placed so that the first visible cell is at the canvas edge.
      expect(view.x).toBeCloseTo(-view.cells.x0 * view.scale);
    }
  });

  it("pans over time", () => {
    const a = viewAt("close", 0, 512, 300, 256, 150);
    const b = viewAt("close", 8, 512, 300, 256, 150);
    expect(Math.abs(a.cells.x0 - b.cells.x0)).toBeGreaterThan(5);
  });
});

describe("chunkVisible", () => {
  const view = { x0: 100, y0: 50, x1: 164, y1: 87.5 };

  it("keeps chunks that touch the view or its margin", () => {
    expect(chunkVisible(view, 112, 64, 16, 2)).toBe(true); // inside
    expect(chunkVisible(view, 96, 48, 16, 2)).toBe(true); // overlapping a corner
    expect(chunkVisible(view, 80, 64, 16, 2)).toBe(false); // to the left
    expect(chunkVisible(view, 82, 64, 16, 2)).toBe(true); // within the margin
    expect(chunkVisible(view, 112, 96, 16, 2)).toBe(false); // below
  });
});
