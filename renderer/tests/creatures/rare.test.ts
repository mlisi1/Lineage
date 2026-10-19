import { describe, expect, it } from "vitest";
import {
  LAYER,
  bodyPlan,
  type BodyOptions,
  type BodyPlan,
  type Look,
} from "../../src/creatures/body";
import {
  RARE_LOOKS,
  parseRareConfig,
  rareLooks,
  withRare,
  type RareLook,
} from "../../src/creatures/rare";

const COSY: BodyOptions = { style: "cosy", scale: 1, pixels: 32, pace: 0.35 };
/** A plain beast with jaws; tests add one rare gene at a time. */
const PLAIN: Look = {
  mass: 2,
  limbPairs: 2,
  landSpeed: 3,
  swimSpeed: 1,
  diet: 0.2,
  speed: 0.3,
  armour: 0,
  sense: 0.4,
  aquatic: 0,
  jaw: 0.6,
  hue: 0.92,
  pattern: 0,
};
const plan = (...rare: RareLook[]): BodyPlan => bodyPlan({ ...PLAIN, rare }, COSY);
const count = (p: BodyPlan, test: (part: BodyPlan["parts"][number]) => boolean): number =>
  p.parts.filter(test).length;
const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 255,
  (rgb >> 8) & 255,
  rgb & 255,
];
const spread = (rgb: number): number => Math.max(...channels(rgb)) - Math.min(...channels(rgb));

describe("rare genes from the sim", () => {
  const signatures = new Map([
    [1, "venom"],
    [4, "giant"],
    [32, "coat"],
    [512, "something-new"],
  ]);

  it("are read by signature from the slots, unknown ones left out", () => {
    expect(rareLooks(0, signatures)).toEqual([]);
    expect(rareLooks(1 | 32, signatures)).toEqual(["venom", "coat"]);
    expect(rareLooks(512 | 4, signatures)).toEqual(["giant"]);
  });

  it("draw a giant at its adjusted mass, and nothing else changes a look", () => {
    const config = parseRareConfig({ giant_mass_factor: 2 });
    expect(withRare(PLAIN, ["giant"], config).mass).toBe(4);
    expect(withRare(PLAIN, ["coat"], config).mass).toBe(2);
    const giant = bodyPlan(withRare(PLAIN, ["giant"], config), COSY);
    expect(giant.length / plan().length).toBeCloseTo(Math.cbrt(2));
    expect(() => parseRareConfig({})).toThrow(/giant_mass_factor/);
  });
});

describe("each rare gene's overlay", () => {
  const plain = plan();

  it("changes the body only for the gene it is, and none leaves it as it was", () => {
    for (const key of RARE_LOOKS.filter((k) => k !== "giant")) {
      expect(plan(key), key).not.toEqual(plain);
      expect(plan(key).kind, key).toBe(plain.kind);
    }
    expect(plan("giant")).toEqual(plain); // the mass does it, not the plan
  });

  it("venom: acid fangs and a dark tail tip", () => {
    const venom = plan("venom");
    expect(count(venom, (part) => part.colour === 0xc8f04a)).toBeGreaterThan(0);
    expect(count(plain, (part) => part.colour === 0xc8f04a)).toBe(0);
  });

  it("warning: bold bands, whatever the pattern gene", () => {
    const bands = (p: BodyPlan): number =>
      count(p, (part) => part.layer === LAYER.mark && [0x1e1612, 0xf2c91e].includes(part.colour));
    expect(bands(plan("warning"))).toBeGreaterThanOrEqual(2);
    expect(bands(plain)).toBe(0);
  });

  it("elder: greyer, with pale flecks", () => {
    const elder = plan("elder");
    expect(spread(elder.colour)).toBeLessThan(spread(plain.colour));
    expect(count(elder, (part) => part.colour === 0xebe5d8)).toBeGreaterThanOrEqual(3);
  });

  it("gills: three frills either side of the head", () => {
    const frills = (p: BodyPlan): number =>
      count(p, (part) => part.joint === 0 && part.shape === "wedge" && part.layer === LAYER.under);
    expect(frills(plan("gills")) - frills(plain)).toBe(6);
  });

  it("coat: a wider outline, nearer the body's colour", () => {
    const outline = (p: BodyPlan): number =>
      Math.max(
        ...p.parts.filter((part) => part.layer === LAYER.outline).map((part) => part.across),
      );
    const coat = plan("coat");
    expect(outline(coat)).toBeGreaterThan(outline(plain));
    expect(coat.outline).not.toBe(plain.outline);
  });

  it("leaves: greener, with leaves along the back", () => {
    const leaves = plan("leaves");
    const [r, g, b] = channels(leaves.colour);
    expect(g).toBeGreaterThan(Math.max(r, b));
    const wedges = (p: BodyPlan): number => count(p, (part) => part.shape === "wedge");
    expect(wedges(leaves)).toBeGreaterThan(wedges(plain));
  });

  it("glow: pale spots in pairs along the back", () => {
    const spots = count(plan("glow"), (part) => part.colour === 0xdcffb4);
    expect(spots).toBeGreaterThanOrEqual(2);
    expect(spots % 2).toBe(0);
  });

  it("all of them at once still make one drawable body", () => {
    const all = plan(...RARE_LOOKS);
    for (const part of all.parts) {
      expect(Number.isFinite(part.along) && part.along > 0).toBe(true);
      expect(Number.isFinite(part.across) && part.across > 0).toBe(true);
    }
  });
});
