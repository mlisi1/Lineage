/**
 * The plant layer moved to `src/plants/plants.ts` (R1); kept so that the spike's imports
 * keep working. The spike's first look (a drawing in every cell) stays here.
 */
import type { Atlas } from "./atlas";
import type { WorldFixture } from "./fixture";
import { SPRITE_WIDTH, lookKey } from "./pixelart";
import { PlantLayer } from "../plants/plants";

export * from "../plants/plants";

/** A drawing in the middle of every vegetated cell, from the hand-drawn atlas. */
export function iconPlants(fixture: WorldFixture, atlas: Atlas): PlantLayer {
  return new PlantLayer(
    fixture,
    (look) => {
      if (look === null) return [];
      const texture = atlas.plants.get(lookKey(look));
      if (texture === undefined) throw new Error(`no texture for ${lookKey(look)}`);
      return [{ texture, anchorX: 0.5, anchorY: 1, scale: 1 / SPRITE_WIDTH, dx: 0, dy: 0 }];
    },
    { tall: 1.5, eager: true },
  );
}
