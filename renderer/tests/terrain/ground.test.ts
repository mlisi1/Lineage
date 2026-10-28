import { describe, expect, it } from "vitest";
import {
  CALM_CELLS,
  CLOSE_FROM_TILE,
  GROUND_STYLES,
  MID_TILE,
  MAP_TILE,
  paintGround,
  valueNoise,
  type GroundOptions,
  type GroundStyle,
} from "../../src/terrain/ground";
import { R0 } from "../../src/looks";

import { hexToRgb, type Pixels } from "../../src/terrain/pixels";
import { R0_SEASONS, SEASONS, seasonRamp, type Season } from "../../src/plants/seasons";
import { DEPTH, LAND, MAP, PALETTE, SEA, SEA_LEVEL, SHORE_OUTLINE, world } from "../spike/worlds";

/** These tests hold the painter to the R0 look's colours, which the test worlds carry. */
const paint = (world: Parameters<typeof paintGround>[0], options: GroundOptions): Pixels =>
  paintGround(world, { look: R0, ...options });

const rows = (letter: string, width: number, height: number): string[] =>
  Array.from({ length: height }, () => letter.repeat(width));
const packed = (colour: string): number => {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
};
const at = (image: Pixels, x: number, y: number): number => {
  const i = (y * image.width + x) * 4;
  return ((image.rgba[i] ?? 0) << 16) | ((image.rgba[i + 1] ?? 0) << 8) | (image.rgba[i + 2] ?? 0);
};
/** How many pixels of the image have each colour. */
function census(image: Pixels): Map<number, number> {
  const counts = new Map<number, number>();
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      counts.set(at(image, x, y), (counts.get(at(image, x, y)) ?? 0) + 1);
    }
  }
  return counts;
}
const share = (image: Pixels, colour: string): number =>
  (census(image).get(packed(colour)) ?? 0) / (image.width * image.height);
const local = (style: GroundStyle, grain = true) => ({ tile: MID_TILE, style, grain });

const ISLAND = [...rows("~", 9, 3), ...rows("~~~...~~~", 1, 3), ...rows("~", 9, 3)];
const BARE = PALETTE["BARE"] ?? ["", "", ""];
const GRASS = PALETTE["GRASS"] ?? ["", "", ""];
/** The band of sea the worlds' flat sea floor falls in. */
const SEA_HERE = SEA[2] ?? "";

describe("paintGround", () => {
  it("paints opaque pixels, tile to the cell, the same every time, in every style", () => {
    const fixture = world(["~~~~~~", "~.gb.~", "~.sc.~", "~~~~~~"]);
    for (const style of GROUND_STYLES) {
      const image = paint(fixture, local(style));
      expect([image.width, image.height]).toEqual([6 * MID_TILE, 4 * MID_TILE]);
      for (let i = 3; i < image.rgba.length; i += 4) expect(image.rgba[i]).toBe(255);
      expect([...paint(fixture, local(style)).rgba]).toEqual([...image.rgba]);
    }
    const map = paint(fixture, { tile: MAP_TILE, style: "smooth", grain: false });
    expect([map.width, map.height]).toEqual([6 * MAP_TILE, 4 * MAP_TILE]);
  });

  it("draws flat squares in the map's colours when asked for squares without grain", () => {
    const fixture = world(["~~~~~~", "~~..gg", "~~..gg", "~~..gg"]);
    const image = paint(fixture, local("squares", false));
    // The middle of a sea cell, of a bare cell and of a grass cell, away from the shore.
    expect(at(image, 4, 4)).toBe(packed(SEA_HERE));
    expect(at(image, 3 * 8 + 4, 2 * 8 + 4)).toBe(packed(BARE[1]));
    expect(at(image, 5 * 8 + 4, 2 * 8 + 4)).toBe(packed(GRASS[1]));
    // Nothing but those, the lit slopes that face the sea floor to the north-west (as on
    // the report maps), the beach, and the outline of the shore.
    expect(new Set(census(image).keys())).toEqual(
      new Set([SEA_HERE, BARE[1], BARE[2], GRASS[1], GRASS[2], SHORE_OUTLINE].map(packed)),
    );
  });

  it("leaves the open sea its colour, with a lighter dash here and there", () => {
    for (const style of GROUND_STYLES) {
      const grained = paint(world(rows("~", 12, 8)), local(style));
      expect(census(grained).size).toBe(2);
      expect(share(grained, SEA_HERE)).toBeGreaterThan(0.97);
      const flat = paint(world(rows("~", 12, 8)), local(style, false));
      expect(census(flat).size).toBe(1);
    }
  });

  it("outlines the shore one pixel wide, and adds foam only with grain", () => {
    for (const style of GROUND_STYLES) {
      const image = paint(world(ISLAND), local(style));
      const outline = packed(SHORE_OUTLINE);
      const sea = packed(SEA_HERE);
      const colours = census(image);
      const edge = colours.get(outline) ?? 0;
      // An island of three cells a side has a shore of about 96 pixels.
      expect(edge).toBeGreaterThan(50);
      expect(edge).toBeLessThan(170);
      expect(at(image, 36, 36)).not.toBe(sea); // its middle is land
      expect(at(image, 0, 0)).toBe(sea);
      // Grain adds foam and pebbles; the outline is there without it.
      const flat = paint(world(ISLAND), local(style, false));
      expect(census(flat).get(outline)).toBe(edge);
      expect(census(image).size).toBeGreaterThan(census(flat).size);
    }
  });

  it("puts an interpolated shore where the height crosses the sea level, not on a cell's edge", () => {
    // Land four times as high as the sea is deep: the shore lies a fifth of the way out.
    const steep = world(ISLAND, 200, (_x, _y, water) => SEA_LEVEL + (water ? -DEPTH : 4 * LAND));
    const level = world(ISLAND);
    const land = (image: Pixels): number => {
      let count = 0;
      for (const [colour, pixels] of census(image)) {
        if (![packed(SEA_HERE), packed(SEA[1] ?? ""), packed(SEA[0] ?? "")].includes(colour)) {
          count += pixels;
        }
      }
      return count;
    };
    const flat = { tile: MID_TILE, style: "smooth", grain: false } as const;
    expect(land(paint(steep, flat))).toBeGreaterThan(land(paint(level, flat)) * 1.25);
    // Squares do not care how high the land is.
    const squares = { ...flat, style: "squares" } as const;
    expect(land(paint(steep, squares))).toBe(land(paint(level, squares)));
  });

  it("shades relief by the slope toward the light, and bands the sea by depth", () => {
    // Rising toward the south-east: every slope faces the light (which is north-west)... away.
    const rising = world(rows(".", 8, 8), 200, (x, y) => SEA_LEVEL + 0.05 + 0.02 * (x + y));
    const falling = world(rows(".", 8, 8), 200, (x, y) => SEA_LEVEL + 0.4 - 0.02 * (x + y));
    for (const style of ["squares", "smooth"] as const) {
      const options = { tile: MID_TILE, style, grain: false };
      // Height gained walking toward the light is positive where the land falls away from it.
      expect(at(paint(rising, options), 36, 36)).toBe(packed(BARE[2]));
      expect(at(paint(falling, options), 36, 36)).toBe(packed(BARE[0]));
    }
    // A sea floor that drops to the east: shallow water first, then band after band.
    const shelf = world(rows("~", 12, 2), 200, (x) => SEA_LEVEL - 0.01 - 0.03 * x);
    const image = paint(shelf, { tile: MID_TILE, style: "smooth", grain: false });
    const seen: number[] = [];
    for (let x = 0; x < image.width; x++) {
      const colour = at(image, x, 8);
      if (seen[seen.length - 1] !== colour) seen.push(colour);
    }
    expect(seen).toEqual(SEA.map(packed));
  });

  it("turns bare heights to rock and snow", () => {
    const peak = world(rows(".", 4, 4), 200, () => SEA_LEVEL + 0.5);
    const rock = world(rows(".", 4, 4), 200, () => SEA_LEVEL + 0.35);
    const flat = { tile: MID_TILE, style: "smooth", grain: false } as const;
    expect(at(paint(peak, flat), 16, 16)).toBe(packed("#e6edf2"));
    expect(at(paint(rock, flat), 16, 16)).toBe(packed("#98928c"));
  });

  it("thickens the grass with its biomass, and shows the soil where it is thin", () => {
    for (const style of ["warped", "blended"] as const) {
      const thin = paint(world(rows("g", 8, 8), 90), local(style));
      const thick = paint(world(rows("g", 8, 8), 250), local(style));
      expect(share(thin, GRASS[1])).toBeGreaterThan(0.1);
      expect(share(thick, GRASS[1])).toBeGreaterThan(share(thin, GRASS[1]) + 0.2);
      expect(share(thin, BARE[1])).toBeGreaterThan(0.2);
    }
    // On the map there is no grain: grass is its flat colour, however thin.
    const map = paint(world(rows("g", 8, 8), 90), local("smooth", false));
    expect(share(map, GRASS[1])).toBe(1);
  });

  it("gives woods a darker floor up close and their own colour on the map", () => {
    const [dark, mid] = PALETTE["BROADLEAF"] ?? ["", ""];
    const close = paint(world(rows("b", 8, 8), 220), local("smooth"));
    expect(share(close, dark)).toBeGreaterThan(0.4);
    expect(share(close, mid)).toBeLessThan(0.1); // only a fleck here and there
    const map = paint(world(rows("b", 8, 8), 220), local("smooth", false));
    expect(share(map, mid)).toBe(1);
  });

  it("cuts the border between two kinds of ground, or blends it", () => {
    const halves = world(rows("....gggg", 1, 8), 255);
    /** Along the middle row of pixels: how often the colour changes between soil and grass. */
    const changes = (style: GroundStyle): number => {
      const image = paint(halves, local(style, false));
      let count = 0;
      for (let x = 1; x < image.width; x++) {
        if (at(image, x, 30) !== at(image, x - 1, 30)) count += 1;
      }
      return count;
    };
    expect(changes("squares")).toBe(1);
    expect(changes("smooth")).toBe(1);
    // Dithered: the two alternate over a few pixels before one gives way.
    expect(changes("blended")).toBeGreaterThan(2);
  });

  it("lets a border wander in every style but squares", () => {
    const halves = world(rows("....gggg", 1, 12), 255);
    for (const style of GROUND_STYLES) {
      const image = paint(halves, local(style, false));
      const edges = new Set<number>();
      for (let y = 0; y < image.height; y++) {
        let first = image.width;
        for (let x = image.width - 1; x >= 0; x--) {
          if (at(image, x, y) === packed(GRASS[1])) first = x;
        }
        edges.add(first);
      }
      if (style === "squares") expect([...edges]).toEqual([4 * MID_TILE]);
      else expect(edges.size).toBeGreaterThan(2);
      for (const edge of edges) expect(Math.abs(edge - 4 * MID_TILE)).toBeLessThan(8);
    }
  });

  it("gives a closer view a wider shore and finer edges, on the same land", () => {
    const fixture = world(ISLAND);
    const mid = paint(fixture, local("blended"));
    const near = paint(fixture, { tile: 4 * MID_TILE, style: "blended", grain: true });
    expect([near.width, near.height]).toEqual([4 * mid.width, 4 * mid.height]);
    const outline = packed(SHORE_OUTLINE);
    // Still an outline of one pixel: four times as long, not sixteen times as much.
    const ratio = (census(near).get(outline) ?? 0) / (census(mid).get(outline) ?? 1);
    expect(ratio).toBeGreaterThan(3);
    expect(ratio).toBeLessThan(6.5);
    // Sand the sea has just left, which the middle view has no room for.
    const wet = [...census(near).keys()].filter((colour) => !census(mid).has(colour));
    expect(wet.length).toBeGreaterThan(0);
    // The land is where it was: as much of the picture is sea.
    const sea = (image: Pixels): number => share(image, SEA_HERE);
    expect(Math.abs(sea(near) - sea(mid))).toBeLessThan(0.06);
  });

  it("paints part of the world as it paints the whole", () => {
    const fixture = world(["~~~~~~~~", "~..gg..~", "~.bbcc.~", "~..ss..~", "~~~~~~~~"]);
    for (const style of GROUND_STYLES) {
      const whole = paint(fixture, local(style));
      const cells = { x0: 2, y0: 1, x1: 6, y1: 4 };
      const part = paint(fixture, { ...local(style), cells });
      expect([part.width, part.height]).toEqual([4 * MID_TILE, 3 * MID_TILE]);
      // Away from the part's own edge, where the shore's outline has nothing to meet.
      for (let y = 2; y < part.height - 2; y++) {
        for (let x = 2; x < part.width - 2; x++) {
          expect(at(part, x, y)).toBe(at(whole, x + 2 * MID_TILE, y + MID_TILE));
        }
      }
    }
  });
});

describe("the ground of a close view", () => {
  /** The local view: four times the middle view's pixels to the cell. */
  const NEAR = 4 * MID_TILE;
  const near = (extra: Partial<Parameters<typeof paintGround>[1]> = {}) => ({
    tile: NEAR,
    style: "blended" as const,
    grain: true,
    ...extra,
  });
  /** Colours of `image` that are nearer to `colour` than `within` in every channel. */
  const like = (image: Pixels, colour: string, within = 0): number => {
    const [r, g, b] = hexToRgb(colour);
    let found = 0;
    for (let i = 0; i < image.rgba.length; i += 4) {
      const near =
        Math.abs((image.rgba[i] ?? 0) - r) <= within &&
        Math.abs((image.rgba[i + 1] ?? 0) - g) <= within &&
        Math.abs((image.rgba[i + 2] ?? 0) - b) <= within;
      if (near) found += 1;
    }
    return found / (image.width * image.height);
  };

  it("reads what grows over the cells around, so that one odd cell is no patch", () => {
    expect(NEAR).toBeGreaterThanOrEqual(CLOSE_FROM_TILE);
    const meadow = rows("g", 9, 9);
    meadow[4] = "gggg.gggg"; // one bare cell in the grass
    const fixture = world(meadow, 255);
    const soil = (image: Pixels): number =>
      BARE.reduce((sum, tone) => sum + like(image, tone, 12), 0);
    // As each cell says: a patch of soil a cell wide. Read over two cells around, the
    // meadow is what it would be without that cell.
    const whole = world(rows("g", 9, 9), 255);
    const odd = soil(paint(fixture, near({ calm: 0 })));
    expect(odd).toBeGreaterThan(0.004);
    expect(odd).toBeGreaterThan(4 * soil(paint(whole, near({ calm: 0 }))) + 0.003);
    expect(soil(paint(fixture, near({ calm: CALM_CELLS })))).toBe(
      soil(paint(whole, near({ calm: CALM_CELLS }))),
    );
    // A close view is calm unless told otherwise; the middle view never is.
    const same = (a: Pixels, b: Pixels): boolean => a.rgba.every((value, i) => value === b.rgba[i]);
    expect(same(paint(fixture, near()), paint(fixture, near({ calm: CALM_CELLS })))).toBe(true);
    expect(
      same(paint(fixture, local("blended")), paint(fixture, { ...local("blended"), calm: 0 })),
    ).toBe(true);
    // A patch that holds several cells together stays, whatever the calm.
    const clearing = rows("g", 12, 12).map((row, y) => (y >= 4 && y < 8 ? "gggg....gggg" : row));
    for (const calm of [1, 2, 3]) {
      expect(soil(paint(world(clearing, 255), near({ calm })))).toBeGreaterThan(0.02);
    }
  });

  it("thins growth in gaps cells across, not in specks", () => {
    const fixture = world(rows("g", 10, 10), 110);
    /**
     * Share of soil, and how long a stretch of it is on average along a row, counted in
     * blocks of four pixels by four so that a pebble or a blade is not a stretch.
     */
    const gaps = (image: Pixels): { share: number; run: number } => {
      const side = 4;
      const isSoil = (bx: number, by: number): boolean => {
        let soil = 0;
        for (let y = by * side; y < (by + 1) * side; y++) {
          for (let x = bx * side; x < (bx + 1) * side; x++) {
            const i = (y * image.width + x) * 4;
            // Soil is as red as it is green; grass, green or dried, is not.
            if ((image.rgba[i] ?? 0) > (image.rgba[i + 1] ?? 0) - 6) soil += 1;
          }
        }
        return soil >= (side * side) / 2;
      };
      let soil = 0;
      let changes = 0;
      const across = image.width / side;
      const down = image.height / side;
      for (let by = 0; by < down; by++) {
        for (let bx = 0; bx < across; bx++) {
          if (isSoil(bx, by)) soil += 1;
          if (bx > 0 && isSoil(bx, by) !== isSoil(bx - 1, by)) changes += 1;
        }
      }
      return { share: soil / (across * down), run: (side * soil) / Math.max(changes / 2, 1) };
    };
    const calm = gaps(paint(fixture, near()));
    const busy = gaps(paint(fixture, near({ calm: 0 })));
    // As much soil shows either way; calm, it shows in stretches a cell long and more,
    // several times what they were.
    expect(calm.share).toBeGreaterThan(0.15);
    expect(calm.share).toBeLessThan(0.75);
    expect(Math.abs(calm.share - busy.share)).toBeLessThan(0.2);
    expect(calm.run).toBeGreaterThan(NEAR);
    expect(calm.run).toBeGreaterThan(2 * busy.run);
  });

  it("draws what each kind of ground is made of", () => {
    const colours = (image: Pixels): number => census(image).size;
    // Grass: blades a tone darker and lighter than the turf, which the middle view has less of.
    const grass = paint(world(rows("g", 6, 6), 255), near());
    expect(like(grass, GRASS[1])).toBeGreaterThan(0.75);
    expect(like(grass, GRASS[0])).toBeGreaterThan(0.01);
    expect(like(grass, GRASS[2])).toBeGreaterThan(0.01);
    // Lichen is rosettes on the soil, not a colour of the ground: soil still shows.
    const lichen = paint(world(rows("l", 6, 6), 255), near());
    const LICHEN = PALETTE["LICHEN"] ?? ["", "", ""];
    expect(like(lichen, BARE[1])).toBeGreaterThan(0.5);
    expect(like(lichen, LICHEN[2]) + like(lichen, LICHEN[1])).toBeGreaterThan(0.03);
    expect(like(lichen, "#c9a94a")).toBeGreaterThan(0); // mustard ones among them
    // The thicker it grows, the more of them.
    const sparse = paint(world(rows("l", 6, 6), 40), near());
    expect(like(lichen, LICHEN[2])).toBeGreaterThan(1.5 * like(sparse, LICHEN[2]));
    // Bare rock carries a few as well; bare soil none.
    const rock = paint(
      world(rows(".", 6, 6), 0, () => SEA_LEVEL + 0.35),
      near(),
    );
    expect(like(rock, LICHEN[2])).toBeGreaterThan(0);
    expect(like(paint(world(rows(".", 6, 6), 0), near()), LICHEN[2])).toBe(0);
    // Under trees the floor is litter: browner than the trees' own dark, with leaves on it.
    const [dark] = PALETTE["BROADLEAF"] ?? [""];
    const wood = paint(world(rows("b", 6, 6), 255), near());
    expect(like(wood, dark)).toBe(0);
    expect(like(wood, "#b08a4a") + like(wood, "#7a5a34")).toBeGreaterThan(0.005);
    // Sand has ripples, soil pebbles and cracks: more than one flat colour each.
    const sand = paint(
      world(rows(".", 6, 6), 0, () => SEA_LEVEL + 0.003),
      near(),
    );
    expect(colours(sand)).toBeGreaterThanOrEqual(3);
    expect(colours(paint(world(rows(".", 6, 6), 0), near()))).toBeGreaterThanOrEqual(3);
    // Without grain there is none of it.
    expect(colours(paint(world(rows("g", 6, 6), 255), near({ grain: false })))).toBe(1);
  });

  it("follows the seasons: colours, blooms, fallen leaves, winter's dieback", () => {
    const meadow = world(rows("g", 8, 8), 255);
    const wood = world(rows("b", 8, 8), 255);
    const same = (a: Pixels, b: Pixels): boolean => a.rgba.every((value, i) => value === b.rgba[i]);
    const grass = (season: Season): string =>
      seasonRamp(PALETTE, "GRASS", season, 0, R0_SEASONS)[1];
    // Summer is what is painted when no season is given.
    expect(same(paint(meadow, near({ season: "summer" })), paint(meadow, near()))).toBe(true);
    // Each season paints the grass in its own tone, and in none of the others'.
    for (const season of SEASONS) {
      const image = paint(meadow, near({ season }));
      expect(like(image, grass(season)), season).toBeGreaterThan(0.6);
      for (const other of SEASONS) {
        if (grass(other) !== grass(season)) expect(like(image, grass(other))).toBe(0);
      }
    }
    // Winter dries low growth whatever its biomass, as the simulation's own winter does.
    expect(grass("winter")).not.toBe(GRASS[1]);
    expect(like(paint(meadow, near({ season: "winter" })), GRASS[1])).toBe(0);
    // Blooms in the turf: most in spring, some in summer, none after.
    const blooms = (season: Season): number =>
      like(paint(meadow, near({ season })), "#f4f1e4") +
      like(paint(meadow, near({ season })), "#f2d24b");
    expect(blooms("spring")).toBeGreaterThan(1.5 * blooms("summer"));
    expect(blooms("summer")).toBeGreaterThan(0);
    expect([blooms("autumn"), blooms("winter")]).toEqual([0, 0]);
    // Under broadleaves autumn lays leaves, gold and flame, more than summer's litter.
    const fallen = (season: Season, colours: readonly string[]): number =>
      colours.reduce((sum, colour) => sum + like(paint(wood, near({ season })), colour), 0);
    expect(fallen("autumn", ["#d29a2a", "#c25a26"])).toBeGreaterThan(
      1.5 * fallen("summer", ["#b08a4a", "#7a5a34"]),
    );
    expect(fallen("summer", ["#d29a2a", "#c25a26"])).toBe(0);
    // The map takes the season's colours too, flat.
    const map = paint(meadow, {
      tile: MAP_TILE,
      style: "smooth",
      grain: false,
      season: "autumn",
    });
    expect(share(map, grass("autumn"))).toBe(1);
    // The middle view as well.
    expect(
      like(paint(meadow, { ...local("blended"), season: "spring" }), grass("spring")),
    ).toBeGreaterThan(0.5);
  });

  it("lays snow in winter if asked: in patches, thinner under trees, never in another season", () => {
    const meadow = world(rows("g", 12, 12), 255);
    const wood = world(rows("b", 12, 12), 255);
    const snowOn = (fixture: Parameters<typeof paintGround>[0], season: Season): number => {
      const image = paint(fixture, near({ season, snow: true }));
      return ["#c9d3dc", "#e6edf2", "#ffffff"].reduce((sum, tone) => sum + like(image, tone, 2), 0);
    };
    const open = snowOn(meadow, "winter");
    expect(open).toBeGreaterThan(0.4);
    expect(open).toBeLessThan(0.97);
    expect(snowOn(wood, "winter")).toBeLessThan(open - 0.15);
    expect(snowOn(wood, "winter")).toBeGreaterThan(0.05);
    expect(snowOn(meadow, "summer")).toBe(0);
    // Without being asked, winter is bare.
    const bare = paint(meadow, near({ season: "winter" }));
    expect(like(bare, "#e6edf2", 2)).toBe(0);
  });

  it("lays shadows on the land, once however many overlap, with a dithered rim", () => {
    const fixture = world(["~~~~~~~~", ...rows("~......~", 1, 6), "~~~~~~~~"], 0);
    const plain = paint(fixture, near());
    const one = paint(fixture, near({ shadows: [{ x: 4, y: 4, rx: 1.5, ry: 0.8 }] }));
    const two = paint(
      fixture,
      near({
        shadows: [
          { x: 4, y: 4, rx: 1.5, ry: 0.8 },
          { x: 4.3, y: 4.1, rx: 1.5, ry: 0.8 },
        ],
      }),
    );
    const sum = (image: Pixels, x: number, y: number): number => {
      const i = (y * image.width + x) * 4;
      return (image.rgba[i] ?? 0) + (image.rgba[i + 1] ?? 0) + (image.rgba[i + 2] ?? 0);
    };
    // In the middle of the shadow the ground is darker, and bluer for it.
    const [cx, cy] = [4 * NEAR, 4 * NEAR];
    expect(sum(one, cx, cy)).toBeLessThan(sum(plain, cx, cy) * 0.9);
    // Where both fall it is no darker than under one.
    expect(sum(two, cx, cy)).toBe(sum(one, cx, cy));
    // Well outside it nothing changed, and the sea carries no shadow.
    expect(sum(one, cx, cy + 2 * NEAR)).toBe(sum(plain, cx, cy + 2 * NEAR));
    const wet = paint(fixture, near({ shadows: [{ x: 0.5, y: 0.5, rx: 2, ry: 2 }] }));
    for (let i = 0; i < NEAR / 2; i++) expect(sum(wet, i, i)).toBe(sum(plain, i, i));
    // Along its rim shaded and unshaded pixels alternate.
    let flips = 0;
    const edge = Math.round(cx + 1.5 * NEAR);
    for (let x = edge - 8; x < edge + 8; x++) {
      if (sum(one, x, cy) < sum(plain, x, cy) !== sum(one, x - 1, cy) < sum(plain, x - 1, cy))
        flips += 1;
    }
    expect(flips).toBeGreaterThan(1);
  });

  it("paints a piece of the world as it paints the whole, a little way in from the piece's edge", () => {
    // What the pieces of the local view rely on: detail and calm come out the same.
    const whole = paint(MAP, near());
    const cells = { x0: 6, y0: 2, x1: 14, y1: 10 };
    const piece = paint(MAP, near({ cells }));
    expect([piece.width, piece.height]).toEqual([8 * NEAR, 8 * NEAR]);
    // A drawing that starts outside the piece is not in it: allow for the largest of them.
    const margin = 8;
    let differing = 0;
    for (let y = margin; y < piece.height - margin; y++) {
      for (let x = margin; x < piece.width - margin; x++) {
        if (at(piece, x, y) !== at(whole, x + cells.x0 * NEAR, y + cells.y0 * NEAR)) differing += 1;
      }
    }
    expect(differing).toBe(0);
  });
});

describe("valueNoise", () => {
  it("stays in range, hits its corners and runs smoothly between them", () => {
    let low = 1;
    let high = 0;
    for (let i = 0; i < 400; i++) {
      const value = valueNoise(i * 0.37, i * 0.11, 3);
      low = Math.min(low, value);
      high = Math.max(high, value);
      expect(Math.abs(valueNoise(i * 0.37 + 0.01, i * 0.11, 3) - value)).toBeLessThan(0.03);
    }
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThan(1);
    expect(high - low).toBeGreaterThan(0.5);
    expect(valueNoise(2.5, 7.25, 1)).toBe(valueNoise(2.5, 7.25, 1));
    expect(valueNoise(2.5, 7.25, 1)).not.toBe(valueNoise(2.5, 7.25, 2));
  });
});

describe("a piece's margin painted as land or sea only (R5, the optimization plan)", () => {
  it("leaves every pixel shown the same, and the shore's data with it", () => {
    const fixture = world([
      "~~~~~~~~~~~~",
      "~~~ggggg..~~",
      "~~gggbbbg.~~",
      "~~ggbbccgg.~",
      "~~~gg..sgg~~",
      "~~~~~gggg~~~",
      "~~~~~~~~~~~~",
    ]);
    for (const tile of [8, 32]) {
      const cells = { x0: 4, y0: 2, x1: 8, y1: 5 };
      const padded = { x0: 3, y0: 1, x1: 9, y1: 6 };
      const options = { tile, style: "blended", grain: true, surf: true, cells: padded } as const;
      const full = paintGround(fixture, options);
      const cut = paintGround(fixture, { ...options, shown: cells });
      const wide = full.width;
      for (let py = tile; py < tile + 3 * tile; py++) {
        for (let px = tile; px < tile + 4 * tile; px++) {
          const at = 4 * (py * wide + px);
          expect(Array.from(cut.rgba.subarray(at, at + 4))).toEqual(
            Array.from(full.rgba.subarray(at, at + 4)),
          );
          expect(Array.from(cut.shore?.subarray(at, at + 4) ?? [])).toEqual(
            Array.from(full.shore?.subarray(at, at + 4) ?? []),
          );
        }
      }
    }
  });
});

describe("the cells of a land worked out once (R5, the optimization plan)", () => {
  it("paints a new land from its own cells, not the last one's", () => {
    const options = { tile: 8, style: "blended", grain: true } as const;
    const first = world(["~~~~~~", "~ggbb~", "~ggbb~", "~~~~~~"]);
    const second = world(["~~~~~~", "~ccss~", "~ccss~", "~~~~~~"]);
    const fresh = paintGround(second, options);
    paintGround(first, options);
    expect(paintGround(second, options).rgba).toEqual(fresh.rgba);
    expect(paintGround(first, options).rgba).not.toEqual(fresh.rgba);
  });
});
