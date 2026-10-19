import { describe, expect, it } from "vitest";
import { plantLook, plantOffset, standsAlone, type Form } from "../../src/plants/look";
import { cellHash } from "../../src/terrain/pixels";
import {
  FLOWER_COLOURS,
  INK,
  PLANT_SCALE,
  SMALL_KINDS,
  SMALL_SIZES,
  STANDING_VARIANTS,
  colourArt,
  drawSmall,
  drawStanding,
  type PlantArt,
} from "../../src/plants/plantart";
import { mulberry32 } from "../../src/rng";
import {
  GROWTHS,
  SEASONS,
  floorRamp,
  growthOf,
  seasonOf,
  seasonRamp,
  type Growth,
  type Season,
} from "../../src/plants/seasons";
import { PALETTE } from "../spike/worlds";

const DORMANT = ["LICHEN", "GRASS", "SHRUB"];
const FOLIAGE: readonly number[] = [INK.deep, INK.dark, INK.mid, INK.light, INK.bright];
const WOOD: readonly number[] = [INK.trunk, INK.trunkDark, INK.trunkLight, INK.trunkDeep];
const SNOW: readonly number[] = [INK.snow, INK.snowShade];
const count = (art: PlantArt, inks: readonly number[]): number =>
  art.ink.reduce((sum, ink) => sum + (inks.includes(ink) ? 1 : 0), 0);
const inkAt = (art: PlantArt, x: number, y: number): number =>
  x < 0 || y < 0 || x >= art.width || y >= art.height
    ? INK.none
    : (art.ink[y * art.width + x] ?? 0);
/** The columns and rows a drawing covers. */
function extent(art: PlantArt): { wide: number; tall: number; bottom: number; top: number } {
  let left = art.width;
  let right = -1;
  let top = art.height;
  let bottom = -1;
  art.ink.forEach((ink, at) => {
    if (ink === INK.none) return;
    left = Math.min(left, at % art.width);
    right = Math.max(right, at % art.width);
    top = Math.min(top, Math.floor(at / art.width));
    bottom = Math.max(bottom, Math.floor(at / art.width));
  });
  return { wide: right - left + 1, tall: bottom - top + 1, bottom, top };
}
/** The local view: four times the middle view's pixels to the cell. */
const near = (
  form: Form,
  variant = 0,
  growth: Growth = "grown",
  season: Season = "summer",
  snow = false,
): PlantArt => drawStanding(form, growth, variant, 4, season, snow);
const TREES = ["BROADLEAF", "CONIFER"] as const;
const STANDING = ["BROADLEAF", "CONIFER", "SHRUB"] as const;

describe("standing plants", () => {
  it("are drawn at the size the scale gives them, standing on their foot", () => {
    const sizes = {
      BROADLEAF: PLANT_SCALE.broadleaf,
      CONIFER: PLANT_SCALE.conifer,
      SHRUB: PLANT_SCALE.bush,
    };
    for (const form of STANDING) {
      for (const detail of [1, 4]) {
        const art = drawStanding(form, "grown", 0, detail);
        const [, height] = sizes[form][0];
        // The outline may add a pixel; a crown may stop a little short of its box.
        expect(extent(art).tall).toBeGreaterThan(height * detail * 0.85);
        expect(extent(art).tall).toBeLessThanOrEqual(height * detail + 2);
        expect(extent(art).bottom).toBeLessThanOrEqual(art.footY);
        expect(extent(art).bottom).toBeGreaterThanOrEqual(art.footY - 2);
        expect(art.footX).toBeCloseTo(art.width / 2);
      }
    }
    // A tree is taller than a bush, a bush taller than a tuft of grass.
    expect(PLANT_SCALE.broadleaf[0][1]).toBeGreaterThan(PLANT_SCALE.bush[0][1] * 1.5);
    expect(PLANT_SCALE.bush[0][1]).toBeGreaterThan(PLANT_SCALE.tuft[1]);
  });

  it("come in three drawings and three builds, the same every time", () => {
    for (const form of STANDING) {
      const drawings = [0, 1, 2].map((variant) => near(form, variant).ink.join(""));
      expect(new Set(drawings).size).toBe(STANDING_VARIANTS);
      expect(near(form, 0).ink.join("")).toBe(drawings[0]);
    }
    const [even, slender, broad] = [0, 1, 2].map((variant) => extent(near("BROADLEAF", variant)));
    expect(slender?.tall).toBeGreaterThan(even?.tall ?? 0);
    expect(broad?.wide).toBeGreaterThan(slender?.wide ?? 0);
    expect(broad?.tall).toBeLessThan(even?.tall ?? 0);
  });

  it("carry no shadow of their own, and say what the ground should paint for them", () => {
    for (const form of STANDING) {
      const art = near(form, 1);
      expect(art.shadow?.rx).toBeGreaterThan(8);
      expect(art.shadow?.ry).toBeLessThan(art.shadow?.rx ?? 0);
    }
    // What has just come up throws none worth painting.
    expect(near("BROADLEAF", 0, "sprout").shadow).toBeUndefined();
    // A bare tree throws a thin one: its trunk's.
    expect(near("BROADLEAF", 0, "grown", "winter").shadow?.rx).toBeLessThan(
      near("BROADLEAF", 0).shadow?.rx ?? 0,
    );
  });

  it("shade a crown in five tones, lit from the upper left, outlined", () => {
    const art = near("BROADLEAF");
    for (const tone of FOLIAGE) expect(count(art, [tone])).toBeGreaterThan(8);
    // No leaf touches the air.
    for (let y = 0; y < art.height; y++) {
      for (let x = 0; x < art.width; x++) {
        if (!FOLIAGE.includes(inkAt(art, x, y))) continue;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          expect(inkAt(art, x + dx, y + dy)).not.toBe(INK.none);
        }
      }
    }
    const middle = (inks: readonly number[]): [number, number] => {
      let x = 0;
      let y = 0;
      let n = 0;
      art.ink.forEach((ink, at) => {
        if (!inks.includes(ink)) return;
        x += at % art.width;
        y += Math.floor(at / art.width);
        n += 1;
      });
      return [x / n, y / n];
    };
    const [lightX, lightY] = middle([INK.bright, INK.light]);
    const [darkX, darkY] = middle([INK.deep, INK.dark]);
    expect(lightX).toBeLessThan(darkX);
    expect(lightY).toBeLessThan(darkY);
  });

  it("build a crown of bundles from many small clumps with soft rims", () => {
    const art = near("BROADLEAF");
    // Along the top of the crown the outline rises and falls by a pixel or two from
    // one column to the next, not by the teeth of a saw.
    const top: number[] = [];
    for (let x = 0; x < art.width; x++) {
      for (let y = 0; y < art.height; y++) {
        if (inkAt(art, x, y) === INK.none) continue;
        top.push(y);
        break;
      }
    }
    const steps = top.slice(1).map((y, i) => Math.abs(y - (top[i] ?? y)));
    expect(steps.filter((step) => step >= 3).length / steps.length).toBeLessThan(0.12);
    // The shade between clumps is a line, not a field, and every tone has its share.
    expect(count(art, [INK.deep]) / count(art, FOLIAGE)).toBeLessThan(0.35);
    for (const tone of [INK.dark, INK.mid, INK.light]) {
      expect(count(art, [tone]) / count(art, FOLIAGE)).toBeGreaterThan(0.1);
    }
    // At the middle view's size a plant is a few clumps, with no line of shade between
    // them (it would be most of the plant), and lighter for it.
    const small = drawStanding("SHRUB", "grown", 0, 1);
    expect(count(small, [INK.deep])).toBe(0);
    expect(count(small, [INK.mid, INK.light, INK.bright])).toBeGreaterThan(
      count(small, [INK.dark]),
    );
  });

  it("give trunks bark, and stand them under the middle of their crowns", () => {
    /** How far the middle of the wood is from the foot, in pixels. */
    const off = (art: PlantArt): number => {
      let sum = 0;
      let n = 0;
      art.ink.forEach((ink, at) => {
        if (!WOOD.includes(ink)) return;
        sum += (at % art.width) + 0.5;
        n += 1;
      });
      expect(n).toBeGreaterThan(0);
      return Math.abs(sum / n - art.footX);
    };
    for (const form of TREES) {
      for (const detail of [1, 4]) {
        for (const growth of ["young", "grown", "old"] as const) {
          expect(off(drawStanding(form, growth, 0, detail))).toBeLessThanOrEqual(1);
        }
      }
      // Up close the trunk is in four tones of wood: lit, plain, shaded, and furrows.
      const art = near(form);
      for (const tone of WOOD) expect(count(art, [tone]), `${form} ${tone}`).toBeGreaterThan(0);
      expect(count(art, [INK.trunkDark, INK.trunkDeep])).toBeGreaterThan(8);
      // At the middle view's size it is a plain stem.
      expect(count(drawStanding(form, "grown", 0, 1), [INK.trunkDeep])).toBe(0);
    }
    // No foliage's outline colour strays into the wood.
    const trunkRows = near("BROADLEAF");
    const foot = trunkRows.footY - 1;
    for (let x = 0; x < trunkRows.width; x++) {
      const ink = inkAt(trunkRows, x, foot - 4);
      expect([INK.none, ...WOOD]).toContain(ink);
    }
    // An old tree is stouter than a grown one.
    const girth = (art: PlantArt): number => {
      let wide = 0;
      for (let x = 0; x < art.width; x++)
        if (WOOD.includes(inkAt(art, x, art.footY - 8))) wide += 1;
      return wide;
    };
    expect(girth(near("BROADLEAF", 0, "old"))).toBeGreaterThan(girth(near("BROADLEAF")));
  });

  it("make a bush a mound: on the ground, widest low down, domed", () => {
    for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
      for (const growth of ["young", "grown", "old"] as const) {
        const art = near("SHRUB", variant, growth);
        expect(extent(art).bottom).toBeLessThanOrEqual(art.footY);
        expect(extent(art).bottom).toBeGreaterThanOrEqual(art.footY - 2);
        /** How wide the bush is on the row this share of the way up it. */
        const wide = (share: number): number => {
          const { top, bottom } = extent(art);
          const y = Math.round(bottom - share * (bottom - top));
          let n = 0;
          for (let x = 0; x < art.width; x++) if (inkAt(art, x, y) !== INK.none) n += 1;
          return n;
        };
        expect(wide(0.3)).toBeGreaterThan(wide(0.9) * 1.4);
        expect(wide(0.3)).toBeGreaterThanOrEqual(wide(0.02));
        // Not lopsided: its widest row is centred on its foot, give or take.
        const { top, bottom } = extent(art);
        const y = Math.round(bottom - 0.3 * (bottom - top));
        let left = art.width;
        let right = 0;
        for (let x = 0; x < art.width; x++) {
          if (inkAt(art, x, y) === INK.none) continue;
          left = Math.min(left, x);
          right = Math.max(right, x);
        }
        expect(Math.abs((left + right + 1) / 2 - art.footX)).toBeLessThan(art.width * 0.1);
      }
    }
  });
});

describe("stages of growth", () => {
  it("follow from biomass: a sprout, young, grown, old", () => {
    expect(GROWTHS).toEqual(["sprout", "young", "grown", "old"]);
    expect([20, 43, 44, 127, 128, 215, 216, 255].map(growthOf)).toEqual([
      "sprout",
      "sprout",
      "young",
      "young",
      "grown",
      "grown",
      "old",
      "old",
    ]);
  });

  it("draw each stage larger than the one before, an old tree broader, not taller", () => {
    for (const form of STANDING) {
      const [sprout, young, grown, old] = GROWTHS.map((growth) => extent(near(form, 0, growth)));
      if (!sprout || !young || !grown || !old) throw new Error("stages");
      expect(sprout.tall).toBeLessThan(young.tall);
      expect(young.tall).toBeLessThan(grown.tall);
      expect(sprout.wide).toBeLessThan(young.wide);
      expect(old.wide).toBeGreaterThan(grown.wide);
      if (form !== "SHRUB") expect(Math.abs(old.tall - grown.tall)).toBeLessThanOrEqual(2);
      // A sprout is a sprout: well under half a grown plant, and still something to see.
      expect(sprout.tall).toBeLessThan(grown.tall * 0.5);
      expect(sprout.tall).toBeGreaterThan(grown.tall * 0.25);
      expect(new Set(GROWTHS.map((growth) => near(form, 0, growth).ink.join(""))).size).toBe(4);
    }
    // A sapling: a stem with a few leaves at its top.
    const sapling = near("BROADLEAF", 0, "sprout");
    expect(count(sapling, WOOD)).toBeGreaterThan(5);
    expect(count(sapling, FOLIAGE)).toBeGreaterThan(20);
    // Grass is short while it is young.
    const tall = (growth: Growth): number => extent(near("GRASS", 0, growth)).tall;
    expect(tall("sprout")).toBeLessThan(tall("young"));
    expect(tall("young")).toBeLessThan(tall("grown"));
  });
});

describe("the seasons", () => {
  it("are read from the fixture by name, summer if the name is unknown", () => {
    expect(SEASONS.map(seasonOf)).toEqual([...SEASONS]);
    expect(seasonOf("monsoon")).toBe("summer");
  });

  it("leave a broadleaf in leaf three seasons and bare in winter", () => {
    for (const season of ["spring", "summer", "autumn"] as const) {
      expect(count(near("BROADLEAF", 0, "grown", season), FOLIAGE)).toBeGreaterThan(1500);
    }
    const bare = near("BROADLEAF", 0, "grown", "winter");
    expect(count(bare, FOLIAGE)).toBe(0);
    // Branches: several times the wood of the trunk alone, spread as wide as the crown was.
    expect(count(bare, WOOD)).toBeGreaterThan(1.5 * count(near("BROADLEAF"), WOOD));
    expect(extent(bare).wide).toBeGreaterThan(extent(near("BROADLEAF")).wide * 0.6);
    // Thin: most of what is above the trunk is air.
    const { top } = extent(bare);
    let filled = 0;
    let rows = 0;
    for (let y = top; y < bare.footY * 0.45; y++) {
      rows += 1;
      for (let x = 0; x < bare.width; x++) if (inkAt(bare, x, y) !== INK.none) filled += 1;
    }
    expect(filled / (rows * bare.width)).toBeLessThan(0.4);
    // The trunk and its branches are in proportion: the trunk narrows as it rises, and
    // where it forks its leader carries on a little thinner, not as a twig.
    for (const growth of ["grown", "old"] as const) {
      for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
        const tree = near("BROADLEAF", variant, growth, "winter");
        /** How wide the wood is on row `y` where the tree's own axis crosses it. */
        const across = (y: number): number => {
          const axis = Math.round(tree.footX);
          const at = [0, -1, 1, -2, 2]
            .map((dx) => axis + dx)
            .find((x) => WOOD.includes(inkAt(tree, x, y)));
          if (at === undefined) return 0;
          let left = at;
          let right = at;
          while (WOOD.includes(inkAt(tree, left - 1, y))) left -= 1;
          while (WOOD.includes(inkAt(tree, right + 1, y))) right += 1;
          return right - left + 1;
        };
        const tall = extent(tree).bottom - extent(tree).top;
        const fork = Math.round(tree.footY - tall / 2);
        const foot = across(tree.footY - 8);
        // Below where the lowest boughs leave it, the row holds the trunk alone.
        const under = across(fork + 14);
        // Above the fork, past where the boughs have parted from it: the leader.
        const leader = across(fork - 12);
        expect(under, `${growth} ${variant}`).toBeLessThan(foot);
        expect(under).toBeGreaterThanOrEqual(foot * 0.55);
        expect(leader, `${growth} ${variant}`).toBeLessThanOrEqual(under);
        expect(leader).toBeGreaterThanOrEqual(under * 0.5);
        // No branch runs along the edge of the drawing: its top row holds only the tips
        // of a few.
        const top = extent(tree).top;
        let tips = 0;
        for (let x = 0; x < tree.width; x++) if (inkAt(tree, x, top) !== INK.none) tips += 1;
        expect(tips).toBeLessThan(tree.width * 0.2);
      }
    }
    // A sapling and a bush are bare too; a conifer never is.
    expect(count(near("BROADLEAF", 0, "sprout", "winter"), FOLIAGE)).toBe(0);
    expect(count(near("SHRUB", 0, "grown", "winter"), FOLIAGE)).toBe(0);
    expect(count(near("SHRUB", 0, "grown", "winter"), WOOD)).toBeGreaterThan(40);
    expect(count(near("CONIFER", 0, "grown", "winter"), FOLIAGE)).toBeGreaterThan(1500);
  });

  it("bring blossom in spring, to one broadleaf in three and two bushes in three", () => {
    const flowers = (form: Form, variant: number, season: Season): number =>
      count(near(form, variant, "grown", season), [INK.accent, INK.accentDark]);
    expect([0, 1, 2].map((variant) => flowers("BROADLEAF", variant, "spring") > 20)).toEqual([
      false,
      true,
      false,
    ]);
    expect([0, 1, 2].map((variant) => flowers("SHRUB", variant, "spring") > 10)).toEqual([
      true,
      true,
      false,
    ]);
    expect(flowers("BROADLEAF", 1, "summer")).toBe(0);
    // Berries: on one bush in three in summer, on two in autumn; none on a sprout.
    expect([0, 1, 2].map((variant) => flowers("SHRUB", variant, "summer") > 3)).toEqual([
      false,
      true,
      false,
    ]);
    expect([0, 1, 2].map((variant) => flowers("SHRUB", variant, "autumn") > 3)).toEqual([
      true,
      true,
      false,
    ]);
    expect(count(near("SHRUB", 1, "sprout", "autumn"), [INK.accent])).toBe(0);
    // A conifer puts out light tips instead: more of its lightest tone than in summer.
    expect(count(near("CONIFER", 0, "grown", "spring"), [INK.bright])).toBeGreaterThan(
      2 * count(near("CONIFER"), [INK.bright]),
    );
  });

  it("change grass: short in spring, in seed in autumn, pressed flat in winter", () => {
    const tuft = (season: Season): PlantArt => near("GRASS", 0, "grown", season);
    expect(extent(tuft("spring")).tall).toBeLessThan(extent(tuft("summer")).tall);
    expect(count(tuft("summer"), [INK.accent, INK.accentDark])).toBe(0);
    expect(count(tuft("autumn"), [INK.accent, INK.accentDark])).toBeGreaterThan(3);
    expect(extent(tuft("winter")).tall).toBeLessThan(extent(tuft("summer")).tall * 0.75);
  });

  it("lay snow on what stands out when it is asked for, in whatever season", () => {
    for (const form of STANDING) {
      expect(count(near(form, 0, "grown", "winter"), SNOW)).toBe(0);
      // The simulation's snow lies on the hills in autumn and spring too.
      expect(count(near(form, 0, "grown", "autumn", true), SNOW), form).toBeGreaterThan(10);
      const snowed = near(form, 0, "grown", "winter", true);
      expect(count(snowed, SNOW), form).toBeGreaterThan(20);
      // It lies on top: the snow's middle is above the middle of the plant.
      const rows = (inks: readonly number[]): number => {
        let sum = 0;
        let n = 0;
        snowed.ink.forEach((ink, at) => {
          if (!inks.includes(ink)) return;
          sum += Math.floor(at / snowed.width);
          n += 1;
        });
        return sum / n;
      };
      expect(rows(SNOW)).toBeLessThan(rows([...FOLIAGE, ...WOOD]));
    }
    // A conifer carries it on the shoulders of every tier, not only on its top.
    const fir = near("CONIFER", 0, "grown", "winter", true);
    const snowy = new Set<number>();
    fir.ink.forEach((ink, at) => {
      if (SNOW.includes(ink)) snowy.add(Math.floor(at / fir.width / 8));
    });
    expect(snowy.size).toBeGreaterThan(6);
    const stone = (snow: boolean): PlantArt =>
      drawSmall("boulder", [20, 13], mulberry32(31), 0, snow);
    expect(count(stone(false), SNOW)).toBe(0);
    expect(count(stone(true), SNOW)).toBeGreaterThan(8);
  });

  it("colour each form by the season", () => {
    const sum = (colour: string): number =>
      [1, 3, 5].reduce((total, at) => total + Number.parseInt(colour.slice(at, at + 2), 16), 0);
    const channel = (colour: string, at: number): number =>
      Number.parseInt(colour.slice(at, at + 2), 16);
    const ramp = (form: string, season: Season, variant = 0) =>
      seasonRamp(PALETTE, form, season, variant);
    // Summer is the palette's own.
    for (const form of ["GRASS", "SHRUB", "BROADLEAF", "CONIFER", "LICHEN"]) {
      expect(ramp(form, "summer")).toEqual(PALETTE[form]);
    }
    // Spring is lighter and yellower; an evergreen barely changes.
    expect(sum(ramp("BROADLEAF", "spring")[1])).toBeGreaterThan(
      sum(ramp("BROADLEAF", "summer")[1]),
    );
    const shift = (form: string): number =>
      Math.abs(sum(ramp(form, "spring")[1]) - sum(ramp(form, "summer")[1]));
    expect(shift("CONIFER")).toBeLessThan(shift("BROADLEAF") / 2);
    // Autumn: three broadleaves turn three ways, all of them redder than green; conifers stay.
    const turned = [0, 1, 2].map((variant) => ramp("BROADLEAF", "autumn", variant)[1]);
    expect(new Set(turned).size).toBe(3);
    for (const colour of turned) expect(channel(colour, 1)).toBeGreaterThan(channel(colour, 5));
    expect(channel(turned[0] ?? "", 1)).toBeGreaterThan(
      channel(PALETTE["BROADLEAF"]?.[1] ?? "", 1),
    );
    expect(ramp("CONIFER", "autumn")).toEqual(PALETTE["CONIFER"]);
    // Winter: evergreens darker and bluer, grass dried and pale.
    const fir = ramp("CONIFER", "winter")[1];
    expect(sum(fir)).toBeLessThan(sum(PALETTE["CONIFER"]?.[1] ?? ""));
    expect(channel(fir, 5) / sum(fir)).toBeGreaterThan(
      channel(PALETTE["CONIFER"]?.[1] ?? "", 5) / sum(PALETTE["CONIFER"]?.[1] ?? ""),
    );
    expect(ramp("GRASS", "winter")).not.toEqual(PALETTE["GRASS"]);
    expect(channel(ramp("GRASS", "winter")[1], 1)).toBeGreaterThan(
      channel(PALETTE["GRASS"]?.[1] ?? "", 1),
    );
    // The floor of a wood in autumn is russet: less bright than the gold on the trees.
    expect(sum(floorRamp(PALETTE, "BROADLEAF", "autumn")[1])).toBeLessThan(sum(turned[0] ?? ""));
    expect(floorRamp(PALETTE, "BROADLEAF", "summer")).toEqual(PALETTE["BROADLEAF"]);
    expect(floorRamp(PALETTE, "GRASS", "autumn")).toEqual(ramp("GRASS", "autumn"));
  });
});

describe("what grows and lies among the trees", () => {
  const draw = (kind: (typeof SMALL_KINDS)[number], variant = 0): PlantArt => {
    const [width, height] = SMALL_SIZES[kind];
    return drawSmall(kind, [width * 4, height * 4], mulberry32(31 + variant), variant);
  };

  it("draws each kind inside its own size, standing on its foot, the same every time", () => {
    for (const kind of SMALL_KINDS) {
      const art = draw(kind);
      const [width, height] = SMALL_SIZES[kind];
      const drawn = extent(art);
      expect(drawn.wide, kind).toBeGreaterThan(1);
      // Its outline may reach a pixel beyond the size on every side.
      expect(drawn.wide, kind).toBeLessThanOrEqual(width * 4 + 2);
      expect(drawn.tall, kind).toBeLessThanOrEqual(height * 4 + 2);
      expect(drawn.tall, kind).toBeGreaterThan(height * 4 * 0.4);
      expect(drawn.bottom, kind).toBeGreaterThan(art.footY - 3);
      expect(draw(kind).ink.join("")).toBe(art.ink.join(""));
    }
    expect(new Set(SMALL_KINDS.map((kind) => draw(kind).ink.join(""))).size).toBe(
      SMALL_KINDS.length,
    );
  });

  it("gives flowers petals on a stem, in the colour asked for", () => {
    for (const kind of ["daisy", "bell", "spike", "umbel"] as const) {
      const art = draw(kind);
      expect(count(art, [INK.accent, INK.accentDark]), kind).toBeGreaterThan(3);
      expect(count(art, [INK.dark, INK.deep]), kind).toBeGreaterThan(4);
      expect(count(art, [INK.outline]), kind).toBe(0);
      // Petals are at the top, the stem below them.
      const rows = (inks: readonly number[]): number[] =>
        [...art.ink].flatMap((ink, at) => (inks.includes(ink) ? [Math.floor(at / art.width)] : []));
      expect(Math.min(...rows([INK.accent]))).toBeLessThan(Math.min(...rows([INK.dark])) + 2);
    }
    const pink = colourArt(draw("daisy"), PALETTE["GRASS"] ?? ["", "", ""], FLOWER_COLOURS[2]);
    const petal = draw("daisy").ink.indexOf(INK.accent);
    expect([...pink.rgba.slice(petal * 4, petal * 4 + 3)]).toEqual([0xe5, 0x8f, 0xb1]);
    expect(FLOWER_COLOURS).toHaveLength(5);
  });

  it("tells a mushroom, a stone, a log, a stump and a snag by what they are made of", () => {
    const mushroom = draw("mushroom");
    expect(count(mushroom, [INK.pale])).toBeGreaterThan(2); // a pale stem, and spots
    expect(count(mushroom, [INK.accent, INK.accentDark])).toBeGreaterThan(8); // a cap
    expect(count(draw("mushroom", 1), [INK.pale])).toBeLessThan(count(mushroom, [INK.pale]));
    // A stone is bare or grown over; a boulder is a stone several times the size.
    const rock: readonly number[] = [INK.dark, INK.mid, INK.light];
    expect(count(draw("stone", 0), [INK.accent])).toBe(0);
    expect(count(draw("stone", 1), [INK.accent])).toBeGreaterThan(1);
    expect(count(draw("boulder"), rock)).toBeGreaterThan(3 * count(draw("stone"), rock));
    // Wood, outlined all round, with a shadow for the ground to paint.
    for (const kind of ["log", "stump"] as const) {
      const art = draw(kind);
      expect(count(art, WOOD)).toBeGreaterThan(10);
      expect(count(art, [INK.pale])).toBeGreaterThan(2); // the cut
      expect(count(art, [INK.outline])).toBeGreaterThan(12);
      expect(art.shadow).toBeDefined();
    }
    // A snag is a dead tree: tall and thin, all wood, with the stubs of limbs to its sides.
    const snag = draw("snag");
    expect(count(snag, FOLIAGE)).toBe(0);
    expect(extent(snag).tall).toBeGreaterThan(2 * extent(snag).wide);
    expect(extent(snag).wide).toBeGreaterThan(8);
    expect(count(snag, WOOD) / (extent(snag).tall * extent(snag).wide)).toBeLessThan(0.4);
    // What is too slight for a shadow has none.
    for (const kind of ["daisy", "fern", "herb", "reed", "mushroom"] as const) {
      expect(draw(kind).shadow).toBeUndefined();
    }
  });

  it("colours the darkest tone cooler and the lightest warmer, and wood as asked", () => {
    const ramp = PALETTE["BROADLEAF"] ?? ["", "", ""];
    const art = near("BROADLEAF");
    const pixels = colourArt(art, ramp);
    const rgb = (ink: number): number[] => {
      const at = art.ink.indexOf(ink);
      return [...pixels.rgba.slice(at * 4, at * 4 + 3)];
    };
    const sum = (colour: number[]): number => colour.reduce((total, value) => total + value, 0);
    const [deep, dark, light, bright] = [INK.deep, INK.dark, INK.light, INK.bright].map(rgb);
    if (deep === undefined || dark === undefined || light === undefined || bright === undefined)
      throw new Error("tones");
    expect(sum(deep)).toBeLessThan(sum(dark));
    expect((deep[2] ?? 0) / sum(deep)).toBeGreaterThan((dark[2] ?? 0) / sum(dark));
    expect(sum(bright)).toBeGreaterThan(sum(light));
    expect((bright[2] ?? 0) / sum(bright)).toBeLessThan((light[2] ?? 0) / sum(light));
    // Every pixel drawn is opaque, every other clear; the ramp's tones come out as given.
    const hex = (at: number): string =>
      `#${[0, 1, 2].map((i) => (pixels.rgba[at * 4 + i] ?? 0).toString(16).padStart(2, "0")).join("")}`;
    art.ink.forEach((ink, at) => {
      expect(pixels.rgba[at * 4 + 3]).toBe(ink === INK.none ? 0 : 255);
      if (ink === INK.dark) expect(hex(at)).toBe(ramp[0]);
      if (ink === INK.mid) expect(hex(at)).toBe(ramp[1]);
      if (ink === INK.light) expect(hex(at)).toBe(ramp[2]);
    });
    // Bark in four tones of the wood asked for, darkest in the furrows.
    const wood = colourArt(art, ramp, undefined, "#6e4a34");
    const tone = (ink: number): number => {
      const at = art.ink.indexOf(ink);
      return sum([...wood.rgba.slice(at * 4, at * 4 + 3)]);
    };
    expect(tone(INK.trunkLight)).toBeGreaterThan(tone(INK.trunk));
    expect(tone(INK.trunk)).toBeGreaterThan(tone(INK.trunkDark));
    expect(tone(INK.trunkDark)).toBeGreaterThan(tone(INK.trunkDeep));
    const at = art.ink.indexOf(INK.trunk);
    expect([...wood.rgba.slice(at * 4, at * 4 + 3)]).toEqual([0x6e, 0x4a, 0x34]);
  });
});

describe("plants that stand alone", () => {
  const look = (kind: string, biomass: number): NonNullable<ReturnType<typeof plantLook>> => {
    const found = plantLook(kind, biomass, 3, 4, 77, DORMANT);
    if (found === null) throw new Error("no plant");
    return found;
  };

  it("are every tree, shrubs in leaf, and one tuft of grown grass in three", () => {
    expect(standsAlone(look("BROADLEAF", 40), 3, 4)).toBe(true);
    expect(standsAlone(look("CONIFER", 240), 3, 4)).toBe(true);
    expect(standsAlone(look("SHRUB", 200), 3, 4)).toBe(true);
    expect(standsAlone(look("SHRUB", 40), 3, 4)).toBe(false); // died back
    expect(standsAlone(look("LICHEN", 240), 3, 4)).toBe(false);
    let tufts = 0;
    for (let x = 0; x < 300; x++) {
      expect(standsAlone(look("GRASS", 100), x, 9)).toBe(false); // young grass is ground
      if (standsAlone(look("GRASS", 240), x, 9)) tufts += 1;
    }
    expect(tufts).toBeGreaterThan(70);
    expect(tufts).toBeLessThan(130);
  });

  it("stand a little off the middle of their cell, always the same way", () => {
    const seen = new Set<string>();
    for (let x = 0; x < 40; x++) {
      for (let y = 0; y < 40; y++) {
        const [dx, dy] = plantOffset(x, y);
        expect(Number.isInteger(dx) && dx >= -2 && dx <= 2).toBe(true);
        expect(Number.isInteger(dy) && dy >= -2 && dy <= 1).toBe(true);
        seen.add(`${dx},${dy}`);
      }
    }
    expect(seen.size).toBe(20); // every offset is used
    expect(plantOffset(7, 9)).toEqual(plantOffset(7, 9));
  });

  it("hash a cell to a number in [0, 1) that the salt changes", () => {
    const values = Array.from({ length: 2000 }, (_, i) => cellHash(i % 50, Math.floor(i / 50), 1));
    expect(Math.min(...values)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...values)).toBeLessThan(1);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
    expect(cellHash(3, 4, 1)).toBe(cellHash(3, 4, 1));
    expect(cellHash(3, 4, 1)).not.toBe(cellHash(3, 4, 2));
    expect(cellHash(-5, -9, 1)).toBeGreaterThanOrEqual(0); // off the map is fine too
  });
});
