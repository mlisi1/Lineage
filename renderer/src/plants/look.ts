/** What plant a cell shows, from its land-cover class and biomass, and where it stands. */
import { cellHash } from "../terrain/pixels";

/** Art pixels to the cell of the spike's first look, by which plant offsets are measured. */
export const SPRITE_WIDTH = 8;

export type Form = "LICHEN" | "GRASS" | "SHRUB" | "BROADLEAF" | "CONIFER";
export type Stage = "young" | "mature";
export const FORMS: readonly Form[] = ["LICHEN", "GRASS", "SHRUB", "BROADLEAF", "CONIFER"];
export const STAGES: readonly Stage[] = ["young", "mature"];
export const VARIANTS = 2;

/** Biomass (0–255) from which a plant is drawn grown. */
export const MATURE_FROM = 128;
/** Biomass (0–255) below which a cell shows bare ground instead of a plant. */
export const VISIBLE_FROM = 20;

export interface PlantLook {
  form: Form;
  stage: Stage;
  variant: number;
  dormant: boolean;
}

/** Which plant a cell shows, or null when it has no plant worth drawing. */
export function plantLook(
  coverClass: string,
  biomass: number,
  x: number,
  y: number,
  dormantBelow: number,
  dormantClasses: readonly string[],
): PlantLook | null {
  if (biomass < VISIBLE_FROM || !(FORMS as readonly string[]).includes(coverClass)) return null;
  return {
    form: coverClass as Form,
    stage: biomass >= MATURE_FROM ? "mature" : "young",
    // A cheap position hash, so neighbours do not all look alike.
    variant: (((x * 73856093) ^ (y * 19349663)) >>> 0) % VARIANTS,
    dormant: biomass < dormantBelow && dormantClasses.includes(coverClass),
  };
}

/** Share of the cells of grown grass that carry a tuft of their own in the scattered style. */
const TUFT_SHARE = 1 / 3;

/**
 * In the scattered style the ground itself is painted with what grows low; only some
 * plants stand on it as drawings of their own: every tree, every shrub in leaf, and a
 * tuft of grown grass here and there.
 */
export function standsAlone(look: PlantLook, x: number, y: number): boolean {
  // What has died back to its roots is ground, not a plant to look at.
  if (look.form === "LICHEN" || look.dormant) return false;
  if (look.form !== "GRASS") return true;
  return look.stage === "mature" && cellHash(x, y, 11) < TUFT_SHARE;
}

/**
 * How far a plant that stands alone is from the middle of its cell, in art pixels
 * (eighths of a cell): up to two either side, up to two back and one forward.
 */
export function plantOffset(x: number, y: number): [number, number] {
  return [Math.floor(cellHash(x, y, 12) * 5) - 2, Math.floor(cellHash(x, y, 13) * 4) - 2];
}
