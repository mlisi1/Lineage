import { describe, expect, it } from "vitest";
import { INK, drawSmall, drawStanding, type PlantArt } from "../../src/plants/plantart";

const count = (art: PlantArt, ink: number): number =>
  art.ink.filter((value) => value === ink).length;

/**
 * Drawn pixels with a clear pixel beside them: what an outline must have covered, but
 * for the inks in `open` (a bare tree's fine twigs, and the snow on them).
 */
function bareEdges(art: PlantArt, open: readonly number[] = []): number {
  let found = 0;
  for (let y = 0; y < art.height; y++) {
    for (let x = 0; x < art.width; x++) {
      const ink = art.ink[y * art.width + x] ?? 0;
      if (ink === INK.none || ink === INK.outline || ink === INK.woodOutline) continue;
      if (open.includes(ink)) continue;
      const clear = (dx: number, dy: number): boolean => {
        const nx = x + dx;
        const ny = y + dy;
        return nx < 0 || ny < 0 || nx >= art.width || ny >= art.height
          ? true
          : art.ink[ny * art.width + nx] === INK.none;
      };
      if (clear(-1, 0) || clear(1, 0) || clear(0, -1) || clear(0, 1)) found += 1;
    }
  }
  return found;
}

describe("cosy plants", () => {
  it("outline everything they draw but a bare tree's fine twigs, wood under snow too", () => {
    const twigs = [INK.trunkDark, INK.snow, INK.snowShade];
    for (const form of ["BROADLEAF", "CONIFER", "SHRUB", "GRASS"] as const) {
      for (const season of ["summer", "winter"] as const) {
        const art = drawStanding(form, "grown", 0, 4, season, season === "winter", "cosy");
        const open = form === "BROADLEAF" && season === "winter" ? twigs : [];
        expect(bareEdges(art, open), `${form} in ${season}`).toBe(0);
      }
    }
    // The fine twigs are there.
    const bareTree = drawStanding("BROADLEAF", "grown", 0, 4, "winter", false, "cosy");
    expect(count(bareTree, INK.trunkDark)).toBeGreaterThan(30);
    // A bare tree in snow: its wood is edged in the wood's own outline.
    const bare = drawStanding("BROADLEAF", "grown", 0, 4, "winter", true, "cosy");
    expect(count(bare, INK.woodOutline)).toBeGreaterThan(50);
    expect(count(bare, INK.snow)).toBeGreaterThan(0);
  });

  it("leave the bundled look's bare trees as they were: no outline round wood", () => {
    const bare = drawStanding("BROADLEAF", "grown", 0, 4, "winter", true, "bundles");
    expect(count(bare, INK.woodOutline)).toBe(0);
    expect(bareEdges(bare)).toBeGreaterThan(0);
  });

  it("keep a winter bush's leaves, unless it is one that goes bare", () => {
    const leafy = drawStanding("SHRUB", "grown", 0, 4, "winter", false, "cosy");
    const bare = drawStanding("SHRUB", "grown", 0, 4, "winter", false, "cosy", true);
    const leaves = (art: PlantArt): number =>
      [INK.deep, INK.dark, INK.mid, INK.light, INK.bright].reduce(
        (n, ink) => n + count(art, ink),
        0,
      );
    expect(leaves(leafy)).toBeGreaterThan(200);
    expect(leaves(bare)).toBe(0);
    expect(count(bare, INK.trunk) + count(bare, INK.trunkDark)).toBeGreaterThan(20);
  });

  it("draw a crown of a few large puffs in the same box as the bundles", () => {
    const cosy = drawStanding("BROADLEAF", "grown", 0, 4, "summer", false, "cosy");
    const bundles = drawStanding("BROADLEAF", "grown", 0, 4, "summer", false, "bundles");
    expect([cosy.width, cosy.height]).toEqual([bundles.width, bundles.height]);
    expect(cosy.footY).toBe(bundles.footY);
    // Lit and in shade: the five tones of a crown are all there.
    for (const ink of [INK.deep, INK.dark, INK.mid, INK.light, INK.bright]) {
      expect(count(cosy, ink)).toBeGreaterThan(0);
    }
  });

  it("outline the small plants that had none", () => {
    for (const kind of ["daisy", "fern", "herb", "reed", "snag"] as const) {
      const art = drawSmall(
        kind,
        [kind === "snag" ? 20 : 8, kind === "snag" ? 52 : 12],
        () => 0.4,
        0,
        false,
        "cosy",
      );
      expect(bareEdges(art), kind).toBe(0);
    }
  });
});
