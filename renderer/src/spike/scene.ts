/**
 * The benchmark's scene: ground, plants, creatures and a full-screen tint, in the spike's
 * first look or in the look proposed since, as the scenario asks.
 */
import { Application, Container, Sprite, type WebGLRenderer } from "pixi.js";
import { DESIGN_HEIGHT, DESIGN_WIDTH, fitToViewport } from "../scene";
import type { BodyOptions } from "./body";
import { viewAt, type View } from "./camera";
import { CreatureLayer } from "./creatures";
import type { WorldFixture } from "./fixture";
import { MID_TILE, MAP_TILE, paintGround } from "./ground";
import { GroundPieces, PIXEL_ART, groundSprite, loadWorldLayers, type WorldLayers } from "./layers";
import { cycleTint } from "./light";
import type { Backend } from "./params";
import { PLANT_SCALES } from "./plantart";
import { standingPlants, type PlantLayer } from "./plants";
import { GROUND, LOCAL_PIXELS, MAP_GROUND, MID_BODY, PLANTS, TREES, localBody } from "./proposal";
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
  /** Time it took to paint the grounds of the proposed look, the first time they were needed. */
  ground_paint_ms: number;
}

/** What the proposed look adds to the scene, built the first time a scenario asks for it. */
interface Proposed {
  mapGround: Sprite;
  midGround: Sprite;
  standing: PlantLayer;
  creatures: CreatureLayer;
  paintMs: number;
  /** The local view: ground in pieces, the plants drawn for it, the creatures seen from close. */
  pieces: GroundPieces;
  nearPlants: PlantLayer;
  nearCreatures: CreatureLayer;
}

export class SpikeScene {
  private readonly world = new Container({ isRenderGroup: true });
  private readonly grounds = new Container();
  private readonly plantLayers = new Container();
  private readonly casts = new Container();
  private readonly tint: Sprite;
  private proposed: Proposed | null = null;
  private shot: Scenario["shot"] = "wide";
  /** Creatures shown as dots, as on the map: no bodies to work out. */
  private dots = false;
  /** The ground of the local view, painted as the camera goes. */
  private pieces: GroundPieces | null = null;
  private timeS = 0;
  private drawnPlants = 0;
  /** The plants and creatures of the scenario in force. */
  private activePlants: PlantLayer | null = null;
  private activeCreatures: CreatureLayer;

  private constructor(
    private readonly app: Application,
    private readonly fixture: WorldFixture,
    private readonly layers: WorldLayers,
    private readonly creatures: CreatureLayer,
    private readonly seed: number,
  ) {
    this.tint = new Sprite({ texture: layers.atlas.white, blendMode: "multiply" });
    this.activeCreatures = creatures;
    // One texel of the bitmaps is one cell, the unit of the world container.
    this.grounds.addChild(layers.ground, layers.map);
    this.plantLayers.addChild(layers.plants.container);
    this.casts.addChild(creatures.container);
    this.world.addChild(this.grounds, this.plantLayers, this.casts);
    app.stage.addChild(this.world, this.tint);
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

    const layers = await loadWorldLayers(fixture, folder);
    const creatures = new CreatureLayer(
      layers.atlas,
      fixture.creatures,
      layers.passable,
      mulberry32(seed),
    );
    const scene = new SpikeScene(app, fixture, layers, creatures, seed);
    window.addEventListener("resize", () => scene.layout());
    return scene;
  }

  /** Number of cells that carry a plant sprite. */
  get plantCells(): number {
    return this.layers.plants.count;
  }

  /** Configure the scene for a scenario. */
  apply(scenario: Scenario): Applied {
    const width = DESIGN_WIDTH / scenario.artScale;
    const height = DESIGN_HEIGHT / scenario.artScale;
    this.app.renderer.resize(width, height);
    this.layout();
    this.shot = scenario.shot;
    const painted = scenario.plants === "painted";
    const wide = scenario.shot === "wide";
    const follow = scenario.shot === "follow";
    const proposed = painted ? this.propose() : this.proposed;
    const { ground, map, plants } = this.layers;
    map.visible = scenario.plants === "map";
    ground.visible = !map.visible && !painted;
    plants.container.visible = scenario.plants === "sprites";
    this.activePlants = plants.container.visible ? plants : null;
    this.activeCreatures = this.creatures;
    this.pieces = null;
    if (proposed !== null) {
      proposed.mapGround.visible = painted && wide;
      proposed.midGround.visible = painted && !wide && !follow;
      proposed.standing.container.visible = painted && !wide && !follow;
      proposed.pieces.container.visible = painted && follow;
      proposed.nearPlants.container.visible = painted && follow;
      if (painted) {
        if (follow) {
          this.activePlants = proposed.nearPlants;
          this.activeCreatures = proposed.nearCreatures;
          this.pieces = proposed.pieces;
        } else {
          if (!wide) this.activePlants = proposed.standing;
          this.activeCreatures = proposed.creatures;
        }
      }
    }
    // On the map a creature is a dot.
    this.dots = painted && wide;
    for (const layer of [this.creatures, proposed?.creatures, proposed?.nearCreatures]) {
      if (layer === undefined) continue;
      layer.setCount(layer === this.activeCreatures ? scenario.creatures : 0);
      layer.show(this.dots ? "markers" : "bodies");
    }
    this.tint.visible = scenario.tint;
    this.tint.scale.set(width / this.tint.texture.width, height / this.tint.texture.height);
    const before = this.pieces?.paintMs ?? 0;
    this.frame(0);
    return {
      internal: [width, height],
      plant_sprites: this.drawnPlants,
      creature_sprites: this.dots ? 2 * scenario.creatures : this.activeCreatures.spriteCount,
      // The grounds of the map and the middle view, or the pieces under the first frame.
      ground_paint_ms: !painted
        ? 0
        : follow
          ? (this.pieces?.paintMs ?? 0) - before
          : (proposed?.paintMs ?? 0),
    };
  }

  /** Advance the animation by `dtS` seconds and draw one frame. */
  frame(dtS: number): void {
    this.timeS += dtS;
    const { width, height } = this.app.renderer;
    let view: View;
    if (this.shot === "follow") {
      // The first creature in the middle of the picture, from close by.
      const scale = LOCAL_PIXELS;
      const subject = this.activeCreatures.centre(0);
      const cells = {
        x0: subject.x - width / scale / 2,
        y0: subject.y - height / scale / 2,
        x1: subject.x + width / scale / 2,
        y1: subject.y + height / scale / 2,
      };
      view = { scale, x: -cells.x0 * scale, y: -cells.y0 * scale, cells };
      this.pieces?.cover(cells);
    } else {
      view = viewAt(this.shot, this.timeS, width, height, this.fixture.width, this.fixture.height);
    }
    this.world.scale.set(view.scale);
    this.world.position.set(Math.round(view.x), Math.round(view.y));
    this.drawnPlants = this.activePlants?.cull(view.cells) ?? 0;
    this.activeCreatures.update(dtS, view.cells, !this.dots);
    // Among plants a creature stands in its row, behind what grows in front of it.
    this.activeCreatures.hostIn(this.activePlants?.guests ?? null, this.activePlants?.rowsPerCell);
    // What stands in front of the one the camera is on shows it through.
    this.activePlants?.fade(this.shot === "follow" ? this.activeCreatures.box(0) : null);
    if (this.tint.visible) this.tint.tint = cycleTint(this.timeS);
    this.app.render();
  }

  /** Build what the chosen look needs, once: the grounds, the plants, the creatures. */
  private propose(): Proposed {
    if (this.proposed !== null) return this.proposed;
    const started = performance.now();
    const mapGround = groundSprite(
      paintGround(this.fixture, { tile: MAP_TILE, style: MAP_GROUND, grain: false }),
      MAP_TILE,
    );
    const midGround = groundSprite(
      paintGround(this.fixture, { tile: MID_TILE, style: GROUND, grain: true }),
      MID_TILE,
    );
    const paintMs = performance.now() - started;
    const scale = PLANT_SCALES.find((candidate) => candidate.name === PLANTS);
    if (scale === undefined) throw new Error(`no plant scale "${PLANTS}"`);
    const cast = (body: BodyOptions): CreatureLayer =>
      new CreatureLayer(
        this.layers.atlas,
        this.fixture.creatures,
        this.layers.passable,
        mulberry32(this.seed),
        body,
      );
    const nearPlants = standingPlants(this.fixture, scale, LOCAL_PIXELS, TREES);
    this.proposed = {
      mapGround,
      midGround,
      standing: standingPlants(this.fixture, scale, MID_TILE),
      creatures: cast(MID_BODY),
      paintMs,
      // The ground of the local view carries the shadows of what stands on it.
      pieces: new GroundPieces(this.fixture, LOCAL_PIXELS, GROUND, (cells) =>
        nearPlants.shadows(cells),
      ),
      nearPlants,
      nearCreatures: cast(localBody(LOCAL_PIXELS)),
    };
    const { standing, creatures, pieces, nearCreatures } = this.proposed;
    this.grounds.addChild(mapGround, midGround, pieces.container);
    this.plantLayers.addChild(standing.container, nearPlants.container);
    this.casts.addChild(creatures.container, nearCreatures.container);
    return this.proposed;
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
