/**
 * The place of the entry on the scroll (R5): while a chronicle entry with a place is out
 * on the scroll (`captions.ts`), a small pixel marker stands where it happened, a pin with
 * a ring that swells from it and fades, over and over, so that the eye finds it on the
 * map. In the middle and local views it shows only when the place is in sight (the local
 * view's camera goes to see it: `director.ts`). It is drawn in whole art pixels, the same
 * size at every zoom but for the ring's reach, in the scroll's own paper and ink.
 *
 * The ring's pixels are pure (`ringPixels`); `PlaceMarker` puts them on screen.
 */
import { Container, Graphics } from "pixi.js";
import type { Point } from "./camera";
import { INK, PAPER } from "./captions";
import type { ViewName } from "./landscape";
import type { CellRect } from "./terrain/land";

/** Seconds a ring takes to swell from the pin to its widest. */
export const PULSE_S = 1.6;
/** The ring's radius at the start and end of a swell in each view (art pixels). */
export const RING_REACH: Readonly<Record<ViewName, readonly [number, number]>> = {
  map: [5, 10],
  middle: [6, 13],
  local: [8, 18],
};
/**
 * The ring's opacity as it swells, in steps (pixel art fades by steps, not smoothly): full
 * at first, then each step for an equal share of the swell.
 */
const RING_ALPHAS = [1, 1, 1, 0.6] as const;
/**
 * The pin at the middle: a diamond this many art pixels from its middle to a tip in each
 * view, outlined in paper and ink.
 */
const PIN_RADIUS: Readonly<Record<ViewName, number>> = { map: 1, middle: 2, local: 3 };
/** Half the ring's paper band, and the ink band on each side of it (art pixels). */
const PAPER_HALF = 0.5;
const INK_BAND = 1;
/** The pin's heart: a warm rose, so that it reads against the green of the land and the blue of the sea. */
const PIN_COLOUR = 0xe0614a;
/** Art pixels beyond the view a marker may stand and still be drawn: past its widest ring. */
const OVERHANG = 20;

/**
 * The art pixels of a ring round (0, 0) whose middles lie at least `inner` and less than
 * `outer` art pixels from it. Rings of neighbouring bands fit together without gaps.
 */
export function ringPixels(inner: number, outer: number): Point[] {
  const pixels: Point[] = [];
  const reach = Math.ceil(outer);
  for (let y = -reach; y <= reach; y++) {
    for (let x = -reach; x <= reach; x++) {
      const distance = Math.hypot(x, y);
      if (distance >= inner && distance < outer) pixels.push({ x, y });
    }
  }
  return pixels;
}

/** The art pixels of a filled diamond of `radius` round (0, 0). */
function diamondPixels(radius: number): Point[] {
  const pixels: Point[] = [];
  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      const reach = Math.abs(x) + Math.abs(y);
      if (reach <= radius) pixels.push({ x, y });
    }
  }
  return pixels;
}

/** The ring's radius and opacity `t` seconds into the marker's showing, in `view`. */
export function ringAt(t: number, view: ViewName): { radius: number; alpha: number } {
  const [from, to] = RING_REACH[view];
  const share = (t / PULSE_S) % 1;
  const radius = from + Math.floor(share * (to - from + 1));
  const step = Math.min(Math.floor(share * RING_ALPHAS.length), RING_ALPHAS.length - 1);
  return { radius: Math.min(radius, to), alpha: RING_ALPHAS[step] ?? 1 };
}

/** The marker on screen: one per scene, over the world and under the sky's effects. */
export class PlaceMarker {
  readonly container = new Container();
  private readonly ring = new Graphics();
  private readonly pin = new Graphics();
  private t = 0;
  private drawn: { radius: number; view: ViewName } | null = null;
  private pinned: ViewName | null = null;
  private place: Point | null = null;

  constructor() {
    this.container.visible = false;
    this.container.addChild(this.ring, this.pin);
  }

  /**
   * Show `place` (in cells; null for nothing) in `view`, whose `cells` are in sight at
   * `tile` art pixels to the cell, the world's cell (0, 0) lying at `origin` on the
   * canvas (whole art pixels).
   */
  update(
    dtS: number,
    place: Point | null,
    view: ViewName,
    cells: CellRect,
    tile: number,
    origin: Point,
  ): void {
    if (place?.x !== this.place?.x || place?.y !== this.place?.y) this.t = 0;
    this.place = place;
    this.t += dtS;
    const inSight =
      place !== null &&
      (view === "map" ||
        ((place.x - cells.x0) * tile > -OVERHANG &&
          (cells.x1 - place.x) * tile > -OVERHANG &&
          (place.y - cells.y0) * tile > -OVERHANG &&
          (cells.y1 - place.y) * tile > -OVERHANG));
    this.container.visible = inSight;
    if (!inSight) return;
    this.container.position.set(
      origin.x + Math.floor(place.x * tile),
      origin.y + Math.floor(place.y * tile),
    );
    if (this.pinned !== view) {
      // The pin: a rose diamond, ringed in paper and outlined in ink.
      this.pinned = view;
      const pin = PIN_RADIUS[view];
      this.pin.clear();
      paint(this.pin, diamondPixels(pin + 2), INK);
      paint(this.pin, diamondPixels(pin + 1), PAPER);
      paint(this.pin, diamondPixels(pin), PIN_COLOUR);
    }
    const { radius, alpha } = ringAt(this.t, view);
    this.ring.alpha = alpha;
    if (this.drawn?.radius === radius && this.drawn.view === view) return;
    this.drawn = { radius, view };
    this.ring.clear();
    // A ring of paper with ink on both sides, so that it reads on light ground and dark.
    paint(this.ring, ringPixels(radius - PAPER_HALF - INK_BAND, radius - PAPER_HALF), INK);
    paint(this.ring, ringPixels(radius - PAPER_HALF, radius + PAPER_HALF), PAPER);
    paint(this.ring, ringPixels(radius + PAPER_HALF, radius + PAPER_HALF + INK_BAND), INK);
  }
}

/** Fill one art pixel for each of `pixels` in `colour`. */
function paint(graphics: Graphics, pixels: readonly Point[], colour: number): void {
  for (const { x, y } of pixels) graphics.rect(x, y, 1, 1);
  graphics.fill(colour);
}
