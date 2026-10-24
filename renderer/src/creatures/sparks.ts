/**
 * Small marks of pixel art the rare genes leave as they act (R5): a glint of sun on a
 * basking photosynthesiser's back, a venomous bite's flash, drips and puff, a swimmer's
 * wake. Each is a few texels drawn once (`pixelTexture`), put down at a place and moved on
 * by whole art pixels at its own pace, its drawing changing as it ages (a plus that
 * shrinks to a dot, a dash that shortens), then half see-through, then gone. A few pooled
 * sprites, none made while the scene runs.
 */
import { Container, Sprite, Texture } from "pixi.js";

/** How many marks a pool holds unless told; the oldest goes when it is full. */
const SPARKS = 64;

/** A drawing of white texels: rows of `#` ink and `.` nothing. */
export function pixelTexture(rows: readonly string[]): Texture {
  const wide = Math.max(...rows.map((row) => row.length), 1);
  const tall = Math.max(rows.length, 1);
  const canvas = document.createElement("canvas");
  canvas.width = wide;
  canvas.height = tall;
  const context = canvas.getContext("2d");
  if (context !== null) {
    context.fillStyle = "#ffffff";
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) if (row[x] === "#") context.fillRect(x, y, 1, 1);
    });
  }
  return Texture.from({ resource: canvas, scaleMode: "nearest" });
}

/** What a kind of mark looks like and how it goes. */
export interface SparkKind {
  /** Its drawings in turn over its life, each for an equal share of it. */
  frames: readonly Texture[];
  /** Seconds it lasts. */
  lasts: number;
  /** The share of its life after which it is half see-through. */
  fadesAt: number;
}

interface Spark {
  kind: SparkKind | null;
  /** Seconds since it was put down (negative: not yet seen). */
  age: number;
  /** Where it was put down (cells), and how fast it moves (art pixels a second). */
  x: number;
  y: number;
  vx: number;
  vy: number;
}

export class Sparks {
  /** Add this to the world (in cells) where the marks are to be seen. */
  readonly container = new Container();
  private readonly sprites: Sprite[] = [];
  private readonly sparks: Spark[] = [];
  private next = 0;
  private readonly count: number;

  /** Up to `count` marks drawn at `pixels` art pixels to the cell. */
  constructor(
    private readonly pixels: number,
    count = SPARKS,
  ) {
    this.count = count;
    for (let k = 0; k < count; k++) {
      const sprite = new Sprite({ texture: Texture.WHITE, anchor: 0.5 });
      sprite.scale.set(1 / pixels);
      sprite.visible = false;
      this.sprites.push(sprite);
      this.sparks.push({ kind: null, age: 0, x: 0, y: 0, vx: 0, vy: 0 });
      this.container.addChild(sprite);
    }
  }

  /**
   * Put a mark of `kind` in `colour` at (x, y) (cells), moving (vx, vy) art pixels a second,
   * seen after `delayS` seconds.
   */
  emit(kind: SparkKind, colour: number, x: number, y: number, vx = 0, vy = 0, delayS = 0): void {
    const k = this.next;
    this.next = (this.next + 1) % this.count;
    const sprite = this.sprites[k];
    const spark = this.sparks[k];
    if (sprite === undefined || spark === undefined) return;
    spark.kind = kind;
    spark.age = -delayS;
    spark.x = x;
    spark.y = y;
    spark.vx = vx;
    spark.vy = vy;
    sprite.tint = colour;
    sprite.alpha = 1;
    sprite.visible = false;
  }

  /** Move the marks on by `dtS` seconds. */
  update(dtS: number): void {
    const { pixels } = this;
    for (let k = 0; k < this.count; k++) {
      const spark = this.sparks[k];
      const sprite = this.sprites[k];
      const kind = spark?.kind;
      if (spark === undefined || sprite === undefined || kind == null) continue;
      spark.age += dtS;
      if (spark.age < 0) continue;
      const t = spark.age / kind.lasts;
      if (t >= 1) {
        spark.kind = null;
        sprite.visible = false;
        continue;
      }
      const frame =
        kind.frames[Math.min(Math.floor(t * kind.frames.length), kind.frames.length - 1)];
      if (frame !== undefined && sprite.texture !== frame) sprite.texture = frame;
      // On the art pixels' grid, as everything drawn in the scene: where it was put, then
      // whole pixels on.
      const x = Math.round(spark.x * pixels + spark.vx * spark.age);
      const y = Math.round(spark.y * pixels + spark.vy * spark.age);
      // A texture an even number of texels across has its middle on a pixel's edge.
      const ox = (sprite.texture.width % 2) / 2;
      const oy = (sprite.texture.height % 2) / 2;
      sprite.position.set((x + ox) / pixels, (y + oy) / pixels);
      sprite.alpha = t < kind.fadesAt ? 1 : 0.5;
      sprite.visible = true;
    }
  }

  /** Put every mark away (the view changed). */
  clear(): void {
    for (const spark of this.sparks) spark.kind = null;
    for (const sprite of this.sprites) sprite.visible = false;
  }
}
