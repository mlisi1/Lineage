import { describe, expect, it } from "vitest";
import { DEFAULT_LOOK } from "../../src/looks";
import { colourArt } from "../../src/plants/plantart";
import { prepareStanding } from "../../src/plants/plants";
import { packSheet, sheetArts, SHEET_WIDTH } from "../../src/plants/standing";
import type { Land } from "../../src/terrain/land";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { world } from "../spike/worlds";

const land = {
  ...world(["~~~~~~", "~gbbg~", "~bccb~", "~~~~~~"], 200),
  ...LAND_PALETTE,
  season: "summer",
} as Land;

const ask = {
  tile: 32,
  look: DEFAULT_LOOK,
  close: true,
  pieces: true,
  shown: ["summer", "autumn"] as const,
  snows: [false],
  rare: [],
};

describe("a sheet of standing plants packed off the page's thread (R5, the optimization plan)", () => {
  const arts = sheetArts(land, ask);

  it("names every drawing by the season it is in", () => {
    expect(arts.some(({ key }) => key.startsWith("summer:"))).toBe(true);
    expect(arts.some(({ key }) => key.startsWith("autumn:"))).toBe(true);
    expect(new Set(arts.map(({ key }) => key)).size).toBe(arts.length);
  });

  it("puts each drawing's coloured pixels where it says, none overlapping, within a page", () => {
    const { pages, places } = packSheet(arts, DEFAULT_LOOK.plants);
    expect(places).toHaveLength(arts.length);
    const owner = pages.map(({ width, height }) => new Int32Array(width * height).fill(-1));
    arts.forEach(({ art, ramp, accent, wood }, index) => {
      const at = places[index];
      const page = at === undefined ? undefined : pages[at.page];
      const taken = at === undefined ? undefined : owner[at.page];
      if (at === undefined || page === undefined || taken === undefined) throw new Error("lost");
      expect(page.width).toBeLessThanOrEqual(SHEET_WIDTH);
      expect(at.left + art.width).toBeLessThanOrEqual(page.width);
      expect(at.top + art.height).toBeLessThanOrEqual(page.height);
      const pixels = colourArt(art, ramp, accent, wood, DEFAULT_LOOK.plants);
      for (let y = 0; y < art.height; y++) {
        for (let x = 0; x < art.width; x++) {
          const cell = (at.top + y) * page.width + at.left + x;
          expect(taken[cell]).toBe(-1);
          taken[cell] = index;
        }
        const from = y * art.width * 4;
        const into = ((at.top + y) * page.width + at.left) * 4;
        expect([...page.rgba.subarray(into, into + art.width * 4)]).toEqual([
          ...pixels.rgba.subarray(from, from + art.width * 4),
        ]);
      }
    });
  });

  it("settles at once where no worker can draw ahead (the layer draws it itself then)", async () => {
    await expect(prepareStanding(land, 32, { close: true })).resolves.toBeUndefined();
  });
});
