/**
 * The plant layer. Plants are kept in rows, from the top of the map down, so that what
 * stands nearer covers what stands farther; each row also has a place for the creatures
 * on it, which puts an animal behind the trees in front of it. Rows are built a chunk
 * at a time, when the view first comes near, and chunks off screen are skipped.
 *
 * Three kinds of layer: a drawing in the middle of every vegetated cell (the spike's
 * first look, which the benchmark's first scenarios measure); for the middle view, only
 * the plants that stand alone on a ground that is itself painted with what grows low;
 * and for the local view the same plants in the same places drawn large, in one of the
 * styles to choose from, with the grass as tufts to walk through and among them what
 * only shows from close: flowers in drifts, ferns and mushrooms under trees, herbs,
 * reeds by the shore, stones, boulders, logs, and stumps where it burnt. The local
 * view's plants carry no shadow: the layer lists them, for the ground to paint.
 */
import { CanvasSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Atlas } from "./atlas";
import type { CellRect } from "./camera";
import type { Ramp, WorldFixture } from "./fixture";
import { valueNoise, type Shadow } from "./ground";
import {
  SPRITE_WIDTH,
  cellHash,
  lookKey,
  plantLook,
  plantOffset,
  standsAlone,
  type PlantLook,
} from "./pixelart";
import {
  CAP_COLOURS,
  FLOWER_COLOURS,
  MOSS_COLOUR,
  SMALL_SIZES,
  STANDING_VARIANTS,
  colourArt,
  drawSmall,
  drawStanding,
  type PlantArt,
  type PlantScale,
  type Small,
  type TreeStyle,
} from "./plantart";
import { mulberry32 } from "./rng";

/** Cells per chunk of a row; whole chunks are built, and skipped, together. */
const CHUNK_CELLS = 16;
/** A plant may stand this far (cells) outside its own cell. */
const REACH_CELLS = 1;
/** A plant in front of the animal the camera is on shows it through; small ones need not. */
const FADED = 0.3;
const FADES_FROM_CELLS = 0.9;

interface Placed {
  texture: Texture;
  /** Where the plant stands, as a share of the texture's width and height. */
  anchorX: number;
  anchorY: number;
  /** Cells per texel. */
  scale: number;
  /** Offset of the foot from the middle of the cell's lower edge, in cells. */
  dx: number;
  dy: number;
  /** The shadow it throws at its foot, as half its width and height in cells, if any. */
  shadow?: { rx: number; ry: number };
}

interface Row {
  container: Container;
  /** The plants of this row, by the first column of their chunk. */
  chunks: Map<number, Container>;
  /** The creatures standing on this row, drawn over its plants. */
  guests: Container;
}

export interface PlantLayerOptions {
  /** Height in cells of the tallest plant: how far below the view a row can still show. */
  tall: number;
  /** Rows to the cell: more where plants and animals are large enough to sort finely. */
  rowsPerCell?: number;
  /** Build every chunk at once instead of as the view reaches it. */
  eager?: boolean;
}

export class PlantLayer {
  /** Add this to the world. */
  readonly container = new Container();
  /** Where the creatures of each row go, top row first; `rowsPerCell` rows to the cell. */
  readonly guests: readonly Container[];
  readonly rowsPerCell: number;
  private readonly rows: Row[] = [];
  private readonly built = new Set<number>();
  private readonly tall: number;
  private sprites = 0;
  private faded: Sprite[] = [];

  /** `place` says what stands on a cell (whose plant, if any, is `look`). */
  constructor(
    private readonly fixture: WorldFixture,
    private readonly place: (look: PlantLook | null, x: number, y: number) => Placed[],
    options: PlantLayerOptions,
  ) {
    this.tall = options.tall;
    this.rowsPerCell = options.rowsPerCell ?? 1;
    for (let row = 0; row < fixture.height * this.rowsPerCell; row++) {
      const made: Row = { container: new Container(), chunks: new Map(), guests: new Container() };
      made.container.addChild(made.guests);
      this.rows.push(made);
      this.container.addChild(made.container);
    }
    this.guests = this.rows.map((row) => row.guests);
    if (options.eager === true) {
      this.cull({ x0: 0, y0: 0, x1: fixture.width, y1: fixture.height });
    }
  }

  /** Number of plant sprites built so far: all of them for an eager layer. */
  get count(): number {
    return this.sprites;
  }

  /**
   * The shadows of what stands on `cells` or near enough to throw one onto them, for
   * the ground to paint. Whether or not the plants themselves are built yet.
   */
  shadows(cells: CellRect): Shadow[] {
    const { fixture } = this;
    const out: Shadow[] = [];
    const reach = Math.ceil(this.tall) + REACH_CELLS;
    for (
      let y = Math.max(cells.y0 - reach, 0);
      y < Math.min(cells.y1 + reach, fixture.height);
      y++
    ) {
      for (
        let x = Math.max(cells.x0 - reach, 0);
        x < Math.min(cells.x1 + reach, fixture.width);
        x++
      ) {
        for (const placed of this.place(this.lookAt(x, y), x, y)) {
          if (placed.shadow === undefined) continue;
          // A little to the right of the foot: the light comes from the upper left.
          out.push({
            x: x + 0.5 + placed.dx + placed.shadow.rx * 0.16,
            y: y + 1 + placed.dy - placed.shadow.ry * 0.1,
            rx: placed.shadow.rx,
            ry: placed.shadow.ry,
          });
        }
      }
    }
    return out;
  }

  private lookAt(x: number, y: number): PlantLook | null {
    const { fixture } = this;
    const index = y * fixture.width + x;
    return plantLook(
      fixture.coverClasses[fixture.cover[index] ?? 0] ?? "",
      fixture.biomass[index] ?? 0,
      x,
      y,
      fixture.dormantBelow,
      fixture.dormantClasses,
    );
  }

  /**
   * Build what the view needs and hide what is outside it. Returns the number of plant
   * sprites left to draw.
   */
  cull(view: CellRect): number {
    const { width, height } = this.fixture;
    const firstChunk = Math.max(Math.floor((view.x0 - REACH_CELLS) / CHUNK_CELLS), 0);
    const lastChunk = Math.min(
      Math.floor((view.x1 + REACH_CELLS) / CHUNK_CELLS),
      Math.ceil(width / CHUNK_CELLS) - 1,
    );
    // A plant shows from its foot up to its top, so rows below the view count too.
    const firstY = Math.max(Math.floor(view.y0) - 1 - REACH_CELLS, 0);
    const lastY = Math.min(Math.ceil(view.y1 + this.tall), height - 1);
    for (let y = firstY; y <= lastY; y++) {
      for (let chunk = firstChunk; chunk <= lastChunk; chunk++) this.build(y, chunk * CHUNK_CELLS);
    }
    let drawn = 0;
    this.rows.forEach((row, index) => {
      const top = index / this.rowsPerCell;
      const bottom = (index + 1) / this.rowsPerCell;
      const visible = bottom + REACH_CELLS >= view.y0 && top - this.tall <= view.y1;
      if (row.container.visible !== visible) row.container.visible = visible;
      if (!visible) return;
      for (const [x, chunk] of row.chunks) {
        const inside = x + CHUNK_CELLS + REACH_CELLS >= view.x0 && x - REACH_CELLS <= view.x1;
        if (chunk.visible !== inside) chunk.visible = inside;
        if (inside) drawn += chunk.children.length;
      }
    });
    return drawn;
  }

  /**
   * Let an animal show through what stands in front of it: plants whose drawing covers
   * `subject` (in cells) and whose foot is below it go see-through; the rest go back.
   */
  fade(subject: CellRect | null): void {
    for (const sprite of this.faded) sprite.alpha = 1;
    this.faded = [];
    if (subject === null) return;
    const first = Math.floor(subject.y1 * this.rowsPerCell);
    const last = Math.min(
      Math.ceil((subject.y1 + this.tall) * this.rowsPerCell),
      this.rows.length - 1,
    );
    for (let index = Math.max(first, 0); index <= last; index++) {
      for (const [x, chunk] of this.rows[index]?.chunks ?? []) {
        if (x + CHUNK_CELLS + REACH_CELLS < subject.x0 || x - REACH_CELLS > subject.x1) continue;
        for (const child of chunk.children) {
          const sprite = child as Sprite;
          const wide = sprite.texture.width * sprite.scale.x;
          const high = sprite.texture.height * sprite.scale.y;
          if (high < FADES_FROM_CELLS) continue;
          const left = sprite.x - sprite.anchor.x * wide;
          const top = sprite.y - sprite.anchor.y * high;
          if (left > subject.x1 || left + wide < subject.x0) continue;
          if (top > subject.y1 || sprite.y < subject.y1) continue;
          sprite.alpha = FADED;
          this.faded.push(sprite);
        }
      }
    }
  }

  /** Build the plants of the cells of row `y` from column `left` on, once. */
  private build(y: number, left: number): void {
    const key = y * 4096 + left;
    if (this.built.has(key)) return;
    this.built.add(key);
    const { fixture } = this;
    const right = Math.min(left + CHUNK_CELLS, fixture.width);
    for (let x = left; x < right; x++) {
      for (const placed of this.place(this.lookAt(x, y), x, y)) {
        const sprite = new Sprite({
          texture: placed.texture,
          anchor: { x: placed.anchorX, y: placed.anchorY },
        });
        sprite.scale.set(placed.scale);
        // The foot of a cell is the middle of its lower edge.
        const footY = y + 1 + placed.dy;
        sprite.position.set(x + 0.5 + placed.dx, footY);
        // The row its foot is in: the last row of a cell for a foot on the cell's edge.
        const at = Math.min(
          Math.max(Math.ceil(footY * this.rowsPerCell) - 1, 0),
          this.rows.length - 1,
        );
        const row = this.rows[at];
        if (row === undefined) continue;
        let chunk = row.chunks.get(left);
        if (chunk === undefined) {
          chunk = new Container();
          row.chunks.set(left, chunk);
          // Before the row's creatures, which are drawn over its plants.
          row.container.addChildAt(chunk, row.container.children.length - 1);
        }
        chunk.addChild(sprite);
        this.sprites += 1;
      }
    }
  }
}

/** A drawing in the middle of every vegetated cell, from the hand-drawn atlas. */
export function iconPlants(fixture: WorldFixture, atlas: Atlas): PlantLayer {
  return new PlantLayer(
    fixture,
    (look) => {
      if (look === null) return [];
      const texture = atlas.plants.get(lookKey(look));
      if (texture === undefined) throw new Error(`no texture for ${lookKey(look)}`);
      return [{ texture, anchorX: 0.5, anchorY: 1, scale: 1 / SPRITE_WIDTH, dx: 0, dy: 0 }];
    },
    { tall: 1.5, eager: true },
  );
}

interface Drawing {
  texture: Texture;
  art: PlantArt;
}

/** Draw `arts` side by side into one texture, a clear pixel between them. */
function strip(
  arts: readonly { key: string; art: PlantArt; ramp: Ramp; accent?: string; wood?: string }[],
) {
  const canvas = document.createElement("canvas");
  canvas.width = arts.reduce((sum, { art }) => sum + art.width + 1, 1);
  canvas.height = Math.max(...arts.map(({ art }) => art.height)) + 2;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the plants");
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const drawings = new Map<string, Drawing>();
  let left = 1;
  for (const { key, art, ramp, accent, wood } of arts) {
    const pixels = colourArt(art, ramp, accent, wood);
    context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), left, 1);
    const frame = new Rectangle(left, 1, art.width, art.height);
    drawings.set(key, { texture: new Texture({ source, frame }), art });
    left += art.width + 1;
  }
  source.update();
  return drawings;
}

const NO_RAMP: Ramp = ["#000000", "#000000", "#000000"];
const standingKey = (look: PlantLook, variant: number): string =>
  `${look.form}/${look.stage}/${variant}`;
/** A stump where it burnt is charred. */
const CHARRED = "#2e2622";
const FLOWERS = ["daisy", "bell", "spike", "umbel"] as const;
/** Land this little above the sea is shore: reeds grow there. */
const SHORE_BELOW = 0.012;
/** How often a cell carries each small thing, by what covers it. */
const CHANCE = {
  bare: { stone: 0.16, boulder: 0.04, herb: 0.06 },
  heights: { stone: 0.26, boulder: 0.14 },
  shore: { reed: 0.3, stone: 0.1 },
  lichen: { stone: 0.3, boulder: 0.1 },
  grass: { herb: 0.14, flower: 0.1, dry: 0.3 },
  scrub: { fern: 0.18, herb: 0.12, flower: 0.05 },
  wood: { mushroom: 0.16, fern: 0.25, log: 0.035, herb: 0.08 },
  pines: { mushroom: 0.2, fern: 0.1, log: 0.03, stone: 0.05 },
  burnt: { stump: 0.3, log: 0.08 },
} as const;
/** Flowers come in drifts: where this noise is high a cell of grown grass carries several. */
const DRIFT_FROM = 0.58;
const DRIFT_CELLS = 4;

/**
 * The plants that stand alone, drawn by rule at `scale`, with `tile` art pixels to the
 * cell. The bigger the plants, the fewer cells of a wood carry one. With `close` (a
 * style of tree) it is the local view: the same trees and bushes in that style, the
 * grass as tufts in every cell that grows it, and the small things of each kind of
 * ground.
 */
export function standingPlants(
  fixture: WorldFixture,
  scale: PlantScale,
  tile: number,
  close: TreeStyle | null = null,
): PlantLayer {
  const detail = tile / SPRITE_WIDTH;
  const arts: { key: string; art: PlantArt; ramp: Ramp; accent?: string; wood?: string }[] = [];
  const ramp = (name: string): Ramp => fixture.palette[name] ?? NO_RAMP;
  for (const form of ["GRASS", "SHRUB", "BROADLEAF", "CONIFER"] as const) {
    for (const stage of ["young", "mature"] as const) {
      for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
        arts.push({
          key: standingKey({ form, stage, variant, dormant: false }, variant),
          art: drawStanding(form, stage, variant, scale, detail, close ?? "first"),
          ramp: ramp(form),
        });
      }
    }
  }
  if (close !== null) {
    const small = (
      kind: Small,
      variant: number,
      colours: Ramp,
      accent?: string,
      wood?: string,
      key = `${kind}/${variant}`,
    ): void => {
      const [width, height] = SMALL_SIZES[kind];
      const art = drawSmall(
        kind,
        [width * detail, height * detail],
        mulberry32(31 + variant),
        variant,
      );
      arts.push({
        key,
        art,
        ramp: colours,
        ...(accent === undefined ? {} : { accent }),
        ...(wood === undefined ? {} : { wood }),
      });
    };
    for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
      // Grass that has dried: the same tufts in the dry colours.
      arts.push({
        key: `dry/${variant}`,
        art: drawStanding("GRASS", "mature", variant, scale, detail),
        ramp: ramp("DORMANT"),
      });
      small("stone", 2 * variant, fixture.relief.highRock);
      small("stone", 2 * variant + 1, fixture.relief.highRock, ramp("LICHEN")[2]);
      small("mushroom", variant, ramp("BARE"), CAP_COLOURS[variant % CAP_COLOURS.length]);
    }
    FLOWERS.forEach((kind) => {
      FLOWER_COLOURS.forEach((accent, colour) => {
        small(kind, colour, ramp("GRASS"), accent, undefined, `${kind}/${colour}`);
      });
    });
    for (let variant = 0; variant < 2; variant++) {
      small("fern", variant, ramp("SHRUB"));
      small("herb", variant, ramp("GRASS"));
      small("reed", variant, ramp("DORMANT"));
      small("boulder", 2 * variant, fixture.relief.highRock);
      small(
        "boulder",
        2 * variant + 1,
        fixture.relief.highRock,
        variant === 0 ? MOSS_COLOUR : ramp("LICHEN")[2],
      );
      small("log", variant, ramp("BARE"), MOSS_COLOUR);
    }
    small("stump", 0, ramp("BARE"));
    small("stump", 1, ramp("BURNT"), undefined, CHARRED);
  }
  const drawings = strip(arts);
  const placed = (key: string, dx: number, dy: number): Placed[] => {
    const drawing = drawings.get(key);
    if (drawing === undefined) return [];
    const { art } = drawing;
    return [
      {
        texture: drawing.texture,
        anchorX: art.footX / art.width,
        anchorY: art.footY / art.height,
        scale: 1 / tile,
        dx,
        dy,
        ...(art.shadow === undefined
          ? {}
          : { shadow: { rx: art.shadow.rx / tile, ry: art.shadow.ry / tile } }),
      },
    ];
  };
  const variantOf = (x: number, y: number, salt: number, of = STANDING_VARIANTS): number =>
    Math.floor(cellHash(x, y, salt) * of);
  /** A place inside the cell, different for each `salt`: offsets from the foot of the cell. */
  const within = (x: number, y: number, salt: number): [number, number] => [
    cellHash(x, y, salt) - 0.5,
    -cellHash(x, y, salt + 1),
  ];
  const burntClass = fixture.coverClasses.indexOf("BURNT");

  /** The small things of the local view on cell (x, y), whose plant is `look`. */
  const among = (look: PlantLook | null, x: number, y: number): Placed[] => {
    const out: Placed[] = [];
    let salt = 100;
    /** One of `kind` somewhere on the cell, with `chance`; `variants` drawings to pick from. */
    const maybe = (kind: string, chance: number, variants: number): void => {
      salt += 4;
      if (cellHash(x, y, salt) >= chance) return;
      out.push(
        ...placed(`${kind}/${variantOf(x, y, salt + 1, variants)}`, ...within(x, y, salt + 2)),
      );
    };
    const cell = y * fixture.width + x;
    const above = (fixture.heights[cell] ?? 0) - fixture.seaLevel;
    if (look === null) {
      if (above <= 0) return out;
      if (fixture.cover[cell] === burntClass) {
        maybe("stump", CHANCE.burnt.stump, 2);
        maybe("log", CHANCE.burnt.log, 2);
      } else if (above < SHORE_BELOW) {
        maybe("reed", CHANCE.shore.reed, 2);
        maybe("reed", CHANCE.shore.reed, 2);
        maybe("stone", CHANCE.shore.stone, 6);
      } else if (above >= fixture.relief.highRockFrom) {
        maybe("stone", CHANCE.heights.stone, 6);
        maybe("boulder", CHANCE.heights.boulder, 4);
      } else {
        maybe("stone", CHANCE.bare.stone, 6);
        maybe("boulder", CHANCE.bare.boulder, 4);
        maybe("herb", CHANCE.bare.herb, 2);
      }
      return out;
    }
    if (look.form === "LICHEN") {
      maybe("stone", CHANCE.lichen.stone, 6);
      maybe("boulder", CHANCE.lichen.boulder, 4);
    } else if (look.form === "GRASS") {
      if (look.dormant) {
        maybe("dry", CHANCE.grass.dry, STANDING_VARIANTS);
        return out;
      }
      // Every cell of grass is tufts to walk through: more where it grows thick.
      const biomass = fixture.biomass[cell] ?? 0;
      const tufts = look.stage === "mature" ? 2 + Math.floor((biomass - 128) / 64) : 1;
      for (let k = 0; k < tufts; k++) {
        const key = standingKey(look, variantOf(x, y, 50 + 3 * k));
        out.push(...placed(key, ...within(x, y, 51 + 3 * k)));
      }
      maybe("herb", CHANCE.grass.herb, 2);
      if (look.stage !== "mature") return out;
      // One kind and colour of flower over several cells, thick in places and rare between.
      const kind = FLOWERS[Math.floor(valueNoise(x / 6, y / 6, 71) * FLOWERS.length)] ?? "daisy";
      const colour = Math.floor(valueNoise(x / 7, y / 7, 72) * FLOWER_COLOURS.length);
      const drift = valueNoise(x / DRIFT_CELLS, y / DRIFT_CELLS, 73);
      const flowers = drift >= DRIFT_FROM ? 2 + variantOf(x, y, 74, 3) : 0;
      for (let k = 0; k < flowers; k++) {
        out.push(...placed(`${kind}/${colour}`, ...within(x, y, 75 + 2 * k)));
      }
      if (flowers === 0 && cellHash(x, y, 81) < CHANCE.grass.flower) {
        out.push(...placed(`${kind}/${colour}`, ...within(x, y, 82)));
      }
    } else if (look.form === "SHRUB") {
      maybe("fern", CHANCE.scrub.fern, 2);
      maybe("herb", CHANCE.scrub.herb, 2);
      if (cellHash(x, y, 83) < CHANCE.scrub.flower) {
        out.push(
          ...placed(`daisy/${variantOf(x, y, 84, FLOWER_COLOURS.length)}`, ...within(x, y, 85)),
        );
      }
    } else if (look.form === "BROADLEAF") {
      maybe("mushroom", CHANCE.wood.mushroom, STANDING_VARIANTS);
      maybe("fern", CHANCE.wood.fern, 2);
      maybe("log", CHANCE.wood.log, 2);
      maybe("herb", CHANCE.wood.herb, 2);
    } else {
      maybe("mushroom", CHANCE.pines.mushroom, STANDING_VARIANTS);
      maybe("fern", CHANCE.pines.fern, 2);
      maybe("log", CHANCE.pines.log, 2);
      maybe("stone", CHANCE.pines.stone, 6);
    }
    return out;
  };

  const tall = Math.max(...arts.map(({ art }) => art.height)) / tile;
  return new PlantLayer(
    fixture,
    (look, x, y) => {
      const out = close === null ? [] : among(look, x, y);
      if (look === null || !standsAlone(look, x, y)) return out;
      // Close up the grass is the tufts above, not one in three cells.
      if (close !== null && look.form === "GRASS") return out;
      const density =
        look.form === "SHRUB" ? scale.bushDensity : look.form === "GRASS" ? 1 : scale.treeDensity;
      if (cellHash(x, y, 16) >= density) return out;
      const [dx, dy] = plantOffset(x, y);
      const key = standingKey(look, variantOf(x, y, 17));
      return [...out, ...placed(key, dx / SPRITE_WIDTH, dy / SPRITE_WIDTH)];
    },
    // Close up, plants and animals are large enough to be sorted four rows to the cell.
    close !== null ? { tall, rowsPerCell: 4 } : { tall, eager: true },
  );
}

/** One of a line-up: a grown tree or bush, in one of its drawings, `at` cells along the row. */
export interface LineUpItem {
  form: "BROADLEAF" | "CONIFER" | "SHRUB";
  variant: number;
  at: number;
}

/**
 * Grown trees and bushes standing in a row, to judge sizes against: drawn as the local
 * view draws them in `style`, each with its foot on row `y` of the world (in cells, as
 * `x` is: where the row starts). Nothing else of the world's plants is in the layer.
 */
export function plantLineUp(
  fixture: WorldFixture,
  scale: PlantScale,
  tile: number,
  style: TreeStyle,
  x: number,
  y: number,
  items: readonly LineUpItem[],
): PlantLayer {
  const detail = tile / SPRITE_WIDTH;
  const drawings = strip(
    items.map((item, index) => ({
      key: String(index),
      art: drawStanding(item.form, "mature", item.variant, scale, detail, style),
      ramp: fixture.palette[item.form] ?? NO_RAMP,
    })),
  );
  let tall = 0;
  for (const { art } of drawings.values()) tall = Math.max(tall, art.height / tile);
  return new PlantLayer(
    fixture,
    (_look, cellX, cellY) => {
      const out: Placed[] = [];
      items.forEach((item, index) => {
        const drawing = drawings.get(String(index));
        // The cell its foot is in: a foot on a cell's lower edge belongs to that cell.
        if (
          drawing === undefined ||
          Math.floor(x + item.at) !== cellX ||
          Math.ceil(y) - 1 !== cellY
        )
          return;
        const { art } = drawing;
        out.push({
          texture: drawing.texture,
          anchorX: art.footX / art.width,
          anchorY: art.footY / art.height,
          scale: 1 / tile,
          dx: x + item.at - (cellX + 0.5),
          dy: y - (cellY + 1),
          ...(art.shadow === undefined
            ? {}
            : { shadow: { rx: art.shadow.rx / tile, ry: art.shadow.ry / tile } }),
        });
      });
      return out;
    },
    { tall, rowsPerCell: 4 },
  );
}
