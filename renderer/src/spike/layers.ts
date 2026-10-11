/** What every view of the world is built from: the two bitmaps, the atlas, the plants. */
import { Assets, CanvasSource, Sprite, Texture, type ApplicationOptions } from "pixi.js";
import { buildAtlas, type Atlas } from "./atlas";
import type { CellRect } from "./camera";
import type { WorldFixture } from "./fixture";
import type { Pixels } from "./pixelart";
import { passableIn, type Passable } from "./habitat";
import { iconPlants, type PlantLayer } from "./plants";

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
