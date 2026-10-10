/** What every view of the world is built from: the two bitmaps, the atlas, the plants. */
import { Assets, Sprite, type ApplicationOptions, type Texture } from "pixi.js";
import { buildAtlas, type Atlas } from "./atlas";
import type { WorldFixture } from "./fixture";
import { passableIn, type Passable } from "./habitat";
import { PlantLayer } from "./plants";

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
    plants: new PlantLayer(fixture, atlas),
    passable: passableIn(fixture),
  };
}
