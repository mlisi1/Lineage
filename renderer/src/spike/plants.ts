/**
 * The plant layer. Plants are kept in rows, from the top of the map down, so that what
 * stands nearer covers what stands farther; each row also has a place for the creatures
 * on it, which puts an animal behind the trees in front of it. Rows are built a chunk
 * at a time, when the view first comes near, and chunks off screen are skipped.
 *
 * Three kinds of layer: a drawing in the middle of every vegetated cell (the spike's
 * first look, which the benchmark's first scenarios measure); for the middle view, only
 * the plants that stand alone on a ground that is itself painted with what grows low;
 * and for the local view the same plants in the same places drawn large, with the grass
 * as tufts to walk through, flowers and stones.
 */
import { CanvasSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Atlas } from "./atlas";
import type { CellRect } from "./camera";
import type { Ramp, WorldFixture } from "./fixture";
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
  FLOWER,
  FLOWER_COLOURS,
  STANDING_VARIANTS,
  STONE,
  colourArt,
  drawFlower,
  drawStanding,
  drawStone,
  type PlantArt,
  type PlantScale,
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
      const index = y * fixture.width + x;
      const look = plantLook(
        fixture.coverClasses[fixture.cover[index] ?? 0] ?? "",
        fixture.biomass[index] ?? 0,
        x,
        y,
        fixture.dormantBelow,
        fixture.dormantClasses,
      );
      for (const placed of this.place(look, x, y)) {
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
function strip(arts: readonly { key: string; art: PlantArt; ramp: Ramp; accent?: string }[]) {
  const canvas = document.createElement("canvas");
  canvas.width = arts.reduce((sum, { art }) => sum + art.width + 1, 1);
  canvas.height = Math.max(...arts.map(({ art }) => art.height)) + 2;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the plants");
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const drawings = new Map<string, Drawing>();
  let left = 1;
  for (const { key, art, ramp, accent } of arts) {
    const pixels = colourArt(art, ramp, accent);
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

/**
 * The plants that stand alone, drawn by rule at `scale`, with `tile` art pixels to the
 * cell. The bigger the plants, the fewer cells of a wood carry one. `close` is the local
 * view: the same trees and bushes, and with them the grass as tufts in every cell that
 * grows it, flowers among the grown grass and stones on bare ground.
 */
export function standingPlants(
  fixture: WorldFixture,
  scale: PlantScale,
  tile: number,
  close = false,
): PlantLayer {
  const detail = tile / SPRITE_WIDTH;
  const arts: { key: string; art: PlantArt; ramp: Ramp; accent?: string }[] = [];
  for (const form of ["GRASS", "SHRUB", "BROADLEAF", "CONIFER"] as const) {
    for (const stage of ["young", "mature"] as const) {
      for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
        arts.push({
          key: standingKey({ form, stage, variant, dormant: false }, variant),
          art: drawStanding(form, stage, variant, scale, detail),
          ramp: fixture.palette[form] ?? NO_RAMP,
        });
      }
    }
  }
  if (close) {
    const sized = (size: readonly [number, number]): [number, number] => [
      Math.round(size[0] * detail),
      Math.round(size[1] * detail),
    ];
    FLOWER_COLOURS.forEach((accent, variant) => {
      arts.push({
        key: `flower/${variant}`,
        art: drawFlower(sized(FLOWER), mulberry32(31 + variant)),
        ramp: fixture.palette["GRASS"] ?? NO_RAMP,
        accent,
      });
    });
    for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
      arts.push({
        key: `stone/${variant}`,
        art: drawStone(sized(STONE), mulberry32(41 + variant)),
        ramp: fixture.relief.highRock,
      });
    }
  }
  const drawings = strip(arts);
  const placed = (key: string, dx: number, dy: number): Placed[] => {
    const drawing = drawings.get(key);
    if (drawing === undefined) return [];
    return [
      {
        texture: drawing.texture,
        anchorX: drawing.art.footX / drawing.art.width,
        anchorY: drawing.art.footY / drawing.art.height,
        scale: 1 / tile,
        dx,
        dy,
      },
    ];
  };
  const variantOf = (x: number, y: number, salt: number): number =>
    Math.floor(cellHash(x, y, salt) * STANDING_VARIANTS);
  /** A place inside the cell, different for each `salt`: offsets from the foot of the cell. */
  const within = (x: number, y: number, salt: number): [number, number] => [
    cellHash(x, y, salt) - 0.5,
    -cellHash(x, y, salt + 1),
  ];

  const tall = Math.max(...arts.map(({ art }) => art.height)) / tile;
  return new PlantLayer(
    fixture,
    (look, x, y) => {
      const out: Placed[] = [];
      if (look === null) {
        // Bare ground: a stone here and there, close up.
        const land = (fixture.heights[y * fixture.width + x] ?? 0) > fixture.seaLevel;
        if (close && land && cellHash(x, y, 40) < 0.16) {
          out.push(...placed(`stone/${variantOf(x, y, 41)}`, ...within(x, y, 42)));
        }
        return out;
      }
      if (look.form === "GRASS" && close && !look.dormant) {
        // Every cell of grass is tufts to walk through: more where it grows thick.
        const biomass = fixture.biomass[y * fixture.width + x] ?? 0;
        const tufts = look.stage === "mature" ? 2 + Math.floor((biomass - 128) / 64) : 1;
        for (let k = 0; k < tufts; k++) {
          const key = standingKey(look, variantOf(x, y, 50 + 3 * k));
          out.push(...placed(key, ...within(x, y, 51 + 3 * k)));
        }
        if (look.stage === "mature" && cellHash(x, y, 60) < 0.22) {
          out.push(...placed(`flower/${variantOf(x, y, 61)}`, ...within(x, y, 62)));
        }
        return out;
      }
      if (!standsAlone(look, x, y)) return out;
      const density =
        look.form === "SHRUB" ? scale.bushDensity : look.form === "GRASS" ? 1 : scale.treeDensity;
      if (cellHash(x, y, 16) >= density) return out;
      const [dx, dy] = plantOffset(x, y);
      const key = standingKey(look, variantOf(x, y, 17));
      return placed(key, dx / SPRITE_WIDTH, dy / SPRITE_WIDTH);
    },
    // Close up, plants and animals are large enough to be sorted four rows to the cell.
    close ? { tall, rowsPerCell: 4 } : { tall, eager: true },
  );
}
