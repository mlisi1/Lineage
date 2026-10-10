/**
 * The look sheet's renderer: one PixiJS scene drawn many ways, each time into another
 * canvas. A picture says where the camera is, what is switched on and who is in it.
 */
import { Application, Container, Sprite } from "pixi.js";
import type { Point } from "./chain";
import { CreatureLayer } from "./creatures";
import type { CreatureSeed, WorldFixture } from "./fixture";
import {
  PIXEL_ART,
  loadWorldLayers,
  paintLayers,
  type PaintedLayers,
  type WorldLayers,
} from "./layers";
import { lightTint, type Light } from "./light";
import { mulberry32 } from "./rng";

export interface Picture {
  /** Size the picture is drawn at, in art pixels. */
  width: number;
  height: number;
  /** Art pixels per cell. */
  zoom: number;
  /**
   * The bare ground or the ground with plants as flat colours (both one square per
   * cell), the ground painted at the plants' pixel size, or one colour (0xRRGGBB).
   */
  backdrop: "ground" | "map" | "painted" | number;
  /** A drawing in every vegetated cell, only the plants that stand alone, or none. */
  plants: "icons" | "scattered" | null;
  light: Light;
  cast: CreatureLayer | null;
  /** Draw only this member of the cast and keep it in the middle. */
  follow: number | null;
  /** The middle of the picture, in cells, when it follows nobody. */
  centre: Point;
}

export class Stage {
  private readonly world = new Container({ isRenderGroup: true });
  private readonly tint: Sprite;
  private readonly flat: Sprite;
  private readonly casts: CreatureLayer[] = [];

  private constructor(
    private readonly app: Application,
    readonly layers: WorldLayers,
    readonly paintedLayers: PaintedLayers,
  ) {
    this.tint = new Sprite({ texture: layers.atlas.white, blendMode: "multiply" });
    this.flat = new Sprite(layers.atlas.white);
    for (const cover of [this.tint, this.flat]) {
      cover.scale.set(
        app.renderer.width / cover.texture.width,
        app.renderer.height / cover.texture.height,
      );
    }
    this.world.addChild(
      layers.ground,
      layers.map,
      paintedLayers.painted,
      layers.plants.container,
      paintedLayers.scattered.container,
    );
    app.stage.addChild(this.flat, this.world, this.tint);
  }

  /** `width` × `height` is the largest picture that will be asked for. */
  static async create(
    fixture: WorldFixture,
    folder: string,
    width: number,
    height: number,
  ): Promise<Stage> {
    const app = new Application();
    await app.init({ ...PIXEL_ART, width, height });
    const layers = await loadWorldLayers(fixture, folder);
    return new Stage(app, layers, paintLayers(fixture, layers));
  }

  /** What PixiJS draws with: "webgl", or "canvas" where WebGL is missing. */
  get api(): string {
    return this.app.renderer.name;
  }

  /** Put creatures on the stage, each where its seed says. Seen only in pictures that cast them. */
  cast(seeds: readonly CreatureSeed[], seed: number): CreatureLayer {
    const layer = new CreatureLayer(
      this.layers.atlas,
      seeds,
      this.layers.passable,
      mulberry32(seed),
    );
    layer.setCount(seeds.length);
    layer.container.visible = false;
    this.casts.push(layer);
    this.world.addChild(layer.container);
    return layer;
  }

  /** Move every creature on by `dtS` seconds. */
  tick(dtS: number): void {
    for (const layer of this.casts) layer.update(dtS);
  }

  /** Draw `picture` and copy it into `into`, whose canvas has the picture's size. */
  draw(picture: Picture, into: CanvasRenderingContext2D): void {
    const { width, height, zoom, cast } = picture;
    const centre =
      cast !== null && picture.follow !== null ? cast.centre(picture.follow) : picture.centre;
    const cells = {
      x0: centre.x - width / zoom / 2,
      y0: centre.y - height / zoom / 2,
      x1: centre.x + width / zoom / 2,
      y1: centre.y + height / zoom / 2,
    };
    this.world.scale.set(zoom);
    this.world.position.set(Math.round(-cells.x0 * zoom), Math.round(-cells.y0 * zoom));

    const { ground, map, plants } = this.layers;
    const { painted, scattered } = this.paintedLayers;
    ground.visible = picture.backdrop === "ground";
    map.visible = picture.backdrop === "map";
    painted.visible = picture.backdrop === "painted";
    this.flat.visible = typeof picture.backdrop === "number";
    if (typeof picture.backdrop === "number") this.flat.tint = picture.backdrop;
    plants.container.visible = picture.plants === "icons";
    if (plants.container.visible) plants.cull(cells);
    scattered.container.visible = picture.plants === "scattered";
    if (scattered.container.visible) scattered.cull(cells);
    for (const layer of this.casts) layer.container.visible = layer === cast;
    cast?.solo(picture.follow);
    this.tint.visible = picture.light !== "day";
    this.tint.tint = lightTint(picture.light);

    this.app.render();
    // The picture is the top-left corner of the scene's canvas.
    into.drawImage(this.app.canvas, 0, 0, width, height, 0, 0, width, height);
  }
}
