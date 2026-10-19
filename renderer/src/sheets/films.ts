/**
 * Films of the scene for the land sheet: the real R1 scene (`landscape.ts`) fed from the
 * committed recording, on a clock of its own, saved as animated PNGs that loop and play
 * without a script.
 *
 * The clock is the film's, not the wall's: each frame moves the scene on by a frame's
 * time, and when a cue hands the scene a new day the film waits for the ground to be
 * painted before going on, so the fade is filmed whole and every run films the same.
 */
import { Application, Container } from "pixi.js";
import { Landscape, TILES, type ViewName } from "../landscape";
import type { Message } from "../protocol";
import { ApngWriter, dataUri } from "../spike/apng";
import { InlinePainter } from "../terrain/painter";

/** What the camera looks at: a view, its middle in cells. */
export interface Shot {
  view: ViewName;
  x: number;
  y: number;
}

/** A message handed to the scene `at` seconds into the film. */
export interface Cue {
  at: number;
  message: Message;
}

export interface FilmOptions {
  seconds: number;
  fps: number;
  /** Seconds a new day takes to fade in (the scene's own is longer than a film can wait). */
  fadeS: number;
}

const WIDTH = 512;
const HEIGHT = 300;
const BACKGROUND = "#24529c";

/** Let the page's queue run: the inline painter paints a request a task. */
const pause = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export class Camera {
  private constructor(
    private readonly app: Application,
    private readonly into: CanvasRenderingContext2D,
  ) {}

  static async create(): Promise<Camera> {
    const app = new Application();
    await app.init({
      width: WIDTH,
      height: HEIGHT,
      background: BACKGROUND,
      antialias: false,
      roundPixels: true,
      resolution: 1,
      autoDensity: false,
      autoStart: false,
      sharedTicker: false,
      preserveDrawingBuffer: true,
    });
    const canvas = document.createElement("canvas");
    canvas.width = WIDTH;
    canvas.height = HEIGHT;
    const into = canvas.getContext("2d", { willReadFrequently: true });
    if (into === null) throw new Error("no 2D canvas");
    return new Camera(app, into);
  }

  /**
   * Film `shot`: the scene is first given `start` and let settle, then `cues` come at
   * their times. Returns the film as a data URI.
   */
  async film(
    shot: Shot,
    start: readonly Message[],
    cues: readonly Cue[],
    options: FilmOptions,
  ): Promise<string> {
    const painter = new InlinePainter();
    const landscape = new Landscape(painter, undefined, options.fadeS);
    const world = new Container();
    world.addChild(landscape.container);
    this.app.stage.removeChildren();
    this.app.stage.addChild(world);
    const tile = TILES[shot.view];
    const cells = {
      x0: shot.x - WIDTH / tile / 2,
      y0: shot.y - HEIGHT / tile / 2,
      x1: shot.x + WIDTH / tile / 2,
      y1: shot.y + HEIGHT / tile / 2,
    };
    world.scale.set(tile);
    world.position.set(Math.round(-cells.x0 * tile), Math.round(-cells.y0 * tile));
    landscape.show(shot.view, cells);
    for (const message of start) landscape.receive(message);
    /** Move the scene on by `dtS`, then wait until what it asked to paint is painted. */
    const step = async (dtS: number): Promise<void> => {
      landscape.show(shot.view, cells);
      landscape.update(dtS);
      while (painter.busy > 0) await pause();
      await pause();
    };
    await step(0);
    for (let tries = 0; !landscape.settled && tries < 400; tries++) await step(0.1);

    const writer = new ApngWriter(WIDTH, HEIGHT, Math.round(1000 / options.fps));
    const frames = Math.round(options.seconds * options.fps);
    const pending = [...cues].sort((a, b) => a.at - b.at);
    for (let frame = 0; frame < frames; frame++) {
      const time = frame / options.fps;
      while (pending.length > 0 && (pending[0]?.at ?? Infinity) <= time) {
        const cue = pending.shift();
        if (cue !== undefined) landscape.receive(cue.message);
      }
      await step(frame === 0 ? 0 : 1 / options.fps);
      this.app.render();
      this.into.drawImage(this.app.canvas, 0, 0);
      await writer.add(this.into.getImageData(0, 0, WIDTH, HEIGHT).data);
    }
    painter.dispose();
    return dataUri(writer.finish(), "image/png");
  }
}
