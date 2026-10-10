/** What every view of the world is built from: the two bitmaps, the atlas, the plants. */
import { Assets, CanvasSource, Sprite, Texture, type ApplicationOptions } from "pixi.js";
import { buildAtlas, type Atlas } from "./atlas";
import type { WorldFixture } from "./fixture";
import { TILE, paintGround } from "./ground";
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

export interface PaintedLayers {
  /** The ground painted at the plants' pixel size, scaled to one cell per TILE texels. */
  painted: Sprite;
  /** Only the plants that stand alone on it. */
  scattered: PlantLayer;
}

function canvasOf(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (context === null) throw new Error("no 2D canvas");
  return [canvas, context];
}

/** The pixels of one of the map bitmaps, one per cell. */
function pixelsOf(bitmap: Sprite, fixture: WorldFixture): Uint8ClampedArray {
  const [, context] = canvasOf(fixture.width, fixture.height);
  context.drawImage(bitmap.texture.source.resource as CanvasImageSource, 0, 0);
  return context.getImageData(0, 0, fixture.width, fixture.height).data;
}

/** The layers of the painted style, made from those every style shares. */
export function paintLayers(fixture: WorldFixture, layers: WorldLayers): PaintedLayers {
  const ground = paintGround(
    fixture,
    pixelsOf(layers.ground, fixture),
    pixelsOf(layers.map, fixture),
  );
  const [canvas, context] = canvasOf(ground.width, ground.height);
  context.putImageData(new ImageData(ground.rgba, ground.width, ground.height), 0, 0);
  const painted = new Sprite(
    new Texture({ source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) }),
  );
  painted.scale.set(1 / TILE);
  return { painted, scattered: new PlantLayer(fixture, layers.atlas, true) };
}
