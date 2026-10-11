/** Where a body can be: land for walkers, water for swimmers. */
import type { WorldFixture } from "./fixture";

/** Can a creature be at this place (in cells)? `swims` asks for water instead of land. */
export type Passable = (x: number, y: number, swims: boolean) => boolean;

/** How far above the sea a walker stays, and below it a swimmer, to keep off the waterline. */
const SHORE_CLEARANCE = 0.004;

/**
 * Height at a place between cells: interpolated between the four nearest cells' middles,
 * as the painted ground does, so that the shore an animal respects is the shore drawn.
 */
export function heightAt(fixture: WorldFixture, x: number, y: number): number {
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
export function passableIn(fixture: WorldFixture): Passable {
  return (x, y, swims) => {
    if (x < 1 || y < 1 || x >= fixture.width - 1 || y >= fixture.height - 1) return false;
    const above = heightAt(fixture, x, y) - fixture.seaLevel;
    return swims ? above < -SHORE_CLEARANCE : above > SHORE_CLEARANCE;
  };
}
