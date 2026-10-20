import { describe, expect, it } from "vitest";
import {
  BASELINE,
  GLYPHS,
  GLYPH_ROWS,
  draw,
  glyph,
  measure,
  plain,
  wrap,
} from "../../src/pixelfont";

describe("the caption font", () => {
  it("has whole glyphs: 7 rows to the baseline, at most 2 below, every row as wide", () => {
    for (const [character, source] of Object.entries(GLYPHS)) {
      const rows = source.split("/");
      expect(rows.length, character).toBeGreaterThanOrEqual(BASELINE);
      expect(rows.length, character).toBeLessThanOrEqual(GLYPH_ROWS);
      expect(new Set(rows.map((row) => row.length)).size, character).toBe(1);
      expect(source.includes("#"), character).toBe(true);
    }
  });

  it("draws every letter, digit and the punctuation the chronicle writes", () => {
    const text = "Among the Lameza was born the island's first giant: 92 of 198, (in 30 days)!?";
    for (const character of text) expect(glyph(character).width).toBeGreaterThan(0);
    for (let code = 65; code <= 90; code++) {
      expect(GLYPHS[String.fromCharCode(code)]).toBeDefined();
      expect(GLYPHS[String.fromCharCode(code + 32)]).toBeDefined();
    }
  });

  it("draws typography as its plain twin, and the unknown as a question mark", () => {
    expect(plain("island’s — “first”…")).toBe('island\'s – "first"...');
    expect(glyph("☃")).toEqual(glyph("?"));
  });

  it("measures what it draws", () => {
    const text = "The Maleha are dwindling.";
    let right = 0;
    const width = draw(text, 3, 0, (x) => (right = Math.max(right, x)));
    expect(width).toBe(measure(text));
    expect(right).toBe(3 + width - 1);
  });

  it("wraps at spaces within the width, keeping every word", () => {
    const text = "Hard times for the Malesha: only 92 are left of 198, after a long dry summer.";
    const lines = wrap(text, 120);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(120);
    expect(lines.join(" ")).toBe(text);
  });

  it("cuts a word too long for a line", () => {
    const lines = wrap("Supercalifragilisticexpialidocious", 40);
    for (const line of lines) expect(measure(line)).toBeLessThanOrEqual(40);
    expect(lines.join("")).toBe("Supercalifragilisticexpialidocious");
  });
});
