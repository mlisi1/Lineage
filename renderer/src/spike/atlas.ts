/** Every texture of the spike in one small atlas, drawn at start-up from the pixel art. */
import { CanvasSource, Rectangle, Texture } from "pixi.js";
import type { WorldFixture } from "./fixture";
import {
  ART,
  FORMS,
  STAGES,
  VARIANTS,
  disc,
  lookKey,
  rasterise,
  type Pixels,
  type PlantLook,
} from "./pixelart";

/** One slot holds the largest plant (8×12) with a transparent pixel all round. */
const SLOT_WIDTH = 10;
const SLOT_HEIGHT = 14;
const COLUMNS = 8;
export const DISC_SIZE = 16;
const WHITE_SIZE = 4;

export interface Atlas {
  /** Plant textures by `lookKey`. */
  plants: ReadonlyMap<string, Texture>;
  /** A white disc: body segments, tinted. */
  disc: Texture;
  /** A white square: legs and the full-screen tint, stretched and tinted. */
  white: Texture;
}

function put(context: CanvasRenderingContext2D, pixels: Pixels, x: number, y: number): void {
  context.putImageData(new ImageData(pixels.rgba, pixels.width, pixels.height), x, y);
}

/** Draw the atlas and cut it into textures. All share one source, so they batch. */
export function buildAtlas(fixture: WorldFixture): Atlas {
  const looks: PlantLook[] = [];
  for (const form of FORMS) {
    for (const stage of STAGES) {
      for (let variant = 0; variant < VARIANTS; variant++) {
        looks.push({ form, stage, variant, dormant: false });
        if (fixture.dormantClasses.includes(form)) {
          looks.push({ form, stage, variant, dormant: true });
        }
      }
    }
  }
  const rows = Math.ceil(looks.length / COLUMNS);
  const canvas = document.createElement("canvas");
  canvas.width = COLUMNS * SLOT_WIDTH;
  canvas.height = rows * SLOT_HEIGHT + DISC_SIZE + 2;
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("no 2D canvas for the atlas");

  const frames = new Map<string, Rectangle>();
  looks.forEach((look, index) => {
    const bitmap = ART[look.form][look.stage][look.variant];
    const ramp = fixture.palette[look.dormant ? "DORMANT" : look.form];
    if (bitmap === undefined || ramp === undefined) {
      throw new Error(`no art or palette for ${lookKey(look)}`);
    }
    const pixels = rasterise(bitmap, ramp);
    const x = (index % COLUMNS) * SLOT_WIDTH + 1;
    const y = Math.floor(index / COLUMNS) * SLOT_HEIGHT + 1;
    put(context, pixels, x, y);
    frames.set(lookKey(look), new Rectangle(x, y, pixels.width, pixels.height));
  });

  const below = rows * SLOT_HEIGHT + 1;
  put(context, disc(DISC_SIZE), 1, below);
  context.fillStyle = "#ffffff";
  context.fillRect(DISC_SIZE + 3, below, WHITE_SIZE, WHITE_SIZE);

  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const plants = new Map<string, Texture>();
  for (const [key, frame] of frames) plants.set(key, new Texture({ source, frame }));
  return {
    plants,
    disc: new Texture({ source, frame: new Rectangle(1, below, DISC_SIZE, DISC_SIZE) }),
    // The inner pixels only, so stretching never samples the transparent surround.
    white: new Texture({
      source,
      frame: new Rectangle(DISC_SIZE + 4, below + 1, WHITE_SIZE - 2, WHITE_SIZE - 2),
    }),
  };
}
