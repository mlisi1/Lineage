/**
 * Painting the ground off the frame (ADR 0007): on the board a piece of the local view
 * takes most of a second and the middle view's whole world about ten, which would stop
 * the picture. So grounds are painted in a Web Worker (`paint.worker.ts`) while the page
 * goes on drawing frames, and come back as pixels to be put on the screen.
 *
 * The page keeps its own queue and hands the worker one request at a time, so that what
 * the camera needs first is painted first and what it has left behind can be dropped.
 * Where there is no worker (tests, Node), `InlinePainter` does the same on the thread.
 */
import { DEFAULT_LOOK, LOOKS } from "../looks";
import { groundSeasons, type YearTime } from "../plants/turning";
import { paintGround, type GroundOptions } from "./ground";
import { NO_CACHE, type GroundCache } from "./groundcache";
import type { Land } from "./land";
import type { Pixels } from "./pixels";

/** What to paint: the painter's options, without what cannot cross to a worker. */
export interface PaintRequest extends Omit<GroundOptions, "look" | "seasonAt"> {
  /** The name of a look (`looks.ts`); the default look if left out. */
  look?: string;
  /** Where the world is in its year: the ground turns place by place around a change of season. */
  time?: YearTime;
  /**
   * Keep the painting (`GroundCache`, R5) under `key` for `stamp`, done by the painter so
   * that the page's thread neither copies nor stores it: one kept for `stamp` already is
   * handed back unpainted. Painted `ahead` (the island painted ahead of time), it is kept
   * and not handed back at all.
   */
  keep?: { key: string; stamp: string; ahead?: boolean };
}

/** Height between cells, interpolated as the painter reads it (u, v from the first cell's middle). */
function heightBetween(land: Land, u: number, v: number): number {
  const { width, height, heights } = land;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (x: number, y: number): number =>
    heights[Math.min(Math.max(y, 0), height - 1) * width + Math.min(Math.max(x, 0), width - 1)] ??
    0;
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
}

/** Paint `request` on `land`: what the worker and `InlinePainter` both do. */
export function paintRequest(land: Land, request: PaintRequest): Pixels {
  // (`keep` is for the painter, not the painting: `paintGround` reads no such option.)
  const { look: name, time, ...options } = request;
  const look = LOOKS.find((candidate) => candidate.name === name) ?? DEFAULT_LOOK;
  return paintGround(look.land === undefined ? land : { ...land, ...look.land }, {
    ...options,
    look,
    ...(time === undefined
      ? {}
      : {
          season: time.season,
          seasonAt: groundSeasons(time, (u, v) => heightBetween(land, u, v), land.seaLevel),
        }),
  });
}

/** A painted piece, and the land it was painted from (`Painter.setLand` counts them). */
export interface Painted {
  pixels: Pixels;
  landVersion: number;
  /** Painted now, not taken from what was kept (`PaintRequest.keep`). */
  fresh?: boolean;
}

/** No pixels: what a painting done ahead of time hands back. */
const NONE: Pixels = { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };

/**
 * Paint `request` on `land`, keeping it in `cache` as `request.keep` asks: what the worker
 * and `InlinePainter` both do.
 */
export async function paintKept(
  land: Land,
  request: PaintRequest,
  cache: GroundCache,
): Promise<{ pixels: Pixels; fresh: boolean }> {
  const { keep } = request;
  if (keep === undefined) return { pixels: paintRequest(land, request), fresh: true };
  const kept = await cache.get(keep.key);
  if (kept?.stamp === keep.stamp)
    return { pixels: keep.ahead === true ? NONE : kept.pixels, fresh: false };
  const pixels = paintRequest(land, request);
  cache.put(keep.key, keep.stamp, pixels);
  return { pixels: keep.ahead === true ? NONE : pixels, fresh: true };
}

export interface Painter {
  /** The land the requests from now on are painted on. Returns its version. */
  setLand(land: Land): number;
  /**
   * Paint `request` on the latest land. The lower `priority`, the sooner. Rejects with
   * `Dropped` if `drop` takes it off the queue first.
   */
  paint(request: PaintRequest, priority?: number): Promise<Painted>;
  /** Take off the queue every request not yet started for which `which` says so. */
  drop(which: (request: PaintRequest) => boolean): void;
  /** Requests waiting or being painted, but those in the background (`BACKGROUND`). */
  readonly busy: number;
  dispose(): void;
}

/**
 * Requests at this priority or beyond are painted in the background (the island painted
 * ahead of time, R5): after everything else, and not counted in `busy`.
 */
export const BACKGROUND = 1e9;

export class Dropped extends Error {
  constructor() {
    super("dropped from the paint queue");
  }
}

interface Queued {
  request: PaintRequest;
  priority: number;
  order: number;
  resolve: (painted: Painted) => void;
  reject: (error: Error) => void;
}

/**
 * The queue both painters share: the lowest priority first, then the oldest, as many at a
 * time as the painter has hands (`slots`).
 */
abstract class QueuedPainter implements Painter {
  protected version = 0;
  private queue: Queued[] = [];
  private readonly running: (Queued | null)[];
  private order = 0;

  constructor(slots = 1) {
    this.running = new Array<Queued | null>(Math.max(slots, 1)).fill(null);
  }

  setLand(land: Land): number {
    this.version += 1;
    this.sendLand(land, this.version);
    return this.version;
  }

  paint(request: PaintRequest, priority = 0): Promise<Painted> {
    return new Promise((resolve, reject) => {
      this.queue.push({ request, priority, order: this.order++, resolve, reject });
      this.next();
    });
  }

  drop(which: (request: PaintRequest) => boolean): void {
    const kept: Queued[] = [];
    for (const queued of this.queue) {
      if (which(queued.request)) queued.reject(new Dropped());
      else kept.push(queued);
    }
    this.queue = kept;
  }

  get busy(): number {
    const wanted = (each: Queued | null): boolean => each !== null && each.priority < BACKGROUND;
    return this.queue.filter(wanted).length + this.running.filter(wanted).length;
  }

  dispose(): void {
    this.drop(() => true);
  }

  protected abstract sendLand(land: Land, version: number): void;
  protected abstract start(request: PaintRequest, slot: number): void;

  /** The request running in `slot` is done: hand it its pixels and start the next. */
  protected finished(pixels: Pixels | Error, landVersion: number, slot = 0, fresh = true): void {
    const done = this.running[slot] ?? null;
    this.running[slot] = null;
    if (done !== null) {
      if (pixels instanceof Error) done.reject(pixels);
      else done.resolve({ pixels, landVersion, fresh });
    }
    this.next();
  }

  private next(): void {
    for (let slot = 0; slot < this.running.length; slot++) {
      if (this.running[slot] !== null) continue;
      if (this.queue.length === 0) return;
      this.queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
      const first = this.queue.shift();
      if (first === undefined) return;
      this.running[slot] = first;
      this.start(first.request, slot);
    }
  }
}

/** Painting on the page's own thread, one request a task: for tests, and where workers are not. */
export class InlinePainter extends QueuedPainter {
  private land: Land | null = null;
  private landVersion = 0;

  /** `cache` is where `PaintRequest.keep` keeps paintings. */
  constructor(private readonly cache: GroundCache = NO_CACHE) {
    super();
  }

  protected sendLand(land: Land, version: number): void {
    this.land = land;
    this.landVersion = version;
  }

  protected start(request: PaintRequest): void {
    setTimeout(() => {
      const { land } = this;
      if (land === null) {
        this.finished(new Error("painter: no land yet"), 0);
        return;
      }
      const version = this.landVersion;
      paintKept(land, request, this.cache).then(
        ({ pixels, fresh }) => this.finished(pixels, version, 0, fresh),
        (error: unknown) =>
          this.finished(error instanceof Error ? error : new Error(String(error)), version),
      );
    }, 0);
  }
}

/** Messages to and from the worker. */
export type ToWorker =
  { kind: "land"; land: Land; version: number } | { kind: "paint"; request: PaintRequest };
export type FromWorker =
  | { kind: "painted"; pixels: Pixels; landVersion: number; fresh: boolean }
  | { kind: "failed"; message: string; landVersion: number };

/**
 * Painting in Web Workers: the page goes on drawing frames meanwhile, and several pieces
 * are painted at once, one to a worker (R5: the board's four cores, one painting, left the
 * island's ground coming in slowly).
 */
export class WorkerPainter extends QueuedPainter {
  private readonly workers: Worker[];

  constructor(count = 1) {
    super(count);
    this.workers = Array.from({ length: Math.max(count, 1) }, (_, slot) => {
      const worker = new Worker(new URL("./paint.worker.ts", import.meta.url), { type: "module" });
      worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
        const reply = event.data;
        this.finished(
          reply.kind === "painted" ? reply.pixels : new Error(reply.message),
          reply.landVersion,
          slot,
          reply.kind === "painted" ? reply.fresh : true,
        );
      });
      return worker;
    });
  }

  protected sendLand(land: Land, version: number): void {
    const message: ToWorker = { kind: "land", land, version };
    for (const worker of this.workers) worker.postMessage(message);
  }

  protected start(request: PaintRequest, slot: number): void {
    const message: ToWorker = { kind: "paint", request };
    this.workers[slot]?.postMessage(message);
  }

  override dispose(): void {
    super.dispose();
    for (const worker of this.workers) worker.terminate();
  }
}

/** Painting workers at most. */
const MOST_PAINTERS = 3;
/**
 * Cores left to the page's own thread and the GPU's: on the board (four cores) three
 * painters took the frames' time in the local view, two do not (R5).
 */
const CORES_KEPT = 2;

/**
 * Workers where the browser has them, `CORES_KEPT` fewer than its cores (at most
 * `MOST_PAINTERS`, at least one), else the page's own thread.
 */
export function makePainter(): Painter {
  if (typeof Worker === "undefined") return new InlinePainter();
  const cores = typeof navigator === "undefined" ? 2 : (navigator.hardwareConcurrency ?? 2);
  return new WorkerPainter(Math.min(Math.max(cores - CORES_KEPT, 1), MOST_PAINTERS));
}
