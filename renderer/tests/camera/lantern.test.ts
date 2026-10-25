import { describe, expect, it } from "vitest";
import {
  CANDLE,
  Captions,
  DAYLIGHT,
  LAMP_LEVELS,
  SHADOW_ALPHA,
  lampKey,
  lantern,
  layOut,
  lightPicture,
  scrollSize,
  type Caption,
} from "../../src/captions";
import { NIGHT_LIGHT } from "../../src/atmosphere/light";
import { VERMILION, initialHeight, initialWidth } from "../../src/illumination";
import {
  BASELINE,
  GLYPH_ROWS,
  HAND_BASELINE,
  HAND_FONT,
  HAND_GLYPHS,
  HAND_ROWS,
  measure,
} from "../../src/pixelfont";
import type { ChronicleMessage } from "../../src/protocol";
import type { Rgb } from "../../src/atmosphere/light";
import { fakeCanvas } from "../support/canvas";

fakeCanvas();

const WHITE = 0xffffff;
const brightness = (lamp: Rgb): number => lamp[0] + lamp[1] + lamp[2];

describe("the lantern the scrolls are lit by (R5)", () => {
  it("leaves the scroll as painted by day", () => {
    expect(lantern(1, WHITE, false)).toEqual(DAYLIGHT);
  });

  it("dims and warms toward candlelight as the light falls", () => {
    const night = lantern(NIGHT_LIGHT, 0x808080, false);
    expect(brightness(night)).toBeLessThan(brightness(DAYLIGHT));
    // Warm: more red than green, more green than blue.
    expect(night[0]).toBeGreaterThan(night[1]);
    expect(night[1]).toBeGreaterThan(night[2]);
    for (let k = 0; k < 3; k++) expect(night[k]).toBeCloseTo(CANDLE[k] ?? 0, 1);
    // Dusk is between.
    const dusk = lantern(0.4, 0x808080, false);
    expect(brightness(dusk)).toBeLessThan(brightness(DAYLIGHT));
    expect(brightness(dusk)).toBeGreaterThan(brightness(night));
    // Never darker as the light rises.
    let last = 0;
    for (let light = 0; light <= 1.0001; light += 0.05) {
      const now = brightness(lantern(light, 0x808080, false));
      expect(now).toBeGreaterThanOrEqual(last - 1e-9);
      last = now;
    }
  });

  it("takes a touch of the sky's colour: a moonlit night is bluer than a grey one", () => {
    const grey = lantern(NIGHT_LIGHT, 0x606060, false);
    const blue = lantern(NIGHT_LIGHT, 0x4060c0, false);
    expect(blue[2] / blue[0]).toBeGreaterThan(grey[2] / grey[0]);
    // A touch only: the paper stays warm.
    expect(blue[0]).toBeGreaterThan(blue[2]);
  });

  it("darkens and reddens with the fires of a world's end, even by day", () => {
    const day = lantern(1, 0xc03018, true);
    expect(brightness(day)).toBeLessThan(brightness(DAYLIGHT));
    expect(day[0]).toBeGreaterThan(day[2]);
    // Without the end the same sky leaves the paper as painted by day.
    expect(lantern(1, 0xc03018, false)).toEqual(DAYLIGHT);
  });

  it("comes in steps, so the scroll is repainted only when one is crossed", () => {
    for (let light = 0; light <= 1; light += 0.037) {
      for (const channel of lantern(light, 0x7080a0, false)) {
        expect(channel * LAMP_LEVELS).toBeCloseTo(Math.round(channel * LAMP_LEVELS), 9);
      }
    }
    expect(lampKey(DAYLIGHT)).toBe(WHITE);
  });

  it("multiplies every solid colour by the lamp, leaving the see-through shadow be", () => {
    const rgba = new Uint8ClampedArray([200, 100, 50, 255, 16, 8, 28, SHADOW_ALPHA, 0, 0, 0, 0]);
    const picture = { width: 3, height: 1, rgba };
    lightPicture(picture, [0.5, 0.5, 0.5]);
    expect([...rgba]).toEqual([100, 50, 25, 255, 16, 8, 28, SHADOW_ALPHA, 0, 0, 0, 0]);
    const untouched = new Uint8ClampedArray([200, 100, 50, 255]);
    lightPicture({ width: 1, height: 1, rgba: untouched }, DAYLIGHT);
    expect([...untouched]).toEqual([200, 100, 50, 255]);
  });
});

describe("an entry laid out on the illuminated scroll (R5)", () => {
  const caption = (text: string, extra: Partial<Caption> = {}): Caption => ({
    number: 1,
    importance: 3,
    text,
    date: "2027-08-12",
    ...extra,
  });

  it("opens with its kind's icon and its first letter as the initial", () => {
    const layout = layOut(caption("Among the Lameza a giant was born.", { kind: "first" }));
    expect(layout.icon).toBe("medal");
    expect(layout.initial).toBe("A");
    expect(layout.lines.join(" ")).toBe("mong the Lameza a giant was born.");
    expect(layOut(caption("Something.")).icon).toBe("quill");
  });

  it("letters the date in capitals for its ribbon, or none without a clock", () => {
    expect(layOut(caption("A fire.")).date).toBe("12 AUGUST 2027");
    expect(layOut(caption("A fire.", { date: null })).date).toBeNull();
  });

  it("writes the first two lines beside the initial, the rest under it", () => {
    const text =
      "Among the Lameza was born the island's first creature that sleeps through the cold, " +
      "a thing never seen before on the island in all its long years.";
    const layout = layOut(caption(text));
    expect(layout.lines.length).toBe(3);
    const beside = layout.initialLeft + initialWidth("A");
    expect(layout.lineLefts[0]).toBeGreaterThan(beside);
    expect(layout.lineLefts[1]).toBe(layout.lineLefts[0]);
    expect(layout.lineLefts[2]).toBe(layout.initialLeft);
    expect(layout.height).toBeGreaterThanOrEqual(initialHeight());
  });

  it("balances a short entry over two lines, so that its scroll is short", () => {
    const short = layOut(caption("A volcano woke in the north."));
    expect(short.lines.length).toBe(2);
    const long =
      "A volcano woke in the north of the island, and its ash fell for days on the woods.";
    expect(scrollSize(caption("A volcano woke in the north.")).width).toBeLessThan(
      scrollSize(caption(long)).width,
    );
    // A one-word entry has one line.
    expect(layOut(caption("Dawn.")).lines).toEqual(["awn."]);
  });

  it("writes in the larger hand, and never more than three lines", () => {
    const text = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const layout = layOut(caption(text));
    expect(layout.lines.length).toBe(3);
    expect(layout.lines[2]?.endsWith("...")).toBe(true);
    expect(layout.width).toBeLessThanOrEqual(420);
  });
});

describe("the scroll on screen (Captions)", () => {
  function entry(species: number, kind = "speciation"): ChronicleMessage {
    return {
      type: "chronicle",
      protocol: 1,
      notable_importance: 3,
      major_importance: 4,
      entries: [
        { number: 5, t_ms: 0, kind, importance: 3, text: "A new species.", species, x: 4, y: 4 },
      ],
    };
  }

  it("colours the initial in the species' colour, or vermilion when it is not known", () => {
    const known = new Captions(512, 300, (species) => (species === 3 ? 0x3a7a5a : null));
    known.take(entry(3), "2027-08-12");
    known.update(1 / 30);
    expect(known.state.initial).toBe(0x3a7a5a);
    expect(known.state.icon).toBe("sprout");
    const unknown = new Captions(512, 300, () => null);
    unknown.take(entry(9), null);
    unknown.update(1 / 30);
    expect(unknown.state.initial).toBe(VERMILION);
    const none = new Captions(512, 300, () => 0x123456);
    none.take(entry(0), null);
    none.update(1 / 30);
    expect(none.state.initial).toBe(VERMILION);
  });

  it("says the lamp it is lit by", () => {
    const captions = new Captions(512, 300);
    captions.take(entry(0), null);
    captions.update(1 / 30, CANDLE);
    expect(captions.state.lamp).toBe(lampKey(CANDLE));
    expect(captions.element.style.display).toBe("block");
  });
});

describe("the scroll's hand (HAND_FONT)", () => {
  it("has whole glyphs: nine rows to the baseline, three below at most, rows as wide", () => {
    for (const [character, source] of Object.entries(HAND_GLYPHS)) {
      const rows = source.split("/");
      expect(rows.length, character).toBeGreaterThanOrEqual(HAND_BASELINE);
      expect(rows.length, character).toBeLessThanOrEqual(HAND_ROWS);
      expect(new Set(rows.map((row) => row.length)).size, character).toBe(1);
      expect(source.includes("#"), character).toBe(true);
    }
  });

  it("draws every letter, digit and the punctuation the chronicle writes", () => {
    for (let code = 65; code <= 90; code++) {
      expect(HAND_GLYPHS[String.fromCharCode(code)], String.fromCharCode(code)).toBeDefined();
      expect(HAND_GLYPHS[String.fromCharCode(code + 32)]).toBeDefined();
    }
    for (const character of "0123456789.,:;!?'\"()-%/&") {
      expect(HAND_GLYPHS[character], character).toBeDefined();
    }
  });

  it("hangs the descenders below the baseline", () => {
    for (const character of "gpqy") {
      const glyph = HAND_FONT.glyph(character);
      const below = glyph.rows.slice(HAND_BASELINE).some((row) => row.some(Boolean));
      expect(below, character).toBe(true);
    }
    const capital = HAND_FONT.glyph("H");
    expect(capital.rows.slice(HAND_BASELINE).some((row) => row.some(Boolean))).toBe(false);
  });

  it("is larger than the caption font", () => {
    expect(HAND_ROWS).toBeGreaterThan(GLYPH_ROWS);
    expect(HAND_BASELINE).toBeGreaterThan(BASELINE);
    const text = "The Nemafa took to the water.";
    expect(HAND_FONT.measure(text)).toBeGreaterThan(measure(text));
  });

  it("measures what it draws", () => {
    const text = "Hard times for the Malesha: 92 left.";
    let right = 0;
    const width = HAND_FONT.draw(text, 5, 0, (x) => (right = Math.max(right, x)));
    expect(width).toBe(HAND_FONT.measure(text));
    expect(right).toBe(5 + width - 1);
  });

  it("wraps its first lines narrower beside an initial", () => {
    const text = "Hard times for the Malesha: only 92 are left of 198, after a long dry summer.";
    const lines = HAND_FONT.wrap(text, 160, 40, 2);
    expect(lines.join(" ")).toBe(text);
    lines.forEach((line, index) => {
      expect(HAND_FONT.measure(line)).toBeLessThanOrEqual(index < 2 ? 120 : 160);
    });
    // Without the indent the first lines take more.
    expect(HAND_FONT.wrap(text, 160)[0]?.length ?? 0).toBeGreaterThan(lines[0]?.length ?? 0);
  });
});
