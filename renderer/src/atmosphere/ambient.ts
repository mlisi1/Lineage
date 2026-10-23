/**
 * Small life about the island (R5, the owner, 2026-10-23): decoration, not the sim's.
 *
 *   fireflies    a few warm lights drifting and blinking over grass at night, in the
 *                middle and local views, added over the tint as the glow is (they make
 *                their own light)
 *   dust         a puff from a hind foot coming down when an animal hurries to where the
 *                sim has it (`CreatureLayer.footfall`), over the grass so that it shows
 *   birds        now and then by day a few birds cross the middle view in a V, wings
 *                flapping, a faint shadow on the ground below and right of them
 *   butterflies  by day in spring and summer, two or three flit over the meadows (grass
 *                thick enough to flower) in the local view
 *
 * Pixel art in the cosy palette, a few pooled sprites (nothing made per frame once they
 * exist), and nothing moves or is drawn in a view that does not show it, nor in rain, nor
 * while a world ends. Its random draws are its own stream, so it changes nothing else.
 */
import { Container, Sprite, Texture } from "pixi.js";
import type { ViewName } from "../landscape";
import type { Message } from "../protocol";
import { mulberry32, type Random } from "../rng";
import type { CellRect, Land } from "../terrain/land";
import { darkness } from "./light";
import { SpritePool, placeCentred } from "./particles";

/** Fireflies in sight at once, in each view that has them. */
const FIREFLIES: Readonly<Record<ViewName, number>> = { map: 0, middle: 12, local: 8 };
/** They come out as it gets this dark (0–1, `darkness`) and are all out by `FIREFLY_FULL`. */
const FIREFLY_DARK = 0.5;
const FIREFLY_FULL = 0.85;
/** How fast a firefly drifts (art pixels a second) and how quickly it changes its way (radians a second). */
const FIREFLY_PX_S = 5;
const FIREFLY_WANDER = 2.5;
/** Seconds a firefly drifts before it is put somewhere else (while dark): from, and up to this much more. */
const FIREFLY_LIFE_S = 8;
const FIREFLY_LIFE_MORE_S = 10;
/** Seconds between a firefly's flashes: from, and up to this much more; the share of it lit. */
const FLASH_S = 2.2;
const FLASH_MORE_S = 2.4;
const FLASH_SHARE = 0.5;
/** Steps of brightness a flash rises and falls in, as pixel art does. */
const FLASH_STEPS = 3;
/** A firefly's light: warm yellow-green, added over the night. */
const FIREFLY_GLOW = 0xf2ff8c;
/** The covers a firefly hovers over (`Land.coverClasses`). */
const FIREFLY_COVERS: ReadonlySet<string> = new Set(["GRASS", "SHRUB"]);
/** Places tried when putting a firefly or a butterfly somewhere. */
const TRIES = 8;

/** Dust: puffs at once, how long one lasts (seconds), how far it rises (art pixels). */
const DUSTS = 20;
const DUST_S = 0.5;
const DUST_RISE_PX = 2;
/** The chance a foot coming down raises a puff, so that a run leaves a trail, not a cloud. */
const DUST_CHANCE = 0.55;
/** The share of its life after which a puff is drawn larger and fainter. */
const DUST_SPREAD_AT = 0.4;
/** Its opacity before and after it spreads. */
const DUST_ALPHA = 0.85;
const DUST_FAINT = 0.5;
/** Dry earth's dust. */
const DUST_COLOUR = 0xeadcb4;

/** Seconds between flocks of birds in the middle view by day: from, and up to this much more. */
const FLOCK_EVERY_S = 25;
const FLOCK_MORE_S = 45;
/** The most birds in a flock (one at least). */
const FLOCK_MOST = 4;
/** How fast birds fly (art pixels a second) and how often their wings beat (a second). */
const BIRD_PX_S = 30;
const BIRD_FLAPS_HZ = 4;
/** In the V each bird flies this far behind and aside of the one before it (art pixels). */
const V_BEHIND_PX = 7;
const V_ASIDE_PX = 6;
/** Its shadow falls this far below and right of a bird (art pixels), this dark. */
const BIRD_SHADOW_PX = { x: 10, y: 14 };
const BIRD_SHADOW_ALPHA = 0.22;
/** A bird: a pale gull, which reads over wood and grass alike. */
const BIRD_COLOUR = 0xf7f1e4;
/** No birds once it is this dark (0–1). */
const BIRDS_DARK = 0.15;

/** Butterflies in the local view by day, in spring and summer. */
const BUTTERFLIES = 3;
/** The least biomass of grass where flowers grow (`plants.ts`): a meadow. */
const MEADOW_BIOMASS = 128;
/** How far from its flower a butterfly flits (cells), and how fast (art pixels a second). */
const FLIT_CELLS = 1.2;
const FLIT_PX_S = 14;
/** Seconds a flit lasts before it turns, from and up to this much more; the chance it then rests. */
const FLIT_S = 0.35;
const FLIT_MORE_S = 0.6;
const REST_CHANCE = 0.2;
/** Seconds it rests with its wings shut, from and up to this much more. */
const REST_S = 1;
const REST_MORE_S = 1.5;
/** Wing beats a second while it flies. */
const WINGS_HZ = 7;
/** Its shadow below and right of it (art pixels), this dark. */
const BUTTERFLY_SHADOW_PX = { x: 3, y: 5 };
const BUTTERFLY_SHADOW_ALPHA = 0.2;
/** Their wings: white, butter yellow and lilac. */
const WINGS = [0xfff8ec, 0xffe27a, 0xe0b8f0] as const;
/** No butterflies once it is this dark (0–1). */
const BUTTERFLIES_DARK = 0.1;
/** The seasons they fly in. */
const BUTTERFLY_SEASONS: ReadonlySet<string> = new Set(["spring", "summer"]);

/** Drawings, rows of texels: `#` the colour given, `b` a dark body, `.` nothing. */
const FIREFLY_SMALL = ["..,..", ".,o,.", ",o#o,", ".,o,.", "..,.."];
const FIREFLY_LARGE = ["...,...", "..,+,..", ".,+o+,.", ",+o#o+,", ".,+o+,.", "..,+,..", "...,..."];
const DUST_SMALL = ["##", "##"];
const DUST_LARGE = [".##.", "####", "####", ".##."];
/** Up close (the local view) a puff is larger. */
const DUST_SMALL_NEAR = [".#.", "###", ".#."];
const DUST_LARGE_NEAR = ["..##..", ".####.", "######", "######", ".####.", "..##.."];
/** A bird from above, flying to the right: wings up, level, down. */
const BIRD_FRAMES = [
  ["#....", "##...", ".##..", "..###", ".##..", "##...", "#...."],
  ["..#..", "..#..", "..##.", "..###", "..##.", "..#..", "..#.."],
  [".....", ".....", "###..", "#####", "###..", ".....", "....."],
];
/** A butterfly from above, flying to the right: wings open, then shut over its back. */
const BUTTERFLY_FRAMES = [
  ["##.", ".#.", "#bb", ".#.", "##."],
  ["...", ".#.", ".bb", ".#.", "..."],
];
/** Opacity of a firefly's halo by texel: `#` its heart, then the glow round it in steps outward. */
const GLOW_ALPHA: Readonly<Record<string, number>> = { "#": 1, o: 0.6, "+": 0.3, ",": 0.12 };

/** A texture of `rows`: `#` white (to tint), `b` dark, the glow's steps as alpha. */
function texture(rows: readonly string[]): Texture {
  const width = Math.max(...rows.map((row) => row.length));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = rows.length;
  const context = canvas.getContext("2d");
  if (context !== null) {
    rows.forEach((row, y) => {
      for (let x = 0; x < row.length; x++) {
        const texel = row[x] ?? ".";
        if (texel === ".") continue;
        const alpha = GLOW_ALPHA[texel] ?? 1;
        context.fillStyle = texel === "b" ? "#2a1e2a" : `rgba(255,255,255,${alpha})`;
        context.fillRect(x, y, 1, 1);
      }
    });
  }
  return Texture.from({ resource: canvas, scaleMode: "nearest" });
}

interface Firefly {
  x: number;
  y: number;
  way: number;
  life: number;
  /** Its own flash: seconds between, and how far into one it starts (0–1). */
  every: number;
  offset: number;
  /** False while no place for it was found. */
  out: boolean;
}

interface Puff {
  x: number;
  y: number;
  age: number;
}

interface Bird {
  /** Behind and aside of the flock's lead (art pixels). */
  behind: number;
  aside: number;
  flap: number;
}

interface Butterfly {
  home: { x: number; y: number };
  x: number;
  y: number;
  way: number;
  /** Seconds left of this flit or rest. */
  left: number;
  resting: boolean;
  wings: number;
  flap: number;
  out: boolean;
}

/** What the ambient needs of the frame. */
export interface AmbientView {
  view: ViewName;
  cells: CellRect;
  /** Art pixels to the cell. */
  tile: number;
  land: Land | null;
  /** The sim's light of the moment (`Atmosphere.state.light`). */
  light: number;
  /** Something falls from the sky (no birds, butterflies or fireflies in it). */
  raining: boolean;
  /** A world ends on the screen. */
  ending: boolean;
}

export class Ambient {
  /** Over everything in the world: dust behind running animals, birds and butterflies, and their shadows. */
  readonly over = new Container();
  /** Added over the tint, as the glow: fireflies. */
  readonly lights = new Container();

  private readonly random: Random;
  private textures: {
    glowSmall: Texture;
    glowLarge: Texture;
    dustSmall: Texture;
    dustLarge: Texture;
    dustSmallNear: Texture;
    dustLargeNear: Texture;
    birds: Texture[];
    butterflies: Texture[];
  } | null = null;
  private readonly glowPool = new SpritePool("add");
  private readonly shadowPool = new SpritePool("normal");
  private readonly flyerPool = new SpritePool("normal");
  private readonly fireflies: Firefly[] = [];
  private readonly puffs: Puff[] = [];
  private readonly dustSprites: Sprite[] = [];
  private nextPuff = 0;
  private readonly butterflies: Butterfly[] = [];
  private flock: {
    x: number;
    y: number;
    way: number;
    birds: Bird[];
    age: number;
    /** It has come into sight: once out again, it is gone. */
    seen: boolean;
  } | null = null;
  private flockWait: number;
  private time = 0;
  private season = "summer";
  /** The view drawn last, and its art pixels to the cell (dust is told only where, in cells). */
  private view: ViewName = "map";
  private tile = 1;

  constructor(seed: number) {
    this.random = mulberry32(seed);
    this.flockWait = FLOCK_EVERY_S * this.random();
    this.lights.addChild(this.glowPool.container);
    this.over.addChild(this.shadowPool.container, this.flyerPool.container);
  }

  private get art(): NonNullable<Ambient["textures"]> {
    this.textures ??= {
      glowSmall: texture(FIREFLY_SMALL),
      glowLarge: texture(FIREFLY_LARGE),
      dustSmall: texture(DUST_SMALL),
      dustLarge: texture(DUST_LARGE),
      dustSmallNear: texture(DUST_SMALL_NEAR),
      dustLargeNear: texture(DUST_LARGE_NEAR),
      birds: BIRD_FRAMES.map(texture),
      butterflies: BUTTERFLY_FRAMES.map(texture),
    };
    return this.textures;
  }

  /** Take a message as it reaches the scene: the season, for the butterflies. */
  receive(message: Message): void {
    if (message.type === "clock") this.season = message.season;
  }

  /**
   * A foot of an animal hurrying on dry land came down at (x, y) cells: now and then a
   * puff of dust there.
   */
  dust(x: number, y: number): void {
    if (this.view === "map" || this.random() >= DUST_CHANCE) return;
    while (this.dustSprites.length < DUSTS) {
      const sprite = new Sprite(this.art.dustSmall);
      sprite.tint = DUST_COLOUR;
      sprite.visible = false;
      this.dustSprites.push(sprite);
      this.puffs.push({ x: 0, y: 0, age: DUST_S });
      this.over.addChildAt(sprite, 0);
    }
    const puff = this.puffs[this.nextPuff];
    this.nextPuff = (this.nextPuff + 1) % DUSTS;
    if (puff === undefined) return;
    puff.x = x;
    puff.y = y;
    puff.age = 0;
  }

  /** Move everything on by `dtS` seconds and draw it for `frame`. */
  update(dtS: number, frame: AmbientView): void {
    this.time += dtS;
    if (frame.view !== this.view) {
      // Another view: what was in the last one is gone, and the fireflies are put anew.
      for (const firefly of this.fireflies) firefly.life = 0;
      for (const butterfly of this.butterflies) butterfly.out = true;
      for (const puff of this.puffs) puff.age = DUST_S;
      this.flock = null;
    }
    this.view = frame.view;
    this.tile = frame.tile;
    this.glowPool.begin();
    this.shadowPool.begin();
    this.flyerPool.begin();
    const dark = darkness(frame.light);
    const quiet = frame.view === "map" || frame.raining || frame.ending || frame.land === null;
    if (!quiet && frame.land !== null) {
      this.drawFireflies(dtS, frame, frame.land, dark);
      this.drawBirds(dtS, frame, dark);
      this.drawButterflies(dtS, frame, frame.land, dark);
    }
    this.drawDust(dtS, frame);
    this.glowPool.end();
    this.shadowPool.end();
    this.flyerPool.end();
  }

  /** What the ambient shows (staging): fireflies lit, puffs, birds and butterflies in sight. */
  get state(): {
    fireflies: number;
    dust: number;
    birds: number;
    butterflies: number;
    /** Where the flock's lead is (cells), if one flies. */
    flock: { x: number; y: number } | null;
  } {
    return {
      flock: this.flock === null ? null : { x: this.flock.x, y: this.flock.y },
      fireflies: this.glowPool.shown,
      dust: this.puffs.filter((puff) => puff.age < DUST_S).length,
      birds: this.flock?.birds.length ?? 0,
      butterflies: this.butterflies.filter((butterfly) => !butterfly.out).length,
    };
  }

  /** A place in sight over one of `covers` (and, with `biomass`, at least so thick), or null. */
  private placeIn(
    cells: CellRect,
    land: Land,
    covers: ReadonlySet<string>,
    biomass = 0,
    out: { x: number; y: number },
  ): boolean {
    for (let attempt = 0; attempt < TRIES; attempt++) {
      const x = cells.x0 + (cells.x1 - cells.x0) * this.random();
      const y = cells.y0 + (cells.y1 - cells.y0) * this.random();
      const cell = Math.floor(y) * land.width + Math.floor(x);
      if (x < 0 || y < 0 || x >= land.width || y >= land.height) continue;
      if ((land.heights[cell] ?? 0) <= land.seaLevel) continue;
      const cover = land.coverClasses[land.cover[cell] ?? 0] ?? "";
      if (!covers.has(cover) || (land.biomass[cell] ?? 0) < biomass) continue;
      out.x = x;
      out.y = y;
      return true;
    }
    return false;
  }

  private drawFireflies(dtS: number, frame: AmbientView, land: Land, dark: number): void {
    const wanted = FIREFLIES[frame.view];
    if (dark <= FIREFLY_DARK || wanted === 0) return;
    const strength = Math.min((dark - FIREFLY_DARK) / (FIREFLY_FULL - FIREFLY_DARK), 1);
    while (this.fireflies.length < wanted) {
      this.fireflies.push({ x: 0, y: 0, way: 0, life: 0, every: 1, offset: 0, out: true });
    }
    const { cells, tile } = frame;
    const glow = frame.view === "local" ? this.art.glowLarge : this.art.glowSmall;
    for (let k = 0; k < wanted; k++) {
      const firefly = this.fireflies[k];
      if (firefly === undefined) continue;
      firefly.life -= dtS;
      const gone =
        firefly.x < cells.x0 - 1 ||
        firefly.x > cells.x1 + 1 ||
        firefly.y < cells.y0 - 1 ||
        firefly.y > cells.y1 + 1;
      if (firefly.life <= 0 || gone) {
        firefly.out = !this.placeIn(cells, land, FIREFLY_COVERS, 0, firefly);
        firefly.life = FIREFLY_LIFE_S + FIREFLY_LIFE_MORE_S * this.random();
        firefly.way = 2 * Math.PI * this.random();
        firefly.every = FLASH_S + FLASH_MORE_S * this.random();
        // It comes dark, at the start of the wait before its next flash: no light pops in.
        firefly.offset = -this.time / firefly.every + FLASH_SHARE;
      }
      if (firefly.out) continue;
      firefly.way += (this.random() * 2 - 1) * FIREFLY_WANDER * dtS;
      const step = (FIREFLY_PX_S / tile) * dtS;
      firefly.x += Math.cos(firefly.way) * step;
      firefly.y += Math.sin(firefly.way) * step;
      const into = (((this.time / firefly.every + firefly.offset) % 1) + 1) % 1;
      if (into >= FLASH_SHARE) continue;
      const lit = Math.ceil(Math.sin((Math.PI * into) / FLASH_SHARE) * FLASH_STEPS) / FLASH_STEPS;
      const sprite = this.glowPool.next(glow);
      placeCentred(sprite, firefly.x, firefly.y, tile, glow.width);
      sprite.tint = FIREFLY_GLOW;
      sprite.alpha = lit * strength;
    }
  }

  private drawDust(dtS: number, frame: AmbientView): void {
    const { tile } = frame;
    this.puffs.forEach((puff, k) => {
      const sprite = this.dustSprites[k];
      if (sprite === undefined) return;
      if (puff.age >= DUST_S || frame.view === "map") {
        sprite.visible = false;
        return;
      }
      puff.age += dtS;
      const t = Math.min(puff.age / DUST_S, 1);
      const spread = t >= DUST_SPREAD_AT;
      const near = frame.view === "local";
      const look = spread
        ? near
          ? this.art.dustLargeNear
          : this.art.dustLarge
        : near
          ? this.art.dustSmallNear
          : this.art.dustSmall;
      if (sprite.texture !== look) sprite.texture = look;
      placeCentred(sprite, puff.x, puff.y - Math.round(DUST_RISE_PX * t) / tile, tile, look.width);
      sprite.alpha = spread ? DUST_FAINT : DUST_ALPHA;
      sprite.visible = t < 1;
    });
  }

  private drawBirds(dtS: number, frame: AmbientView, dark: number): void {
    if (frame.view !== "middle" || dark >= BIRDS_DARK) {
      this.flock = null;
      return;
    }
    const { cells, tile } = frame;
    const width = cells.x1 - cells.x0;
    const height = cells.y1 - cells.y0;
    if (this.flock === null) {
      this.flockWait -= dtS;
      if (this.flockWait > 0) return;
      this.flockWait = FLOCK_EVERY_S + FLOCK_MORE_S * this.random();
      // From beyond one edge of the view, across it, a little off its middle.
      const way = 2 * Math.PI * this.random();
      const reach = Math.hypot(width, height) / 2 + (2 * V_BEHIND_PX * FLOCK_MOST) / tile;
      const aside = (this.random() - 0.5) * Math.min(width, height) * 0.6;
      const midX = (cells.x0 + cells.x1) / 2 - Math.sin(way) * aside;
      const midY = (cells.y0 + cells.y1) / 2 + Math.cos(way) * aside;
      const count = 1 + Math.floor(this.random() * FLOCK_MOST);
      const birds: Bird[] = [];
      for (let k = 0; k < count; k++) {
        const rank = Math.ceil(k / 2);
        birds.push({
          behind: rank * V_BEHIND_PX,
          aside: (k % 2 === 0 ? 1 : -1) * rank * V_ASIDE_PX,
          flap: this.random(),
        });
      }
      this.flock = {
        x: midX - Math.cos(way) * reach,
        y: midY - Math.sin(way) * reach,
        way,
        birds,
        age: 0,
        seen: false,
      };
    }
    const flock = this.flock;
    flock.age += dtS;
    const step = (BIRD_PX_S / tile) * dtS;
    flock.x += Math.cos(flock.way) * step;
    flock.y += Math.sin(flock.way) * step;
    const cos = Math.cos(flock.way);
    const sin = Math.sin(flock.way);
    let inSight = false;
    const margin = (2 * V_BEHIND_PX * FLOCK_MOST) / tile;
    for (const bird of flock.birds) {
      const x = flock.x + (-cos * bird.behind - sin * bird.aside) / tile;
      const y = flock.y + (-sin * bird.behind + cos * bird.aside) / tile;
      if (
        x > cells.x0 - margin &&
        x < cells.x1 + margin &&
        y > cells.y0 - margin &&
        y < cells.y1 + margin
      ) {
        inSight = true;
      }
      const frames = this.art.birds;
      const beat = Math.floor((flock.age * BIRD_FLAPS_HZ + bird.flap) * frames.length * 2);
      // Up, level, down, level: the wings go and come back.
      const index = [0, 1, 2, 1][beat % 4] ?? 0;
      const look = frames[index] ?? frames[0];
      if (look === undefined) continue;
      const shadow = this.shadowPool.next(look);
      this.flyer(shadow, x + BIRD_SHADOW_PX.x / tile, y + BIRD_SHADOW_PX.y / tile, flock.way, tile);
      shadow.tint = 0x000000;
      shadow.alpha = BIRD_SHADOW_ALPHA;
      const sprite = this.flyerPool.next(look);
      this.flyer(sprite, x, y, flock.way, tile);
      sprite.tint = BIRD_COLOUR;
      sprite.alpha = 1;
    }
    // Once it has crossed and is past the far edge, it is gone.
    if (inSight) flock.seen = true;
    else if (flock.seen) this.flock = null;
  }

  /** Put a flyer's `sprite` at (x, y) cells on whole art pixels, its drawing turned to `way`. */
  private flyer(sprite: Sprite, x: number, y: number, way: number, tile: number): void {
    sprite.anchor.set(0.5);
    sprite.position.set(Math.round(x * tile) / tile, Math.round(y * tile) / tile);
    sprite.rotation = way;
    sprite.scale.set(1 / tile);
  }

  private drawButterflies(dtS: number, frame: AmbientView, land: Land, dark: number): void {
    if (frame.view !== "local" || dark >= BUTTERFLIES_DARK || !BUTTERFLY_SEASONS.has(this.season)) {
      for (const butterfly of this.butterflies) butterfly.out = true;
      return;
    }
    while (this.butterflies.length < BUTTERFLIES) {
      this.butterflies.push({
        home: { x: 0, y: 0 },
        x: 0,
        y: 0,
        way: 0,
        left: 0,
        resting: false,
        wings: this.butterflies.length % WINGS.length,
        flap: this.random(),
        out: true,
      });
    }
    const { cells, tile } = frame;
    for (const butterfly of this.butterflies) {
      const { home } = butterfly;
      const gone =
        home.x < cells.x0 - 1 ||
        home.x > cells.x1 + 1 ||
        home.y < cells.y0 - 1 ||
        home.y > cells.y1 + 1;
      if (butterfly.out || gone) {
        // A meadow in sight to flit over; none, and it waits for one.
        butterfly.out = !this.placeIn(cells, land, FIREFLY_COVERS, MEADOW_BIOMASS, home);
        if (butterfly.out) continue;
        butterfly.x = home.x;
        butterfly.y = home.y;
        butterfly.left = 0;
      }
      butterfly.left -= dtS;
      if (butterfly.left <= 0) {
        // A new flit, back toward its flower when it has gone far; or a rest.
        butterfly.resting = !butterfly.resting && this.random() < REST_CHANCE;
        butterfly.left = butterfly.resting
          ? REST_S + REST_MORE_S * this.random()
          : FLIT_S + FLIT_MORE_S * this.random();
        const far = Math.hypot(butterfly.x - home.x, butterfly.y - home.y) > FLIT_CELLS;
        butterfly.way = far
          ? Math.atan2(home.y - butterfly.y, home.x - butterfly.x) + (this.random() - 0.5)
          : 2 * Math.PI * this.random();
      }
      if (!butterfly.resting) {
        const step = (FLIT_PX_S / tile) * dtS;
        butterfly.x += Math.cos(butterfly.way) * step;
        butterfly.y += Math.sin(butterfly.way) * step;
      }
      const frames = this.art.butterflies;
      const open = butterfly.resting
        ? 1
        : Math.floor((this.time * WINGS_HZ + butterfly.flap) * frames.length) % frames.length;
      const look = frames[open] ?? frames[0];
      if (look === undefined) continue;
      // It faces the way it flits; resting, the way it came.
      const shadow = this.shadowPool.next(look);
      this.flyer(
        shadow,
        butterfly.x + BUTTERFLY_SHADOW_PX.x / tile,
        butterfly.y + BUTTERFLY_SHADOW_PX.y / tile,
        butterfly.way,
        tile,
      );
      shadow.tint = 0x000000;
      shadow.alpha = BUTTERFLY_SHADOW_ALPHA;
      const sprite = this.flyerPool.next(look);
      this.flyer(sprite, butterfly.x, butterfly.y, butterfly.way, tile);
      sprite.tint = WINGS[butterfly.wings] ?? WINGS[0];
      sprite.alpha = 1;
    }
  }
}
