/**
 * What the look sheet and the creature sheet share: finding and making elements, sizing
 * a canvas for a picture, placing creatures where their bodies can live, and naming them.
 */
import { bodyPlan, kindOf, patternOf } from "../creatures/body";
import { ApngWriter, dataUri } from "./apng";
import type { Point } from "../creatures/chain";
import type { CellRect } from "./camera";
import type { CreatureSeed, WorldFixture } from "./fixture";
import type { Passable } from "../creatures/habitat";
import { hexToRgb } from "./pixelart";
import type { Random } from "../rng";
import type { Picture, Stage } from "./stage";

declare global {
  interface Window {
    /** Set once every picture has been drawn (the report script waits for it). */
    __lookReady?: boolean;
    /**
     * The page as one self-contained HTML document, pictures as inline images. With
     * `film`, the pictures with animals in them are loops of that many seconds at that
     * many frames a second, which play without a script.
     */
    __lookStandalone?: (film?: { seconds: number; fps: number }) => Promise<string>;
  }
}

/** Cells kept clear of a region's edge when placing creatures in it. */
const PLACING_MARGIN = 3;
const PLACING_TRIES = 300;

export function element(id: string): HTMLElement {
  const found = document.getElementById(id);
  if (found === null) throw new Error(`the page has no #${id}`);
  return found;
}

export function create<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== "") node.className = className;
  if (text !== "") node.textContent = text;
  return node;
}

/** Size a canvas for a picture drawn at `width` × `height` and shown `enlarged` times. */
export function size(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  enlarged: number,
): void {
  canvas.width = width;
  canvas.height = height;
  canvas.style.width = `${width * enlarged}px`;
  canvas.style.height = `${height * enlarged}px`;
}

/** "#rrggbb" → 0xRRGGBB. */
export function packed(colour: string): number {
  const [r, g, b] = hexToRgb(colour);
  return (r << 16) | (g << 8) | b;
}

export const centreOf = (rect: CellRect): [number, number] => [
  (rect.x0 + rect.x1) / 2,
  (rect.y0 + rect.y1) / 2,
];
export const middle = (rect: CellRect): Point => ({
  x: (rect.x0 + rect.x1) / 2,
  y: (rect.y0 + rect.y1) / 2,
});

/** The whole cells within `margin` of a view of `width` × `height` cells around `centre`. */
export function around(
  centre: Point,
  width: number,
  height: number,
  margin: number,
  fixture: WorldFixture,
): CellRect {
  return {
    x0: Math.max(Math.floor(centre.x - width / 2) - margin, 0),
    y0: Math.max(Math.floor(centre.y - height / 2) - margin, 0),
    x1: Math.min(Math.ceil(centre.x + width / 2) + margin, fixture.width),
    y1: Math.min(Math.ceil(centre.y + height / 2) + margin, fixture.height),
  };
}

/** Copies of `seeds` placed at random in `region`, each where its body can live. */
export function scatter(
  seeds: readonly CreatureSeed[],
  region: CellRect,
  passable: Passable,
  random: Random,
): CreatureSeed[] {
  const width = region.x1 - region.x0 - 2 * PLACING_MARGIN;
  const height = region.y1 - region.y0 - 2 * PLACING_MARGIN;
  return seeds.map((seed) => {
    const swims = bodyPlan(seed).swims;
    // Should nothing fit (no water in sight for a swimmer), the layer moves it to the nearest.
    let spot = middle(region);
    for (let attempt = 0; attempt < PLACING_TRIES; attempt++) {
      const x = region.x0 + PLACING_MARGIN + random() * width;
      const y = region.y0 + PLACING_MARGIN + random() * height;
      if (passable(x, y, swims)) {
        spot = { x, y };
        break;
      }
    }
    return { ...seed, x: spot.x, y: spot.y };
  });
}

/** "lizard · herbivore · mass 0.9 · spots" */
export function describe(seed: CreatureSeed, fixture: WorldFixture): string {
  const diet =
    seed.diet <= fixture.herbivoreMaxDiet
      ? "herbivore"
      : seed.diet >= fixture.predatorMinDiet
        ? "predator"
        : "omnivore";
  const mass = seed.mass >= 10 ? seed.mass.toFixed(0) : seed.mass.toFixed(1);
  return `${kindOf(seed)} · ${diet} · mass ${mass} · ${patternOf(seed.pattern).pattern}`;
}

/** A rectangle of cells `x` and `y` either side of `centre`. */
export const pen = (centre: Point, reach: { x: number; y: number }): CellRect => ({
  x0: centre.x - reach.x,
  y0: centre.y - reach.y,
  x1: centre.x + reach.x,
  y1: centre.y + reach.y,
});

/** A picture on the page and the canvas it is drawn into. */
export interface Drawn {
  picture: Picture;
  context: CanvasRenderingContext2D;
  /** On screen now; pictures out of sight are not redrawn. */
  seen: boolean;
}

/**
 * The page as one self-contained HTML document, every canvas an inline image. With
 * `film`, the pictures with animals in them by day are loops of that many seconds at
 * that many frames a second (animated PNG, all on one clock), which play without a
 * script. Live-only parts (`data-live`) are dropped and still-only ones (`data-still`)
 * shown. The stage moves on by steps of `stepS`.
 */
export async function standalone(
  drawn: readonly Drawn[],
  stage: Stage,
  stepS: number,
  film?: { seconds: number; fps: number },
): Promise<string> {
  const loops = new Map<HTMLCanvasElement, string>();
  if (film !== undefined) {
    const moving = drawn.filter(({ picture }) => picture.cast !== null && picture.light === "day");
    const writers = moving.map(
      ({ picture }) => new ApngWriter(picture.width, picture.height, Math.round(1000 / film.fps)),
    );
    const frames = Math.round(film.seconds * film.fps);
    const steps = Math.max(1, Math.round(1 / film.fps / stepS));
    for (let frame = 0; frame < frames; frame++) {
      if (frame > 0) for (let step = 0; step < steps; step++) stage.tick(stepS);
      for (const [index, { picture, context }] of moving.entries()) {
        stage.draw(picture, context);
        const pixels = context.getImageData(0, 0, picture.width, picture.height).data;
        await writers[index]?.add(pixels);
      }
    }
    moving.forEach(({ context }, index) => {
      const writer = writers[index];
      if (writer !== undefined) loops.set(context.canvas, dataUri(writer.finish(), "image/png"));
    });
  }
  const copy = document.documentElement.cloneNode(true) as HTMLElement;
  const sources = [...document.querySelectorAll("canvas")];
  [...copy.querySelectorAll("canvas")].forEach((canvas, index) => {
    const source = sources[index];
    const image = create("img");
    if (source !== undefined) image.src = loops.get(source) ?? source.toDataURL("image/png");
    image.alt = canvas.getAttribute("aria-label") ?? "";
    image.width = canvas.width;
    image.height = canvas.height;
    image.style.cssText = canvas.style.cssText;
    canvas.replaceWith(image);
  });
  for (const node of copy.querySelectorAll("script, link, [data-live]")) node.remove();
  for (const node of copy.querySelectorAll("[data-still]")) node.removeAttribute("hidden");
  return `<!doctype html>\n${copy.outerHTML}\n`;
}
