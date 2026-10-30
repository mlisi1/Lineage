/**
 * The portrait on the name card (R5, `card.ts`): the animal followed, drawn from its genes
 * in its own colours by the scene's own creature layer, posed straight and facing right,
 * once, into pixels the card paints. A torpid animal is drawn curled up, a young one as
 * small as it is.
 *
 * How: a creature layer of its own holds the one animal, with the local view's body
 * options and species plans, so the drawing is the scene's. It is drawn into a texture at
 * a zoom that makes the body fill the portrait (the body options' `pixels` follow the zoom,
 * so an outline stays one art pixel wide, as R2's creature sheet draws its portraits), and
 * its pixels are read back. Portraits are kept by the herd's key (`Herd.portraitOf`), which
 * changes when the drawing would, so each animal is drawn once while it looks the same.
 */
import { PROBE } from "../frameprobe";
import { Container, Rectangle, WebGLRenderer, type Renderer, type Texture } from "pixi.js";
import type { Atlas } from "./atlas";
import type { BodyOptions } from "./body";
import { CreatureLayer } from "./layer";
import type { CreatureSeed } from "./seed";
import type { SpeciesPlan } from "./species";
import { WATER_LOOK } from "./views";
import { mulberry32 } from "../rng";
import type { Pixels } from "../terrain/pixels";

/** What a portrait is drawn from (`Herd.portraitOf`). */
export interface Portrait {
  /** The animal's id. */
  id: number;
  /** Changes whenever the drawing would. */
  key: string;
  /** Changes whenever the drawing's size would (not with its colours alone). */
  shape: string;
  seed: CreatureSeed;
  /** What each species is drawn as in the scene. */
  plans: ReadonlyMap<number, SpeciesPlan>;
  /** The body options of the view it is drawn from (the local view's). */
  body: BodyOptions;
}

/** Art pixels across (and down) the portrait's square. */
export const PORTRAIT_SIZE = 44;
/** The body, its legs and its shadow fit within this many art pixels of the square. */
const PORTRAIT_FIT = 40;
/**
 * The most a body is drawn larger than in the local view: a small animal fills the
 * square, but its outline and eyes are not blown up past what the scene would make of a
 * body this size.
 */
const MOST_ENLARGED = 3;
/** Tries at the zoom: a body is measured, drawn to fit, and drawn smaller if it still spills over. */
const FIT_TRIES = 3;
/** Facing right: the head toward +x. */
const FACING_RIGHT = 0;
/** Portraits kept at most (a few animals followed in turn); the oldest drawn goes first. */
const PORTRAITS_KEPT = 8;
/** The seed of the portrait layer's random stream: it draws, it does not wander. */
const PORTRAIT_RANDOM_SEED = 1;
/** Alpha of an opaque pixel. */
const OPAQUE = 255;

export class Portraits {
  private readonly kept = new Map<string, Pixels>();
  /** The zoom each body's portrait was last fitted at, by its shape (`Portrait.shape`). */
  private readonly zooms = new Map<string, number>();
  /** The latest portrait of each animal (shown while its next one is drawn). */
  private readonly latest = new Map<number, Pixels>();
  /** A portrait being drawn over a few frames (`asynchronous`): its steps and the read in flight. */
  private pending: {
    key: string;
    portrait: Portrait;
    steps: Generator<number, Pixels, Pixels>;
    reading: PixelRead | null;
  } | null = null;

  /**
   * With `asynchronous`, a portrait's pixels are read back from the GPU without waiting
   * for it (R5, the optimization plan's Phase 1: `readPixels` waited for every draw queued
   * before it, a long frame each time); `of` then answers null until they come, a frame
   * or a few later. Without (films, stills and tests), they are read at once, as before.
   */
  constructor(
    private readonly renderer: Renderer,
    private readonly atlas: Atlas,
    private readonly asynchronous = false,
  ) {}

  /**
   * The portrait of `portrait`'s animal, `PORTRAIT_SIZE` square, drawn once per key; null
   * while it is still being drawn (asynchronous only).
   */
  of(portrait: Portrait): Pixels | null {
    const known = this.kept.get(portrait.key);
    if (known !== undefined) return known;
    if (!this.asynchronous) {
      const steps = this.fit(portrait);
      let step = steps.next();
      while (step.done !== true) step = steps.next(this.drawNow(portrait, step.value));
      return this.keep(portrait, step.value);
    }
    let pending = this.pending;
    if (pending?.key !== portrait.key) {
      // Another animal (or look) asked for: what was being drawn is dropped.
      pending?.reading?.cancel();
      const steps = this.fit(portrait);
      pending = { key: portrait.key, portrait, steps, reading: null };
      this.pending = pending;
      const first = steps.next();
      if (first.done === true) return this.keep(portrait, first.value);
      pending.reading = this.drawLater(portrait, first.value);
    }
    const read = pending.reading?.poll() ?? null;
    if (read === null) return null;
    const step = pending.steps.next(read);
    if (step.done === true) {
      this.pending = null;
      return this.keep(portrait, step.value);
    }
    pending.reading = this.drawLater(portrait, step.value);
    return null;
  }

  /** The latest portrait drawn of animal `id`, if any. */
  latestOf(id: number): Pixels | null {
    return this.latest.get(id) ?? null;
  }

  private keep(portrait: Portrait, drawn: Pixels): Pixels {
    this.kept.set(portrait.key, drawn);
    this.latest.delete(portrait.id);
    this.latest.set(portrait.id, drawn);
    for (const map of [this.kept, this.latest] as Map<unknown, Pixels>[]) {
      for (const key of map.keys()) {
        if (map.size <= PORTRAITS_KEPT) break;
        map.delete(key);
      }
    }
    return drawn;
  }

  /**
   * Drawn at the zoom that makes it fill the square, centred in it: the zooms to draw at,
   * one after another, each answered with what it drew. A body of a shape fitted before
   * starts at the zoom it ended at, which it would come to again (its colours do not
   * change its size): drawn once instead of measured first.
   */
  private *fit(portrait: Portrait): Generator<number, Pixels, Pixels> {
    const base = portrait.body.pixels;
    const known = this.zooms.get(portrait.shape);
    if (known !== undefined) return centred(yield known, PORTRAIT_SIZE);
    let zoom = base;
    let drawn = yield zoom;
    for (let tries = 0; tries < FIT_TRIES; tries++) {
      const longest = Math.max(drawn.width, drawn.height, 1);
      const wanted = Math.min((zoom * PORTRAIT_FIT) / longest, base * MOST_ENLARGED);
      if (longest <= PORTRAIT_FIT && Math.abs(wanted - zoom) < 1) break;
      zoom = wanted;
      drawn = yield zoom;
    }
    this.zooms.set(portrait.shape, zoom);
    return centred(drawn, PORTRAIT_SIZE);
  }

  /** The animal drawn at `zoom` art pixels to the cell, cropped to what it covers. */
  private drawNow(portrait: Portrait, zoom: number): Pixels {
    const { holder, frame } = this.stage(portrait, zoom);
    const read = this.renderer.extract.pixels({
      target: holder,
      frame,
      resolution: 1,
      antialias: false,
      clearColor: [0, 0, 0, 0],
    });
    holder.destroy({ children: true });
    return finish(read.pixels, read.width, read.height);
  }

  /** As `drawNow`, its pixels read back without waiting for the GPU (WebGL2; else at once). */
  private drawLater(portrait: Portrait, zoom: number): PixelRead {
    const { holder, frame } = this.stage(portrait, zoom);
    const texture = this.renderer.textureGenerator.generateTexture({
      target: holder,
      frame,
      resolution: 1,
      antialias: false,
      clearColor: [0, 0, 0, 0],
    });
    holder.destroy({ children: true });
    return readLater(this.renderer, texture);
  }

  /** The animal laid out at `zoom`, and the box of whole art pixels it covers. */
  private stage(portrait: Portrait, zoom: number): { holder: Container; frame: Rectangle } {
    PROBE.note("portrait-draw");
    const layer = new CreatureLayer(
      this.atlas,
      [],
      () => true,
      mulberry32(PORTRAIT_RANDOM_SEED),
      { ...portrait.body, pixels: zoom },
      "wander",
      null,
      WATER_LOOK,
    );
    layer.usePlans(portrait.plans);
    const { seed } = portrait;
    // Placed awake, so that it can be laid out straight, then curled up if it is torpid.
    layer.place(0, { ...seed, x: 0, y: 0, torpid: false });
    layer.pin(0, 0, 0, FACING_RIGHT);
    layer.setTorpid(0, seed.torpid);
    layer.update(0);
    const zoomed = new Container();
    zoomed.scale.set(zoom);
    zoomed.addChild(layer.container);
    const holder = new Container();
    holder.addChild(zoomed);
    // Whole art pixels, as the scene places its world.
    const bounds = holder.getLocalBounds();
    const x0 = Math.floor(bounds.minX);
    const y0 = Math.floor(bounds.minY);
    const frame = new Rectangle(
      x0,
      y0,
      Math.max(Math.ceil(bounds.maxX) - x0, 1),
      Math.max(Math.ceil(bounds.maxY) - y0, 1),
    );
    return { holder, frame };
  }
}

/** Pixels read back from the GPU: unpremultiplied, and cut to what is not see-through. */
function finish(pixels: Uint8ClampedArray | Uint8Array, width: number, height: number): Pixels {
  const rgba = new Uint8ClampedArray(pixels);
  unpremultiply(rgba);
  return cropped({ width, height, rgba });
}

/** A read of a texture's pixels under way: `poll` answers them once they have come. */
export interface PixelRead {
  poll(): Pixels | null;
  cancel(): void;
}

/**
 * Read `texture`'s pixels as Pixi's `getPixels` does, the same bytes, but into a buffer on
 * the GPU and fetched once a fence says the GPU is done (WebGL2), so that the page does
 * not wait for every draw queued before it. Without WebGL2, read at once.
 */
function readLater(renderer: Renderer, texture: Texture): PixelRead {
  const frame = texture.frame;
  const resolution = texture.source.resolution;
  const width = Math.max(Math.round(frame.width * resolution), 1);
  const height = Math.max(Math.round(frame.height * resolution), 1);
  const gl = renderer instanceof WebGLRenderer ? renderer.gl : null;
  if (gl === null || !(gl instanceof WebGL2RenderingContext)) {
    const read = renderer.texture.getPixels(texture);
    texture.destroy(true);
    const done = finish(read.pixels, read.width, read.height);
    return { poll: () => done, cancel: () => undefined };
  }
  const webgl = renderer as WebGLRenderer;
  const target = webgl.renderTarget.getRenderTarget(texture);
  const glTarget = webgl.renderTarget.getGpuRenderTarget(target) as {
    resolveTargetFramebuffer: WebGLFramebuffer;
  };
  webgl.renderTarget.adaptor.bindFramebuffer(glTarget.resolveTargetFramebuffer);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
  gl.bufferData(gl.PIXEL_PACK_BUFFER, 4 * width * height, gl.STREAM_READ);
  gl.readPixels(
    Math.round(frame.x * resolution),
    Math.round(frame.y * resolution),
    width,
    height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    0,
  );
  gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
  const fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
  gl.flush();
  let done: Pixels | null = null;
  let open = true;
  const close = (): void => {
    if (!open) return;
    open = false;
    gl.deleteSync(fence);
    gl.deleteBuffer(buffer);
    texture.destroy(true);
  };
  return {
    poll: () => {
      if (done !== null || !open) return done;
      const status = gl.clientWaitSync(fence as WebGLSync, 0, 0);
      if (status !== gl.ALREADY_SIGNALED && status !== gl.CONDITION_SATISFIED) return null;
      const pixels = new Uint8Array(4 * width * height);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, pixels);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
      close();
      done = finish(pixels, width, height);
      return done;
    },
    cancel: close,
  };
}

/** The colours read back are multiplied by their alpha (the shadow's): divided out again. */
function unpremultiply(rgba: Uint8ClampedArray): void {
  for (let at = 0; at < rgba.length; at += 4) {
    const alpha = rgba[at + 3] ?? 0;
    if (alpha === 0 || alpha === OPAQUE) continue;
    for (let channel = 0; channel < 3; channel++) {
      rgba[at + channel] = ((rgba[at + channel] ?? 0) * OPAQUE) / alpha;
    }
  }
}

/** `pixels` cut down to the box of what is not see-through. */
function cropped(pixels: Pixels): Pixels {
  const { width, height, rgba } = pixels;
  let x0 = width;
  let y0 = height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if ((rgba[4 * (y * width + x) + 3] ?? 0) === 0) continue;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      y0 = Math.min(y0, y);
      y1 = Math.max(y1, y);
    }
  }
  if (x1 < 0) return { width: 0, height: 0, rgba: new Uint8ClampedArray(0) };
  return copyBox(pixels, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 0, 0);
}

/** `pixels` in the middle of a see-through square `size` across (cut if larger). */
function centred(pixels: Pixels, size: number): Pixels {
  const left = Math.floor((size - pixels.width) / 2);
  const top = Math.floor((size - pixels.height) / 2);
  return copyBox(pixels, 0, 0, pixels.width, pixels.height, left, top, size, size);
}

/**
 * A `width` by `height` picture with the `w` by `h` box of `pixels` at (sx, sy) copied to
 * (dx, dy); what falls outside is left out.
 */
function copyBox(
  pixels: Pixels,
  sx: number,
  sy: number,
  w: number,
  h: number,
  dx: number,
  dy: number,
  width = w,
  height = h,
): Pixels {
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const tx = dx + x;
      const ty = dy + y;
      if (tx < 0 || ty < 0 || tx >= width || ty >= height) continue;
      const from = 4 * ((sy + y) * pixels.width + sx + x);
      rgba.set(pixels.rgba.subarray(from, from + 4), 4 * (ty * width + tx));
    }
  }
  return { width, height, rgba };
}
