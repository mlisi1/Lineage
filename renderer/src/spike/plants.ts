/**
 * The plant layer, in chunks that are skipped off screen. Two styles: a drawing in the
 * middle of every vegetated cell, or (scattered) only the plants that stand alone, each
 * a little off the middle of its cell, for a ground that is itself painted with growth.
 */
import { Container, Sprite } from "pixi.js";
import type { Atlas } from "./atlas";
import { chunkVisible, type CellRect } from "./camera";
import type { WorldFixture } from "./fixture";
import { SPRITE_WIDTH, lookKey, plantLook, plantOffset, standsAlone } from "./pixelart";

/** Cells per side of a chunk; whole chunks are skipped when off screen. */
const CHUNK_CELLS = 16;
/** Trees are 1.5 cells tall, so a chunk just below the view can still show. */
const CULL_MARGIN_CELLS = 2;

interface Chunk {
  container: Container;
  x: number;
  y: number;
  sprites: number;
}

export class PlantLayer {
  /** Add this to the world. */
  readonly container = new Container();
  /** Number of plant sprites in the world. */
  readonly count: number;
  private readonly chunks: Chunk[] = [];

  constructor(fixture: WorldFixture, atlas: Atlas, scattered = false) {
    let count = 0;
    // Chunks and their sprites are added top to bottom, so nearer plants cover farther.
    for (let chunkY = 0; chunkY < fixture.height; chunkY += CHUNK_CELLS) {
      for (let chunkX = 0; chunkX < fixture.width; chunkX += CHUNK_CELLS) {
        const container = new Container();
        const yEnd = Math.min(chunkY + CHUNK_CELLS, fixture.height);
        const xEnd = Math.min(chunkX + CHUNK_CELLS, fixture.width);
        for (let y = chunkY; y < yEnd; y++) {
          for (let x = chunkX; x < xEnd; x++) {
            const index = y * fixture.width + x;
            const look = plantLook(
              fixture.coverClasses[fixture.cover[index] ?? 0] ?? "",
              fixture.biomass[index] ?? 0,
              x,
              y,
              fixture.dormantBelow,
              fixture.dormantClasses,
            );
            if (look === null || (scattered && !standsAlone(look, x, y))) continue;
            const [dx, dy] = scattered ? plantOffset(x, y) : [0, 0];
            const texture = atlas.plants.get(lookKey(look));
            if (texture === undefined) throw new Error(`no texture for ${lookKey(look)}`);
            // Anchored at the foot of the cell: one cell wide, tall art overlaps upward.
            const sprite = new Sprite({ texture, anchor: { x: 0.5, y: 1 } });
            sprite.scale.set(1 / SPRITE_WIDTH);
            sprite.position.set(x + 0.5 + dx / SPRITE_WIDTH, y + 1 + dy / SPRITE_WIDTH);
            container.addChild(sprite);
          }
        }
        if (container.children.length === 0) continue;
        count += container.children.length;
        this.chunks.push({
          container,
          x: chunkX,
          y: chunkY,
          sprites: container.children.length,
        });
        this.container.addChild(container);
      }
    }
    this.count = count;
  }

  /** Hide the chunks outside the view. Returns the number of sprites left to draw. */
  cull(view: CellRect): number {
    let drawn = 0;
    for (const chunk of this.chunks) {
      const visible = chunkVisible(view, chunk.x, chunk.y, CHUNK_CELLS, CULL_MARGIN_CELLS);
      if (chunk.container.visible !== visible) chunk.container.visible = visible;
      if (visible) drawn += chunk.sprites;
    }
    return drawn;
  }
}
