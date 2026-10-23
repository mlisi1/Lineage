/**
 * The land and its plants from the state stream, in the three views (ADR 0007):
 *
 *   map      2 art pixels to the cell: the whole continent, plants as the ground's colour
 *   middle   8: a region; the ground one picture of the whole world, trees and bushes
 *            standing on it, their shadows painted on the ground
 *   local    32: the ground in pieces round the camera, the same plants drawn larger,
 *            grass as tufts, and what only shows from close
 *
 * Once a sim-day, or when the land changes, the plants are laid out again for the day
 * (each in the season of its own turn, with snow where the simulation has it) and the
 * grounds repainted off the frame; the new day fades in over the old. Only the views
 * that have been shown are kept up to date. The sea moves all the while (`terrain/sea.ts`).
 * Creatures (`herd.ts`) stand among the plants; the camera (`director.ts`) chooses the view.
 */
import { Container } from "pixi.js";
import { DEFAULT_LOOK, type Look } from "./looks";
import { standingPlants, type PlantLayer } from "./plants/plants";
import type { YearTime } from "./plants/turning";
import type { ClockMessage, LandMessage, Message } from "./protocol";
import { landOf, yearOf } from "./stream";
import { MAP_TILE, MID_TILE, type GroundStyle } from "./terrain/ground";
import { FADE_S, PieceGround, WholeGround } from "./terrain/grounds";
import type { CellRect, Land } from "./terrain/land";
import type { Painter } from "./terrain/painter";
import { Sea } from "./terrain/sea";
import { shoreSizes, swashUp, tideLevel } from "./terrain/tide";
import { heightAt } from "./creatures/habitat";

export const VIEWS = ["map", "middle", "local"] as const;
export type ViewName = (typeof VIEWS)[number];
/** Art pixels to the cell in each view. */
export const TILES: Readonly<Record<ViewName, number>> = {
  map: MAP_TILE,
  middle: MID_TILE,
  local: 32,
};
/**
 * The middle view reads what grows over the cells around each one (`calm`, as the local
 * view does), so that cover lies in patches instead of a patchwork cell by cell (R5).
 */
const MIDDLE_CALM = 1;
/** Land higher than this above the sea (height units) is never reached by the swash. */
const SWASH_BEACH = 0.03;
/** Where to look for the water round a place, to know if the swash reaches it: eight ways. */
const SWASH_LOOKS: readonly (readonly [number, number])[] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [Math.SQRT1_2, Math.SQRT1_2],
  [-Math.SQRT1_2, Math.SQRT1_2],
  [Math.SQRT1_2, -Math.SQRT1_2],
  [-Math.SQRT1_2, -Math.SQRT1_2],
];
/** How each view's ground reads the cells (ADR 0007): the map cut, the closer views dithered. */
const STYLES: Readonly<Record<ViewName, GroundStyle>> = {
  map: "smooth",
  middle: "blended",
  local: "blended",
};

/**
 * A plant layer coming in over the one before it: the new one fades in over the first half
 * (drawn over the old, so plants in both never dim), then the old one fades out under it
 * over the second half, so plants gone from the new one fade away instead of vanishing.
 */
class PlantFade {
  readonly container = new Container();
  current: PlantLayer | null = null;
  private outgoing: PlantLayer | null = null;
  private age = 0;

  constructor(private readonly fadeS: number) {}

  show(layer: PlantLayer): void {
    this.drop();
    this.outgoing = this.current;
    this.current = layer;
    this.age = 0;
    layer.container.alpha = this.outgoing === null || this.fadeS <= 0 ? 1 : 0;
    this.container.addChild(layer.container);
    if (layer.container.alpha === 1) this.drop();
  }

  get fading(): boolean {
    return this.outgoing !== null;
  }

  /** The layer drawn fully opaque: the old one while the new fades in over it. */
  get host(): PlantLayer | null {
    const coming = this.current !== null && this.current.container.alpha < 1;
    return coming ? (this.outgoing ?? this.current) : this.current;
  }

  tick(dtS: number, view: CellRect): void {
    this.current?.cull(view);
    if (this.outgoing === null || this.current === null) return;
    this.outgoing.cull(view);
    this.age += dtS;
    const half = this.fadeS / 2;
    this.current.container.alpha = Math.min(this.age / half, 1);
    this.outgoing.container.alpha = 1 - Math.min(Math.max((this.age - half) / half, 0), 1);
    if (this.age >= this.fadeS) this.drop();
  }

  private drop(): void {
    if (this.current !== null) this.current.container.alpha = 1;
    this.outgoing?.destroy();
    this.outgoing = null;
  }
}

interface Built {
  map: WholeGround | null;
  middle: { ground: WholeGround; plants: PlantFade } | null;
  local: { ground: PieceGround; plants: PlantFade } | null;
}

export class Landscape {
  /** Add this to the world layer, which is in cells: x and y as the simulation's grid. */
  readonly container = new Container();
  private clock: ClockMessage | null = null;
  private landMessage: LandMessage | null = null;
  private land: Land | null = null;
  private landVersion = 0;
  /** What has to be laid out again: a new land, or a new day of the year. */
  private stale = false;
  private laidOutDay = -1;
  private view: ViewName = "middle";
  private cells: CellRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
  private readonly built: Built = { map: null, middle: null, local: null };
  /**
   * What lies on the ground (R4: a crater, a cone's scree, a fire's embers): under the
   * plants of the view shown, over its ground and sea, so that what stands is drawn over it.
   */
  readonly floor = new Container();
  /** Cells a cone or crater covers (R4): no plant, stone or boulder is placed there. */
  covered: ((x: number, y: number) => boolean) | null = null;
  private readonly layers: Record<ViewName, Container> = {
    map: new Container(),
    middle: new Container(),
    local: new Container(),
  };

  /** The moving sea of each view, and the wall time it has moved for. */
  private readonly seas: Record<ViewName, Sea> = {
    map: new Sea(TILES.map),
    middle: new Sea(TILES.middle),
    local: new Sea(TILES.local),
  };
  private seaTime = 0;
  /**
   * Draw the local view's bushes in pieces, a sprite for each puff (R5, an experiment the
   * owner asked for: `?bushes=pieces`). Set before the first land comes.
   */
  bushPieces = false;

  /** `still` keeps the sea as it is at its first moment: for pictures that must not change. */
  constructor(
    private readonly painter: Painter,
    private readonly look: Look = DEFAULT_LOOK,
    private readonly fadeS = FADE_S,
    private readonly still = false,
  ) {
    for (const name of VIEWS) {
      this.layers[name].visible = false;
      this.container.addChild(this.layers[name]);
    }
  }

  /** The world's size in cells, once a land has come. */
  get size(): { width: number; height: number } | null {
    return this.land === null ? null : { width: this.land.width, height: this.land.height };
  }

  /** Whether ground is being painted now. */
  get painting(): boolean {
    return this.painter.busy > 0;
  }

  /** The land as the stream last sent it (R4's demos change it and send it again). */
  get lastMessage(): LandMessage | null {
    return this.landMessage;
  }

  /** The current land, once one has come. */
  get current(): Land | null {
    return this.land;
  }

  /**
   * Whether the swash covers the beach at a place (cells) in the view shown, now (R5: an
   * animal there gets wet feet): the place is land, and the water lies no further off than
   * the swash has run up the sand at this moment, as the shore's shader draws it.
   */
  swashCovers(x: number, y: number): boolean {
    const land = this.land;
    if (land === null || this.view === "map") return false;
    const above = heightAt(land, x, y) - land.seaLevel;
    if (above <= 0 || above > SWASH_BEACH) return false;
    const tile = TILES[this.view];
    const top = shoreSizes(tile).swash * tideLevel(this.seaTime);
    const up = swashUp(this.seaTime, x, y, top) / tile;
    if (up <= 0) return false;
    for (const [dx, dy] of SWASH_LOOKS) {
      if (heightAt(land, x + dx * up, y + dy * up) <= land.seaLevel) return true;
    }
    return false;
  }

  /** The plants of the view being shown, for creatures to be sorted among (R2). */
  get plants(): PlantLayer | null {
    if (this.view === "middle") return this.built.middle?.plants.current ?? null;
    if (this.view === "local") return this.built.local?.plants.current ?? null;
    return null;
  }

  /**
   * Where the creatures of the view being shown stand (R3): among the plants of the view
   * drawn opaque, so that they do not fade in with the next day's plants. The layer may
   * change from one frame to the next; its guests are let go before it is destroyed.
   */
  get hosts(): PlantLayer | null {
    if (this.view === "middle") return this.built.middle?.plants.host ?? null;
    if (this.view === "local") return this.built.local?.plants.host ?? null;
    return null;
  }

  /** The view being shown. */
  get shown(): ViewName {
    return this.view;
  }

  /** Take a message from the stream; what it changes is laid out on the next `update`. */
  receive(message: Message): void {
    if (message.type === "clock") {
      this.clock = message;
      if (message.day_of_year !== this.laidOutDay) this.stale = true;
    } else if (message.type === "land") {
      // Several lands in a row (a recording played at once): only the last is drawn.
      this.landMessage = message;
      this.land = null;
      this.stale = true;
    }
  }

  /** Show `name`, with `cells` of the world in sight. */
  show(name: ViewName, cells: CellRect): void {
    this.view = name;
    this.cells = cells;
    for (const view of VIEWS) this.layers[view].visible = view === name;
    if (this.land !== null && this.built[name] === null) this.build(name);
    this.placeFloor();
  }

  /** Put the floor in the view shown, just under its plants (on top of the map's ground). */
  private placeFloor(): void {
    const layer = this.layers[this.view];
    const standing =
      this.view === "middle"
        ? this.built.middle?.plants.container
        : this.view === "local"
          ? this.built.local?.plants.container
          : undefined;
    if (standing === undefined || standing.parent !== layer) {
      if (
        this.floor.parent !== layer ||
        layer.getChildIndex(this.floor) !== layer.children.length - 1
      ) {
        layer.addChild(this.floor);
      }
      return;
    }
    const under = layer.getChildIndex(standing);
    if (this.floor.parent === layer && layer.getChildIndex(this.floor) === under - 1) return;
    layer.addChildAt(this.floor, layer.getChildIndex(standing));
  }

  /** Lay out what is stale, move the fades on, and ask for the ground the view needs. */
  update(dtS: number): void {
    if (this.stale && this.landMessage !== null) this.layOut();
    this.placeFloor();
    const { built, cells } = this;
    built.map?.tick(dtS);
    if (!this.still) this.seaTime += dtS;
    if (this.land !== null) {
      const ground =
        this.view === "middle"
          ? built.middle?.ground
          : this.view === "local"
            ? built.local?.ground
            : (built.map ?? undefined);
      this.seas[this.view].tick(
        this.seaTime,
        this.land,
        cells,
        ground === undefined ? null : ground.surf,
      );
    }
    if (built.middle !== null) {
      built.middle.ground.tick(dtS);
      built.middle.plants.tick(dtS, cells);
    }
    if (built.local !== null) {
      built.local.ground.tick(dtS);
      built.local.plants.tick(dtS, cells);
      if (this.view === "local") built.local.ground.cover(cells);
    }
  }

  /** Whether everything the view shows is painted from the latest land, and nothing is fading. */
  get settled(): boolean {
    if (this.stale || this.land === null || this.painter.busy > 0) return false;
    const { built } = this;
    if (this.view === "map") return built.map?.settled ?? false;
    if (this.view === "middle") {
      return (built.middle?.ground.settled ?? false) && !(built.middle?.plants.fading ?? true);
    }
    return (
      (built.local?.ground.ready(this.cells) ?? false) && !(built.local?.plants.fading ?? true)
    );
  }

  private time(): YearTime {
    return this.clock === null ? { season: "summer", progress: 0.5 } : yearOf(this.clock);
  }

  private layOut(): void {
    const message = this.landMessage;
    if (message === null) return;
    this.stale = false;
    this.laidOutDay = this.clock?.day_of_year ?? -1;
    if (this.land === null) {
      this.land = landOf(message, this.clock);
      this.landVersion = this.painter.setLand(this.land);
    } else {
      this.land = { ...this.land, season: this.clock?.season ?? this.land.season };
    }
    for (const name of VIEWS) {
      if (this.built[name] !== null || name === this.view) this.build(name);
    }
  }

  /** Make view `name` (again) for the current land and day. */
  private build(name: ViewName): void {
    const { land, look } = this;
    if (land === null) return;
    const time = this.time();
    const close = name !== "map";
    // Waves break on every coast in every view, the map's too (the owner, 2026-10-20).
    const request = { style: STYLES[name], grain: close, surf: true, look: look.name, time };
    if (name === "map") {
      if (this.built.map === null) {
        this.built.map = new WholeGround(this.painter, TILES.map, this.fadeS);
        const { container, surf } = this.built.map;
        this.layers.map.addChild(container, ...[...surf].reverse(), this.seas.map.glints);
      }
      void this.built.map.repaint(request, 5);
      return;
    }
    performance.mark(`lineage:plants:${name}`);
    const plants = standingPlants(land, TILES[name], {
      covered: this.covered ?? undefined,
      look,
      time,
      close: name === "local",
      lazy: name === "middle",
      pieces: this.bushPieces,
    });
    performance.measure(`lineage:plants:${name}`, `lineage:plants:${name}`);
    if (name === "middle") {
      if (this.built.middle === null) {
        this.built.middle = {
          ground: new WholeGround(this.painter, TILES.middle, this.fadeS),
          plants: new PlantFade(this.fadeS),
        };
        const { ground, plants: standing } = this.built.middle;
        this.layers.middle.addChild(
          ground.container,
          ...[...ground.surf].reverse(),
          this.seas.middle.glints,
          standing.container,
        );
      }
      const island = { x0: 0, y0: 0, x1: land.width, y1: land.height };
      void this.built.middle.ground.repaint(
        { ...request, calm: MIDDLE_CALM, shadows: plants.shadows(island) },
        10,
      );
      this.built.middle.plants.show(plants);
      return;
    }
    if (this.built.local === null) {
      this.built.local = {
        ground: new PieceGround(this.painter, TILES.local, land, this.fadeS),
        plants: new PlantFade(this.fadeS),
      };
      const { ground, plants: standing } = this.built.local;
      this.layers.local.addChild(
        ground.container,
        ...[...ground.surf].reverse(),
        this.seas.local.glints,
        standing.container,
      );
    }
    this.built.local.ground.update(this.landVersion, request, (cells) => plants.shadows(cells));
    this.built.local.plants.show(plants);
  }
}
