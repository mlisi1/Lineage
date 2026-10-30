/**
 * Hand-drawn pixel art for the spike, as text. Each plant is a tiny bitmap whose letters
 * pick a tone of its form's three-tone ramp (the same palette as the report maps):
 *
 *   .  transparent     d  dark     m  mid     l  light     t  trunk
 *
 * Low forms are 8×8 art pixels; grown trees are 8×12 and overlap the cell above.
 */
import { SPRITE_WIDTH, type Form, type PlantLook, type Stage } from "../plants/look";
import type { Ramp } from "../terrain/land";
import { hexToRgb, type Pixels } from "../terrain/pixels";

export { disc, wedge } from "../creatures/atlas";

export { cellHash, hexToRgb, type Pixels } from "../terrain/pixels";
export {
  FORMS,
  MATURE_FROM,
  SPRITE_WIDTH,
  STAGES,
  VARIANTS,
  VISIBLE_FROM,
  plantLook,
  plantOffset,
  standsAlone,
  type Form,
  type PlantLook,
  type Stage,
} from "../plants/look";

export const TRUNK_COLOUR = "#5a4632";

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

/** Name of a look in the atlas. */
export function lookKey(look: PlantLook): string {
  return `${look.form}/${look.stage}/${look.variant}${look.dormant ? "/dormant" : ""}`;
}
