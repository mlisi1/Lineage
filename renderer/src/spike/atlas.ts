/** Every texture of the spike in one small atlas, drawn at start-up from the pixel art. */
import { CanvasSource, Rectangle, Texture } from "pixi.js";
import { DISC_SIZE, WHITE_SIZE, put, shapes, type Atlas } from "../creatures/atlas";
import type { WorldFixture } from "./fixture";
import {
  ART,
  FORMS,
  STAGES,
  VARIANTS,
  disc,
  lookKey,
  rasterise,
  wedge,
  type PlantLook,
} from "./pixelart";

/** One slot holds the largest plant (8×12) with a transparent pixel all round. */
const SLOT_WIDTH = 10;
const SLOT_HEIGHT = 14;
const COLUMNS = 8;

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
  canvas.width = Math.max(COLUMNS * SLOT_WIDTH, 2 * DISC_SIZE + WHITE_SIZE + 8);
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
  const wedgeLeft = DISC_SIZE + WHITE_SIZE + 5;
  put(context, wedge(DISC_SIZE), wedgeLeft, below);

  const source = new CanvasSource({ resource: canvas, scaleMode: "nearest" });
  const plants = new Map<string, Texture>();
  for (const [key, frame] of frames) plants.set(key, new Texture({ source, frame }));
  return { plants, ...shapes(source, below, wedgeLeft) };
}

export { DISC_SIZE, creatureAtlas, type Atlas } from "../creatures/atlas";
