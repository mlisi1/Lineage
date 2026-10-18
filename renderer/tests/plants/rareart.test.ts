import { describe, expect, it } from "vitest";
import { INK, drawStanding, type PlantArt } from "../../src/plants/plantart";
import { standingArts } from "../../src/plants/plants";
import {
  EMERGENT_TALLER,
  LOOK_OF_GENE,
  OVERLAYS,
  RARE_LOOKS,
  looksOf,
  overlayArt,
} from "../../src/plants/rareart";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { world } from "../spike/worlds";

const LEAVES = [INK.deep, INK.dark, INK.mid, INK.light, INK.bright];
const drawn = (art: PlantArt): number => art.ink.filter((ink) => ink !== INK.none).length;
const tallest = (art: PlantArt): number => {
  for (let at = 0; at < art.ink.length; at++)
    if (art.ink[at] !== INK.none) return art.height - Math.floor(at / art.width);
  return 0;
};

describe("rare plant looks", () => {
  it("read a cell's rare genes by the names the stream gives their bits", () => {
    const genes = ["FIRE_PINE", "NITROGEN_FIXER", "MANGROVE", "POISONOUS", "FRUITING", "EMERGENT"];
    expect(looksOf(0, genes)).toEqual([]);
    expect(looksOf(1 | 8 | 32, genes)).toEqual(["bark", "berries", "crown"]);
    // A gene the renderer does not know shows nothing; nor does a bit with no name.
    expect(looksOf(1 | 64, [...genes, "SOMETHING_NEW"])).toEqual(["bark"]);
    expect(Object.values(LOOK_OF_GENE).sort()).toEqual([...RARE_LOOKS].sort());
  });

  it("lay each overlay over the drawing it is for: same size, same foot", () => {
    const base = drawStanding("BROADLEAF", "grown", 0, 4, "summer", false, "cosy");
    for (const overlay of OVERLAYS) {
      const art = overlayArt(base, overlay, 5);
      expect([art.width, art.height, art.footX, art.footY], overlay).toEqual([
        base.width,
        base.height,
        base.footX,
        base.footY,
      ]);
      expect(drawn(art), overlay).toBeGreaterThan(0);
    }
  });

  it("put berries and fruit on the leaves, clover and stilts at the foot", () => {
    const base = drawStanding("BROADLEAF", "grown", 0, 4, "summer", false, "cosy");
    for (const overlay of ["berries", "fruit"] as const) {
      const art = overlayArt(base, overlay, 5);
      art.ink.forEach((ink, at) => {
        if (ink === INK.accent) expect(LEAVES).toContain(base.ink[at]);
      });
    }
    for (const overlay of ["clover", "stilts"] as const) {
      const art = overlayArt(base, overlay, 5);
      art.ink.forEach((ink, at) => {
        if (ink !== INK.none)
          expect(Math.floor(at / art.width), overlay).toBeGreaterThan(base.height * 0.6);
      });
    }
  });

  it("draw an emergent tree's crown half as tall again", () => {
    const plain = drawStanding("CONIFER", "grown", 0, 4, "summer", false, "cosy");
    const emergent = drawStanding(
      "CONIFER",
      "grown",
      0,
      4,
      "summer",
      false,
      "cosy",
      undefined,
      EMERGENT_TALLER,
    );
    expect(tallest(emergent) / tallest(plain)).toBeGreaterThan(1.35);
    expect(emergent.width).toBe(plain.width);
  });

  it("make the rare drawings only for the looks asked for", () => {
    const land = { ...world(["gg", "gg"]), ...LAND_PALETTE };
    const keys = (rare: readonly (typeof RARE_LOOKS)[number][]): string[] =>
      standingArts(land, 32, { close: true, season: "summer", rare }).map((art) => art.key);
    const plain = keys([]);
    expect(plain.some((key) => key.includes("#") || key.includes("+"))).toBe(false);
    const some = keys(["bark", "berries"]);
    expect(some).toContain("BROADLEAF/grown/0+bark");
    expect(some).toContain("SHRUB/grown/1#berries");
    expect(some.some((key) => key.includes("#fruit") || key.includes("+crown"))).toBe(false);
    // No berries on grass, no bark on it either.
    expect(
      some.some(
        (key) => key.startsWith("GRASS/") && (key.includes("#berries") || key.includes("+bark")),
      ),
    ).toBe(false);
    const crowns = keys(["crown"]);
    expect(crowns).toContain("CONIFER/old/2+crown");
    expect(crowns).not.toContain("SHRUB/grown/0+crown");
  });
});
