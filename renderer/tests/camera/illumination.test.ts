import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  FALLBACK_ICON,
  ICONS,
  ICON_COLOURS,
  ICON_OF_KIND,
  ICON_SIZE,
  INITIAL_MOST_DIGITS,
  RIBBON,
  RIBBON_LETTERS,
  VERMILION,
  iconOf,
  initialFill,
  initialHeight,
  initialWidth,
  paintIcon,
  paintInitial,
  paintRibbon,
  ribbonHeight,
  ribbonWidth,
  splitInitial,
} from "../../src/illumination";
import { HAND_BASELINE } from "../../src/pixelfont";

/** The kinds of entry the sim's chronicle writes (`lineage_sim.chronicle.Kind`). */
const SIM_KINDS: string[] = (() => {
  const source = readFileSync("../sim/lineage_sim/chronicle.py", "utf8");
  const body = /class Kind\(Enum\):([\s\S]*?)\n\n\n/.exec(source)?.[1] ?? "";
  return [...body.matchAll(/^\s+[A-Z_]+ = "([a-z_]+)"/gm)].map((match) => match[1] ?? "");
})();

/** What a painter was asked to paint: colour by "x,y". */
function canvas(): {
  put: (x: number, y: number, colour: number) => void;
  at: Map<string, number>;
} {
  const at = new Map<string, number>();
  return { put: (x, y, colour) => at.set(`${x},${y}`, colour), at };
}
const luma = (colour: number): number =>
  (0.299 * ((colour >> 16) & 255) + 0.587 * ((colour >> 8) & 255) + 0.114 * (colour & 255)) / 255;

describe("the icons of the chronicle's entries", () => {
  it("has an icon for every kind of entry the sim's chronicle writes", () => {
    expect(SIM_KINDS.length).toBeGreaterThan(20);
    for (const kind of SIM_KINDS) {
      expect(Object.hasOwn(ICON_OF_KIND, kind), kind).toBe(true);
      expect(iconOf(kind)).not.toBe(FALLBACK_ICON);
    }
  });

  it("writes an entry of a kind it does not know with a quill", () => {
    expect(iconOf("")).toBe("quill");
    expect(iconOf("something_new")).toBe("quill");
    expect(iconOf("constructor")).toBe("quill");
  });

  it("draws every icon fifteen pixels square in the icons' own colours", () => {
    for (const [name, rows] of Object.entries(ICONS)) {
      expect(rows, name).toHaveLength(ICON_SIZE);
      for (const row of rows) {
        expect(row, name).toHaveLength(ICON_SIZE);
        for (const key of row) {
          if (key !== ".") expect(Object.hasOwn(ICON_COLOURS, key), `${name} ${key}`).toBe(true);
        }
      }
    }
  });

  it("paints an icon where it is asked to, and nothing on the paper round it", () => {
    const { put, at } = canvas();
    paintIcon("flame", 10, 20, put);
    expect(at.size).toBeGreaterThan(20);
    for (const key of at.keys()) {
      const [x, y] = key.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThan(10 + ICON_SIZE);
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThan(20 + ICON_SIZE);
    }
  });

  it("gives every kind of entry its own icon", () => {
    const icons = new Set(SIM_KINDS.map(iconOf));
    expect(icons.size).toBe(SIM_KINDS.length);
  });
});

describe("the illuminated initial", () => {
  it("is the entry's first letter, in capitals, or a short number it opens with", () => {
    expect(splitInitial("Among the Lameza")).toEqual({ initial: "A", rest: "mong the Lameza" });
    expect(splitInitial("  the island")).toEqual({ initial: "T", rest: "he island" });
    expect(splitInitial("92 are left")).toEqual({ initial: "92", rest: " are left" });
    const long = "1".repeat(INITIAL_MOST_DIGITS + 1);
    expect(splitInitial(`${long} days`)).toEqual({ initial: "", rest: `${long} days` });
    expect(splitInitial("“Quoted”")).toEqual({ initial: "", rest: "“Quoted”" });
    expect(splitInitial("")).toEqual({ initial: "", rest: "" });
  });

  it("is two lines of the hand tall, and as wide as its letters", () => {
    expect(initialHeight()).toBeGreaterThan(2 * HAND_BASELINE);
    expect(initialWidth("")).toBe(0);
    expect(initialWidth("W")).toBeGreaterThan(initialWidth("I"));
    expect(initialWidth("12")).toBeGreaterThan(initialWidth("1"));
  });

  it("keeps a species' colour that reads, and darkens or lightens one that would not", () => {
    // A middling colour is kept as it is.
    expect(initialFill(0x7a4a8a)).toBe(0x7a4a8a);
    expect(initialFill(VERMILION)).toBe(VERMILION);
    // A pale one is darkened, a near-black one lightened, both into the band that reads.
    expect(luma(initialFill(0xf8f4e0))).toBeLessThanOrEqual(0.5);
    expect(luma(initialFill(0xf8f4e0))).toBeLessThan(luma(0xf8f4e0));
    expect(luma(initialFill(0x050505))).toBeGreaterThanOrEqual(0.18);
  });

  it("paints a framed square with the letter knocked out in paper and gold corners", () => {
    const { put, at } = canvas();
    const ink = 0x5a3424;
    const paper = 0xf7e6bc;
    paintInitial("A", 0x3a7a5a, 0, 0, ink, paper, put);
    const width = initialWidth("A");
    const height = initialHeight();
    expect(at.size).toBe(width * height);
    const gold = at.get("0,0");
    expect(at.get(`${width - 1},0`)).toBe(gold);
    expect(at.get(`0,${height - 1}`)).toBe(gold);
    expect(at.get(`${width - 1},${height - 1}`)).toBe(gold);
    expect(at.get("1,0")).toBe(ink);
    const painted = [...at.values()];
    expect(painted.filter((colour) => colour === paper).length).toBeGreaterThan(10);
    expect(painted).toContain(0x3a7a5a);
  });

  it("paints nothing for an entry with no initial", () => {
    const { put, at } = canvas();
    paintInitial("", 0x3a7a5a, 0, 0, 0, 0, put);
    expect(at.size).toBe(0);
  });
});

describe("the date's ribbon", () => {
  it("is as wide as its date and its tails, and a line of capitals tall", () => {
    expect(ribbonWidth("4 AUGUST 2027")).toBeGreaterThan(ribbonWidth("4 MAY 2027"));
    expect(ribbonHeight()).toBeGreaterThan(7);
  });

  it("paints a red band lettered in warm white within its size", () => {
    const { put, at } = canvas();
    const date = "12 AUGUST 2027";
    paintRibbon(date, 3, 5, 0x5a3424, put);
    const colours = [...at.values()];
    expect(colours).toContain(RIBBON);
    expect(colours.filter((colour) => colour === RIBBON_LETTERS).length).toBeGreaterThan(20);
    for (const key of at.keys()) {
      const [x = 0, y = 0] = key.split(",").map(Number);
      expect(x).toBeGreaterThanOrEqual(3);
      expect(x).toBeLessThan(3 + ribbonWidth(date));
      expect(y).toBeGreaterThanOrEqual(5);
      // The tails hang a little below the band.
      expect(y).toBeLessThan(5 + ribbonHeight() + 3);
    }
  });
});
