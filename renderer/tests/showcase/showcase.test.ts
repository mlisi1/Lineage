import { describe, expect, it } from "vitest";
import { HAND_GLYPHS } from "../../src/pixelfont";
import { FrameMeter, type FrameReport } from "../../src/showcase/meter";
import { paintLine, paintTitle } from "../../src/showcase/overlay";
import { captionAt, dipAt } from "../../src/showcase/showcase";
import { ACTS, HARDWARE, LOOP_S, actAt } from "../../src/showcase/script";

const WIDTH = 512;
const HEIGHT = 300;

describe("the showcase's script", () => {
  it("runs its thirteen acts from the title to the end card, some two and a half minutes", () => {
    expect(ACTS.map((act) => act.name)).toEqual([
      "title",
      "world",
      "creatures",
      "life",
      "family",
      "rare",
      "seasons",
      "weather",
      "night",
      "powers",
      "chronicle",
      "end",
      "card",
    ]);
    expect(LOOP_S).toBeGreaterThan(140);
    expect(LOOP_S).toBeLessThan(180);
    expect(ACTS[0]?.title).toBe("LINEAGE");
    expect(ACTS.at(-1)?.line).toBe(HARDWARE);
  });

  it("says where a moment falls, and loops", () => {
    expect(actAt(0)).toMatchObject({ loop: 0, index: 0, intoS: 0 });
    const second = ACTS[0]?.seconds ?? 0;
    expect(actAt(second + 1)).toMatchObject({ loop: 0, index: 1, intoS: 1 });
    expect(actAt(LOOP_S - 0.01).index).toBe(ACTS.length - 1);
    expect(actAt(LOOP_S + 2)).toMatchObject({ loop: 1, index: 0, intoS: 2 });
    expect(actAt(-5)).toMatchObject({ loop: 0, index: 0, intoS: 0 });
  });

  it("writes only what the scroll's hand can write, every line within the screen", () => {
    for (const act of ACTS) {
      for (const character of act.line + (act.title ?? "")) {
        if (character === " ") continue;
        expect(HAND_GLYPHS[character], `"${character}" in ${act.name}`).toBeDefined();
      }
      const drawn: [number, number][] = [];
      paintLine(act.line, WIDTH, HEIGHT, (x, y) => drawn.push([x, y]));
      if (act.title !== undefined)
        paintTitle(act.title, WIDTH, HEIGHT, (x, y) => drawn.push([x, y]));
      for (const [x, y] of drawn) {
        expect(x, act.name).toBeGreaterThanOrEqual(0);
        expect(x, act.name).toBeLessThan(WIDTH);
        expect(y, act.name).toBeGreaterThanOrEqual(0);
        expect(y, act.name).toBeLessThan(HEIGHT);
      }
    }
  });
});

describe("the showcase's frame meter", () => {
  it("counts the frames each second and hands on every interval by act", () => {
    const counts: number[] = [];
    const reports: FrameReport[] = [];
    const meter = new FrameMeter(
      (fps) => counts.push(fps),
      (report) => reports.push(report),
    );
    for (let k = 0; k <= 6 * 30; k++) meter.frame((k * 1000) / 30, k < 90 ? 2 : 3, 0, k / 30);
    expect(counts[0]).toBeCloseTo(30, 0);
    expect(reports).toHaveLength(1);
    const frames = reports[0]?.frames ?? [];
    expect(frames).toHaveLength(150);
    expect(frames[0]).toEqual([2, 33.3]);
    expect(frames.at(-1)?.[0]).toBe(3);
    expect(reports[0]?.tool).toBe("lineage-showcase");
  });
});

describe("the showcase's transitions", () => {
  it("fades the picture out before each cut and in after it, through the dark", () => {
    // An act of 10 s with a cut at 6: dark at its start, its cut and its end.
    expect(dipAt(0, 10, [6])).toBe(1);
    expect(dipAt(6, 10, [6])).toBe(1);
    expect(dipAt(10, 10, [6])).toBe(1);
    // Clear between, easing in and out (never a step).
    expect(dipAt(3, 10, [6])).toBe(0);
    expect(dipAt(0.4, 10, [6])).toBeGreaterThan(0);
    expect(dipAt(0.4, 10, [6])).toBeLessThan(1);
    expect(dipAt(5.7, 10, [6])).toBeGreaterThan(dipAt(5.5, 10, [6]));
    for (let t = 0; t + 0.05 <= 10; t += 0.05) {
      expect(Math.abs(dipAt(t + 0.05, 10, [6]) - dipAt(t, 10, [6]))).toBeLessThan(0.15);
    }
  });

  it("shows the caption only while the picture is up, eased in and out", () => {
    expect(captionAt(0, 10)).toBe(0);
    expect(captionAt(0.8, 10)).toBe(0);
    expect(captionAt(5, 10)).toBe(1);
    expect(captionAt(9.4, 10)).toBe(0);
    expect(captionAt(1.0, 10)).toBeGreaterThan(0);
    expect(captionAt(1.0, 10)).toBeLessThan(1);
  });
});
