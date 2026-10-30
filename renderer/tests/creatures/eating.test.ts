import { Texture } from "pixi.js";
import { describe, expect, it } from "vitest";
import {
  BASK_REACH,
  bask,
  glintDue,
  glintKind,
  glintPlace,
  newBasker,
  sunny,
} from "../../src/creatures/basking";
import { SWIMS_FROM } from "../../src/creatures/body";
import { Flecks, bite, flecks } from "../../src/creatures/eating";
import {
  RIPPLES,
  WADE_DEPTH,
  bobAt,
  effortOf,
  paceIn,
  rippleAt,
  ringTexture,
  wetOf,
} from "../../src/creatures/wading";
import { canvases, installCanvas } from "./canvas";

installCanvas();

const STEP_S = 1 / 30;

describe("an animal eating", () => {
  it("does not move its head when it eats nothing", () => {
    expect(bite("none", 3.2, 0.4, 0.5)).toEqual({ forward: 0, aside: 0, phase: 0, count: 0 });
  });

  it("nibbles grass: the head reaches forward and back, never aside, a pause every fourth", () => {
    const spacing = 0.5;
    let rests = 0;
    let most = 0;
    for (let t = 0; t < 10; t += 0.01) {
      const { forward, aside, count } = bite("plants", t, 0, spacing);
      expect(aside).toBe(0);
      expect(forward).toBeGreaterThanOrEqual(0);
      expect(forward).toBeLessThanOrEqual(0.8 * spacing + 1e-9);
      most = Math.max(most, forward);
      if (count === -1) {
        rests += 1;
        expect(forward).toBe(0);
      }
    }
    expect(most).toBeCloseTo(0.8 * spacing, 2);
    // A quarter of the beats are a pause to chew.
    expect(rests / 1000).toBeCloseTo(0.25, 1);
  });

  it("dips down quickly and comes up slowly", () => {
    // 2.2 nibbles a second: the head is furthest 0.35 into a nibble.
    const nibble = 1 / 2.2;
    const down = bite("plants", 0.35 * nibble, 0, 1).forward;
    expect(down).toBeCloseTo(0.8);
    expect(bite("plants", 0.2 * nibble, 0, 1).forward).toBeGreaterThan(
      bite("plants", 0.8 * nibble, 0, 1).forward,
    );
  });

  it("tugs meat from side to side and back, never forward", () => {
    const spacing = 0.5;
    let left = 0;
    let right = 0;
    for (let t = 0; t < 5; t += 0.01) {
      const { forward, aside } = bite("meat", t, 0.2, spacing);
      expect(forward).toBeLessThanOrEqual(0);
      expect(forward).toBeGreaterThanOrEqual(-0.3 * spacing - 1e-9);
      expect(Math.abs(aside)).toBeLessThanOrEqual(0.6 * spacing + 1e-9);
      left = Math.min(left, aside);
      right = Math.max(right, aside);
    }
    expect(left).toBeLessThan(-0.25);
    expect(right).toBeGreaterThan(0.25);
  });

  it("keeps animals apart by their offsets", () => {
    expect(bite("plants", 1, 0.1, 1)).not.toEqual(bite("plants", 1, 0.6, 1));
  });

  it("throws a fleck at the end of every other nibble or tug, none while chewing", () => {
    expect(flecks("plants", 0.9, 0.96, 0)).toBe(true);
    expect(flecks("plants", 0.9, 0.96, 1)).toBe(false);
    expect(flecks("plants", 0.9, 0.96, 2)).toBe(true);
    expect(flecks("plants", 0.9, 0.96, -1)).toBe(false);
    expect(flecks("meat", 0.9, 0.96, 4)).toBe(true);
    expect(flecks("meat", 0.96, 0.99, 4)).toBe(false);
    expect(flecks("none", 0.9, 0.96, 0)).toBe(false);
  });

  it("flings flecks that rise, drift to their side and are gone", () => {
    const pool = new Flecks(Texture.WHITE, 0.1, 1);
    pool.throw("plants", { x: 5, y: 5 }, 1);
    pool.throw("none", { x: 9, y: 9 }, 1);
    const seen = () => pool.container.children.filter((sprite) => sprite.visible);
    expect(seen()).toHaveLength(1);
    pool.update(0.2);
    const [fleck] = seen();
    expect(fleck?.position.x).toBeGreaterThan(5);
    expect(fleck?.position.y).toBeLessThan(5);
    pool.update(0.3);
    expect(seen()).toHaveLength(0);
  });
});

describe("a land animal in the water", () => {
  it("is dry on land, wading on the shallow shelf, out of its depth beyond it", () => {
    expect(wetOf(-0.1)).toBe("dry");
    expect(wetOf(0)).toBe("dry");
    expect(wetOf(0.01)).toBe("shallow");
    expect(wetOf(WADE_DEPTH)).toBe("shallow");
    expect(wetOf(WADE_DEPTH + 0.001)).toBe("deep");
  });

  it("struggles in the water unless it is nearly a swimmer", () => {
    expect(effortOf(0)).toBe(1);
    expect(effortOf(SWIMS_FROM)).toBe(0);
    expect(effortOf(1)).toBe(0);
    expect(effortOf(SWIMS_FROM / 2)).toBeCloseTo(0.5);
  });

  it("slows in the shallows, more out of its depth, and not at all on wet sand", () => {
    expect(paceIn("dry", 1)).toBe(1);
    expect(paceIn("feet", 1)).toBe(1);
    expect(paceIn("shallow", 1)).toBeLessThan(1);
    expect(paceIn("deep", 1)).toBeLessThan(paceIn("shallow", 1));
    expect(paceIn("deep", 0)).toBe(1);
    expect(paceIn("deep", 0.5)).toBeGreaterThan(paceIn("deep", 1));
  });

  it("bobs only out of its depth, and less the better it swims", () => {
    let most = 0;
    for (let t = 0; t < 2; t += 0.01) {
      expect(bobAt("shallow", 1, t, 0)).toBe(0);
      most = Math.max(most, Math.abs(bobAt("deep", 1, t, 0.3)));
      expect(Math.abs(bobAt("deep", 0.5, t, 0.3))).toBeLessThanOrEqual(most + 1e-12);
    }
    expect(most).toBeGreaterThan(0.02);
    expect(most).toBeLessThanOrEqual(0.035 + 1e-12);
    expect(bobAt("deep", 0, 0.7, 0)).toBeCloseTo(0);
  });

  it("spreads ripples that grow and fade, none on dry land", () => {
    expect(rippleAt("dry", 1, 1, 0.5, 0)).toBeNull();
    const early = rippleAt("shallow", 1, 1, 0.1, 0);
    const late = rippleAt("shallow", 1, 1, 1.4, 0);
    expect(late?.across ?? 0).toBeGreaterThan(early?.across ?? Infinity);
    expect(late?.alpha ?? 1).toBeLessThan(early?.alpha ?? 0);
    // Out of its depth the rings go wider; the second ring half a spread behind the first.
    expect(rippleAt("deep", 1, 1, 0, 0)?.across ?? 0).toBeGreaterThan(
      rippleAt("shallow", 1, 1, 0, 0)?.across ?? Infinity,
    );
    expect(RIPPLES).toBe(2);
    expect(rippleAt("shallow", 1, 1, 0, 1)?.across).toBeCloseTo(
      rippleAt("shallow", 1, 1, 0.8, 0)?.across ?? 0,
    );
    // A swimmer-like body leaves fainter rings.
    expect(rippleAt("shallow", 0, 1, 0.3, 0)?.alpha ?? 1).toBeLessThan(
      rippleAt("shallow", 1, 1, 0.3, 0)?.alpha ?? 0,
    );
  });

  it("draws a ripple as a ring a pixel thick, flatter than wide, once per size", () => {
    const before = canvases.length;
    const ring = ringTexture(11);
    expect(ringTexture(11)).toBe(ring);
    expect(ringTexture(10.8)).toBe(ring);
    expect(canvases.length).toBe(before + 1);
    const rows = canvases[before]?.rows() ?? [];
    expect(rows[0]?.length).toBe(11);
    expect(rows.length).toBe(Math.round(11 * 0.6));
    // Hollow in the middle, drawn at its edges.
    const middle = rows[Math.floor(rows.length / 2)] ?? "";
    expect(middle[0]).toBe("#");
    expect(middle[10]).toBe("#");
    expect(middle[5]).toBe(".");
  });
});

describe("a photosynthesiser basking", () => {
  it("basks only in daylight under a clear sky", () => {
    expect(sunny(0, 0)).toBe(true);
    expect(sunny(0.3, 0.25)).toBe(true);
    expect(sunny(0.5, 0)).toBe(false);
    // Cloud (0.5) or worse keeps it standing.
    expect(sunny(0, 0.5)).toBe(false);
  });

  it("settles after standing a moment in the sun, spreads out slowly and gets up quickly", () => {
    const basker = newBasker();
    let t = 0;
    for (; t < 1.1; t += STEP_S) bask(basker, true, STEP_S);
    expect(basker.share).toBe(0);
    for (; t < 1.9; t += STEP_S) bask(basker, true, STEP_S);
    expect(basker.share).toBeGreaterThan(0);
    expect(basker.share).toBeLessThan(1);
    for (; t < 3; t += STEP_S) bask(basker, true, STEP_S);
    expect(basker.share).toBe(1);
    // Up in well under half a second.
    for (let up = 0; up < 0.4; up += STEP_S) bask(basker, false, STEP_S);
    expect(basker.share).toBe(0);
    expect(basker.waited).toBe(0);
  });

  it("spreads its feet further out than standing", () => {
    expect(BASK_REACH).toBeGreaterThan(0.8);
  });

  it("glints now and then once spread flat, never before", () => {
    const basker = newBasker();
    for (let t = 0; t < 5; t += STEP_S) expect(glintDue(basker, STEP_S, 0.3)).toBe(false);
    basker.share = 1;
    const times: number[] = [];
    for (let t = 0; t < 20; t += STEP_S) if (glintDue(basker, STEP_S, 0.3)) times.push(t);
    // The first after 1.2 × (0.5 + offset) seconds; then every 1.2 to 2.8 seconds.
    expect(times[0]).toBeCloseTo(1.2 * 0.8, 1);
    for (let k = 1; k < times.length; k++) {
      const gap = (times[k] ?? 0) - (times[k - 1] ?? 0);
      expect(gap).toBeGreaterThanOrEqual(1.2 - STEP_S);
      expect(gap).toBeLessThanOrEqual(2.8 + STEP_S);
    }
    expect(basker.glints).toBe(times.length);
  });

  it("glints at places along its back, all of them in turn", () => {
    const basker = newBasker();
    const places = new Set<number>();
    for (let k = 0; k < 40; k++) {
      basker.glints = k;
      const place = glintPlace(basker, 5, 0.37);
      expect(place).toBeGreaterThanOrEqual(0);
      expect(place).toBeLessThan(5);
      places.add(place);
    }
    expect(places.size).toBe(5);
  });

  it("draws its glint as a dot that grows to a star and shrinks back", () => {
    const kind = glintKind();
    expect(glintKind()).toBe(kind);
    expect(kind.frames.map((frame) => frame.width)).toEqual([1, 3, 5, 3, 1]);
    expect(kind.frames[1]).toBe(kind.frames[3]);
  });
});
