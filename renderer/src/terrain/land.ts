/**
 * The land as the renderer paints it: the cells' heights, what covers them and how
 * thickly, and the palette that turns them into colour. It comes from the state stream
 * (`stream.ts`); the R0 spike's fixture has the same fields, so the painters take either.
 */
import type { Season } from "../plants/seasons";

/** Three tones, dark to light. */
export type Ramp = readonly [string, string, string];

/** A rectangle of the world, in cells: x0 ≤ x < x1, y0 ≤ y < y1. */
export interface CellRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** How the maps turn height into colour; the renderer does the same between cells. */
export interface Relief {
  /** The sea by depth, shallowest first: down to `limit` below the surface, this colour. */
  seaBands: readonly { limit: number; colour: string }[];
  /** Height gained per cell toward the light (north-west) from which a slope is lit. */
  slope: number;
  /** Bare ground this far above the sea is rock, and higher still snow. */
  highRockFrom: number;
  highRock: Ramp;
  snowFrom: number;
  snow: Ramp;
  shoreOutline: string;
}

/** The colours the land is painted in. */
export interface LandPalette {
  relief: Relief;
  /** Dark, mid and light tone per class name (and "DORMANT"). */
  palette: Readonly<Record<string, Ramp>>;
}

export interface Land extends LandPalette {
  width: number;
  height: number;
  /** Height of each cell (0–1), row by row; above `seaLevel` is land. */
  heights: Float32Array;
  seaLevel: number;
  /** Land-cover class per cell, row by row; an index into `coverClasses`. */
  cover: Uint8Array;
  /** Plant biomass per cell, 0–255. */
  biomass: Uint8Array;
  coverClasses: readonly string[];
  /** Low plants below this biomass (0–255) are drawn dry. */
  dormantBelow: number;
  dormantClasses: readonly string[];
  /** The time of year in the world: what its plants are drawn in, unless told otherwise. */
  season: Season;
  /**
   * The genes of the plant on each cell that show in its drawing, 0–255, row by row
   * (absent in the R0 fixture): `HEIGHT` picks its build, `EVERGREEN` how late it turns.
   */
  plantHeight?: Uint8Array;
  plantEvergreen?: Uint8Array;
}
