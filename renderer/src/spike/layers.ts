/** What every view of the world is built from: the two bitmaps, the atlas, the plants. */
import { Assets, CanvasSource, Container, Sprite, Texture, type ApplicationOptions } from "pixi.js";
import { buildAtlas, type Atlas } from "./atlas";
import type { CellRect } from "./camera";
import type { WorldFixture } from "./fixture";
import { paintGround, type GroundStyle, type Shadow } from "../terrain/ground";
import type { Pixels } from "./pixelart";
import { passableIn, type Passable } from "../creatures/habitat";
import type { PlantLayer } from "../plants/plants";
import { iconPlants } from "./iconplants";

/** The deepest sea colour of the palette: what shows beyond the map. */
const BACKGROUND = "#1f437a";

/** Pixel art: no smoothing anywhere, positions snapped to whole pixels, frames on demand. */
export const PIXEL_ART: Partial<ApplicationOptions> = {
  background: BACKGROUND,
  antialias: false,
  roundPixels: true,
  resolution: 1,
  autoDensity: false,
  autoStart: false,
  sharedTicker: false,
};

export interface WorldLayers {
  /** The bare ground, and the same with plants as flat colours: one texel per cell. */
  ground: Sprite;
  map: Sprite;
  atlas: Atlas;
  plants: PlantLayer;
  passable: Passable;
}

/** `folder` holds the fixture's terrain.png and map.png. */
export async function loadWorldLayers(fixture: WorldFixture, folder: string): Promise<WorldLayers> {
  const bitmap = async (name: string): Promise<Sprite> => {
    const texture = await Assets.load<Texture>(`${folder}/${name}`);
    texture.source.scaleMode = "nearest";
    return new Sprite(texture);
  };
  const atlas = buildAtlas(fixture);
  return {
    ground: await bitmap("terrain.png"),
    map: await bitmap("map.png"),
    atlas,
    plants: iconPlants(fixture, atlas),
    passable: passableIn(fixture),
  };
}

/**
 * A painted ground as a sprite in the world: `tile` texels to the cell, its corner on
 * the corner of `cells` (the whole world when left out).
 */
export function groundSprite(pixels: Pixels, tile: number, cells?: CellRect): Sprite {
  const canvas = document.createElement("canvas");
  canvas.width = pixels.width;
  canvas.height = pixels.height;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas");
  context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), 0, 0);
  const sprite = new Sprite(
    new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) }),
  );
  sprite.scale.set(1 / tile);
  sprite.position.set(cells?.x0 ?? 0, cells?.y0 ?? 0);
  return sprite;
}

/** Cells per side of a piece of ground painted on demand, and how many pieces are kept. */
const PIECE_CELLS = 8;
const PIECES_KEPT = 60;
/** Cells painted round a piece and cut off, so that its shore meets its neighbours'. */
const PIECE_MARGIN = 1;

/**
 * The ground of a view too close for one picture of the whole world: painted a piece at
 * a time, when the view first comes over it, and forgotten when it is far behind.
 */
export class GroundPieces {
  /** Add this to the world. */
  readonly container = new Container();
  /** Pieces painted so far, and the time it took. */
  painted = 0;
  paintMs = 0;
  private readonly pieces = new Map<number, Sprite>();

  /** `shadows` says what throws a shadow onto given cells, if anything does. */
  constructor(
    private readonly fixture: WorldFixture,
    private readonly tile: number,
    private readonly style: GroundStyle,
    private readonly shadows?: (cells: CellRect) => Shadow[],
  ) {}

  /** Paint what `view` needs and is not there yet. */
  cover(view: CellRect): void {
    const { width, height } = this.fixture;
    const first = (value: number): number => Math.max(Math.floor(value / PIECE_CELLS), 0);
    const lastX = Math.min(Math.floor(view.x1 / PIECE_CELLS), Math.ceil(width / PIECE_CELLS) - 1);
    const lastY = Math.min(Math.floor(view.y1 / PIECE_CELLS), Math.ceil(height / PIECE_CELLS) - 1);
    for (let py = first(view.y0); py <= lastY; py++) {
      for (let px = first(view.x0); px <= lastX; px++) {
        const key = py * 1024 + px;
        if (this.pieces.has(key)) continue;
        const started = performance.now();
        const cells = {
          x0: px * PIECE_CELLS,
          y0: py * PIECE_CELLS,
          x1: Math.min((px + 1) * PIECE_CELLS, width),
          y1: Math.min((py + 1) * PIECE_CELLS, height),
        };
        const padded = {
          x0: Math.max(cells.x0 - PIECE_MARGIN, 0),
          y0: Math.max(cells.y0 - PIECE_MARGIN, 0),
          x1: Math.min(cells.x1 + PIECE_MARGIN, width),
          y1: Math.min(cells.y1 + PIECE_MARGIN, height),
        };
        const shadows = this.shadows?.(padded);
        const pixels = paintGround(this.fixture, {
          tile: this.tile,
          style: this.style,
          grain: true,
          cells: padded,
          season: this.fixture.season,
          ...(shadows === undefined ? {} : { shadows }),
        });
        const canvas = document.createElement("canvas");
        canvas.width = (cells.x1 - cells.x0) * this.tile;
        canvas.height = (cells.y1 - cells.y0) * this.tile;
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no 2D canvas");
        // Drawn shifted, so that the margin falls outside the canvas.
        context.putImageData(
          new ImageData(pixels.rgba, pixels.width, pixels.height),
          (padded.x0 - cells.x0) * this.tile,
          (padded.y0 - cells.y0) * this.tile,
        );
        const sprite = new Sprite(
          new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) }),
        );
        sprite.scale.set(1 / this.tile);
        sprite.position.set(cells.x0, cells.y0);
        this.pieces.set(key, sprite);
        this.container.addChild(sprite);
        this.painted += 1;
        this.paintMs += performance.now() - started;
      }
    }
    // Forget the pieces farthest from the view once there are too many.
    if (this.pieces.size <= PIECES_KEPT) return;
    const centreX = (view.x0 + view.x1) / 2;
    const centreY = (view.y0 + view.y1) / 2;
    const byDistance = [...this.pieces].sort(
      ([, a], [, b]) =>
        Math.hypot(b.x - centreX, b.y - centreY) - Math.hypot(a.x - centreX, a.y - centreY),
    );
    for (const [key, sprite] of byDistance.slice(0, this.pieces.size - PIECES_KEPT)) {
      this.pieces.delete(key);
      sprite.destroy({ texture: true, textureSource: true });
    }
  }
}
