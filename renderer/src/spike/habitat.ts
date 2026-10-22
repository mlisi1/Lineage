/** Where a body can be: land for walkers, water for swimmers. */
import { DEPTH_STEPS, type SeaAt } from "../creatures/water";
import type { WorldFixture } from "./fixture";

/** Can a creature be at this place (in cells)? `swims` asks for water instead of land. */
export type Passable = (x: number, y: number, swims: boolean) => boolean;

/**
 * What stands in an animal's way among the plants (R5): the feet of trees and the bodies
 * of bushes. `blocked` says whether a body of radius `margin` (cells) whose middle is at
 * (x, y) would overlap one. Grass and the small things are walked through.
 */
export interface Footprints {
  blocked(x: number, y: number, margin: number): boolean;
}

/** What `heightAt` and `passableIn` read of a world: the spike's fixture or the stream's land. */
export type Relief = Pick<WorldFixture, "width" | "height" | "heights" | "seaLevel">;

/** How far above the sea a walker stays, to keep off the waterline. */
const SHORE_CLEARANCE = 0.004;
/**
 * How far below it a swimmer's head stays: deeper, so that its body, which trails behind,
 * is in the sea too and not lying on the beach (about half the shallowest band).
 */
const SWIM_CLEARANCE = 0.012;

/**
 * Height at a place between cells: interpolated between the four nearest cells' middles,
 * as the painted ground does, so that the shore an animal respects is the shore drawn.
 */
export function heightAt(fixture: Relief, x: number, y: number): number {
  const { width, height, heights } = fixture;
  // A cell's height is the height of its middle.
  const u = x - 0.5;
  const v = y - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const column = (value: number): number => Math.min(Math.max(value, 0), width - 1);
  const row = (value: number): number => Math.min(Math.max(value, 0), height - 1) * width;
  const top =
    (heights[row(y0) + column(x0)] ?? 0) * (1 - fx) + (heights[row(y0) + column(x0 + 1)] ?? 0) * fx;
  const bottom =
    (heights[row(y0 + 1) + column(x0)] ?? 0) * (1 - fx) +
    (heights[row(y0 + 1) + column(x0 + 1)] ?? 0) * fx;
  return top * (1 - fy) + bottom * fy;
}

/** Land for walkers, water for swimmers, and nobody on the outermost ring of cells. */
export function passableIn(fixture: Relief): Passable {
  return (x, y, swims) => {
    if (x < 1 || y < 1 || x >= fixture.width - 1 || y >= fixture.height - 1) return false;
    const above = heightAt(fixture, x, y) - fixture.seaLevel;
    return swims ? above < -SWIM_CLEARANCE : above > SHORE_CLEARANCE;
  };
}

/**
 * The water at a place, as a swimmer is seen through it: the colour of the sea's depth
 * bands (as the ground paints them) blended between the bands' middles, and the depth as
 * a share of the deepest band's middle (where the colour is the deepest band's). Depth goes in `DEPTH_STEPS` steps, and the colour
 * is that of the step, so a swimmer's colours change only now and then as it moves.
 */
export function seaIn(fixture: WorldFixture): SeaAt {
  const bands = fixture.relief.seaBands;
  const middles = bands.map((band, i) => {
    const from = i === 0 ? 0 : (bands[i - 1]?.limit ?? 0);
    const to = i === bands.length - 1 ? from + (from - (bands[i - 2]?.limit ?? 0)) : band.limit;
    return { depth: (from + to) / 2, colour: packHex(band.colour) };
  });
  // The deepest band runs on without end: its middle is taken one band's width in.
  const deep = middles[middles.length - 1]?.depth ?? 0.3;
  return (x, y) => {
    const below = fixture.seaLevel - heightAt(fixture, x, y);
    if (below <= 0) return null;
    const share = Math.round(Math.min(below / deep, 1) * (DEPTH_STEPS - 1)) / (DEPTH_STEPS - 1);
    const depth = share * deep;
    const after = middles.findIndex((middle) => middle.depth >= depth);
    const upper = middles[after < 0 ? middles.length - 1 : after];
    const lower = middles[Math.max((after < 0 ? middles.length : after) - 1, 0)];
    if (upper === undefined || lower === undefined) return null;
    const t =
      upper.depth === lower.depth
        ? 0
        : Math.min(Math.max((depth - lower.depth) / (upper.depth - lower.depth), 0), 1);
    return { colour: blendRgb(lower.colour, upper.colour, t), depth: share };
  };
}

function packHex(colour: string): number {
  return Number.parseInt(colour.slice(1), 16);
}

function blendRgb(from: number, to: number, t: number): number {
  const channel = (shift: number): number =>
    Math.round(((from >> shift) & 255) * (1 - t) + ((to >> shift) & 255) * t) << shift;
  return channel(16) | channel(8) | channel(0);
}
