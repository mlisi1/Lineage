import { describe, expect, it } from "vitest";
import {
  CaptionQueue,
  GAP_S,
  MOST_WAITING,
  ROLL_UP_S,
  UNROLL_S,
  linesOf,
  longDate,
  paintScroll,
  readingTime,
  scrollSize,
  type Caption,
} from "../../src/captions";
import { measure } from "../../src/pixelfont";
import type { ChronicleMessage } from "../../src/protocol";

function message(...entries: [number, number, string][]): ChronicleMessage {
  return {
    type: "chronicle",
    protocol: 1,
    notable_importance: 3,
    major_importance: 4,
    entries: entries.map(([number, importance, text]) => ({
      number,
      t_ms: 0,
      kind: "test",
      importance,
      text,
      species: 0,
      x: -1,
      y: -1,
    })),
  };
}

/** Every caption shown, in order, with how long each was fully open. */
function play(queue: CaptionQueue, seconds: number): { text: string; openS: number }[] {
  const shown: { text: string; openS: number }[] = [];
  const step = 1 / 30;
  for (let t = 0; t < seconds; t += step) {
    const { caption, open } = queue.update(step);
    if (caption === null) continue;
    const last = shown[shown.length - 1];
    if (last?.text !== caption.text) shown.push({ text: caption.text, openS: 0 });
    if (open === 1) (shown[shown.length - 1] as { openS: number }).openS += step;
  }
  return shown;
}

describe("captions", () => {
  it("shows the notable entries only, one after another, each for its reading time", () => {
    const queue = new CaptionQueue();
    queue.take(
      message(
        [1, 3, "A new species, the Malebi."],
        [2, 2, "Autumn came."],
        [3, 5, "The world ended."],
      ),
      "2027-08-12",
    );
    const shown = play(queue, 60);
    expect(shown.map((each) => each.text)).toEqual([
      "A new species, the Malebi.",
      "The world ended.",
    ]);
    for (const each of shown) {
      expect(each.openS).toBeCloseTo(
        readingTime({ number: 0, importance: 3, text: each.text, date: null }),
        0,
      );
    }
  });

  it("unrolls, stays open, rolls up and waits before the next: never two at once", () => {
    const queue = new CaptionQueue();
    queue.take(message([1, 3, "One."], [2, 3, "Two."]), null);
    const phases: string[] = [];
    let opening = -1;
    for (let t = 0; t < 30; t += 1 / 30) {
      const { open } = queue.update(1 / 30);
      const { phase } = queue.state;
      if (phases[phases.length - 1] !== phase) {
        phases.push(phase);
        opening = -1;
      }
      if (phase === "unroll") {
        expect(open).toBeGreaterThanOrEqual(opening);
        opening = open;
      }
    }
    // The first starts at once; the second after the gap.
    expect(phases).toEqual([
      "unroll",
      "open",
      "roll-up",
      "gap",
      "unroll",
      "open",
      "roll-up",
      "gap",
    ]);
    const first = readingTime({ number: 1, importance: 3, text: "One.", date: null });
    expect(UNROLL_S + first + ROLL_UP_S + GAP_S).toBeLessThan(30);
  });

  it("keeps at most a few waiting, letting the least important go", () => {
    const queue = new CaptionQueue();
    queue.take(
      message(
        [1, 3, "a"],
        [2, 4, "b"],
        [3, 3, "c"],
        [4, 5, "d"],
        [5, 3, "e"],
        [6, 4, "f"],
        [7, 3, "g"],
      ),
      null,
    );
    expect(queue.length).toBe(MOST_WAITING);
    expect(play(queue, 120).map((each) => each.text)).toEqual(["b", "d", "f", "g"]);
  });

  it("writes the date in words above the entry, wrapping the entry within the scroll", () => {
    expect(longDate("2027-08-04")).toBe("4 August 2027");
    expect(longDate("someday")).toBe("someday");
    const caption: Caption = {
      number: 1,
      importance: 3,
      text: "Among the Lameza was born the island's first creature that sleeps through the cold.",
      date: "2027-08-04",
    };
    const { date, lines } = linesOf(caption);
    expect(date).toBe("4 August 2027");
    expect(lines.length).toBe(2);
    expect(lines.join(" ")).toBe(caption.text);
  });

  it("cuts an entry too long for the scroll with an ellipsis", () => {
    const text = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const { lines } = linesOf({ number: 1, importance: 3, text, date: null });
    expect(lines.length).toBe(4);
    expect(lines[3]?.endsWith("...")).toBe(true);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(264);
  });

  it("paints a scroll that opens from its middle, ink only on the paper shown", () => {
    const caption: Caption = {
      number: 1,
      importance: 3,
      text: "The Nemafa took to the water.",
      date: null,
    };
    const { width, height } = scrollSize(caption);
    // It fits the 512 × 300 screen with room round it.
    expect(width).toBeLessThan(512 - 100);
    expect(height).toBeLessThan(80);
    const opaque = (open: number): number[] => {
      const { rgba } = paintScroll(caption, open);
      const columns: number[] = [];
      for (let x = 0; x < width; x++) {
        let any = false;
        for (let y = 0; y < height; y++) any ||= (rgba[4 * (y * width + x) + 3] ?? 0) === 255;
        if (any) columns.push(x);
      }
      return columns;
    };
    const closed = opaque(0);
    const half = opaque(0.5);
    const full = opaque(1);
    expect(closed.length).toBeLessThan(half.length);
    expect(half.length).toBeLessThan(full.length);
    // Centred: as much either side of the middle.
    const middle = (columns: number[]): number =>
      ((columns[0] ?? 0) + (columns[columns.length - 1] ?? 0)) / 2;
    expect(Math.abs(middle(half) - middle(full))).toBeLessThanOrEqual(1);
    expect(paintScroll(caption, 1)).toEqual(paintScroll(caption, 1));
  });
});
