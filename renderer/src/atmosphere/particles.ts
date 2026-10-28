/**
 * The atmosphere's moving bits (R4): smoke, ash, dust, sparks and rain, each a slot that
 * goes round and round a cycle of its own. Where a slot is is a function of its number
 * and the time alone, as the sea's glints are (`terrain/sea.ts`): nothing is kept from
 * frame to frame, the same moment looks the same on every run, and a still picture
 * (`?still`) is a fixed one.
 */
import { Container, Sprite, type Texture } from "pixi.js";
import { cellHash } from "../terrain/pixels";

/** A source of puffs that rise, drift and grow as they go: smoke, ash clouds, dust. */
export interface Plume {
  /** Where it rises from (cells), and how far round that its puffs start (cells). */
  x: number;
  y: number;
  spread: number;
  /** Art pixels a second: up (negative y) and across. */
  rise: number;
  drift: number;
  /** Seconds a puff lasts. */
  life: number;
  /** Art pixels across, when it starts and when it goes. */
  from: number;
  to: number;
  /** Opacity when it starts; it fades to nothing. */
  alpha: number;
  /** Any number: plumes with different salts never move together. */
  salt: number;
}

/** Where puff `slot` of `plume` is at `timeS` (x, y in cells), how big (art pixels) and how opaque. */
export function puffAt(
  plume: Plume,
  slot: number,
  timeS: number,
  tile: number,
  out: Puff = { x: 0, y: 0, size: 0, alpha: 0 },
): Puff {
  const phase = cellHash(slot, plume.salt, 301);
  const shifted = timeS + phase * plume.life;
  const cycle = Math.floor(shifted / plume.life);
  const age = (shifted - cycle * plume.life) / plume.life;
  const angle = 2 * Math.PI * cellHash(slot, cycle + plume.salt, 302);
  const reach = plume.spread * Math.sqrt(cellHash(slot, cycle + plume.salt, 303));
  const travelled = age * plume.life;
  // Each puff leans a little its own way as it rises.
  const lean = 0.5 + cellHash(slot, cycle + plume.salt, 304);
  out.x = plume.x + reach * Math.cos(angle) + (plume.drift * lean * travelled) / tile;
  out.y = plume.y + reach * Math.sin(angle) - (plume.rise * travelled) / tile;
  out.size = plume.from + (plume.to - plume.from) * age;
  out.alpha = plume.alpha * (1 - age) * Math.min(age * 6, 1);
  return out;
}

/** A puff where `puffAt` puts it: x, y in cells, its size in art pixels, its opacity. */
export interface Puff {
  x: number;
  y: number;
  size: number;
  alpha: number;
}

/** Tint `sprite` `colour`, written only when it changes (Pixi parses a colour on every write). */
export function tint(sprite: Sprite, colour: number): void {
  if (sprite.tint !== colour) sprite.tint = colour;
}

/** Something falling across the screen: rain, falling ash. In art pixels of the screen. */
export interface Fall {
  /** Art pixels a second, down and across. */
  speed: number;
  slant: number;
  /** Any number: falls with different salts never move together. */
  salt: number;
}

/** Where drop `slot` is at `timeS` over a screen `width` × `height` art pixels. */
export function dropAt(
  fall: Fall,
  slot: number,
  timeS: number,
  width: number,
  height: number,
): { x: number; y: number } {
  const span = height + 8;
  const life = span / fall.speed;
  const phase = cellHash(slot, fall.salt, 311);
  const shifted = timeS + phase * life;
  const cycle = Math.floor(shifted / life);
  const age = shifted - cycle * life;
  const startX = cellHash(slot, cycle + fall.salt, 312) * width;
  // Off one side, it comes back on the other.
  return { x: (((startX + fall.slant * age) % width) + width) % width, y: -4 + fall.speed * age };
}

/** Sprites to be placed afresh each frame: as many as are asked for, the rest hidden. */
export class SpritePool {
  // Its own render group (R5): sprites shown and hidden here every frame rebuild only this
  // group's draw list, not the scene's with its thousands of plants.
  readonly container = new Container({ isRenderGroup: true });
  private readonly sprites: Sprite[] = [];
  private used = 0;
  private skipped = 0;

  constructor(private readonly blendMode: "normal" | "add" = "normal") {}

  begin(): void {
    this.used = 0;
    this.skipped = 0;
  }

  /** The next sprite, shown, with `texture`. */
  next(texture: Texture): Sprite {
    let sprite = this.sprites[this.used];
    if (sprite === undefined) {
      sprite = new Sprite(texture);
      sprite.blendMode = this.blendMode;
      this.sprites.push(sprite);
      this.container.addChild(sprite);
    }
    if (sprite.texture !== texture) sprite.texture = texture;
    sprite.visible = true;
    this.used += 1;
    return sprite;
  }

  /**
   * Pass over a sprite not drawn this frame, keeping its place: those asked for after it
   * keep theirs, rather than each taking its neighbour's texture and place and being
   * written afresh (R5, review P1). What is drawn, and in what order, is the same.
   */
  skip(): void {
    const sprite = this.sprites[this.used];
    if (sprite === undefined) return;
    sprite.visible = false;
    this.used += 1;
    this.skipped += 1;
  }

  end(): void {
    for (let i = this.used; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (sprite !== undefined) sprite.visible = false;
    }
  }

  /** Sprites shown after the last `end` (tests). */
  get shown(): number {
    return this.used - this.skipped;
  }
}

/** The plants' rows of the view shown, where things that stand are sorted among them. */
export interface Rows {
  /** One container per row, top row first, drawn over that row's plants. */
  guests: readonly Container[];
  rowsPerCell: number;
}

/**
 * Sprites placed afresh each frame among the plants (R4): each goes into the row of the
 * plants it stands with (by its foot), so that what stands in front covers it and it covers
 * what stands behind. Without rows (the map) they go into `fallback`.
 */
export class RowPool {
  private readonly sprites: Sprite[] = [];
  private used = 0;
  /** This frame's sprites by the row they were asked into, in the order asked. */
  private readonly placed = new Map<Container, Sprite[]>();

  constructor(
    private readonly fallback: Container,
    private readonly blendMode: "normal" | "add" = "normal",
  ) {}

  begin(): void {
    this.used = 0;
    this.placed.clear();
  }

  /** The next sprite, shown, with `texture`, in the row of a foot at `footY` cells. */
  next(texture: Texture, rows: Rows | null, footY: number): Sprite {
    let sprite = this.sprites[this.used];
    if (sprite === undefined) {
      sprite = new Sprite(texture);
      sprite.blendMode = this.blendMode;
      this.sprites.push(sprite);
    }
    const host =
      rows === null
        ? this.fallback
        : (rows.guests[
            Math.min(Math.max(Math.floor(footY * rows.rowsPerCell), 0), rows.guests.length - 1)
          ] ?? this.fallback);
    if (sprite.parent !== host) host.addChild(sprite);
    let row = this.placed.get(host);
    if (row === undefined) {
      row = [];
      this.placed.set(host, row);
    }
    row.push(sprite);
    if (sprite.texture !== texture) sprite.texture = texture;
    sprite.visible = true;
    this.used += 1;
    return sprite;
  }

  end(): void {
    // Last in its row, in the order asked: what is asked for later is drawn over what came
    // before (a cone, then its lava; a tree's foot fire, then the flames in its crown).
    // Put there only where they are not already (R5: taken out and put back every frame,
    // every flame rebuilt its band's draw list every frame).
    for (const [host, row] of this.placed) {
      const children = host.children;
      const from = children.length - row.length;
      let inPlace = from >= 0;
      for (let k = 0; inPlace && k < row.length; k++) inPlace = children[from + k] === row[k];
      if (!inPlace) for (const sprite of row) host.addChild(sprite);
    }
    for (let i = this.used; i < this.sprites.length; i++) {
      const sprite = this.sprites[i];
      if (sprite !== undefined) sprite.visible = false;
    }
  }

  get shown(): number {
    return this.used;
  }
}

/**
 * Put `sprite` centred on (x, y) in cells, `size` art pixels across (or `width` × `height`),
 * on whole art pixels.
 */
export function placeCentred(
  sprite: Sprite,
  x: number,
  y: number,
  tile: number,
  width: number,
  height = width,
): void {
  const w = Math.max(Math.round(width), 1);
  const h = Math.max(Math.round(height), 1);
  sprite.position.set(Math.round(x * tile - w / 2) / tile, Math.round(y * tile - h / 2) / tile);
  sprite.scale.set(w / tile / sprite.texture.width, h / tile / sprite.texture.height);
}
