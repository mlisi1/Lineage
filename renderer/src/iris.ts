/**
 * The iris between views (R5, the owner: "we just have to mask the load times"): live, a
 * change of view closes a circle on the middle of the screen, in the dip's purple and in
 * stepped pixels; while it is shut a small ring of dots turns in the middle; then it opens
 * from the middle of the new view only as far as that view's ground is painted out from
 * its middle (`Landscape.openTo`), which is the order the pieces are painted in. Films and
 * stills keep the plain dip (`main.ts`).
 */
import { CanvasSource, Sprite, Texture } from "pixi.js";

/** How far open the ground must allow (0–1) before the iris starts opening: not a slit. */
export const IRIS_FROM = 0.12;
/** Canvas pixels to an iris block: the circle's edge steps by this much. */
export const IRIS_BLOCK = 2;
/** How fast the iris may open beyond the dip's own pace, in widths a second, catching up with ground that has come. */
export const IRIS_CATCH_UP = 2.5;
/**
 * The loading ring: its dots, each this many blocks square, its radius in blocks, and turns
 * a second (the head steps from dot to dot).
 */
export const LOADER_DOTS = 8;
export const LOADER_DOT = 2;
export const LOADER_RADIUS = 8;
export const LOADER_TURNS = 1;
/** Seconds the loading ring takes to come and to go. */
export const LOADER_FADE_S = 0.15;

/**
 * How open the iris is after `dtS` (0 shut, 1 open): never more open than the dip says
 * (`dim`, the director's) nor than the ground painted allows (`limit`); closing at once
 * with the dip, opening at the dip's pace or, behind it, catching up at `IRIS_CATCH_UP`.
 */
export function irisStep(open: number, dim: number, limit: number, dtS: number): number {
  const target = Math.min(1 - dim, Math.max(limit, 0));
  if (target <= open) return Math.max(target, 0);
  return Math.min(target, open + IRIS_CATCH_UP * dtS);
}

/** The colour `share` (0–1) of the way from `from` to `to`, both 0xrrggbb. */
function mix(from: number, to: number, share: number): number {
  const channel = (shift: number): number => {
    const a = (from >> shift) & 255;
    const b = (to >> shift) & 255;
    return Math.round(a + (b - a) * share) << shift;
  };
  return channel(16) | channel(8) | channel(0);
}

/** 0xrrggbb as the little-endian RGBA word of a pixel, opaque. */
const word = (rgb: number): number =>
  (0xff << 24) | ((rgb & 255) << 16) | (rgb & 0xff00) | ((rgb >> 16) & 255);

/**
 * Fill `pixels` (`width` × `height` blocks, RGBA words) with the iris: `colour` outside a
 * circle of `radius` blocks round the middle, see-through inside; and, where `loader` > 0,
 * the loading ring in `ink` at `turn` (0–1 of a turn), `loader` of the way in.
 */
export function drawIris(
  pixels: Uint32Array,
  width: number,
  height: number,
  radius: number,
  colour: number,
  loader = 0,
  turn = 0,
  ink = 0xffffff,
): void {
  const solid = word(colour);
  const cx = width / 2;
  const cy = height / 2;
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - cy;
    const row = y * width;
    const reach = radius * radius - dy * dy;
    if (reach <= 0) {
      pixels.fill(solid, row, row + width);
      continue;
    }
    const half = Math.sqrt(reach);
    const left = Math.min(Math.max(Math.round(cx - half), 0), width);
    const right = Math.min(Math.max(Math.round(cx + half), left), width);
    pixels.fill(solid, row, row + left);
    pixels.fill(0, row + left, row + right);
    pixels.fill(solid, row + right, row + width);
  }
  if (loader <= 0) return;
  // The ring: the head dot brightest, the ones behind it fading into the dark.
  const head = Math.floor(turn * LOADER_DOTS) % LOADER_DOTS;
  for (let dot = 0; dot < LOADER_DOTS; dot++) {
    const behind = (head - dot + LOADER_DOTS) % LOADER_DOTS;
    const bright = (1 - behind / LOADER_DOTS) * loader;
    const angle = (dot / LOADER_DOTS) * 2 * Math.PI - Math.PI / 2;
    const x0 = Math.round(cx + Math.cos(angle) * LOADER_RADIUS - LOADER_DOT / 2);
    const y0 = Math.round(cy + Math.sin(angle) * LOADER_RADIUS - LOADER_DOT / 2);
    const lit = word(mix(colour, ink, bright));
    for (let y = Math.max(y0, 0); y < Math.min(y0 + LOADER_DOT, height); y++) {
      for (let x = Math.max(x0, 0); x < Math.min(x0 + LOADER_DOT, width); x++) {
        pixels[y * width + x] = lit;
      }
    }
  }
}

/** The iris over the canvas: a texture of blocks, drawn again only while it moves. */
export class Iris {
  readonly sprite: Sprite;
  /** How open it is (0 shut, 1 open: not drawn). */
  open = 1;
  private loader = 0;
  private turn = 0;
  private readonly context: CanvasRenderingContext2D;
  private readonly image: ImageData;
  private readonly pixels: Uint32Array;
  private readonly source: CanvasSource;
  private readonly width: number;
  private readonly height: number;
  private drawn = "";

  /** Over a canvas of `width` × `height` pixels, in `colour`, its ring in `ink`. */
  constructor(
    width: number,
    height: number,
    private readonly colour: number,
    private readonly ink: number,
  ) {
    this.width = Math.ceil(width / IRIS_BLOCK);
    this.height = Math.ceil(height / IRIS_BLOCK);
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2D canvas for the iris");
    this.context = context;
    this.image = context.createImageData(this.width, this.height);
    this.pixels = new Uint32Array(this.image.data.buffer);
    this.source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
    this.sprite = new Sprite(new Texture({ source: this.source }));
    this.sprite.scale.set(IRIS_BLOCK);
    this.sprite.visible = false;
  }

  /** Whether the iris is shut, the screen all its colour. */
  get shut(): boolean {
    return this.open <= 0;
  }

  /**
   * Move it on by `dtS` toward what the dip says (`dim`) and the ground allows (`limit`,
   * 0–1 of the way open), and draw it if it changed.
   */
  update(dtS: number, dim: number, limit: number): void {
    this.open = irisStep(this.open, dim, limit, dtS);
    const fade = dtS / LOADER_FADE_S;
    this.loader = this.shut ? Math.min(this.loader + fade, 1) : Math.max(this.loader - fade, 0);
    this.turn = this.loader > 0 ? (this.turn + dtS * LOADER_TURNS) % 1 : 0;
    const visible = this.open < 1;
    if (this.sprite.visible !== visible) this.sprite.visible = visible;
    if (!visible) return;
    const radius = Math.hypot(this.width / 2, this.height / 2) * this.open;
    const head = Math.floor(this.turn * LOADER_DOTS);
    const state = `${Math.round(radius)}|${this.loader.toFixed(2)}|${head}`;
    if (state === this.drawn) return;
    this.drawn = state;
    drawIris(
      this.pixels,
      this.width,
      this.height,
      Math.round(radius),
      this.colour,
      this.loader,
      this.turn,
      this.ink,
    );
    this.context.putImageData(this.image, 0, 0);
    this.source.update();
  }
}
