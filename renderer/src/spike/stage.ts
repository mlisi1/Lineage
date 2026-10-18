/**
 * The look sheet's renderer: one PixiJS scene drawn many ways, each time into another
 * canvas. Grounds and plant layers are added under a name; a picture says which of them
 * it shows, where the camera is and who is in it.
 */
import { Application, Container, Sprite } from "pixi.js";
import type { Atlas } from "./atlas";
import type { BodyOptions } from "../creatures/body";
import type { CellRect } from "./camera";
import type { Point } from "../creatures/chain";
import { CreatureLayer } from "./creatures";
import type { CreatureSeed, WorldFixture } from "./fixture";
import type { Passable } from "./habitat";
import { PIXEL_ART, groundSprite, loadWorldLayers } from "./layers";
import { lightTint, type Light } from "./light";
import type { Pixels } from "./pixelart";
import type { PlantLayer } from "./plants";
import { mulberry32 } from "./rng";

export interface Picture {
  /** Size the picture is drawn at, in art pixels. */
  width: number;
  height: number;
  /** Art pixels per cell. */
  zoom: number;
  /** The name of a ground added to the stage, or one colour (0xRRGGBB). */
  ground: string | number;
  /** The name of a plant layer added to the stage, or none. */
  plants: string | null;
  light: Light;
  cast: CreatureLayer | null;
  /** The cast as dots, as on a map, instead of bodies. */
  markers: boolean;
  /** Draw only this member of the cast and keep it in the middle. */
  follow: number | null;
  /** Draw only this member of the cast, the camera staying where `centre` says. */
  only: number | null;
  /** The member of the cast the picture is about: plants in front of it show it through. */
  subject: number | null;
  /** The middle of the picture, in cells, when it follows nobody. */
  centre: Point;
}

export class Stage {
  readonly atlas: Atlas;
  readonly passable: Passable;
  private readonly world = new Container({ isRenderGroup: true });
  private readonly grounds = new Map<string, Sprite>();
  private readonly plantLayers = new Map<string, PlantLayer>();
  private readonly groundLayer = new Container();
  private readonly plantLayer = new Container();
  private readonly castLayer = new Container();
  private readonly tint: Sprite;
  private readonly flat: Sprite;
  private readonly casts: CreatureLayer[] = [];

  private constructor(
    private readonly app: Application,
    atlas: Atlas,
    passable: Passable,
  ) {
    this.atlas = atlas;
    this.passable = passable;
    this.tint = new Sprite({ texture: atlas.white, blendMode: "multiply" });
    this.flat = new Sprite(atlas.white);
    for (const cover of [this.tint, this.flat]) {
      cover.scale.set(
        app.renderer.width / cover.texture.width,
        app.renderer.height / cover.texture.height,
      );
    }
    this.world.addChild(this.groundLayer, this.plantLayer, this.castLayer);
    app.stage.addChild(this.flat, this.world, this.tint);
  }

  /**
   * `width` × `height` is the largest picture that will be asked for. The two bitmaps
   * of the report maps come as grounds "terrain.png" and "map.png", and the first
   * look's plants (a drawing in every cell) as plant layer "icons".
   */
  static async create(
    fixture: WorldFixture,
    folder: string,
    width: number,
    height: number,
  ): Promise<Stage> {
    const app = new Application();
    await app.init({ ...PIXEL_ART, width, height });
    const layers = await loadWorldLayers(fixture, folder);
    const stage = new Stage(app, layers.atlas, layers.passable);
    stage.addSprite("terrain.png", layers.ground);
    stage.addSprite("map.png", layers.map);
    stage.addPlants("icons", layers.plants);
    return stage;
  }

  /** What PixiJS draws with: "webgl", or "canvas" where WebGL is missing. */
  get api(): string {
    return this.app.renderer.name;
  }

  /** A painted ground: `tile` pixels to the cell, over `cells` (the whole world if left out). */
  addGround(name: string, pixels: Pixels, tile: number, cells?: CellRect): void {
    this.addSprite(name, groundSprite(pixels, tile, cells));
  }

  addPlants(name: string, layer: PlantLayer): void {
    layer.container.visible = false;
    this.plantLayers.set(name, layer);
    this.plantLayer.addChild(layer.container);
  }

  /** Put creatures on the stage, each where its seed says. Seen only in pictures that cast them. */
  cast(seeds: readonly CreatureSeed[], seed: number, body?: BodyOptions): CreatureLayer {
    const layer = new CreatureLayer(this.atlas, seeds, this.passable, mulberry32(seed), body);
    layer.setCount(seeds.length);
    layer.show("hidden");
    this.casts.push(layer);
    this.castLayer.addChild(layer.container);
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

    for (const [name, ground] of this.grounds) ground.visible = name === picture.ground;
    this.flat.visible = typeof picture.ground === "number";
    if (typeof picture.ground === "number") this.flat.tint = picture.ground;
    let plants: PlantLayer | null = null;
    for (const [name, layer] of this.plantLayers) {
      layer.container.visible = name === picture.plants;
      if (layer.container.visible) plants = layer;
    }
    plants?.cull(cells);
    for (const layer of this.casts) {
      if (layer !== cast) layer.show("hidden");
    }
    if (cast !== null) {
      cast.show(picture.markers ? "markers" : "bodies", picture.follow ?? picture.only);
      // Among plants a creature stands in its row, behind what grows in front of it.
      const among = picture.markers || plants === null ? null : plants;
      cast.hostIn(among?.guests ?? null, among?.rowsPerCell);
    }
    plants?.fade(cast !== null && picture.subject !== null ? cast.box(picture.subject) : null);
    this.tint.visible = picture.light !== "day";
    this.tint.tint = lightTint(picture.light);

    this.app.render();
    // The picture is the top-left corner of the scene's canvas.
    into.drawImage(this.app.canvas, 0, 0, width, height, 0, 0, width, height);
  }

  private addSprite(name: string, sprite: Sprite): void {
    sprite.visible = false;
    this.grounds.set(name, sprite);
    this.groundLayer.addChild(sprite);
  }
}
