/**
 * The plant layer. Plants are kept row by row, from the top of the map down, so that
 * what stands nearer covers what stands farther; each row also has a place for the
 * creatures on it, which puts an animal behind the trees in front of it. Within a row,
 * chunks that are off screen are skipped.
 *
 * Two kinds of layer: a drawing in the middle of every vegetated cell (the spike's first
 * look, which the benchmark's first scenarios measure), or only the plants that stand
 * alone, each a little off the middle of its cell, for a ground that is itself painted
 * with what grows low.
 */
import { CanvasSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import type { Atlas } from "./atlas";
import type { CellRect } from "./camera";
import type { WorldFixture } from "./fixture";
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
  STANDING_VARIANTS,
  colourArt,
  drawStanding,
  type PlantArt,
  type PlantScale,
} from "./plantart";

/** Cells per chunk of a row; whole chunks are skipped when off screen. */
const CHUNK_CELLS = 16;
/** A plant may stand this far (cells) outside its own cell. */
const REACH_CELLS = 1;

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

interface Chunk {
  container: Container;
  x: number;
  sprites: number;
}

interface Row {
  container: Container;
  chunks: Chunk[];
  /** The creatures standing on this row, drawn over its plants. */
  guests: Container;
}

export class PlantLayer {
  /** Add this to the world. */
  readonly container = new Container();
  /** Number of plant sprites in the world. */
  readonly count: number;
  /** Where the creatures of each row of cells go, top row first. */
  readonly guests: readonly Container[];
  private readonly rows: Row[] = [];

  /**
   * `place` says what stands on a cell, if anything; `tall` is the height in cells of
   * the tallest plant, which decides how far below the view a row can still show.
   */
  constructor(
    fixture: WorldFixture,
    place: (look: PlantLook, x: number, y: number) => Placed | null,
    private readonly tall: number,
  ) {
    let count = 0;
    for (let y = 0; y < fixture.height; y++) {
      const row: Row = { container: new Container(), chunks: [], guests: new Container() };
      for (let chunkX = 0; chunkX < fixture.width; chunkX += CHUNK_CELLS) {
        const container = new Container();
        const end = Math.min(chunkX + CHUNK_CELLS, fixture.width);
        for (let x = chunkX; x < end; x++) {
          const index = y * fixture.width + x;
          const look = plantLook(
            fixture.coverClasses[fixture.cover[index] ?? 0] ?? "",
            fixture.biomass[index] ?? 0,
            x,
            y,
            fixture.dormantBelow,
            fixture.dormantClasses,
          );
          const placed = look === null ? null : place(look, x, y);
          if (placed === null) continue;
          const sprite = new Sprite({
            texture: placed.texture,
            anchor: { x: placed.anchorX, y: placed.anchorY },
          });
          sprite.scale.set(placed.scale);
          // The foot of a cell is the middle of its lower edge.
          sprite.position.set(x + 0.5 + placed.dx, y + 1 + placed.dy);
          container.addChild(sprite);
        }
        if (container.children.length === 0) continue;
        count += container.children.length;
        row.chunks.push({ container, x: chunkX, sprites: container.children.length });
        row.container.addChild(container);
      }
      row.container.addChild(row.guests);
      this.rows.push(row);
      this.container.addChild(row.container);
    }
    this.count = count;
    this.guests = this.rows.map((row) => row.guests);
  }

  /** Hide what is outside the view. Returns the number of plant sprites left to draw. */
  cull(view: CellRect): number {
    let drawn = 0;
    this.rows.forEach((row, y) => {
      // A row shows from its plants' feet (just below it) up to their tops.
      const visible = y + 1 + REACH_CELLS >= view.y0 && y + 1 - this.tall <= view.y1;
      if (row.container.visible !== visible) row.container.visible = visible;
      if (!visible) return;
      for (const chunk of row.chunks) {
        const inside =
          chunk.x + CHUNK_CELLS + REACH_CELLS >= view.x0 && chunk.x - REACH_CELLS <= view.x1;
        if (chunk.container.visible !== inside) chunk.container.visible = inside;
        if (inside) drawn += chunk.sprites;
      }
    });
    return drawn;
  }
}

/** A drawing in the middle of every vegetated cell, from the hand-drawn atlas. */
export function iconPlants(fixture: WorldFixture, atlas: Atlas): PlantLayer {
  return new PlantLayer(
    fixture,
    (look) => {
      const texture = atlas.plants.get(lookKey(look));
      if (texture === undefined) throw new Error(`no texture for ${lookKey(look)}`);
      return { texture, anchorX: 0.5, anchorY: 1, scale: 1 / SPRITE_WIDTH, dx: 0, dy: 0 };
    },
    1.5,
  );
}

const standingKey = (look: PlantLook, variant: number): string =>
  `${look.form}/${look.stage}/${variant}`;

/**
 * Only the plants that stand alone, drawn by rule at `scale`, with `tile` art pixels to
 * the cell. The bigger the plants, the fewer cells of a wood carry one.
 */
export function standingPlants(fixture: WorldFixture, scale: PlantScale, tile: number): PlantLayer {
  const forms = ["GRASS", "SHRUB", "BROADLEAF", "CONIFER"] as const;
  const arts: { key: string; art: PlantArt }[] = [];
  for (const form of forms) {
    for (const stage of ["young", "mature"] as const) {
      for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
        const look = { form, stage, variant, dormant: false };
        const art = drawStanding(form, stage, variant, scale, tile / SPRITE_WIDTH);
        arts.push({ key: standingKey(look, variant), art });
      }
    }
  }
  // One strip of drawings, a clear pixel between them.
  const canvas = document.createElement("canvas");
  canvas.width = arts.reduce((sum, { art }) => sum + art.width + 1, 1);
  canvas.height = Math.max(...arts.map(({ art }) => art.height)) + 2;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the plants");
  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const sprites = new Map<string, { texture: Texture; art: PlantArt }>();
  let left = 1;
  for (const { key, art } of arts) {
    const form = key.slice(0, key.indexOf("/"));
    const pixels = colourArt(art, fixture.palette[form] ?? ["#000000", "#000000", "#000000"]);
    context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), left, 1);
    const frame = new Rectangle(left, 1, art.width, art.height);
    sprites.set(key, { texture: new Texture({ source, frame }), art });
    left += art.width + 1;
  }
  source.update();

  const tall = Math.max(...arts.map(({ art }) => art.height)) / tile;
  return new PlantLayer(
    fixture,
    (look, x, y) => {
      if (!standsAlone(look, x, y)) return null;
      const density =
        look.form === "SHRUB" ? scale.bushDensity : look.form === "GRASS" ? 1 : scale.treeDensity;
      if (cellHash(x, y, 16) >= density) return null;
      const variant = Math.floor(cellHash(x, y, 17) * STANDING_VARIANTS);
      const sprite = sprites.get(standingKey(look, variant));
      if (sprite === undefined) return null;
      const [dx, dy] = plantOffset(x, y);
      return {
        texture: sprite.texture,
        anchorX: sprite.art.footX / sprite.art.width,
        anchorY: sprite.art.footY / sprite.art.height,
        scale: 1 / tile,
        dx: dx / SPRITE_WIDTH,
        dy: dy / SPRITE_WIDTH,
      };
    },
    tall,
  );
}
