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
import { flameTexel, FLAME_FRAMES, FLAME_HEIGHT, FLAME_WIDTH } from "../../src/atmosphere/sprites";

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
