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
import type { Land } from "./land";
import type { Pixels } from "./pixels";

/** What to paint: the painter's options, without what cannot cross to a worker. */
export interface PaintRequest extends Omit<GroundOptions, "look" | "seasonAt"> {
  /** The name of a look (`looks.ts`); the default look if left out. */
  look?: string;
  /** Where the world is in its year: the ground turns place by place around a change of season. */
  time?: YearTime;
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
  /** Requests waiting or being painted. */
  readonly busy: number;
  dispose(): void;
}

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

/** The queue both painters share: the lowest priority first, then the oldest. */
abstract class QueuedPainter implements Painter {
  protected version = 0;
  private queue: Queued[] = [];
  private running: Queued | null = null;
  private order = 0;

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
    return this.queue.length + (this.running === null ? 0 : 1);
  }

  dispose(): void {
    this.drop(() => true);
  }

  protected abstract sendLand(land: Land, version: number): void;
  protected abstract start(request: PaintRequest): void;

  /** The running request is done: hand it its pixels and start the next. */
  protected finished(pixels: Pixels | Error, landVersion: number): void {
    const done = this.running;
    this.running = null;
    if (done !== null) {
      if (pixels instanceof Error) done.reject(pixels);
      else done.resolve({ pixels, landVersion });
    }
    this.next();
  }

  private next(): void {
    if (this.running !== null || this.queue.length === 0) return;
    this.queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
    const first = this.queue.shift();
    if (first === undefined) return;
    this.running = first;
    this.start(first.request);
  }
}

/** Painting on the page's own thread, one request a task: for tests, and where workers are not. */
export class InlinePainter extends QueuedPainter {
  private land: Land | null = null;
  private landVersion = 0;

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
      this.finished(paintRequest(land, request), this.landVersion);
    }, 0);
  }
}

/** Messages to and from the worker. */
export type ToWorker =
  { kind: "land"; land: Land; version: number } | { kind: "paint"; request: PaintRequest };
export type FromWorker =
  | { kind: "painted"; pixels: Pixels; landVersion: number }
  | { kind: "failed"; message: string; landVersion: number };

/** Painting in a Web Worker: the page goes on drawing frames meanwhile. */
export class WorkerPainter extends QueuedPainter {
  private readonly worker: Worker;

  constructor() {
    super();
    this.worker = new Worker(new URL("./paint.worker.ts", import.meta.url), { type: "module" });
    this.worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
      const reply = event.data;
      this.finished(
        reply.kind === "painted" ? reply.pixels : new Error(reply.message),
        reply.landVersion,
      );
    });
  }

  protected sendLand(land: Land, version: number): void {
    const message: ToWorker = { kind: "land", land, version };
    this.worker.postMessage(message);
  }

  protected start(request: PaintRequest): void {
    const message: ToWorker = { kind: "paint", request };
    this.worker.postMessage(message);
  }

  override dispose(): void {
    super.dispose();
    this.worker.terminate();
  }
}

/** A worker where the browser has them, else the page's own thread. */
export function makePainter(): Painter {
  return typeof Worker === "undefined" ? new InlinePainter() : new WorkerPainter();
}
