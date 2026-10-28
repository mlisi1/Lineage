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
import { PROBE } from "./frameprobe";
import { Container } from "pixi.js";
import { DEFAULT_LOOK, type Look } from "./looks";
import { standingPlants, type PlantLayer } from "./plants/plants";
import type { YearTime } from "./plants/turning";
import type { Wind } from "./plants/wind";
import type { ClockMessage, LandMessage, Message } from "./protocol";
import { landOf, yearOf } from "./stream";
import { MAP_TILE, MID_TILE, type GroundStyle } from "./terrain/ground";
import {
  CLOSE_PIECES,
  FADE_S,
  PieceGround,
  WholeGround,
  type PieceOptions,
} from "./terrain/grounds";
import { NO_CACHE, type GroundCache } from "./terrain/groundcache";

declare const __BUILD_COMMIT__: string;

/**
 * The painter's code, for the stamps of the ground kept (`GroundCache`): the commit the
 * page was built from; none kept for a build with changes not committed, or under the
 * development server, whose painter may change from one page load to the next.
 */
const PAINTER_CODE =
  typeof __BUILD_COMMIT__ === "string" &&
  __BUILD_COMMIT__ !== "unknown" &&
  !__BUILD_COMMIT__.endsWith("-dirty") &&
  !import.meta.env.DEV
    ? __BUILD_COMMIT__
    : "";
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
/**
 * The middle view's ground in pieces (R5, the board): what is on the screen and a piece
 * round it are painted first, the rest of the island in the background (`prepaint`), and
 * every piece is kept, so that the view's drift finds it painted. One picture of the
 * whole island took the board's painter some 25 s before anything showed.
 */
const MIDDLE_PIECES: PieceOptions = { cells: 32, ahead: 32, kept: Infinity };
/**
 * A frame later than this (seconds; the cap's is a thirtieth) came late; the island is
 * painted ahead only once frames have come on time for `ON_TIME_S` (R5, the board).
 */
const LATE_FRAME_S = 0.045;
const ON_TIME_S = 3;
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

  /** Move the fade on by `dtS` for `view`, the plants leaning in `wind` (none: standing straight). */
  tick(dtS: number, view: CellRect, wind: Wind | null, shown = true): void {
    // A view not on the screen is neither culled nor blown (R5, review P3): both are worked
    // out afresh on the frame it comes back. Its fade goes on.
    if (shown) {
      this.current?.cull(view);
      this.current?.blow(wind);
    }
    if (this.outgoing === null || this.current === null) return;
    if (shown) {
      this.outgoing.cull(view);
      this.outgoing.blow(wind);
    }
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
  middle: { ground: PieceGround; plants: PlantFade } | null;
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
  /** Seconds since a frame came late (`framesOnTime`). */
  private sinceLate = Infinity;
  /** The day held (`holdDay`), and whether a land came while it was. */
  private held = false;
  private landWaiting = false;
  private laidOutDay = -1;
  /**
   * Bumped by every lay-out; each view built remembers the one it was built for, and is
   * built again when next shown if it is behind (R5: building every view at each new land
   * held the board's page for seconds; the view on the screen is built at once, the others
   * when they come on it).
   */
  private layoutVersion = 0;
  private readonly builtFor = new Map<ViewName, number>();
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
  /** Where painted ground is kept between visits (R5); nothing kept by default. */
  cache: GroundCache = NO_CACHE;
  /**
   * Whether the rest of the island is painted ahead after a new day (`PieceGround.prepaint`):
   * the desk's way; the showcase, which visits a few places, turns it off.
   */
  paintAhead = true;
  /** The wind the plants of the view shown lean in (R5, `plants/wind.ts`); none: straight. */
  wind: Wind | null = null;
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
   * Draw the local view's bushes in pieces, a sprite for each puff (R5, the owner's choice
   * on 2026-10-24; `?bushes=whole` draws them whole). Set before the first land comes.
   */
  bushPieces = true;

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
      if (this.held) this.landWaiting = true;
      else this.land = null;
      this.stale = true;
    }
  }

  /**
   * Hold the day (R5, the benchmark): the land and day drawn stay as they are while it is
   * held, what comes meanwhile is laid out when it is let go. On the desk a day turns once
   * a day; the benchmark plays its recording 1800 times as fast, a new day every 48 s.
   */
  set holdDay(held: boolean) {
    this.held = held;
    if (!held && this.landWaiting) {
      this.land = null;
      this.landWaiting = false;
    }
  }

  get holdDay(): boolean {
    return this.held;
  }

  /**
   * Whether the frames have come on time for a while (`ON_TIME_S`): the island is painted
   * ahead only then (`PieceGround.mayPaintAhead`).
   */
  get framesOnTime(): boolean {
    return this.sinceLate >= ON_TIME_S;
  }

  /**
   * Paint and keep the ground `view` will show over `cells`, behind what is on the screen
   * (R5, the showcase: where the camera goes next). Only a view built for the latest land.
   */
  prefetch(view: ViewName, cells: CellRect): void {
    if (this.land === null || view === "map" || this.behind(view)) return;
    const ground = view === "middle" ? this.built.middle?.ground : this.built.local?.ground;
    ground?.prefetch(cells);
  }

  /** Whether a new day or land is waiting to be laid out. */
  get dayDue(): boolean {
    return this.stale;
  }

  /** Show `name`, with `cells` of the world in sight. */
  show(name: ViewName, cells: CellRect): void {
    this.view = name;
    this.cells = cells;
    for (const view of VIEWS) this.layers[view].visible = view === name;
    if (this.land !== null && (this.built[name] === null || this.behind(name))) this.build(name);
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
    this.sinceLate = dtS > LATE_FRAME_S ? 0 : this.sinceLate + dtS;
    if (this.stale && this.landMessage !== null && !this.held) this.layOut();
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
      const shown = this.view === "middle";
      built.middle.plants.tick(dtS, cells, shown ? this.wind : null, shown);
      if (this.view === "middle") built.middle.ground.cover(cells);
    }
    if (built.local !== null) {
      built.local.ground.tick(dtS);
      const shown = this.view === "local";
      built.local.plants.tick(dtS, cells, shown ? this.wind : null, shown);
      if (this.view === "local") built.local.ground.cover(cells);
    }
  }

  /**
   * Whether the ground the view shows has been put on the screen from the latest land
   * (plants may still be fading in): what the showcase waits for in the dark between shots.
   */
  get groundShown(): boolean {
    if (this.stale || this.land === null) return false;
    const { built } = this;
    if (this.view === "map") return built.map?.settled ?? false;
    const ground = this.view === "middle" ? built.middle?.ground : built.local?.ground;
    return ground?.ready(this.cells) ?? false;
  }

  /** Whether everything the view shows is painted from the latest land, and nothing is fading. */
  get settled(): boolean {
    if (this.stale || this.land === null || this.painter.busy > 0) return false;
    const { built } = this;
    if (this.view === "map") return built.map?.settled ?? false;
    if (this.view === "middle") {
      return (
        (built.middle?.ground.ready(this.cells) ?? false) && !(built.middle?.plants.fading ?? true)
      );
    }
    return (
      (built.local?.ground.ready(this.cells) ?? false) && !(built.local?.plants.fading ?? true)
    );
  }

  private time(): YearTime {
    return this.clock === null ? { season: "summer", progress: 0.5 } : yearOf(this.clock);
  }

  private layOut(): void {
    PROBE.note("lay-out");
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
    this.layoutVersion += 1;
    this.build(this.view);
  }

  /** Whether view `name` was built for an older lay-out than the latest. */
  private behind(name: ViewName): boolean {
    return (this.builtFor.get(name) ?? -1) !== this.layoutVersion;
  }

  /**
   * What the ground painted now is made from, for the pieces kept (`GroundCache`): the
   * painter's code, the world, the land message, the day of the year, the look and how
   * the plants that throw shadows are drawn. "" (nothing kept) without a cache or a
   * committed build.
   */
  private stampOf(): string {
    const message = this.landMessage;
    if (this.cache === NO_CACHE || PAINTER_CODE === "" || message === null) return "";
    return [
      PAINTER_CODE,
      message.world.seed,
      message.t_ms,
      this.clock?.day_of_year ?? -1,
      this.look.name,
      this.bushPieces ? "pieces" : "whole",
      this.covered === null ? "open" : "covered",
    ].join("|");
  }

  /** Make view `name` (again) for the current land and day. */
  private build(name: ViewName): void {
    const { land, look } = this;
    if (land === null) return;
    this.builtFor.set(name, this.layoutVersion);
    const time = this.time();
    const close = name !== "map";
    // Waves break on every coast in every view, the map's too (the owner, 2026-10-20).
    const request = { style: STYLES[name], grain: close, surf: true, look: look.name, time };
    const stamp = this.stampOf();
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
          ground: new PieceGround(
            this.painter,
            TILES.middle,
            land,
            this.fadeS,
            MIDDLE_PIECES,
            this.cache,
          ),
          plants: new PlantFade(this.fadeS),
        };
        const { ground, plants: standing } = this.built.middle;
        ground.mayPaintAhead = () => this.framesOnTime;
        this.layers.middle.addChild(
          ground.container,
          ...[...ground.surf].reverse(),
          this.seas.middle.glints,
          standing.container,
        );
      }
      this.built.middle.ground.update(
        this.landVersion,
        { ...request, calm: MIDDLE_CALM },
        (cells) => plants.shadows(cells),
        stamp,
      );
      // The rest of the island painted ahead and kept, for wherever the camera goes next.
      if (this.paintAhead) void this.built.middle.ground.prepaint();
      this.built.middle.plants.show(plants);
      return;
    }
    if (this.built.local === null) {
      this.built.local = {
        ground: new PieceGround(
          this.painter,
          TILES.local,
          land,
          this.fadeS,
          CLOSE_PIECES,
          this.cache,
        ),
        plants: new PlantFade(this.fadeS),
      };
      const { ground, plants: standing } = this.built.local;
      ground.mayPaintAhead = () => this.framesOnTime;
      this.layers.local.addChild(
        ground.container,
        ...[...ground.surf].reverse(),
        this.seas.local.glints,
        standing.container,
      );
    }
    this.built.local.ground.update(
      this.landVersion,
      request,
      (cells) => plants.shadows(cells),
      stamp,
    );
    if (this.paintAhead) void this.built.local.ground.prepaint();
    this.built.local.plants.show(plants);
  }
}
