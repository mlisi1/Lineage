/**
 * Hand-drawn pixel art for the spike, as text. Each plant is a tiny bitmap whose letters
 * pick a tone of its form's three-tone ramp (the same palette as the report maps):
 *
 *   .  transparent     d  dark     m  mid     l  light     t  trunk
 *
 * Low forms are 8×8 art pixels; grown trees are 8×12 and overlap the cell above.
 */
import type { Ramp } from "./fixture";

export const SPRITE_WIDTH = 8;
export const TRUNK_COLOUR = "#5a4632";

export type Form = "LICHEN" | "GRASS" | "SHRUB" | "BROADLEAF" | "CONIFER";
export type Stage = "young" | "mature";
export const FORMS: readonly Form[] = ["LICHEN", "GRASS", "SHRUB", "BROADLEAF", "CONIFER"];
export const STAGES: readonly Stage[] = ["young", "mature"];
export const VARIANTS = 2;

type Bitmap = readonly string[];

/** ART[form][stage] holds the variants of that plant. */
export const ART: Readonly<Record<Form, Readonly<Record<Stage, readonly Bitmap[]>>>> = {
  LICHEN: {
    young: [
      [
        "........",
        "........",
        "........",
        "........",
        "........",
        "........",
        ".l..lm..",
        "dmd.dmd.",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        "........",
        "........",
        "..lm..l.",
        ".dmd.dmd",
      ],
    ],
    mature: [
      [
        "........",
        "........",
        "........",
        "........",
        "........",
        ".ll..lm.",
        "lmml.mml",
        "dmmddmmd",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        "........",
        "..lm.ll.",
        ".lmmlmml",
        "ddmmdmmd",
      ],
    ],
  },
  GRASS: {
    young: [
      [
        "........",
        "........",
        "........",
        "........",
        "..l..l..",
        ".lm.lm.l",
        ".mmdmmlm",
        "ddmddmdd",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        ".l...l..",
        ".ml.lm..",
        "dmmlmmdl",
        "dddmddmd",
      ],
    ],
    mature: [
      [
        "........",
        "........",
        ".l...l..",
        ".ml.lm.l",
        ".mm.mm.m",
        "dmmlmmlm",
        "dmmdmmdm",
        "ddmddmdd",
      ],
      [
        "........",
        "........",
        "...l....",
        "l..ml..l",
        "ml.mm.lm",
        "mmlmmlmm",
        "dmmdmmdm",
        "ddmddddm",
      ],
    ],
  },
  SHRUB: {
    young: [
      [
        "........",
        "........",
        "........",
        "........",
        "..mll...",
        ".dmmml..",
        ".ddmmm..",
        "..ddd...",
      ],
      [
        "........",
        "........",
        "........",
        "........",
        "...mll..",
        "..dmmml.",
        "..ddmmm.",
        "...ddd..",
      ],
    ],
    mature: [
      [
        "........",
        "........",
        "..mll...",
        ".mmmll..",
        "dmmmmll.",
        "dmmmmmml",
        "ddmmmmmm",
        ".dddddd.",
      ],
      [
        "........",
        "........",
        "...mll..",
        "..mmmll.",
        ".dmmmmll",
        "dmmmmmml",
        "ddmmmmmd",
        ".dddddd.",
      ],
    ],
  },
  BROADLEAF: {
    young: [
      [
        "........",
        "..mll...",
        ".mmmll..",
        ".dmmml..",
        ".ddmmm..",
        "..ddd...",
        "...t....",
        "...t....",
      ],
      [
        "........",
        "...mll..",
        "..mmmll.",
        "..dmmml.",
        "..ddmmm.",
        "...ddd..",
        "....t...",
        "....t...",
      ],
    ],
    mature: [
      [
        "..mlll..",
        ".mmmlll.",
        "mmmmmlll",
        "dmmmmmll",
        "dmmmmmml",
        "ddmmmmmm",
        "ddmmmmmm",
        ".dddmmd.",
        "..dttd..",
        "...tt...",
        "...tt...",
        "...tt...",
      ],
      [
        "...mll..",
        ".mmmlll.",
        ".mmmmlll",
        "dmmmmmll",
        "dmmmmmml",
        "ddmmmmmm",
        ".ddmmmmd",
        "..ddddd.",
        "...tt...",
        "...tt...",
        "...tt...",
        "...tt...",
      ],
    ],
  },
  CONIFER: {
    young: [
      [
        "........",
        "...l....",
        "...ml...",
        "..dml...",
        "..dmml..",
        ".ddmmml.",
        "...t....",
        "...t....",
      ],
      [
        "........",
        "....l...",
        "....ml..",
        "...dml..",
        "...dmml.",
        "..ddmmml",
        "....t...",
        "....t...",
      ],
    ],
    mature: [
      [
        "...ml...",
        "...ml...",
        "..mmll..",
        "..dmml..",
        ".dmmmll.",
        ".ddmmml.",
        "dmmmmmll",
        "dddmmmml",
        ".ddddmm.",
        "...tt...",
        "...tt...",
        "...tt...",
      ],
      [
        "....l...",
        "...ml...",
        "...mml..",
        "..dmml..",
        "..dmmll.",
        ".ddmmml.",
        ".dmmmmll",
        "dddmmmml",
        ".dddddm.",
        "...tt...",
        "...tt...",
        "...tt...",
      ],
    ],
  },
};

export interface Pixels {
  width: number;
  height: number;
  /** RGBA bytes, row by row. */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

/** "#rrggbb" → [r, g, b]. */
export function hexToRgb(colour: string): [number, number, number] {
  const value = Number.parseInt(colour.replace("#", ""), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/** Paint a bitmap with a three-tone ramp. */
export function rasterise(bitmap: Bitmap, ramp: Ramp): Pixels {
  const height = bitmap.length;
  const rgba = new Uint8ClampedArray(SPRITE_WIDTH * height * 4);
  const tones: Record<string, [number, number, number]> = {
    d: hexToRgb(ramp[0]),
    m: hexToRgb(ramp[1]),
    l: hexToRgb(ramp[2]),
    t: hexToRgb(TRUNK_COLOUR),
  };
  bitmap.forEach((row, y) => {
    for (let x = 0; x < SPRITE_WIDTH; x++) {
      const tone = tones[row.charAt(x)];
      if (tone === undefined) continue; // "." stays transparent
      rgba.set([tone[0], tone[1], tone[2], 255], (y * SPRITE_WIDTH + x) * 4);
    }
  });
  return { width: SPRITE_WIDTH, height, rgba };
}

/** A filled white disc with hard edges, `size` pixels across: one body segment. */
export function disc(size: number): Pixels {
  const rgba = new Uint8ClampedArray(size * size * 4);
  const centre = size / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const inside = (x + 0.5 - centre) ** 2 + (y + 0.5 - centre) ** 2 <= centre * centre;
      if (inside) rgba.set([255, 255, 255, 255], (y * size + x) * 4);
    }
  }
  return { width: size, height: size, rgba };
}

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

/** Which sprite a cell shows, or null when it has no plant worth drawing. */
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

/** A number in [0, 1) that depends only on the cell (and on `salt`, to draw several). */
export function cellHash(x: number, y: number, salt: number): number {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(salt, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
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

/** Name of a look in the atlas. */
export function lookKey(look: PlantLook): string {
  return `${look.form}/${look.stage}/${look.variant}${look.dormant ? "/dormant" : ""}`;
}
