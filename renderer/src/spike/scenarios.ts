/**
 * What the R0 spike measures. Each scenario is one configuration of the same scene,
 * run for a fixed time; together they answer whether PixiJS in Chromium is fast enough
 * on the device and how the renderer should be built.
 */

/** Screen pixels per art pixel: the scene is drawn at 1024/artScale × 600/artScale. */
export type ArtScale = 1 | 2 | 4;
/**
 * Wide: the whole island. Close: 4× zoom, panning across it. Follow: closer again, the
 * camera on one creature wherever it walks.
 */
export type Shot = "wide" | "close" | "follow";
/**
 * Plants as one sprite per cell, as a flat-colour map (one pixel per cell), or not drawn:
 * the spike's first look. "painted" is the look chosen since: the ground painted from
 * the cells (two art pixels to the cell in a wide shot, eight in a close one, more when
 * following) with the plants that stand on it, and the creatures as body plans (dots in
 * a wide shot).
 */
export type PlantMode = "none" | "sprites" | "map" | "painted";

export interface Scenario {
  name: string;
  artScale: ArtScale;
  shot: Shot;
  plants: PlantMode;
  creatures: number;
  tint: boolean;
  about: string;
}

/** The creature count R0 asks for, and the most the sim can hold (both caps). */
export const SPEC_CREATURES = 50;
export const CROWD_CREATURES = 216;

export const SCENARIOS: readonly Scenario[] = [
  {
    name: "floor",
    artScale: 1,
    shot: "wide",
    plants: "none",
    creatures: 0,
    tint: false,
    about: "Terrain bitmap only: what the browser costs before any scene.",
  },
  {
    name: "spec-1x",
    artScale: 1,
    shot: "wide",
    plants: "sprites",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "The R0 scene by the letter at the display's resolution: every plant a sprite.",
  },
  {
    name: "spec-2x",
    artScale: 2,
    shot: "wide",
    plants: "sprites",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "The same scene drawn at 512×300 and scaled up: art pixels of 2 screen pixels.",
  },
  {
    name: "spec-4x",
    artScale: 4,
    shot: "wide",
    plants: "sprites",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "The same scene drawn at 256×150: art pixels of 4 screen pixels.",
  },
  {
    name: "map-1x",
    artScale: 1,
    shot: "wide",
    plants: "map",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "A wide shot as it would ship: plants as a flat map, sprites kept for close-ups.",
  },
  {
    name: "close-1x",
    artScale: 1,
    shot: "close",
    plants: "sprites",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "A panning close-up at full resolution, off-screen plants skipped.",
  },
  {
    name: "close-2x",
    artScale: 2,
    shot: "close",
    plants: "sprites",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "The same close-up at 512×300.",
  },
  {
    name: "crowd-1x",
    artScale: 1,
    shot: "wide",
    plants: "map",
    creatures: CROWD_CREATURES,
    tint: true,
    about: "Every creature the sim can hold, animated at once.",
  },
  {
    name: "map-view",
    artScale: 2,
    shot: "wide",
    plants: "painted",
    creatures: CROWD_CREATURES,
    tint: true,
    about: "The map view: painted ground, every creature a dot.",
  },
  {
    name: "mid-view",
    artScale: 2,
    shot: "close",
    plants: "painted",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "The middle view: painted ground, the plants that stand, 50 creatures.",
  },
  {
    name: "mid-crowd",
    artScale: 2,
    shot: "close",
    plants: "painted",
    creatures: CROWD_CREATURES,
    tint: true,
    about: "The middle view with every creature the sim can hold walking somewhere.",
  },
  {
    name: "local-view",
    artScale: 2,
    shot: "follow",
    plants: "painted",
    creatures: SPEC_CREATURES,
    tint: true,
    about: "The local view: the camera on one creature, ground painted as it goes.",
  },
];

/** R0 passes when this scenario reaches the target at its median frame time. */
export const ACCEPTANCE_SCENARIO = "spec-1x";
export const TARGET_FPS = 30;

/** The scenarios to run: all of them, or the named ones in table order. */
export function selectScenarios(only: readonly string[] | null): Scenario[] {
  if (only === null) return [...SCENARIOS];
  const known = new Set(SCENARIOS.map((scenario) => scenario.name));
  const unknown = only.filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw new Error(`unknown scenario: ${unknown.join(", ")}`);
  }
  return SCENARIOS.filter((scenario) => only.includes(scenario.name));
}
