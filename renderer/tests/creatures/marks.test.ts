import { Texture } from "pixi.js";
import { describe, expect, it, vi } from "vitest";
import { DISC_SIZE, creatureAtlas, disc, wedge } from "../../src/creatures/atlas";
import { heightAt, passableIn, type Relief } from "../../src/creatures/habitat";
import { dotOf, dotSize } from "../../src/creatures/markers";
import { Sparks, pixelTexture, type SparkKind } from "../../src/creatures/sparks";
import { envenom } from "../../src/creatures/venom";
import {
  CREATURE_SCALE,
  LOCAL_PIXELS,
  MAP_PIXELS,
  MID_BODY,
  MID_CREATURE_SCALE,
  MID_PIXELS,
  localBody,
  midBody,
} from "../../src/creatures/views";
import { FOAM, wakePair } from "../../src/creatures/wake";
import type { Pixels } from "../../src/terrain/pixels";
import { canvases, installCanvas, type FakeCanvas } from "./canvas";

installCanvas();

/** Rows of a picture, `#` where it is opaque. */
function rows(pixels: Pixels): string[] {
  return Array.from({ length: pixels.height }, (_, y) =>
    Array.from({ length: pixels.width }, (_, x) =>
      (pixels.rgba[(y * pixels.width + x) * 4 + 3] ?? 0) > 0 ? "#" : ".",
    ).join(""),
  );
}

/** A `Sparks` that only records what it is asked to put down. */
function recorder(): { sparks: Sparks; emitted: Parameters<Sparks["emit"]>[] } {
  const emitted: Parameters<Sparks["emit"]>[] = [];
  const emit = vi.fn((...args: Parameters<Sparks["emit"]>) => {
    emitted.push(args);
  });
  return { sparks: { emit } as unknown as Sparks, emitted };
}

describe("the views' sizes", () => {
  it("draws four times closer in the local view than the middle, the map closest to the world", () => {
    expect(MAP_PIXELS).toBeLessThan(MID_PIXELS);
    expect(LOCAL_PIXELS).toBe(4 * MID_PIXELS);
    expect(MID_BODY).toEqual({
      style: "cosy",
      scale: MID_CREATURE_SCALE,
      pixels: MID_PIXELS,
      pace: 1,
    });
    expect(midBody(0.3).scale).toBe(0.3);
  });

  it("lets an animal amble up close instead of hurrying", () => {
    const local = localBody(LOCAL_PIXELS);
    expect(local).toEqual({
      style: "cosy",
      scale: CREATURE_SCALE,
      pixels: LOCAL_PIXELS,
      pace: 0.35,
    });
    expect(local.pace).toBeLessThan(MID_BODY.pace);
  });
});

describe("where a body can be", () => {
  // A 4 × 3 island: one row of sea, one of shore, one of hills.
  const relief: Relief = {
    width: 4,
    height: 3,
    heights: [0.2, 0.2, 0.2, 0.2, 0.5, 0.5, 0.5, 0.5, 0.8, 0.8, 0.8, 0.8],
    seaLevel: 0.4,
  };

  it("reads a cell's height at its middle, and between cells as the painted ground does", () => {
    expect(heightAt(relief, 1.5, 0.5)).toBeCloseTo(0.2);
    expect(heightAt(relief, 1.5, 1.5)).toBeCloseTo(0.5);
    expect(heightAt(relief, 1.5, 1)).toBeCloseTo(0.35);
    expect(heightAt(relief, 1.3, 1.75)).toBeCloseTo(0.575);
    // Beyond the edge, the edge's own.
    expect(heightAt(relief, -3, 0)).toBeCloseTo(0.2);
    expect(heightAt(relief, 9, 9)).toBeCloseTo(0.8);
  });

  it("keeps walkers off the water and swimmers off the land, and everyone off the outer ring", () => {
    const wide: Relief = {
      width: 6,
      height: 6,
      heights: Array.from({ length: 36 }, (_, i) => (i % 6 < 3 ? 0.2 : 0.6)),
      seaLevel: 0.4,
    };
    const passable = passableIn(wide);
    expect(passable(4, 2, false)).toBe(true);
    expect(passable(4, 2, true)).toBe(false);
    expect(passable(1.5, 2, true)).toBe(true);
    expect(passable(1.5, 2, false)).toBe(false);
    // On the waterline itself: neither.
    expect(passable(3, 2, false)).toBe(false);
    expect(passable(3, 2, true)).toBe(false);
    // The outermost ring of cells.
    expect(passable(0.5, 2, true)).toBe(false);
    expect(passable(5.5, 2, false)).toBe(false);
  });
});

describe("animals on the map", () => {
  it("are dots in three sizes by mass", () => {
    expect(dotSize(0.5)).toBe("small");
    expect(dotSize(1.25 ** 3 - 0.01)).toBe("small");
    expect(dotSize(1.25 ** 3)).toBe("medium");
    expect(dotSize(7.99)).toBe("medium");
    expect(dotSize(8)).toBe("large");
  });

  it("are round, with an edge a pixel wide; a swimmer's is a ring", () => {
    const before = canvases.length;
    const large = dotOf("large", false);
    // Drawn once for every animal.
    expect(dotOf("large", false)).toBe(large);
    expect(dotOf("small", true).across).toBe(4);
    const canvas = canvases[before] as FakeCanvas;
    expect(canvases.length).toBe(before + 1);
    expect(large.across).toBe(8);
    const fill = (dot: typeof large): string[] =>
      canvas.rows(dot.fill.frame.x, dot.fill.frame.y, dot.across, dot.across);
    const edge = (dot: typeof large): string[] =>
      canvas.rows(dot.edge.frame.x, dot.edge.frame.y, dot.across, dot.across);
    expect(fill(large)).toEqual([
      "........",
      "...##...",
      "..####..",
      ".######.",
      ".######.",
      "..####..",
      "...##...",
      "........",
    ]);
    // The edge covers the fill and one pixel round it, not diagonally.
    expect(edge(large)).toEqual([
      "...##...",
      "..####..",
      ".######.",
      "########",
      "########",
      ".######.",
      "..####..",
      "...##...",
    ]);
    const ring = dotOf("large", true);
    expect(fill(ring)).toEqual([
      "........",
      "...##...",
      "..#..#..",
      ".#....#.",
      ".#....#.",
      "..#..#..",
      "...##...",
      "........",
    ]);
    // A small dot is too small for a hole: a swimmer's stays whole.
    expect(fill(dotOf("small", true))).toEqual(fill(dotOf("small", false)));
  });
});

describe("the creatures' atlas", () => {
  it("has a hard-edged round disc, filling its square", () => {
    const picture = rows(disc(8));
    expect(picture).toEqual([
      "..####..",
      ".######.",
      "########",
      "########",
      "########",
      "########",
      ".######.",
      "..####..",
    ]);
    const big = disc(DISC_SIZE);
    // Every pixel is fully on or fully off.
    for (let at = 3; at < big.rgba.length; at += 4) expect([0, 255]).toContain(big.rgba[at]);
  });

  it("has a wedge pointing right, its base down the left edge", () => {
    expect(rows(wedge(8))).toEqual([
      "#.......",
      "###.....",
      "#####...",
      "#######.",
      "#######.",
      "#####...",
      "###.....",
      "#.......",
    ]);
  });

  it("frames the disc, a white square's inside and the wedge side by side", () => {
    const atlas = creatureAtlas();
    expect(atlas.plants.size).toBe(0);
    expect([atlas.disc.frame.width, atlas.disc.frame.height]).toEqual([DISC_SIZE, DISC_SIZE]);
    expect([atlas.wedge.frame.width, atlas.wedge.frame.height]).toEqual([DISC_SIZE, DISC_SIZE]);
    expect(atlas.white.frame.width).toBe(2);
    // None overlaps another.
    const [disc_, white, wedge_] = [atlas.disc.frame, atlas.white.frame, atlas.wedge.frame];
    expect(disc_.x + disc_.width).toBeLessThanOrEqual(white.x);
    expect(white.x + white.width).toBeLessThanOrEqual(wedge_.x);
  });
});

describe("small marks of pixel art", () => {
  it("draws a mark from rows of texels", () => {
    const before = canvases.length;
    const texture = pixelTexture([".#.", "###", ".#."]);
    expect([texture.width, texture.height]).toEqual([3, 3]);
    expect(canvases[before]?.rows()).toEqual([".#.", "###", ".#."]);
  });

  const kind: SparkKind = {
    frames: [pixelTexture(["###"]), pixelTexture(["##"]), pixelTexture(["#"])],
    lasts: 0.9,
    fadesAt: 0.5,
  };

  it("shows a mark after its delay, on whole art pixels, its drawing changing as it ages", () => {
    const sparks = new Sparks(8, 4);
    const seen = () => sparks.container.children.filter((sprite) => sprite.visible);
    sparks.emit(kind, 0xff0000, 1.03, 2, 10, 0, 0.1);
    sparks.update(0.05);
    expect(seen()).toHaveLength(0);
    sparks.update(0.1);
    const [mark] = seen();
    expect(mark?.tint).toBe(0xff0000);
    // 1.03 cells at 8 pixels a cell, 10 pixels a second for 0.05 s: pixel 9, then its middle.
    expect((mark?.position.x ?? 0) * 8).toBeCloseTo(9 + 0.5);
    expect(mark?.alpha).toBe(1);
    sparks.update(0.3);
    expect((mark as unknown as { texture: Texture }).texture).toBe(kind.frames[1]);
    expect(mark?.alpha).toBe(1);
    // Past half its life, half see-through.
    sparks.update(0.2);
    expect(mark?.alpha).toBe(0.5);
    sparks.update(0.4);
    expect(seen()).toHaveLength(0);
  });

  it("drops the oldest mark when the pool is full, and puts all away when the view changes", () => {
    const sparks = new Sparks(8, 2);
    const seen = () => sparks.container.children.filter((sprite) => sprite.visible);
    for (let k = 0; k < 3; k++) sparks.emit(kind, 0x10 + k, k, 0);
    sparks.update(0.01);
    expect(seen().map((sprite) => sprite.tint)).toEqual([0x12, 0x11]);
    sparks.clear();
    sparks.update(0.01);
    expect(seen()).toHaveLength(0);
  });
});

describe("a venomous strike", () => {
  it("flashes at the bite, drips twice from it and puffs four wisps off the prey", () => {
    const { sparks, emitted } = recorder();
    envenom(sparks, { x: 3, y: 4 }, { x: 3.2, y: 4.1 }, 1, 8);
    expect(emitted).toHaveLength(7);
    const [flash, ...rest] = emitted;
    expect(flash?.slice(2, 4)).toEqual([3, 4]);
    const drips = rest.slice(0, 2);
    const puffs = rest.slice(2);
    // The drips a pixel either side of the bite, falling, after the flash.
    expect(drips.map((drip) => drip[2])).toEqual([3 - 1 / 8, 3 + 1 / 8]);
    for (const drip of drips) {
      expect(drip[5]).toBeGreaterThan(0);
      expect(drip[6]).toBeGreaterThan(0);
    }
    // The wisps rise off the prey, drifting either way in turn, one after another.
    for (const puff of puffs) {
      expect(puff.slice(2, 4)).toEqual([3.2, 4.1]);
      expect(puff[5]).toBeLessThan(0);
    }
    expect(puffs.map((puff) => Math.sign(puff[4] ?? 0))).toEqual([1, -1, 1, -1]);
    const delays = puffs.map((puff) => puff[6] ?? 0);
    expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  });
});

describe("a swimmer's wake", () => {
  it("puts down a pair of foam dashes beside its body, drifting out to either side", () => {
    const { sparks, emitted } = recorder();
    // Swimming east (+x): its left is +y.
    wakePair(sparks, { x: 5, y: 5 }, 0, 0.25, 8);
    expect(emitted).toHaveLength(2);
    const [left, right] = emitted;
    expect(left?.[1]).toBe(FOAM);
    expect(left?.[2]).toBeCloseTo(5);
    expect(left?.[3]).toBeCloseTo(5 + 0.25 + 1 / 8);
    expect(right?.[3]).toBeCloseTo(5 - 0.25 - 1 / 8);
    expect(left?.[5]).toBeGreaterThan(0);
    expect(right?.[5]).toBeLessThan(0);
    // Each laid along its arm of the V: the two arms aslant, mirrored.
    expect(left?.[0]).not.toBe(right?.[0]);
  });
});
