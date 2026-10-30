import { describe, expect, it } from "vitest";
import { Sprite, Texture, TextureSource } from "pixi.js";
import { PlantLayer, standingPlants, type Crown, type Placed } from "../../src/plants/plants";
import { ROCK_JITTER, gustAt } from "../../src/plants/wind";
import { cellHash } from "../../src/terrain/pixels";
import type { Land } from "../../src/terrain/land";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { fakeCanvas } from "../support/canvas";
import { world } from "../spike/worlds";

fakeCanvas();

/** A land from a picture (`world`), in the land palette, in `season`. */
const landOf = (
  rows: readonly string[],
  season: Land["season"] = "summer",
  heightOf?: (x: number, y: number, water: boolean) => number,
): Land => ({ ...world(rows, 200, heightOf), ...LAND_PALETTE, season });

/** A drawing `width` × `height` pixels, standing on the middle of its lower edge. */
const drawing = (width: number, height: number): Texture =>
  new Texture({ source: new TextureSource({ width, height }) });

/** A plant of a drawing `width` × `height`, `tile` pixels to the cell, its foot `dx`, `dy` off the cell's. */
function plant(tile: number, width: number, height: number, extra: Partial<Placed> = {}): Placed {
  return {
    texture: drawing(width, height),
    anchorX: 0.5,
    anchorY: 1,
    scale: 1 / tile,
    dx: 0,
    dy: 0,
    ...extra,
  };
}

/** A layer with `put(x, y)` standing on each cell, built at once. */
function layerOf(land: Land, put: (x: number, y: number) => Placed[], rowsPerCell = 1): PlantLayer {
  return new PlantLayer(land, (_look, x, y) => put(x, y), {
    tall: 2,
    rowsPerCell,
    eager: true,
  });
}

/** The sprites a layer drew, each with where its foot is (cells). */
function spritesOf(layer: PlantLayer): Sprite[] {
  const out: Sprite[] = [];
  const walk = (node: { children: readonly unknown[] }): void => {
    for (const child of node.children) {
      if (child instanceof Sprite) out.push(child);
      else walk(child as { children: readonly unknown[] });
    }
  };
  walk(layer.container);
  return out;
}

const SEA_WEST = ["~~~~gggggggg", "~~~~gggggggg", "~~~~gggggggg", "~~~~gggggggg"];

describe("plants stand ashore (PlantLayer.ashore)", () => {
  it("builds a plant whose foot is well up the land", () => {
    const layer = layerOf(landOf(SEA_WEST), (x, y) =>
      x === 8 && y === 2 ? [plant(32, 8, 8)] : [],
    );
    expect(layer.count).toBe(1);
  });

  it("leaves off a plant whose cell is land but whose foot is on the water as painted", () => {
    // The coast is drawn half way between the last sea cell and the first land one (x = 4).
    const land = landOf(SEA_WEST);
    const onSea = layerOf(land, (x, y) =>
      x === 4 && y === 2 ? [plant(32, 8, 8, { dx: -0.7 })] : [],
    );
    expect(onSea.count).toBe(0);
  });

  it("keeps a plant's foot beyond where the swash runs up the beach, up close", () => {
    // A foot at x = 4.2 is on land, a fifth of a cell from the waterline: the swash of the
    // local view runs further up than that, the map has none.
    const land = landOf(SEA_WEST);
    const put = (tile: number) => (x: number, y: number) =>
      x === 4 && y === 2 ? [plant(tile, 8, 8, { dx: -0.3 })] : [];
    expect(layerOf(land, put(32)).count).toBe(0);
    expect(layerOf(land, put(4)).count).toBe(1);
    // Further up the beach the local view keeps it too.
    const higher = (x: number, y: number): Placed[] =>
      x === 4 && y === 2 ? [plant(32, 8, 8)] : [];
    expect(layerOf(land, higher).count).toBe(1);
  });

  it("looks for the water every way round the foot, not only to the west", () => {
    const north = landOf(["~~~~~~~~", "gggggggg", "gggggggg", "gggggggg"]);
    const near = (x: number, y: number): Placed[] =>
      x === 4 && y === 1 ? [plant(32, 8, 8, { dy: -0.75 })] : [];
    const far = (x: number, y: number): Placed[] => (x === 4 && y === 2 ? [plant(32, 8, 8)] : []);
    expect(layerOf(north, near).count).toBe(0);
    expect(layerOf(north, far).count).toBe(1);
  });

  it("throws no shadow for a plant left off the water", () => {
    const land = landOf(SEA_WEST);
    const layer = layerOf(land, (x, y) =>
      y === 2 && (x === 4 || x === 8)
        ? [plant(32, 8, 8, { dx: x === 4 ? -0.7 : 0, shadow: { rx: 0.3, ry: 0.1 } })]
        : [],
    );
    const shadows = layer.shadows({ x0: 0, y0: 0, x1: 12, y1: 4 });
    expect(shadows).toHaveLength(1);
    expect(shadows[0]?.x).toBeGreaterThan(8);
  });

  it("puts a plant's foot on a whole art pixel", () => {
    const land = landOf(SEA_WEST);
    const layer = layerOf(land, (x, y) =>
      x === 9 && y === 1
        ? [plant(32, 7, 9, { dx: 0.123, dy: -0.311, anchorX: 3 / 7, anchorY: 8 / 9 })]
        : [],
    );
    const [sprite] = spritesOf(layer);
    if (sprite === undefined) throw new Error("no plant");
    // The drawing's corner lies on the art pixel grid.
    const left = sprite.x * 32 - 3;
    const top = sprite.y * 32 - 8;
    expect(left).toBeCloseTo(Math.round(left), 9);
    expect(top).toBeCloseTo(Math.round(top), 9);
  });
});

describe("what animals keep out of (PlantLayer.blocked)", () => {
  const land = landOf(["gggggggg", "gggggggg", "gggggggg", "gggggggg", "gggggggg"]);
  const tree = (x: number, y: number): Placed[] =>
    x === 3 && y === 2 ? [plant(32, 32, 64, { footprint: { rx: 0.3, ry: 0.15 } })] : [];

  it("blocks a body over a tree's foot, a little above where it stands", () => {
    const layer = layerOf(land, tree);
    // The foot is at (3.5, 3); the footprint's middle 0.6 of its half height above it.
    const middle = 3 - 0.15 * 0.6;
    expect(layer.blocked(3.5, middle, 0)).toBe(true);
    expect(layer.blocked(3.7, middle, 0)).toBe(true);
    expect(layer.blocked(3.5, middle - 0.1, 0)).toBe(true);
    // Beside it, and in front of or behind it, an animal walks by.
    expect(layer.blocked(3.85, middle, 0)).toBe(false);
    expect(layer.blocked(3.5, middle + 0.2, 0)).toBe(false);
    expect(layer.blocked(3.5, 1.5, 0)).toBe(false);
  });

  it("blocks a larger body further out", () => {
    const layer = layerOf(land, tree);
    const middle = 3 - 0.15 * 0.6;
    expect(layer.blocked(3.85, middle, 0)).toBe(false);
    expect(layer.blocked(3.85, middle, 0.1)).toBe(true);
    expect(layer.blocked(4.5, middle, 0.1)).toBe(false);
  });

  it("keeps a bush's footprint as a band along its foot, about its drawing's middle", () => {
    // A bush's footprint is raised to its drawing's middle (`raise` in half heights).
    const bush = (x: number, y: number): Placed[] =>
      x === 3 && y === 2
        ? [plant(32, 32, 24, { footprint: { rx: 0.45, ry: 0.3, raise: 1.25 } })]
        : [];
    const layer = layerOf(land, bush);
    const middle = 3 - 0.3 * 1.25;
    expect(layer.blocked(3.5, middle, 0)).toBe(true);
    expect(layer.blocked(3.9, middle, 0)).toBe(true);
    expect(layer.blocked(3.5, middle - 0.25, 0)).toBe(true);
    expect(layer.blocked(3.5, middle + 0.25, 0)).toBe(true);
    expect(layer.blocked(3.5, middle + 0.35, 0)).toBe(false);
    expect(layer.blocked(4.0, middle, 0)).toBe(false);
  });

  it("does not block on grass and small things, which keep no footprint", () => {
    const layer = layerOf(land, (x, y) => [
      plant(32, 8, 8, { dx: (x % 2) * 0.1, dy: -(y % 2) * 0.1 }),
    ]);
    for (let y = 0.2; y < 5; y += 0.4) {
      for (let x = 0.2; x < 8; x += 0.4) expect(layer.blocked(x, y, 0.2)).toBe(false);
    }
  });

  it("counts only the plants built so far: an animal far off walks as on open ground", () => {
    const lazy = new PlantLayer(land, (_look, x, y) => tree(x, y), { tall: 2 });
    const middle = 3 - 0.15 * 0.6;
    expect(lazy.blocked(3.5, middle, 0)).toBe(false);
    lazy.cull({ x0: 0, y0: 0, x1: 8, y1: 5 });
    expect(lazy.blocked(3.5, middle, 0)).toBe(true);
  });
});

describe("the crowns that drop leaves (PlantLayer.crownAt)", () => {
  const land = landOf(["gggggggg", "gggggggg", "gggggggg", "gggggggg"]);
  const crown: Crown = { half: 0.4, bottom: 0.9, top: 1.8, colours: [1, 2, 3], x: 0, y: 0 };

  it("gives the crown of a broadleaf by the cell its foot is on, with where its foot is", () => {
    const layer = layerOf(land, (x, y) =>
      x === 5 && y === 1 ? [plant(32, 32, 64, { crown, dx: 0.2, dy: -0.4 })] : [],
    );
    const found = layer.crownAt(5.9, 1.1);
    expect(found).toBeDefined();
    expect(found?.half).toBe(0.4);
    expect(found?.colours).toEqual([1, 2, 3]);
    expect(found?.x).toBeCloseTo(5.7, 1);
    expect(found?.y).toBeCloseTo(1.6, 1);
    expect(layer.crownAt(4.5, 1.5)).toBeUndefined();
    expect(layer.crownAt(5.5, 2.5)).toBeUndefined();
  });

  it("gives the crown of a foot on a cell's lower edge to that cell", () => {
    const layer = layerOf(land, (x, y) =>
      x === 2 && y === 1 ? [plant(32, 32, 64, { crown })] : [],
    );
    expect(layer.crownAt(2.5, 1.5)).toBeDefined();
    expect(layer.crownAt(2.5, 2.5)).toBeUndefined();
  });

  it("has none off the land", () => {
    const layer = layerOf(land, () => [plant(32, 32, 64, { crown })]);
    expect(layer.crownAt(-0.5, 1)).toBeUndefined();
    expect(layer.crownAt(3, -0.5)).toBeUndefined();
    expect(layer.crownAt(8, 1)).toBeUndefined();
    expect(layer.crownAt(3, 4)).toBeUndefined();
  });
});

describe("depth among the plants", () => {
  const land = landOf(["gggggggg", "gggggggg", "gggggggg", "gggggggg"]);

  it("puts a plant in the row of its foot, before that row's creatures", () => {
    const layer = layerOf(
      land,
      (x, y) => (x === 2 && y === 1 ? [plant(32, 16, 16, { dy: -0.3 })] : []),
      4,
    );
    const [sprite] = spritesOf(layer);
    if (sprite === undefined) throw new Error("no plant");
    // Its foot is at y = 1.7: the third row of the second cell, four rows to the cell.
    const row = layer.guests[Math.ceil(1.7 * 4) - 1]?.parent;
    expect(sprite.parent?.parent).toBe(row);
    const order = row?.children ?? [];
    expect(order.indexOf(sprite.parent as never)).toBeLessThan(
      order.indexOf(layer.guests[6] as never),
    );
    // And rows are drawn top to bottom: the plants of a row in front cover the creatures behind.
    // (The rows are kept in bands, each its own render group: read them in drawing order.)
    const rows = layer.container.children.flatMap((band) => band.children);
    expect(rows.indexOf(row as never)).toBeGreaterThan(
      rows.indexOf(layer.guests[5]?.parent as never),
    );
  });

  it("finds the tree or bush over an animal, but not the grass (PlantLayer.over)", () => {
    const layer = layerOf(
      land,
      (x, y) => {
        if (x === 2 && y === 1) return [plant(32, 32, 64, { footprint: { rx: 0.2, ry: 0.1 } })];
        if (x === 6 && y === 1) return [plant(32, 32, 32)];
        return [];
      },
      4,
    );
    // The tree's drawing covers x 2–3, y 0–2; its foot is in row 7.
    expect(layer.over({ x0: 2.2, y0: 1, x1: 2.8, y1: 1.5 }, 5, 6)).toBe(7);
    // The grass does not count, nor a box beside the tree.
    expect(layer.over({ x0: 6.2, y0: 1.2, x1: 6.8, y1: 1.8 }, 5, 6)).toBe(-1);
    expect(layer.over({ x0: 4.2, y0: 1.2, x1: 4.8, y1: 1.8 }, 5, 6)).toBe(-1);
  });

  it("covers an animal with a piece of a bush only where the animal is behind its foot", () => {
    const layer = layerOf(
      land,
      (x, y) =>
        x === 3 && y === 1
          ? [plant(32, 16, 16, { piece: true, footprint: { rx: 0.2, ry: 0.1, raise: 1 } })]
          : [],
      4,
    );
    // The piece spans x 3.25–3.75, y 1.5–2, standing on y = 2.
    const box = { x0: 3.3, y0: 1.6, x1: 3.7, y1: 2.3 };
    expect(layer.over(box, 6, 9)).toBe(7);
    expect(layer.over(box, 6, 9, [{ x: 3.5, y: 1.8 }], [0.1])).toBe(7);
    expect(layer.over(box, 6, 9, [{ x: 3.5, y: 2.2 }], [0.1])).toBe(-1);
  });
});

describe("plants in the wind (PlantLayer.blow)", () => {
  const land = landOf(["gggggggg", "gggggggg", "gggggggg", "gggggggg"]);
  /** The lean the wind gives a plant rocking as one at (x, y), `tile` pixels to the cell. */
  const leanAt = (
    x: number,
    y: number,
    tile: number,
    wind: { timeS: number; strength: number },
    reach: number,
  ): number =>
    Math.round(
      wind.strength *
        reach *
        gustAt(
          x,
          y,
          wind.timeS,
          ROCK_JITTER * cellHash(Math.round(x * tile), Math.round(y * tile), 977),
        ),
    );

  it("swaps a leaning plant's drawing for the lean the wind gives it where it stands", () => {
    const frames = [-1, 0, 1, 2, 3].map(() => drawing(10, 20));
    const layer = layerOf(land, (x, y) =>
      x === 3 && y === 2
        ? [
            {
              ...plant(32, 10, 20),
              texture: frames[1] ?? drawing(1, 1),
              sway: { frames, lowest: -1, reach: 2, added: 4 },
            },
          ]
        : [],
    );
    const [sprite] = spritesOf(layer);
    if (sprite === undefined) throw new Error("no plant");
    const seen = new Set<number>();
    for (let t = 0; t < 60; t += 0.37) {
      const wind = { timeS: t, strength: 1.5 };
      layer.blow(wind);
      const lean = Math.min(Math.max(leanAt(sprite.x, sprite.y, 32, wind, 2), -1), 3);
      expect(sprite.texture).toBe(frames[lean + 1]);
      seen.add(lean);
    }
    expect(seen.size).toBeGreaterThan(1);
    // Without wind it stands straight.
    layer.blow(null);
    expect(sprite.texture).toBe(frames[1]);
  });

  it("slides a piece of a bush sideways by whole art pixels with its bush's gust", () => {
    const tile = 32;
    const layer = layerOf(land, (x, y) =>
      x === 3 && y === 2
        ? [
            plant(tile, 12, 10, {
              piece: true,
              footprint: { rx: 0.1, ry: 0.05 },
              slide: { lowest: -1, highest: 2, reach: 1.5, dx: 0.25, dy: 0.125 },
            }),
          ]
        : [],
    );
    const [sprite] = spritesOf(layer);
    if (sprite === undefined) throw new Error("no plant");
    const still = sprite.x;
    const foot = sprite.y;
    const seen = new Set<number>();
    for (let t = 0; t < 60; t += 0.37) {
      const wind = { timeS: t, strength: 3 };
      layer.blow(wind);
      const lean = Math.round((sprite.x - still) * tile * 1e6) / 1e6;
      expect(Number.isInteger(lean)).toBe(true);
      // The lean of the gust at its bush's foot, not at the piece's own, within its range.
      const expected = Math.min(
        Math.max(leanAt(still + 0.25, foot + 0.125, tile, wind, 1.5), -1),
        2,
      );
      expect(lean + 0).toBe(expected + 0);
      seen.add(lean);
    }
    expect(seen.size).toBeGreaterThan(1);
    // The piece keeps its one drawing, and its foot's row.
    expect(sprite.y).toBe(foot);
    layer.blow(null);
    expect(sprite.x).toBe(still);
  });

  it("leaves still what does not bend", () => {
    const layer = layerOf(land, (x, y) => (x === 3 && y === 2 ? [plant(32, 8, 8)] : []));
    const [sprite] = spritesOf(layer);
    if (sprite === undefined) throw new Error("no plant");
    const { x } = sprite;
    const texture = sprite.texture;
    layer.blow({ timeS: 3, strength: 3.4 });
    expect(sprite.x).toBe(x);
    expect(sprite.texture).toBe(texture);
  });
});

describe("the island's trees and bushes (standingPlants)", () => {
  const rows = (letter: string): string[] => Array.from({ length: 16 }, () => letter.repeat(16));
  const island = { x0: 0, y0: 0, x1: 16, y1: 16 };
  /** Every crown built on the land. */
  function crowns(layer: PlantLayer): Crown[] {
    const out: Crown[] = [];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const crown = layer.crownAt(x + 0.5, y + 0.5);
        if (crown !== undefined) out.push(crown);
      }
    }
    return out;
  }
  const local = (land: Land, pieces = false): PlantLayer => {
    const layer = standingPlants(land, 32, { close: true, pieces });
    layer.cull(island);
    return layer;
  };

  it("marks the crowns of broadleaves in autumn, in the colours they turn", () => {
    const found = crowns(local(landOf(rows("b"), "autumn")));
    expect(found.length).toBeGreaterThan(10);
    for (const crown of found) {
      expect(crown.half).toBeGreaterThan(0);
      expect(crown.bottom).toBeGreaterThan(0);
      expect(crown.top).toBeGreaterThan(crown.bottom);
      expect(crown.colours).toHaveLength(3);
      // Where its foot is, on the cell it was asked for by.
      expect(crown.x).toBeGreaterThan(0);
      expect(crown.y).toBeGreaterThan(0);
    }
  });

  it("marks none in summer, none on conifers, none on broadleaves that keep their leaves", () => {
    expect(crowns(local(landOf(rows("b"), "summer")))).toHaveLength(0);
    expect(crowns(local(landOf(rows("c"), "autumn")))).toHaveLength(0);
    const evergreen: Land = {
      ...landOf(rows("b"), "autumn"),
      plantEvergreen: new Uint8Array(256).fill(100),
    };
    expect(crowns(local(evergreen))).toHaveLength(0);
    const deciduous: Land = { ...evergreen, plantEvergreen: new Uint8Array(256).fill(20) };
    expect(crowns(local(deciduous)).length).toBeGreaterThan(0);
  });

  it("marks crowns in the middle view too", () => {
    const layer = standingPlants(landOf(rows("b"), "autumn"), 8);
    expect(crowns(layer).length).toBeGreaterThan(10);
  });

  it("keeps animals out of the trunks of a wood, not out of the whole wood", () => {
    const layer = local(landOf(rows("b")));
    let blocked = 0;
    let tried = 0;
    for (let y = 2.05; y < 14; y += 0.1) {
      for (let x = 2.05; x < 14; x += 0.1) {
        tried += 1;
        if (layer.blocked(x, y, 0)) blocked += 1;
      }
    }
    expect(blocked).toBeGreaterThan(0);
    expect(blocked).toBeLessThan(tried / 3);
  });

  it("keeps animals out of more of a scrub than of a wood: a bush's whole drawing", () => {
    const share = (letter: string): number => {
      const layer = local(landOf(rows(letter)));
      let blocked = 0;
      let tried = 0;
      for (let y = 2.05; y < 14; y += 0.1) {
        for (let x = 2.05; x < 14; x += 0.1) {
          tried += 1;
          if (layer.blocked(x, y, 0)) blocked += 1;
        }
      }
      return blocked / tried;
    };
    expect(share("s")).toBeGreaterThan(share("b"));
    expect(share("g")).toBe(0);
  });

  it("draws bushes in pieces when asked: more sprites, each piece its own footprint", () => {
    const land = landOf(rows("s"));
    const whole = local(land);
    const pieces = local(land, true);
    expect(pieces.count).toBeGreaterThan(whole.count);
    // The pieces block about where the whole bushes did.
    let both = 0;
    let either = 0;
    for (let y = 2.05; y < 14; y += 0.1) {
      for (let x = 2.05; x < 14; x += 0.1) {
        const a = whole.blocked(x, y, 0);
        const b = pieces.blocked(x, y, 0);
        if (a && b) both += 1;
        if (a || b) either += 1;
      }
    }
    expect(either).toBeGreaterThan(0);
    expect(both / either).toBeGreaterThan(0.4);
  });

  it("draws no bush in pieces in the middle view", () => {
    const land = landOf(rows("s"));
    const a = standingPlants(land, 8, { pieces: true });
    const b = standingPlants(land, 8);
    expect(a.count).toBe(b.count);
  });
});

describe("culling, row by row (review P3)", () => {
  it("leaves the rows and bands shown as a layer culled once at the last view would", () => {
    const land = landOf(Array<string>(40).fill("gggggggggggggggggggg"));
    const put = (): Placed[] => [plant(8, 8, 12)];
    const moved = layerOf(land, put, 4);
    // The camera wanders, up and down and back, by fractions of a cell and by jumps.
    const views = [
      { x0: 0, y0: 0, x1: 10, y1: 6 },
      { x0: 2, y0: 3.3, x1: 12, y1: 9.3 },
      { x0: 4, y0: 20.7, x1: 14, y1: 26.7 },
      { x0: 3, y0: 19.1, x1: 13, y1: 25.1 },
      { x0: 0, y0: 33, x1: 10, y1: 39 },
      { x0: 1, y0: 8.6, x1: 11, y1: 14.6 },
    ];
    for (const view of views) moved.cull(view);
    const fresh = layerOf(land, put, 4);
    const last = views.at(-1) ?? views[0];
    if (last === undefined) throw new Error("no view");
    expect(moved.cull(last)).toBe(fresh.cull(last));
    const shown = (layer: PlantLayer): boolean[] =>
      layer.container.children.flatMap((band) => [
        band.visible,
        ...band.children.map((row) => row.visible),
      ]);
    expect(shown(moved)).toEqual(shown(fresh));
  });
});
