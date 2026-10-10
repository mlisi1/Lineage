/** Where a body can be: land for walkers, water for swimmers. */
import type { WorldFixture } from "./fixture";

/** Can a creature be at this cell? `swims` asks for water instead of land. */
export type Passable = (x: number, y: number, swims: boolean) => boolean;

/** Land for walkers, water for swimmers, and nobody on the outermost ring of cells. */
export function passableIn(fixture: WorldFixture): Passable {
  const water = fixture.coverClasses.indexOf("WATER");
  return (x, y, swims) => {
    const column = Math.round(x);
    const row = Math.round(y);
    if (column < 1 || row < 1 || column >= fixture.width - 1 || row >= fixture.height - 1) {
      return false;
    }
    return (fixture.cover[row * fixture.width + column] === water) === swims;
  };
}
