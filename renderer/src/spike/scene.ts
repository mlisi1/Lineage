/** The spike's scene: terrain bitmap, plants, creatures and a full-screen tint. */
import { Application, Container, Sprite, type WebGLRenderer } from "pixi.js";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "../scene";
import { viewAt } from "./camera";
import { CreatureLayer } from "./creatures";
import type { WorldFixture } from "./fixture";
import { PIXEL_ART, loadWorldLayers } from "./layers";
import { cycleTint } from "./light";
import type { Backend } from "./params";
import type { PlantLayer } from "./plants";
import { mulberry32 } from "./rng";
import type { Scenario } from "./scenarios";

export interface GpuInfo {
  /** "webgl", "webgpu" or "canvas": what PixiJS ended up using. */
  api: string;
  webgl_version: string;
  vendor: string;
  renderer: string;
  unmasked_vendor: string;
  unmasked_renderer: string;
  max_texture_size: number;
  /** A guess from the renderer string: drawn by the CPU, not a GPU. */
  software: boolean;
}

export interface Applied {
  internal: [number, number];
  plant_sprites: number;
  creature_sprites: number;
}

export class SpikeScene {
  private readonly world = new Container({ isRenderGroup: true });
  private readonly tint: Sprite;
  private shot: Scenario["shot"] = "wide";
  private timeS = 0;
  private drawnPlants = 0;

  private constructor(
    private readonly app: Application,
    private readonly fixture: WorldFixture,
    /** The bare ground, and the same with plants as flat colours: one texel per cell. */
    private readonly ground: Sprite,
    private readonly map: Sprite,
    private readonly plants: PlantLayer,
    private readonly creatures: CreatureLayer,
    tint: Sprite,
  ) {
    this.tint = tint;
  }

  /** `folder` holds the fixture's terrain.png and map.png. */
  static async create(
    host: HTMLElement,
    fixture: WorldFixture,
    folder: string,
    backend: Backend,
    seed: number,
  ): Promise<SpikeScene> {
    const app = new Application();
    await app.init({
      ...PIXEL_ART,
      width: DESIGN_WIDTH,
      height: DESIGN_HEIGHT,
      preference: backend,
      powerPreference: "high-performance",
    });
    app.canvas.dataset["testid"] = "spike-stage";
    host.appendChild(app.canvas);

    const { ground, map, atlas, plants, passable } = await loadWorldLayers(fixture, folder);
    const creatures = new CreatureLayer(atlas, fixture.creatures, passable, mulberry32(seed));
    const tint = new Sprite({ texture: atlas.white, blendMode: "multiply" });

    const scene = new SpikeScene(app, fixture, ground, map, plants, creatures, tint);
    // One texel of the bitmaps is one cell, the unit of the world container.
    scene.world.addChild(ground, map, plants.container, creatures.container);
    app.stage.addChild(scene.world, tint);
    window.addEventListener("resize", () => scene.layout());
    return scene;
  }

  /** Number of cells that carry a plant sprite. */
  get plantCells(): number {
    return this.plants.count;
  }

  /** Configure the scene for a scenario. */
  apply(scenario: Scenario): Applied {
    const width = DESIGN_WIDTH / scenario.artScale;
    const height = DESIGN_HEIGHT / scenario.artScale;
    this.app.renderer.resize(width, height);
    this.layout();
    this.shot = scenario.shot;
    this.map.visible = scenario.plants === "map";
    this.ground.visible = !this.map.visible;
    this.plants.container.visible = scenario.plants === "sprites";
    this.creatures.setCount(scenario.creatures);
    this.tint.visible = scenario.tint;
    this.tint.scale.set(width / this.tint.texture.width, height / this.tint.texture.height);
    this.frame(0);
    return {
      internal: [width, height],
      plant_sprites: this.drawnPlants,
      creature_sprites: this.creatures.spriteCount,
    };
  }

  /** Advance the animation by `dtS` seconds and draw one frame. */
  frame(dtS: number): void {
    this.timeS += dtS;
    const { width, height } = this.app.renderer;
    const view = viewAt(
      this.shot,
      this.timeS,
      width,
      height,
      this.fixture.width,
      this.fixture.height,
    );
    this.world.scale.set(view.scale);
    this.world.position.set(Math.round(view.x), Math.round(view.y));
    this.drawnPlants = this.plants.container.visible ? this.plants.cull(view.cells) : 0;
    this.creatures.update(dtS);
    if (this.tint.visible) this.tint.tint = cycleTint(this.timeS);
    this.app.render();
  }

  gpu(): GpuInfo {
    const info: GpuInfo = {
      api: this.app.renderer.name,
      webgl_version: "",
      vendor: "",
      renderer: "",
      unmasked_vendor: "",
      unmasked_renderer: "",
      max_texture_size: 0,
      software: false,
    };
    const gl = (this.app.renderer as Partial<WebGLRenderer>).gl;
    if (gl !== undefined) {
      const text = (parameter: number): string => String(gl.getParameter(parameter) ?? "");
      info.webgl_version = text(gl.VERSION);
      info.vendor = text(gl.VENDOR);
      info.renderer = text(gl.RENDERER);
      info.max_texture_size = Number(gl.getParameter(gl.MAX_TEXTURE_SIZE));
      const debug = gl.getExtension("WEBGL_debug_renderer_info");
      if (debug !== null) {
        info.unmasked_vendor = text(debug.UNMASKED_VENDOR_WEBGL);
        info.unmasked_renderer = text(debug.UNMASKED_RENDERER_WEBGL);
      }
    }
    const names = `${info.renderer} ${info.unmasked_renderer}`;
    info.software = info.api === "canvas" || /swiftshader|llvmpipe|softpipe|software/i.test(names);
    return info;
  }

  /** Stretch the canvas over the viewport, whatever its internal size, with hard pixels. */
  private layout(): void {
    const fit = fitToViewport(window.innerWidth, window.innerHeight);
    const style = this.app.canvas.style;
    style.position = "absolute";
    style.left = `${fit.offsetX}px`;
    style.top = `${fit.offsetY}px`;
    style.width = `${DESIGN_WIDTH * fit.scale}px`;
    style.height = `${DESIGN_HEIGHT * fit.scale}px`;
    style.imageRendering = "pixelated";
  }
}
