import { describe, expect, it } from "vitest";
import { piecesOf } from "../../src/plants/pieces";
import { INK, drawStanding, type PlantArt } from "../../src/plants/plantart";
import type { Season } from "../../src/plants/seasons";

/** A bush of the local view in the cosy look. */
const bush = (variant = 0, season: Season = "summer", snow = false): PlantArt =>
  drawStanding("SHRUB", "grown", variant, 4, season, snow, "cosy");

const BUSHES: PlantArt[] = [];
for (const season of ["spring", "summer", "autumn"] as const) {
  for (let variant = 0; variant < 3; variant++) BUSHES.push(bush(variant, season));
}
BUSHES.push(bush(1, "winter", true));

describe("a bush's puffs", () => {
  it("are kept with the drawing of a leafy bush: three to five, inside the drawing", () => {
    for (const art of BUSHES) {
      const puffs = art.puffs ?? [];
      expect(puffs.length).toBeGreaterThanOrEqual(3);
      expect(puffs.length).toBeLessThanOrEqual(5);
      for (const p of puffs) {
        expect(p.r).toBeGreaterThan(0);
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x).toBeLessThanOrEqual(art.width);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(art.footY + 1);
        // Where the drawing was settled onto its foot, the puff went too: leaves at its middle.
        const ink = art.ink[Math.floor(p.y) * art.width + Math.floor(p.x)] ?? INK.none;
        expect(ink).not.toBe(INK.none);
      }
    }
  });

  it("are not kept by a bare bush in winter, a tree or a tuft of grass", () => {
    expect(drawStanding("SHRUB", "grown", 0, 4, "winter", false, "cosy", "bare").puffs).toBe(
      undefined,
    );
    for (const form of ["BROADLEAF", "CONIFER", "GRASS"] as const) {
      expect(drawStanding(form, "grown", 0, 4, "summer", false, "cosy").puffs).toBeUndefined();
    }
  });
});

describe("a bush in pieces (piecesOf)", () => {
  it("has none for a drawing without puffs, or with a single one", () => {
    const tree = drawStanding("BROADLEAF", "grown", 0, 4, "summer", false, "cosy");
    expect(piecesOf(tree)).toBeNull();
    const one = bush();
    expect(piecesOf({ ...one, puffs: (one.puffs ?? []).slice(0, 1) })).toBeNull();
  });

  it("gives each puff its own piece, with its puff's radius", () => {
    for (const art of BUSHES) {
      const pieces = piecesOf(art) ?? [];
      expect(pieces).toHaveLength(art.puffs?.length ?? 0);
      pieces.forEach((piece, k) => expect(piece.r).toBe(art.puffs?.[k]?.r));
    }
  });

  it("shares out the drawing's pixels between the pieces: the bush looks the same", () => {
    for (const art of BUSHES) {
      const pieces = piecesOf(art) ?? [];
      const laid = new Uint8Array(art.width * art.height);
      const owners = new Uint8Array(art.width * art.height);
      for (const { art: piece, left, top } of pieces) {
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(left + piece.width).toBeLessThanOrEqual(art.width);
        expect(top + piece.height).toBeLessThanOrEqual(art.height);
        for (let y = 0; y < piece.height; y++) {
          for (let x = 0; x < piece.width; x++) {
            const ink = piece.ink[y * piece.width + x] ?? INK.none;
            if (ink === INK.none) continue;
            const at = (top + y) * art.width + left + x;
            laid[at] = ink;
            owners[at] = (owners[at] ?? 0) + 1;
          }
        }
      }
      // Every pixel in exactly one piece, with its own ink.
      expect([...laid]).toEqual([...art.ink]);
      for (let at = 0; at < owners.length; at++) {
        expect(owners[at]).toBe(art.ink[at] === INK.none ? 0 : 1);
      }
    }
  });

  it("stands each piece on the foot of its own puff, never below the bush's foot", () => {
    for (const art of BUSHES) {
      const pieces = piecesOf(art) ?? [];
      const feet = pieces.map(({ art: piece, top }) => top + piece.footY);
      pieces.forEach(({ art: piece, left, top }, k) => {
        const puff = art.puffs?.[k];
        if (puff === undefined) throw new Error();
        const footY = top + piece.footY;
        expect(footY).toBeLessThanOrEqual(art.footY);
        expect(footY).toBe(Math.min(Math.round(puff.y + puff.r), art.footY));
        expect(left + piece.footX).toBe(Math.round(puff.x));
      });
      // The pieces stand at different depths: the puffs above sort behind those below.
      expect(new Set(feet).size).toBeGreaterThan(1);
      // The lowest puffs stand on the bush's own foot.
      expect(Math.max(...feet)).toBe(art.footY);
    }
  });

  it("cuts the same bush the same way every time", () => {
    expect(piecesOf(bush(2))).toEqual(piecesOf(bush(2)));
  });
});
