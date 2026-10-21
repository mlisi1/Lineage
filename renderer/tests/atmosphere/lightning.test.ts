import { describe, expect, it } from "vitest";
import { BOLTS, boltAt, boltPath, strikePoint } from "../../src/atmosphere/lightning";
import {
  coneShape,
  coneSummit,
  conePixel,
  ledgeAt,
  CRATER_RIM,
  craterHeight,
  craterPixel,
  LAVA_FRAMES,
  lavaPixel,
  type MarkPixel,
} from "../../src/atmosphere/marks";
import {
  BIG_FLAME_FRAMES,
  BIG_FLAME_HEIGHT,
  BIG_FLAME_WIDTH,
  EMBER_FRAMES,
  EMBER_HEIGHT,
  EMBER_WIDTH,
  bigFlameTexel,
  emberTexel,
  flameTexel,
  FLAME_FRAMES,
  FLAME_HEIGHT,
  FLAME_WIDTH,
} from "../../src/atmosphere/sprites";

describe("lightning", () => {
  it("falls more often and brighter in a thunderstorm than in thunder, the strike brightest", () => {
    const count = (kind: "thunder" | "storm"): number => {
      const seen = new Set<number>();
      for (let t = 0; t < 600; t += 0.05) {
        const bolt = boltAt(kind, t);
        if (bolt !== null) seen.add(bolt.n);
      }
      return seen.size;
    };
    expect(count("storm")).toBeGreaterThan(3 * count("thunder"));
    expect(count("thunder")).toBeGreaterThan(20);
    expect(BOLTS.storm.flash).toBeGreaterThan(BOLTS.thunder.flash);
    expect(BOLTS.strike.flash).toBeGreaterThan(BOLTS.storm.flash);
    expect(BOLTS.strike.width).toBeGreaterThan(BOLTS.storm.width);
  });

  it("falls at irregular times: short gaps and long lulls", () => {
    const starts: number[] = [];
    let last = -1;
    for (let t = 0; t < 1200; t += 0.05) {
      const bolt = boltAt("thunder", t);
      if (bolt !== null && bolt.n !== last) {
        starts.push(t);
        last = bolt.n;
      }
    }
    const gaps = starts.slice(1).map((t, i) => t - (starts[i] ?? 0));
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const spread = Math.sqrt(gaps.reduce((a, b) => a + (b - mean) ** 2, 0) / gaps.length);
    // A clock would give gaps all alike; these vary about as much as they last.
    expect(spread / mean).toBeGreaterThan(0.6);
    expect(Math.min(...gaps)).toBeLessThan(mean / 3);
    expect(Math.max(...gaps)).toBeGreaterThan(mean * 2.5);
  });

  it("is the same at the same moment", () => {
    expect(boltAt("storm", 12.34)).toEqual(boltAt("storm", 12.34));
  });

  it("runs from above the screen down to where it strikes, one pixel a row", () => {
    const at = strikePoint(7, 512, 300);
    expect(at.y).toBeGreaterThan(100);
    const [main, ...forks] = boltPath(7, at.x, at.y, 2);
    expect(main?.[0]?.[1]).toBeLessThan(0);
    expect(main?.[main.length - 1]).toEqual([at.x, at.y]);
    main?.forEach(([, y], i) => {
      if (i > 0) expect(y - (main[i - 1]?.[1] ?? 0)).toBe(1);
    });
    expect(forks).toHaveLength(2);
  });
});

describe("the flame and the marks", () => {
  it("draws a flame broad at its foot and pointed at its tip, its heart inside", () => {
    for (let frame = 0; frame < FLAME_FRAMES; frame++) {
      const width = (y: number): number =>
        Array.from({ length: FLAME_WIDTH }, (_, x) => flameTexel(frame, x, y)).filter((t) => t >= 0)
          .length;
      expect(width(FLAME_HEIGHT - 2)).toBeGreaterThan(width(1));
      const hearts = Array.from({ length: FLAME_HEIGHT * FLAME_WIDTH }, (_, i) =>
        flameTexel(frame, i % FLAME_WIDTH, Math.floor(i / FLAME_WIDTH)),
      ).filter((t) => t === 3).length;
      expect(hearts).toBeGreaterThan(0);
    }
  });

  const brightness = (pixel: MarkPixel): number => {
    const colour = pixel?.[0] ?? 0;
    return (colour >> 16) + ((colour >> 8) & 255) + (colour & 255);
  };

  it("builds a cone of ledges standing up out of its foot, larger ones with more", () => {
    const small = coneShape(20);
    const large = coneShape(160);
    expect(large.ledges).toBeGreaterThan(small.ledges);
    expect(large.height).toBeGreaterThan(large.width); // it rises above its foot
    expect(coneSummit(160)).toBe(large.ledges * large.lift);
  });

  it("draws cliff faces below the ledges' south edges, darker than the tops, and lava in its mouth", () => {
    const shape = coneShape(120);
    let scree = 0;
    let faces = 0;
    let faceLight = 0;
    let tops = 0;
    let topLight = 0;
    for (let y = 0; y < shape.height; y++) {
      for (let x = 0; x < shape.width; x++) {
        const at = ledgeAt(shape, x, y);
        const pixel = conePixel(shape, x, y);
        if (at === null) {
          // Off the ledges only scree, round the foot, never above it.
          if (pixel !== null) {
            scree += 1;
            expect(Math.hypot(x + 0.5 - shape.cx, y + 0.5 - shape.cy)).toBeGreaterThan(
              shape.radius * 0.8,
            );
          }
          continue;
        }
        if (at.kind === "face") {
          expect(y + 0.5).toBeGreaterThan(shape.cy - at.ledge * shape.lift); // south of its ledge
          faces += 1;
          faceLight += brightness(pixel);
        } else if (at.ledge < shape.ledges) {
          tops += 1;
          topLight += brightness(pixel);
        }
      }
    }
    expect(faces).toBeGreaterThan(100);
    expect(tops).toBeGreaterThan(faces);
    expect(scree).toBeGreaterThan(0);
    expect(topLight / tops).toBeGreaterThan(faceLight / faces);
    const mouth = lavaPixel(
      shape,
      Math.round(shape.cx),
      Math.round(shape.cy - shape.ledges * shape.lift + 2),
    );
    expect(mouth).not.toBeNull();
    expect(lavaPixel(shape, 0, 0)).toBeNull();
    // The lava moves from frame to frame and comes round again.
    const frames = (frame: number): string =>
      Array.from({ length: shape.height * shape.width }, (_, i) =>
        String(lavaPixel(shape, i % shape.width, Math.floor(i / shape.width), frame)?.[0]),
      ).join();
    expect(frames(1)).not.toBe(frames(0));
    expect(frames(LAVA_FRAMES)).toBe(frames(0));
  });

  it("draws a crater: a lit far wall, the near wall in shadow, ejecta beyond, never a circle", () => {
    const size = 160;
    const rim = (size / 2) * CRATER_RIM;
    const mid = size / 2;
    expect(craterPixel(size, mid, mid)).not.toBeNull(); // the floor is drawn, not a hole
    // Inside, the wall facing the light (lower right) is brighter than the one in shadow.
    const wall = Math.round(rim * 0.75 * Math.SQRT1_2);
    expect(brightness(craterPixel(size, mid + wall, mid + wall))).toBeGreaterThan(
      brightness(craterPixel(size, mid - wall, mid - wall)),
    );
    // Thrown earth just beyond the rim, all round; open ground at the texture's corner.
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const at = rim * 1.2;
      expect(
        craterPixel(size, Math.round(mid + dx * at), Math.round(mid + dy * at)),
      ).not.toBeNull();
    }
    expect(craterPixel(size, 0, 0)).toBeNull();
    // The rim wanders: its reach differs round the bowl.
    const reaches = [0, 0.25, 0.5, 0.75].map((turn) => {
      let r = 0;
      while (
        craterHeight(Math.cos(2 * Math.PI * turn) * r, Math.sin(2 * Math.PI * turn) * r) < 0.17
      ) {
        r += 0.005;
      }
      return r;
    });
    expect(Math.max(...reaches) - Math.min(...reaches)).toBeGreaterThan(0.03);
  });
});

describe("the close fire", () => {
  it("keeps its base on its fuel while its top licks and sways", () => {
    const row = (frame: number, y: number): string =>
      Array.from({ length: BIG_FLAME_WIDTH }, (_, x) => bigFlameTexel(frame, x, y)).join();
    const foot = BIG_FLAME_HEIGHT - 1;
    const top = Math.floor(BIG_FLAME_HEIGHT * 0.3);
    const feet = new Set<string>();
    const tops = new Set<string>();
    for (let frame = 0; frame < BIG_FLAME_FRAMES; frame++) {
      feet.add(row(frame, foot));
      tops.add(row(frame, top));
    }
    expect(feet.size).toBe(1);
    expect(tops.size).toBeGreaterThan(2);
    // Deep red at its rim, white-gold at its heart.
    const middle = Math.floor(BIG_FLAME_WIDTH / 2);
    expect(bigFlameTexel(0, middle, foot - 2)).toBe(5);
    expect(bigFlameTexel(0, 0, foot)).toBeLessThanOrEqual(0);
  });

  it("stands in a bed of embers that glow in turn", () => {
    const bed = (frame: number): number[] =>
      Array.from({ length: EMBER_WIDTH * EMBER_HEIGHT }, (_, i) =>
        emberTexel(frame, i % EMBER_WIDTH, Math.floor(i / EMBER_WIDTH)),
      );
    expect(bed(0)).not.toEqual(bed(1));
    expect(EMBER_FRAMES).toBeGreaterThan(1);
    expect(emberTexel(0, 0, 0)).toBe(-1); // its corners are the ground's
    expect(bed(0).filter((tone) => tone >= 3).length).toBeGreaterThan(5);
  });
});
