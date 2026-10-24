/**
 * Autumn leaves blown off the trees (R5, the open item of ADR 0022): in autumn a few leaves
 * come loose from the crowns of the broadleaves in sight, in the colour each tree has
 * turned, and fall to the ground with the wind, fluttering, to lie there a moment and go.
 *
 *   which trees   only broadleaves shown in autumn (each turns on its own day,
 *                 `plants/turning.ts`), not those that keep their leaves through winter, and
 *                 no conifer: the plant layer marks their crowns (`PlantLayer.crownAt`)
 *   how many      few: more as autumn goes on, more in the wind's gusts (`gustAt`), more
 *                 again in rain and most in a thunderstorm (the wind's strength), none in the
 *                 map; a wood drops more than a lone tree, for more of the places tried
 *                 hold a crown
 *   how           whole art pixels, a pixel in the middle view and a small leaf of two or
 *                 three up close that flips as it flutters; each sorted among the plants by
 *                 where it will land, so a tree in front hides a leaf falling behind it
 *
 * One kind of fall per view, as R4's snow: leaves only where trees stand. Pooled sprites,
 * its own random stream, nothing made per frame once the pool is full.
 */
import type { Container, Texture } from "pixi.js";
import type { ViewName } from "../landscape";
import type { Message } from "../protocol";
import { mulberry32, type Random } from "../rng";
import type { CellRect } from "../terrain/land";
import type { Crown } from "../plants/plants";
import { gustAt, type Wind } from "../plants/wind";
import { RowPool, type Rows } from "./particles";
import { texture as textureOf } from "./ambient";

/** Leaves in the air or on the ground at once, at most, in each view. */
const MOST: Readonly<Record<ViewName, number>> = { map: 0, middle: 22, local: 12 };
/**
 * Places tried a second for each cell in sight, in each view, at a calm day's wind late in
 * autumn: a try that finds a crown lets a leaf go if a gust is on it, so that a tree drops a
 * leaf every ten seconds or so on a calm day.
 */
const TRIES_CELL_S: Readonly<Record<ViewName, number>> = { map: 0, middle: 0.2, local: 0.25 };
/** Early in autumn this share of the leaves fall that do late in it. */
const EARLY = 0.3;
/** How much more the wind's strength makes fall: tries grow as the strength to this power. */
const WIND_POWER = 1.4;
/** Below this push of the wind (`gustAt`) a leaf holds on; at `LOOSE_GUST` and above it always goes. */
const HOLD_GUST = 0.05;
const LOOSE_GUST = 1;
/** The least chance a leaf goes in a lull. */
const LULL_CHANCE = 0.08;
/** How fast a leaf sinks (art pixels a second), from and up to this much more. */
const FALL_PX_S = 7;
const FALL_MORE_PX_S = 5;
/** How far the wind carries a leaf (art pixels a second, for a push of 1 at strength 1). */
const DRIFT_PX_S = 9;
/** Where the wind blows to (the plants' wind, `wind.ts`): east, a little south. */
const BLOWS = { x: 0.94, y: 0.34 };
/** A leaf swings from side to side as it falls: this far (art pixels), this often (a second). */
const SWING_PX = 2.5;
const SWING_HZ = 0.9;
/** Up close a leaf flips this many times a second as it flutters. */
const FLIP_HZ = 3;
/** Where it lands, ahead of the tree's foot or behind it (cells, from the foot: back, front). */
const LAND_BACK = 0.15;
const LAND_FRONT = 0.45;
/** Seconds a leaf lies on the ground before it goes, the last share of them faint. */
const LIE_S = 2.5;
const FAINT_SHARE = 0.35;
const FAINT = 0.5;
/** Chances of each of the crown's tones (dark, middle, light): most leaves its middle tone. */
const TONE_DARK = 0.25;
const TONE_LIGHT = 0.7;

/**
 * Art pixels to a leaf's texel in each view: up close the plants are drawn in texels of two
 * art pixels (`plants/cosyart.ts`), and their leaves are too.
 */
const TEXEL: Readonly<Record<ViewName, number>> = { map: 1, middle: 1, local: 2 };
/** Drawings, rows of texels: in the middle view a pixel, up close a small leaf in two flips. */
const LEAF_FAR = ["#"];
const LEAF_FAR_FLAT = ["##"];
const LEAF_NEAR = [
  ["##.", ".##"],
  [".#", "##", "#."],
];
const LEAF_NEAR_FLAT = ["###"];

interface Leaf {
  /** Where it will land (cells), and how high above that it is now (cells). */
  x: number;
  y: number;
  high: number;
  fall: number;
  /** Its own swing (radians), colour, and seconds since it landed (negative: in the air). */
  swing: number;
  colour: number;
  lain: number;
  out: boolean;
}

/** What the leaves need of the frame. */
export interface LeavesView {
  view: ViewName;
  cells: CellRect;
  /** Art pixels to the cell. */
  tile: number;
  /** The plants of the view: the crowns that drop leaves, and the rows to sort them among. */
  plants: (Rows & { crownAt(x: number, y: number): Crown | undefined }) | null;
  /** The wind of the moment (`Atmosphere.wind`); none: a calm day's. */
  wind: Wind | null;
  /** A world ends on the screen. */
  ending: boolean;
}

export class Leaves {
  private readonly random: Random;
  private readonly pool: RowPool;
  private readonly leaves: Leaf[] = [];
  private textures: { far: Texture; farFlat: Texture; near: Texture[]; nearFlat: Texture } | null =
    null;
  private season = "summer";
  private progress = 0;
  private time = 0;
  /** Tries owed (fractions carried from frame to frame). */
  private owed = 0;
  private view: ViewName = "map";

  constructor(seed: number, fallback: Container) {
    this.random = mulberry32(seed);
    this.pool = new RowPool(fallback);
  }

  private get art(): NonNullable<Leaves["textures"]> {
    this.textures ??= {
      far: textureOf(LEAF_FAR),
      farFlat: textureOf(LEAF_FAR_FLAT),
      near: LEAF_NEAR.map(textureOf),
      nearFlat: textureOf(LEAF_NEAR_FLAT),
    };
    return this.textures;
  }

  /** Take a message as it reaches the scene: the season and how far into it. */
  receive(message: Message): void {
    if (message.type !== "clock") return;
    this.season = message.season;
    this.progress = message.season_progress;
  }

  /** Leaves in the air and on the ground (staging). */
  get state(): { falling: number; lying: number } {
    let falling = 0;
    let lying = 0;
    for (const leaf of this.leaves) {
      if (!leaf.out) continue;
      if (leaf.lain < 0) falling += 1;
      else lying += 1;
    }
    return { falling, lying };
  }

  /** How many leaves late autumn drops against the rest of it (a turn's last trees in winter too). */
  private lateness(): number {
    if (this.season === "autumn") return EARLY + (1 - EARLY) * this.progress;
    return this.season === "winter" ? 1 : EARLY;
  }

  /** Move the leaves on by `dtS` seconds and draw them for `frame`. */
  update(dtS: number, frame: LeavesView): void {
    this.time += dtS;
    if (frame.view !== this.view) {
      this.view = frame.view;
      for (const leaf of this.leaves) leaf.out = false;
      this.owed = 0;
    }
    const most = MOST[frame.view];
    while (this.leaves.length < most) {
      this.leaves.push({
        x: 0,
        y: 0,
        high: 0,
        fall: 0,
        swing: 0,
        colour: 0,
        lain: 0,
        out: false,
      });
    }
    this.pool.begin();
    const { plants } = frame;
    if (plants !== null && most > 0 && !frame.ending) {
      this.loosen(dtS, frame, plants, most);
      this.drift(dtS, frame, plants);
    }
    this.pool.end();
  }

  /** Let go of the leaves this frame owes, from crowns in sight that a gust reaches. */
  private loosen(
    dtS: number,
    frame: LeavesView,
    plants: NonNullable<LeavesView["plants"]>,
    most: number,
  ): void {
    const strength = frame.wind?.strength ?? 1;
    const { cells } = frame;
    const area = (cells.x1 - cells.x0) * (cells.y1 + 1 - cells.y0);
    this.owed += area * TRIES_CELL_S[frame.view] * this.lateness() * strength ** WIND_POWER * dtS;
    while (this.owed >= 1) {
      this.owed -= 1;
      // A crown above the view's lower edge may stand on a foot below it.
      const x = cells.x0 + (cells.x1 - cells.x0) * this.random();
      const y = cells.y0 + (cells.y1 + 1 - cells.y0) * this.random();
      const crown = plants.crownAt(x, y);
      if (crown === undefined) continue;
      const push = gustAt(crown.x, crown.y, frame.wind?.timeS ?? this.time, 0);
      const chance = Math.max(
        Math.min((push - HOLD_GUST) / (LOOSE_GUST - HOLD_GUST), 1),
        LULL_CHANCE,
      );
      if (this.random() >= chance) continue;
      let leaf: Leaf | undefined;
      for (let k = 0; k < most && leaf === undefined; k++) {
        if (this.leaves[k]?.out === false) leaf = this.leaves[k];
      }
      if (leaf === undefined) return;
      const across = (2 * this.random() - 1) * crown.half;
      leaf.x = crown.x + across;
      leaf.y = crown.y - LAND_BACK + (LAND_BACK + LAND_FRONT) * this.random();
      leaf.high = crown.bottom + (crown.top - crown.bottom) * this.random() + (leaf.y - crown.y);
      leaf.fall = FALL_PX_S + FALL_MORE_PX_S * this.random();
      leaf.swing = 2 * Math.PI * this.random();
      const tone = this.random();
      leaf.colour =
        crown.colours[tone < TONE_DARK ? 0 : tone < TONE_LIGHT ? 1 : 2] ?? crown.colours[0] ?? 0;
      leaf.lain = -1;
      leaf.out = true;
    }
  }

  /** Carry the leaves in the air on the wind and down; those on the ground lie, then go. */
  private drift(dtS: number, frame: LeavesView, plants: NonNullable<LeavesView["plants"]>): void {
    const { tile, cells, wind } = frame;
    const strength = wind?.strength ?? 1;
    const timeS = wind?.timeS ?? this.time;
    const near = frame.view === "local";
    const texel = TEXEL[frame.view];
    for (const leaf of this.leaves) {
      if (!leaf.out) continue;
      if (leaf.lain < 0) {
        const push = strength * gustAt(leaf.x, leaf.y, timeS, leaf.swing);
        const carried = ((DRIFT_PX_S * push) / tile) * dtS;
        leaf.x += BLOWS.x * carried;
        leaf.y += BLOWS.y * carried;
        leaf.high -= (leaf.fall / tile) * dtS;
        if (leaf.high <= 0) {
          leaf.high = 0;
          leaf.lain = 0;
        }
      } else {
        leaf.lain += dtS;
        if (leaf.lain >= LIE_S) {
          leaf.out = false;
          continue;
        }
      }
      if (
        leaf.x < cells.x0 - 1 ||
        leaf.x > cells.x1 + 1 ||
        leaf.y - leaf.high < cells.y0 - 1 ||
        leaf.y > cells.y1 + 2
      ) {
        leaf.out = false;
        continue;
      }
      const flying = leaf.lain < 0;
      const art = this.art;
      const flip = Math.floor((this.time + leaf.swing) * FLIP_HZ) % art.near.length;
      const look = flying
        ? near
          ? (art.near[flip] ?? art.nearFlat)
          : flip === 0
            ? art.far
            : art.farFlat
        : near
          ? art.nearFlat
          : art.far;
      // Swinging from side to side as it sinks; still once it lies.
      const swing = flying
        ? (SWING_PX * Math.sin(2 * Math.PI * SWING_HZ * this.time + leaf.swing)) / tile
        : 0;
      const sprite = this.pool.next(look, plants, leaf.y);
      const left = Math.round((leaf.x + swing) * tile - (texel * look.width) / 2);
      const top = Math.round((leaf.y - leaf.high) * tile - texel * look.height);
      sprite.position.set(left / tile, top / tile);
      sprite.scale.set(texel / tile);
      sprite.tint = leaf.colour;
      sprite.alpha = flying || leaf.lain < LIE_S * (1 - FAINT_SHARE) ? 1 : FAINT;
    }
  }
}
