/**
 * The atmosphere over the scene (R4, ADR 0021): the light, what glows in the dark, the
 * weather of the island's events, and the end of a world.
 *
 *   light     the colour multiplied over everything (`light.ts`): moonlit blue at night,
 *             rose at dusk, lilac at dawn, day graded by the season, greyed by rain;
 *             eased between the sim's 10-minute steps
 *   glow      light added over the tint, so that it shows in the dark: the spots of
 *             animals with the glow gene, fires, lava, sparks, beams
 *   weather   rain while the rain god power's rain falls; smoke over burning cells; ash
 *             and lava from a volcano; a shake and dust for an earthquake; a meteor's
 *             streak, flash and dust where it digs its crater; light from the sky where
 *             the seed and ark powers fall; a flash when lightning starts a fire
 *   the end   the apocalypse sequence (`apocalypse.ts`), about three minutes on the map
 *
 * Its layers go in the scene in this order: the world (land, plants, animals) and then
 * `ground` (cells: the risen sea, smoke, dust), `weather` (art pixels of the screen: rain,
 * falling ash), `tint` (the light, multiplied over all of those), `lights` (cells, added
 * over the tint) and `flash` (the screen, over everything). The scroll and the dip
 * between views are page elements and take none of it.
 *
 * Short things (a shake, a meteor, a beam) last a few wall seconds, so that they read at
 * any speed; a volcano's eruption lasts sim-hours, and at least some wall seconds.
 */
import { Container, Sprite, Texture } from "pixi.js";
import { GLOW_SPOT } from "../creatures/body";
import type { ViewName } from "../landscape";
import type { EventsMessage, Message, Season, SkyMessage } from "../protocol";
import { mulberry32, type Random } from "../rng";
import type { CellRect, Land } from "../terrain/land";
import { cellHash } from "../terrain/pixels";
import { Sequence, floodPixels, seaLevelAt, ventsOf, type Moment } from "./apocalypse";
import {
  LightEase,
  RAIN_GREY,
  darkness,
  mixRgb,
  multiplyRgb,
  packRgb,
  skyTint,
  type Rgb,
} from "./light";
import { BOLTS, boltAt, boltPath, strikePoint } from "./lightning";
import { CRATER_RIM, LAVA_FRAMES, coneSummit, markTexture } from "./marks";
import { SpritePool, dropAt, placeCentred, puffAt, type Fall, type Plume } from "./particles";
import { HALO_SIZE, RINGS, atmosphereSprites, streakTexture, type Sprites } from "./sprites";

/** The colours of things that glow (0xRRGGBB): lava and fire, sparks, the seed's gold, the ark's light. */
const LAVA = [0xff5a1e, 0xff8a2a, 0xffc04a] as const;
const FIRE = [0xff7a20, 0xffa830, 0xffd060] as const;
const SPARK = 0xffe6a0;
const SEED_GOLD = 0xffe08a;
const ARK_LIGHT = 0xd8f0ff;
/** Smoke, ash, dust and rain (0xRRGGBB). */
const SMOKE = 0x8a8290;
const ASH = 0x3c3438;
const DUST = 0xb8a088;
const RAIN = 0xe4f0ff;
const RIPPLE = 0xe8f4ff;
const BOLT = 0xf4f8ff;
const BOLT_GLOW = 0xb8d0ff;
/** How hard each rain falls (share of `RAINDROPS`), and how it leans (art pixels a second across). */
const RAIN_STRENGTH: Readonly<Record<RainKind, number>> = {
  none: 0,
  rain: 0.7,
  thunder: 0.8,
  storm: 1,
  soaking: 0.6,
};
/** How much the rain leans with the wind: pixels across for each pixel down. */
const RAIN_LEAN: Readonly<Record<RainKind, number>> = {
  none: 0,
  rain: 0.35,
  thunder: 0.45,
  storm: 0.8,
  soaking: 0.2,
};
/** Rain as the view is close: how long a drop is (art pixels), how fast it falls (art pixels a second), how many, how bright. */
const RAIN_SCALE: Readonly<
  Record<ViewName, { length: number; speed: number; count: number; alpha: number }>
> = {
  map: { length: 2, speed: 80, count: 1.6, alpha: 0.4 },
  middle: { length: 3, speed: 120, count: 1.3, alpha: 0.5 },
  local: { length: 6, speed: 170, count: 1, alpha: 0.7 },
};
/** The layers of rain, far to near: share of the drops, and how fast, long and bright against the view's. */
const RAIN_LAYERS = [
  { share: 0.45, speed: 0.6, length: 0.6, alpha: 0.55 },
  { share: 0.35, speed: 1, length: 1, alpha: 0.85 },
  { share: 0.2, speed: 1.45, length: 1.45, alpha: 1 },
] as const;
/** Glow: seconds a pulse takes, the least of it, and the glow round an animal's square on the map (art pixels). */
const GLOW_PULSE_S = 3.5;
const GLOW_LOW = 0.45;
const GLOW_MAP_PX = 8;
/** A thunderstorm darkens the sky this much more than rain (multiplied in as it builds). */
const STORM_GREY: Rgb = [0.6, 0.64, 0.78];
/** Ripples on the water a frame at full rain, in the middle and local views, and how long one lasts (s). */
const RIPPLES = 40;
const RIPPLE_S = 0.6;
/** The sky at the end of a world. */
const BLOOD_RED: Rgb = [1.0, 0.42, 0.3];

/** Wall seconds each short thing lasts; a volcano lasts sim-hours, at least `VOLCANO_WALL_S`. */
const QUAKE_S = 4;
const METEOR_FALL_S = 1.2;
const METEOR_S = 7;
const BEAM_S = 8;
/**
 * A volcano's cone and a meteor's crater stay drawn this many sim-days after (the land
 * keeps them; its shading barely shows them), and at least this many wall seconds.
 */
const MARK_DAYS = 30;
const MARK_WALL_S = 90;
const MS_PER_DAY = 86_400_000;
/** Seconds a burnt animal's ash rises; motes of the seed power over the bare land in sight. */
const ASH_S = 3;
/** Frames a second of the lava's flow (it loops over `LAVA_FRAMES`). */
const LAVA_FPS = 4;
const SEED_MOTES = 120;
const SPARKS_S = 2;
const VOLCANO_HOURS = 12;
const VOLCANO_WALL_S = 30;
const FLASH_S = 0.5;
/** Art pixels a quake shakes the picture by, at most; a meteor's landing, a little less. */
const QUAKE_PX = 2;
const IMPACT_PX = 2;
/** At most this many burning cells lit, and this many of them smoking. */
const MOST_FIRES = 300;
const MOST_SMOKES = 24;
/** Raindrops and flecks of falling ash on the screen at full strength. */
const RAINDROPS = 180;
const ASHFALL = 90;
/** Seconds for rain to set in or stop. */
const RAIN_EASE_S = 3;
/** Lava vents of the end of a world. */
const VENTS = 40;
/** Seconds between repaints of the risen sea (it moves slowly). */
const FLOOD_REPAINT_S = 0.1;
const MS_PER_HOUR = 3_600_000;

/** Something that glows on an animal (cells): where, and how big the animal is. */
export interface Spot {
  x: number;
  y: number;
  size: number;
}

/** What the scene shows this frame. */
export interface View {
  view: ViewName;
  cells: CellRect;
  /** Art pixels to the cell. */
  tile: number;
  /** The screen, in art pixels. */
  width: number;
  height: number;
  land: Land | null;
  /** Glowing animals in sight. */
  glowing: readonly Spot[];
  /** Art pixels of screen beyond the world's first cell in sight (the canvas's margin). */
  margin?: number;
}

type Kind =
  "volcano" | "quake" | "meteor" | "seed" | "ark" | "sparks" | "strike" | "ash" | "cone" | "crater";
/** What falls from the sky (the `sky` message's `rain`). */
export type RainKind = SkyMessage["rain"];

interface Effect {
  kind: Kind;
  x: number;
  y: number;
  radius: number;
  /** Wall seconds since it began, and the least it lasts. */
  age: number;
  wallS: number;
  /** Sim time it lasts to (volcano), or -1. */
  untilMs: number;
  salt: number;
  /** Whether a meteor has struck yet (its flash goes off once). */
  struck: boolean;
  /** Wall seconds before it shows (a crater waits for its meteor). */
  delayS?: number;
}

export interface AtmosphereOptions {
  /** Called when a world's end begins on the screen (the camera goes to the map, the dead go). */
  onEnd?: () => void;
  /** The shake's random draws. */
  random: Random;
}

export class Atmosphere {
  readonly ground = new Container();
  readonly weather = new Container();
  readonly tint: Sprite;
  readonly lights = new Container();
  readonly flash: Sprite;
  /** Over everything, on the screen: lightning, and the flash. */
  readonly sky = new Container();

  private readonly sprites: Sprites = atmosphereSprites();
  private readonly groundPool = new SpritePool("normal");
  private readonly weatherPool = new SpritePool("normal");
  private readonly lightPool = new SpritePool("add");
  /** Flames and a volcano's mouth: drawn as they are, over the tint (they make their own light). */
  private readonly flamePool = new SpritePool("normal");
  private readonly ripplePool = new SpritePool("normal");
  private readonly boltPool = new SpritePool("add");
  private readonly flood: Sprite;
  private floodCanvas: HTMLCanvasElement | null = null;
  private floodTexture: Texture | null = null;
  private floodLevel: number | null = null;
  private floodWait = 0;

  private readonly ease = new LightEase(1);
  private present = true;
  private rainKind: RainKind = "none";
  private rain = 0;
  private storm = 0;
  private burning: readonly number[] = [];
  private season: Season = "summer";
  private progress = 0.5;
  private simMs = 0;
  private timeS = 0;
  private flashLeft = 0;
  private effects: Effect[] = [];
  private salts = 0;
  private readonly sequence: Sequence;
  private vents: { x: number; y: number }[] = [];
  private shown: Rgb = [1, 1, 1];

  constructor(
    deliver: (message: Message) => void,
    private readonly options: AtmosphereOptions,
  ) {
    this.tint = new Sprite({ texture: Texture.WHITE, blendMode: "multiply" });
    this.flash = new Sprite(Texture.WHITE);
    this.flash.alpha = 0;
    this.flood = new Sprite(Texture.EMPTY);
    this.flood.visible = false;
    this.ground.addChild(this.flood, this.ripplePool.container, this.groundPool.container);
    this.weather.addChild(this.weatherPool.container);
    this.lights.addChild(this.lightPool.container, this.flamePool.container);
    this.sky.addChild(this.boltPool.container, this.flash);
    this.sequence = new Sequence(deliver);
  }

  /**
   * Take `message` before anything else does: true when a world's end holds it back (it
   * is handed to `deliver` later). The message that ends a world starts the sequence.
   */
  hold(message: Message): boolean {
    const was = this.sequence.active;
    const held = this.sequence.take(message);
    if (!was && this.sequence.active) this.options.onEnd?.();
    return held;
  }

  /** Whether a world is ending on the screen (the camera stays on the map). */
  get ending(): boolean {
    return this.sequence.active;
  }

  /** Take a message as it reaches the scene. */
  receive(message: Message): void {
    if (message.type === "clock") {
      this.simMs = message.t_ms;
      this.season = message.season;
      this.progress = message.season_progress;
    } else if (message.type === "sky") {
      this.simMs = message.t_ms;
      this.ease.step(message.light);
      this.present = message.present;
      this.rainKind = message.rain;
      this.burning = message.burning;
    } else if (message.type === "events") this.takeEvents(message);
  }

  /** Show the sky's light at once (a picture that must not wait for the ease). */
  settleLight(): void {
    this.ease.set(this.ease.target);
    this.rain = RAIN_STRENGTH[this.rainKind];
    this.storm = this.rainKind === "storm" ? 1 : 0;
  }

  private takeEvents(message: EventsMessage): void {
    for (const event of message.events) {
      const x = event.x ?? 0;
      const y = event.y ?? 0;
      const radius = event.radius_cells ?? 2;
      const add = (kind: Kind, wallS: number, untilMs = -1, delayS = 0): void => {
        this.effects.push({
          kind,
          x,
          y,
          radius,
          age: 0,
          wallS,
          untilMs,
          salt: ++this.salts,
          struck: false,
          delayS,
        });
      };
      switch (event.kind) {
        case "volcano":
          add("cone", MARK_WALL_S, event.t_ms + MARK_DAYS * MS_PER_DAY);
          add("volcano", VOLCANO_WALL_S, event.t_ms + VOLCANO_HOURS * MS_PER_HOUR);
          break;
        case "earthquake":
          add("quake", QUAKE_S);
          break;
        case "crater":
          // A meteor's god power digs it: its fall is drawn here, where it lands, and the
          // bowl it leaves once it has struck.
          add("crater", MARK_WALL_S, event.t_ms + MARK_DAYS * MS_PER_DAY, METEOR_FALL_S);
          add("meteor", METEOR_S);
          break;
        case "god_power":
          if (event.power === "seed") add("seed", BEAM_S);
          else if (event.power === "ark") add("ark", BEAM_S);
          break;
        case "creatures_arrived": {
          // The ark's newcomers land here: its light goes where they are.
          const ark = [...this.effects]
            .reverse()
            .find((effect) => effect.kind === "ark" && effect.age === 0);
          if (ark !== undefined) {
            ark.x = x;
            ark.y = y;
          }
          break;
        }
        case "fire_started":
          // The thunderstorm's lightning: the biggest bolt, where the fire begins.
          add("strike", BOLTS.strike.lasts + SPARKS_S);
          add("sparks", SPARKS_S);
          break;
        case "world_ended":
          this.effects = [];
          this.burning = [];
          break;
        default:
          break;
      }
    }
  }

  /** Move everything on by `dtS` wall seconds and draw it for `view`; the shake to apply (art pixels). */
  update(dtS: number, view: View): { x: number; y: number } {
    this.timeS += dtS;
    this.ease.tick(dtS);
    this.flashLeft = Math.max(this.flashLeft - dtS, 0);
    const ease = (now: number, target: number): number =>
      now + Math.sign(target - now) * Math.min(Math.abs(target - now), dtS / RAIN_EASE_S);
    this.rain = ease(this.rain, RAIN_STRENGTH[this.rainKind]);
    this.storm = ease(this.storm, this.rainKind === "storm" ? 1 : 0);
    const wasEnding = this.sequence.active;
    this.sequence.update(dtS);
    const moment = this.sequence.active ? this.sequence.moment : null;
    if (moment !== null && (!wasEnding || this.vents.length === 0) && view.land !== null) {
      this.vents = ventsOf(view.land, VENTS, mulberry32(view.land.width * 7919 + view.land.height));
    }
    if (moment === null) this.vents = [];
    for (const effect of this.effects) effect.age += dtS;
    this.effects = this.effects.filter(
      (effect) => effect.age < effect.wallS || (effect.untilMs >= 0 && this.simMs < effect.untilMs),
    );

    this.paintTint(view, moment);
    this.groundPool.begin();
    this.weatherPool.begin();
    this.lightPool.begin();
    this.flamePool.begin();
    this.ripplePool.begin();
    this.boltPool.begin();
    let shake = 0;
    const dark = this.darkness(moment);
    this.drawGlow(view, dark);
    this.drawFires(view, dark);
    for (const effect of this.effects) shake = Math.max(shake, this.drawEffect(effect, view));
    this.drawRain(view);
    const lightning = this.drawLightning(view);
    if (moment !== null) shake = Math.max(shake, this.drawEnd(moment, view, dtS));
    else this.flood.visible = false;
    this.groundPool.end();
    this.weatherPool.end();
    this.lightPool.end();
    this.flamePool.end();
    this.ripplePool.end();
    this.boltPool.end();

    this.flash.width = view.width;
    this.flash.height = view.height;
    this.flash.alpha = Math.max(Math.min(this.flashLeft / FLASH_S, 1) * 0.8, lightning);
    if (shake <= 0 || dtS <= 0) return { x: 0, y: 0 };
    const jolt = (): number => Math.round((this.options.random() * 2 - 1) * shake);
    return { x: jolt(), y: jolt() };
  }

  /** How dark it is (0–1): the night's, or the end of a world's. */
  private darkness(moment: Moment | null): number {
    const night = darkness(this.ease.value);
    return moment === null ? night : Math.max(night, moment.black, moment.red * 0.6);
  }

  private paintTint(view: View, moment: Moment | null): void {
    let colour = skyTint(this.ease.value, this.present, this.season, this.progress);
    // Clouds over the sun: any rain greys the day, thunder more.
    const cloud = Math.min(this.rain / 0.7, 1) * (this.rainKind === "thunder" ? 1.15 : 1);
    colour = multiplyRgb(colour, mixRgb([1, 1, 1], RAIN_GREY, Math.min(cloud, 1.15)));
    colour = multiplyRgb(colour, mixRgb([1, 1, 1], STORM_GREY, this.storm));
    if (moment !== null) {
      // Red whatever the hour: the end of a world is lit by its fires, not by the owner.
      colour = mixRgb(colour, BLOOD_RED, moment.red);
      colour = mixRgb(colour, [0.03, 0.02, 0.04], moment.black);
    }
    this.shown = colour;
    this.tint.tint = packRgb(colour);
    this.tint.width = view.width;
    this.tint.height = view.height;
  }

  private halo(
    x: number,
    y: number,
    size: number,
    colour: number,
    alpha: number,
    tile: number,
  ): void {
    if (alpha <= 0.01) return;
    const sprite = this.lightPool.next(this.sprites.halo);
    // No bigger than the texture thrice, so that its steps stay a few art pixels wide.
    placeCentred(sprite, x, y, tile, Math.min(size, 3 * HALO_SIZE));
    sprite.tint = colour;
    sprite.alpha = Math.min(alpha, 1);
  }

  /** A flicker between 0.75 and 1 for thing `n`, changing a few times a second. */
  private flicker(n: number): number {
    return 0.75 + 0.25 * cellHash(n, Math.floor(this.timeS * 6), 341);
  }

  private drawGlow(view: View, dark: number): void {
    if (dark <= 0.02) return;
    // A slow pulse, a breath every few seconds.
    const pulse = 0.5 + 0.5 * Math.sin((2 * Math.PI * this.timeS) / GLOW_PULSE_S);
    const strength = dark * (GLOW_LOW + (1 - GLOW_LOW) * pulse);
    const map = view.view === "map";
    for (const spot of view.glowing) {
      // On the map a soft light just round the animal's square; closer, a ring of light
      // round each spot of its back, its heart clear so that the animal shows through.
      const size = map
        ? GLOW_MAP_PX
        : Math.max(spot.size * view.tile * (view.tile >= 32 ? 7 : 5), 12);
      const sprite = this.lightPool.next(map ? this.sprites.halo : this.sprites.ring);
      placeCentred(sprite, spot.x, spot.y, view.tile, Math.min(size, 3 * HALO_SIZE));
      sprite.tint = GLOW_SPOT;
      sprite.alpha = Math.min((map ? 0.7 : 0.6) * strength, 1);
    }
  }

  private drawFires(view: View, dark: number): void {
    const land = view.land;
    if (land === null || this.burning.length === 0) return;
    const { cells, tile } = view;
    const inSight: number[] = [];
    for (const index of this.burning) {
      const x = (index % land.width) + 0.5;
      const y = Math.floor(index / land.width) + 0.5;
      if (x < cells.x0 - 2 || x > cells.x1 + 2 || y < cells.y0 - 2 || y > cells.y1 + 2) continue;
      inSight.push(index);
    }
    const every = Math.max(1, Math.ceil(inSight.length / MOST_FIRES));
    const strength = 0.55 + 0.45 * dark;
    // The whole fire lights the land round it, more so at night.
    let sumX = 0;
    let sumY = 0;
    for (const index of inSight) {
      sumX += (index % land.width) + 0.5;
      sumY += Math.floor(index / land.width) + 0.5;
    }
    if (inSight.length > 0) {
      const spread = Math.sqrt(inSight.length) * tile * 2.5 + 12;
      const glow = 0.15 + 0.3 * dark;
      this.halo(sumX / inSight.length, sumY / inSight.length, spread, FIRE[0], glow, tile);
    }
    // Each burning cell: a small flickering glow, and flames licking up from it.
    inSight.forEach((index, n) => {
      if (n % every !== 0) return;
      const x = (index % land.width) + 0.5;
      const y = Math.floor(index / land.width) + 0.5;
      const flame = Math.floor(cellHash(index, Math.floor(this.timeS * 5), 342) * FIRE.length);
      const colour = FIRE[flame] ?? FIRE[0];
      // Off the cell's middle by a hash, so that a fire is not a grid of lamps.
      const fx = x + (cellHash(index, 1, 345) - 0.5) * 0.6;
      const fy = y + (cellHash(index, 2, 345) - 0.5) * 0.6;
      const size = Math.max(tile * 0.9, 4);
      this.halo(fx, fy, size, colour, 0.6 * strength * this.flicker(index), tile);
      const flames: Plume = {
        x: fx,
        y: fy,
        spread: 0.4,
        rise: 6 + tile * 0.5,
        drift: 1,
        life: 0.8,
        from: tile >= 32 ? 3 : 2,
        to: 1,
        alpha: strength,
        salt: index,
      };
      if (tile < 8) {
        // On the map a burning cell is a flicker of light and a spark or two.
        this.puffs(flames, 1, FIRE[(flame + 1) % FIRE.length] ?? SPARK, tile, true);
        return;
      }
      // Closer, flames: one to a cell in the middle view; up close two larger,
      // more detailed ones, each with its own glow and embers rising from it. Each on its
      // own frame of the flicker; whole multiples of size only, for hard pixel edges.
      const close = tile >= 32;
      const count = close ? 2 : 1;
      const frames = close ? this.sprites.bigFlames : this.sprites.flames;
      const scale = close ? 2 : 1;
      for (let k = 0; k < count; k++) {
        const ox = count === 1 ? 0 : (cellHash(index, k, 346) - 0.5) * 0.8;
        const oy = count === 1 ? 0 : (cellHash(index, k, 347) - 0.5) * 0.6;
        const rate = 7 + 4 * cellHash(index, k, 349);
        const frame = (Math.floor(this.timeS * rate) + k + index) % frames.length;
        const sprite = this.flamePool.next(frames[frame] ?? this.sprites.fleck);
        const w = sprite.texture.width * scale;
        const h = sprite.texture.height * scale;
        // Its foot on the place, rising from it.
        placeCentred(sprite, fx + ox, fy + oy - h / 2 / tile, tile, w, h);
        sprite.tint = 0xffffff;
        sprite.alpha = 1;
        if (close) {
          const glow = FIRE[(frame + k) % FIRE.length] ?? FIRE[0];
          this.halo(
            fx + ox,
            fy + oy - h / 3 / tile,
            w * 1.8,
            glow,
            0.45 * strength * this.flicker(index + k),
            tile,
          );
          this.puffs(
            {
              x: fx + ox,
              y: fy + oy - (h * 0.6) / tile,
              spread: 0.08,
              rise: 22,
              drift: 4,
              life: 1.1,
              from: 2,
              to: 1,
              alpha: strength,
              salt: index * 7 + k,
            },
            3,
            SPARK,
            tile,
            true,
          );
        }
      }
      if (!close) this.puffs(flames, 2, SPARK, tile, true);
    });
    // Smoke from some of them, grey and drifting with the wind.
    const smokes = Math.min(MOST_SMOKES, inSight.length);
    for (let s = 0; s < smokes; s++) {
      const index = inSight[Math.floor((s * inSight.length) / smokes)] ?? 0;
      const plume: Plume = {
        x: (index % land.width) + 0.5,
        y: Math.floor(index / land.width) + 0.5,
        spread: 0.4,
        rise: 6,
        drift: 3,
        life: 4,
        from: 3,
        to: 10,
        alpha: 0.7,
        salt: index,
      };
      this.puffs(plume, 3, SMOKE, tile);
    }
  }

  private puffs(plume: Plume, count: number, colour: number, tile: number, glow = false): void {
    for (let slot = 0; slot < count; slot++) {
      const puff = puffAt(plume, slot, this.timeS, tile);
      if (puff.alpha <= 0.01) continue;
      const sprite = glow
        ? this.lightPool.next(this.sprites.fleck)
        : this.groundPool.next(this.sprites.puff);
      // What glows is a fleck of a pixel or two; smoke and dust are puffs.
      placeCentred(
        sprite,
        puff.x,
        puff.y,
        tile,
        glow ? Math.max(Math.round(puff.size), 1) : puff.size,
      );
      sprite.tint = colour;
      sprite.alpha = puff.alpha;
    }
  }

  /** Draw `effect`; how much it shakes the picture now (art pixels). */
  private drawEffect(effect: Effect, view: View): number {
    const { tile } = view;
    const { x, y, radius, age, salt } = effect;
    if (age < (effect.delayS ?? 0)) return 0;
    switch (effect.kind) {
      case "cone":
      case "crater": {
        // A crater's rim stands where the sim dug, its thrown earth beyond.
        const across = radius * 2 * tile * (effect.kind === "crater" ? 1 / CRATER_RIM : 1);
        this.mark(this.groundPool, effect.kind, x, y, across, tile, 1);
        return 0;
      }
      case "volcano": {
        // The eruption comes out of the summit, which stands above the cone's foot.
        const summit = coneSummit(radius * 2 * tile) / tile;
        const fading =
          effect.untilMs >= 0 && this.simMs >= effect.untilMs
            ? Math.max(1 - (effect.age - effect.wallS), 0)
            : 1;
        const size = Math.max(radius * tile * 1.4, 8);
        const colour =
          LAVA[Math.floor(cellHash(salt, Math.floor(this.timeS * 4), 343) * LAVA.length)] ??
          LAVA[0];
        this.halo(x, y - summit, size, colour, fading * this.flicker(salt), tile);
        // Its lava: the pool in the mouth and the rivers down the cone, drawn over it
        // untinted (it makes its own light), cooling to crust as the eruption ends.
        const frame = Math.floor(this.timeS * LAVA_FPS) % LAVA_FRAMES;
        this.mark(this.flamePool, "lava", x, y, radius * 2 * tile, tile, fading, frame);
        // A column of ash, dark, rising high and spreading with the wind.
        this.puffs(
          {
            x,
            y: y - summit,
            spread: radius * 0.2,
            rise: 14,
            drift: 5,
            life: 8,
            from: 6,
            to: 26,
            alpha: 0.85 * fading,
            salt,
          },
          18,
          ASH,
          tile,
        );
        this.puffs(
          {
            x,
            y: y - summit,
            spread: radius * 0.15,
            rise: 22,
            drift: 2,
            life: 1.6,
            from: 1,
            to: 1,
            alpha: fading,
            salt: salt + 1,
          },
          12,
          SPARK,
          tile,
          true,
        );
        return age < 2 ? QUAKE_PX * (1 - age / 2) : 0;
      }
      case "quake": {
        if (age < 1.5) {
          this.puffs(
            {
              x,
              y,
              spread: radius * 0.6,
              rise: 2,
              drift: 1,
              life: 2.5,
              from: 3,
              to: 9,
              alpha: 0.5,
              salt,
            },
            12,
            DUST,
            tile,
          );
        }
        return QUAKE_PX * Math.max(1 - age / QUAKE_S, 0);
      }
      case "meteor": {
        if (age < METEOR_FALL_S) {
          // The streak: from high up and to the left, its head bright, its trail fading.
          const t = age / METEOR_FALL_S;
          const fromX = x - 60 / tile;
          const fromY = y - 90 / tile;
          for (let k = 0; k < 8; k++) {
            const back = Math.max(t - k * 0.04, 0);
            const hx = fromX + (x - fromX) * back;
            const hy = fromY + (y - fromY) * back;
            this.halo(
              hx,
              hy,
              k === 0 ? 8 : 6 - k * 0.5,
              k === 0 ? 0xffffff : SPARK,
              1 - k / 8,
              tile,
            );
          }
          return 0;
        }
        const since = age - METEOR_FALL_S;
        if (!effect.struck) {
          effect.struck = true;
          this.flashLeft = FLASH_S;
        }
        this.halo(x, y, Math.max(radius * tile * 2, 10), LAVA[1], Math.max(1 - since / 3, 0), tile);
        this.puffs(
          {
            x,
            y,
            spread: radius * 0.8,
            rise: 3,
            drift: 2,
            life: 3,
            from: 4,
            to: 12,
            alpha: 0.6 * Math.max(1 - since / (METEOR_S - METEOR_FALL_S), 0),
            salt,
          },
          16,
          DUST,
          tile,
        );
        return since < 1.5 ? IMPACT_PX * (1 - since / 1.5) : 0;
      }
      case "seed":
      case "ark": {
        const life = Math.min(age / 1, 1) * Math.max(Math.min((BEAM_S - age) / 2, 1), 0);
        const colour = effect.kind === "seed" ? SEED_GOLD : ARK_LIGHT;
        if (effect.kind === "seed") {
          // The seed power sows the bare land of the whole island (the sim aims it nowhere):
          // golden motes drift down onto the bare cells in sight.
          this.drawSeedMotes(view, life, salt);
          return 0;
        }
        const beam = this.lightPool.next(this.sprites.beam);
        placeCentred(beam, x, y - 40 / tile, tile, 16, 88);
        beam.tint = colour;
        beam.alpha = 0.9 * life;
        this.halo(x, y, 28, colour, 0.8 * life, tile);
        // Motes falling onto the place.
        this.puffs(
          {
            x,
            y: y - 20 / tile,
            spread: 2.5 * Math.max(8 / tile, 0.5),
            rise: -10,
            drift: 0,
            life: 2,
            from: 1,
            to: 1,
            alpha: life,
            salt,
          },
          24,
          colour,
          tile,
          true,
        );
        return 0;
      }
      case "strike":
        return 0; // drawn with the lightning
      case "ash":
        // An animal caught in the fire: a grey puff rising where it fell.
        this.puffs(
          {
            x,
            y,
            spread: 0.2,
            rise: 5,
            drift: 1,
            life: 1.6,
            from: 2,
            to: 7,
            alpha: Math.max(1 - age / ASH_S, 0),
            salt,
          },
          5,
          SMOKE,
          tile,
        );
        return 0;
      case "sparks":
        this.puffs(
          {
            x,
            y,
            spread: 0.3,
            rise: 14,
            drift: 3,
            life: 1,
            from: 1,
            to: 1,
            alpha: Math.max(1 - age / SPARKS_S, 0),
            salt,
          },
          10,
          SPARK,
          tile,
          true,
        );
        return 0;
    }
  }

  private drawRain(view: View): void {
    if (this.rain <= 0.01) return;
    // Drops as large as the view is close: fine on the map, longer up close; in layers
    // that fall at different speeds (the near ones faster, longer, brighter), all leaning
    // with the wind, which gusts in a thunderstorm.
    const scale = RAIN_SCALE[view.view];
    const gust = this.storm * 0.25 * Math.sin(this.timeS * 0.7);
    const lean = RAIN_LEAN[this.rainKind] + gust;
    for (const [layer, depth] of RAIN_LAYERS.entries()) {
      const speed = scale.speed * depth.speed * (1 + 0.4 * this.storm);
      const fall: Fall = { speed, slant: speed * lean, salt: 7 + layer };
      const length = Math.max(Math.round(scale.length * depth.length * (1 + 0.3 * this.storm)), 1);
      const texture = streakTexture(length, lean);
      const drops = Math.round(RAINDROPS * this.rain * depth.share * scale.count);
      for (let slot = 0; slot < drops; slot++) {
        const at = dropAt(fall, slot, this.timeS, view.width, view.height);
        const sprite = this.weatherPool.next(texture);
        // The streak's head where the drop is; its tail up the wind.
        sprite.position.set(
          Math.round(at.x) - (lean >= 0 ? texture.width - 1 : 0),
          Math.round(at.y) - texture.height + 1,
        );
        sprite.scale.set(1, 1);
        sprite.tint = RAIN;
        sprite.alpha = scale.alpha * depth.alpha;
      }
    }
    // Where it falls: rings spreading on the water, and splashes on the land.
    const land = view.land;
    if (land === null || view.view === "map") return;
    const { cells, tile } = view;
    const count = Math.round(RIPPLES * this.rain * (view.view === "local" ? 1 : 2));
    for (let slot = 0; slot < count; slot++) {
      const every = RIPPLE_S * (1 + cellHash(slot, 0, 409));
      const shifted = this.timeS + every * cellHash(slot, 1, 409);
      const showing = Math.floor(shifted / every);
      const phase = (shifted - showing * every) / every;
      const x = cells.x0 + (cells.x1 - cells.x0) * cellHash(slot, showing, 410);
      const y = cells.y0 + (cells.y1 - cells.y0) * cellHash(slot, showing, 411);
      const cell = Math.floor(y) * land.width + Math.floor(x);
      const wet = (land.heights[cell] ?? 1) <= land.seaLevel;
      if (wet) {
        const ring =
          this.sprites.rings[Math.min(Math.floor(phase * RINGS.length), RINGS.length - 1)];
        if (ring === undefined) continue;
        const sprite = this.ripplePool.next(ring);
        const size = ring.width * (tile >= 32 ? 2 : 1);
        placeCentred(sprite, x, y, tile, size, size * 0.6);
        sprite.tint = RIPPLE;
        sprite.alpha = 0.7 * (1 - phase);
      } else if (phase < 0.3) {
        const sprite = this.ripplePool.next(this.sprites.fleck);
        placeCentred(sprite, x, y, tile, 2, 1);
        sprite.tint = RIPPLE;
        sprite.alpha = 0.6;
      }
    }
  }

  /** Thunder and storm bolts on the screen, and the fire's strike; the flash they make (0–1). */
  private drawLightning(view: View): number {
    let flash = 0;
    const margin = view.margin ?? 0;
    const draw = (paths: [number, number][][], width: number, alpha: number): void => {
      for (const [index, path] of paths.entries()) {
        const thick = index === 0 ? width : Math.max(width - 1, 1);
        for (const [px, py] of path) {
          if (py < 0 || py >= view.height || px < 0 || px >= view.width) continue;
          const sprite = this.boltPool.next(this.sprites.fleck);
          sprite.position.set(px - Math.floor(thick / 2), py);
          sprite.scale.set(thick, 1);
          sprite.tint = index === 0 ? BOLT : BOLT_GLOW;
          sprite.alpha = alpha;
        }
      }
    };
    for (const kind of ["thunder", "storm"] as const) {
      if (this.rainKind !== kind) continue;
      const bolt = boltAt(kind, this.timeS);
      if (bolt === null) continue;
      const { width, flash: bright, forks } = BOLTS[kind];
      // It shows, goes dark and shows again once, as a bolt flickers.
      const on = bolt.phase < 0.35 || (bolt.phase > 0.55 && bolt.phase < 0.8);
      if (!on) continue;
      const at = strikePoint(bolt.n, view.width, view.height);
      draw(boltPath(bolt.n, at.x, at.y, forks), width, 1);
      flash = Math.max(flash, bright * (1 - bolt.phase));
    }
    for (const effect of this.effects) {
      if (effect.kind !== "strike" || effect.age >= BOLTS.strike.lasts) continue;
      const phase = effect.age / BOLTS.strike.lasts;
      const x = Math.round((effect.x - view.cells.x0) * view.tile) + margin;
      const y = Math.round((effect.y - view.cells.y0) * view.tile) + margin;
      if (phase < 0.45 || (phase > 0.6 && phase < 0.85)) {
        draw(boltPath(effect.salt, x, y, BOLTS.strike.forks), BOLTS.strike.width, 1);
      }
      flash = Math.max(flash, BOLTS.strike.flash * (1 - phase));
    }
    return flash;
  }

  /** The seed power's motes falling on the bare land in sight. */
  private drawSeedMotes(view: View, life: number, salt: number): void {
    const land = view.land;
    if (land === null || life <= 0) return;
    const { cells, tile } = view;
    for (let slot = 0; slot < SEED_MOTES; slot++) {
      const every = 2 + cellHash(slot, salt, 412);
      const shifted = this.timeS + every * cellHash(slot, salt, 413);
      const showing = Math.floor(shifted / every);
      const phase = (shifted - showing * every) / every;
      const x = cells.x0 + (cells.x1 - cells.x0) * cellHash(slot, showing, 414);
      const y = cells.y0 + (cells.y1 - cells.y0) * cellHash(slot, showing, 415);
      const cell = Math.floor(y) * land.width + Math.floor(x);
      const bare = (land.heights[cell] ?? 0) > land.seaLevel && (land.biomass[cell] ?? 255) < 10;
      if (!bare) continue;
      // Down from above onto the place, a glint where it lands.
      const fall = (1 - Math.min(phase / 0.8, 1)) * 24;
      const sprite = this.lightPool.next(this.sprites.fleck);
      // Two art pixels across (three up close), so that it is seen in every view.
      placeCentred(sprite, x, y - fall / tile, tile, tile >= 32 ? 3 : 2);
      sprite.tint = SEED_GOLD;
      sprite.alpha = life * (phase > 0.8 ? (1 - phase) * 5 : 1);
      if (phase > 0.8) this.halo(x, y, 6, SEED_GOLD, 0.6 * life * (1 - phase) * 5, tile);
    }
  }

  /** A mark (`marks.ts`) whose foot is `across` art pixels wide, its foot's middle on (x, y). */
  private mark(
    pool: SpritePool,
    kind: "cone" | "lava" | "crater",
    x: number,
    y: number,
    across: number,
    tile: number,
    alpha: number,
    frame = 0,
  ): void {
    if (alpha <= 0.01) return;
    // Up close its art pixels are two screen pixels, as the plants' are.
    const pixel = tile >= 32 ? 2 : 1;
    const mark = markTexture(kind, across / pixel, frame);
    const sprite = pool.next(mark.texture);
    sprite.anchor.set(mark.cx / mark.texture.width, mark.cy / mark.texture.height);
    sprite.position.set(Math.round(x * tile) / tile, Math.round(y * tile) / tile);
    sprite.scale.set(pixel / tile);
    sprite.tint = 0xffffff;
    sprite.alpha = alpha;
  }

  /** An animal died in the fire at (x, y) cells: a puff of ash rises there. */
  burnt(x: number, y: number): void {
    this.effects.push({
      kind: "ash",
      x,
      y,
      radius: 0,
      age: 0,
      wallS: ASH_S,
      untilMs: -1,
      salt: ++this.salts,
      struck: false,
    });
  }

  /** Whether cell (x, y) is burning now. */
  isBurning(index: number): boolean {
    return this.burning.includes(index);
  }

  /** The end of a world, at `moment`; how much it shakes the picture (art pixels). */
  private drawEnd(moment: Moment, view: View, dtS: number): number {
    const land = view.land;
    const { tile } = view;
    // The risen sea, over the old land as it rises and over the new as it falls back.
    const level = land === null ? null : seaLevelAt(land, moment);
    this.floodWait -= dtS;
    if (land !== null && level !== null) {
      if (this.floodLevel !== level && this.floodWait <= 0) {
        this.paintFlood(land, level);
        this.floodLevel = level;
        this.floodWait = FLOOD_REPAINT_S;
      }
      this.flood.visible = true;
    } else this.flood.visible = false;
    // Vents of lava where the sea has not yet come.
    if (land !== null && moment.vents > 0) {
      const open = Math.round(this.vents.length * moment.vents);
      this.vents.slice(0, open).forEach((vent, n) => {
        const height = land.heights[Math.floor(vent.y) * land.width + Math.floor(vent.x)] ?? 1;
        if (level !== null && height < level) return;
        const colour =
          LAVA[Math.floor(cellHash(n, Math.floor(this.timeS * 4), 344) * LAVA.length)] ?? LAVA[0];
        this.halo(vent.x, vent.y, Math.max(5 * tile, 14), colour, this.flicker(n + 1000), tile);
        // Lava running from it.
        for (let k = 0; k < 3; k++) {
          const angle = 2 * Math.PI * cellHash(n, k, 348);
          const reach = 1 + 2 * cellHash(n, k, 349);
          const run = LAVA[(n + k) % LAVA.length] ?? LAVA[0];
          const rx = vent.x + reach * Math.cos(angle);
          const ry = vent.y + reach * Math.sin(angle);
          this.halo(rx, ry, Math.max(2 * tile, 6), run, 0.8 * this.flicker(n + k), tile);
        }
        if (n % 4 === 0) {
          this.puffs(
            {
              x: vent.x,
              y: vent.y,
              spread: 0.5,
              rise: 8,
              drift: 4,
              life: 5,
              from: 3,
              to: 12,
              alpha: 0.6,
              salt: n + 500,
            },
            4,
            ASH,
            tile,
          );
        }
      });
    }
    // Ash falling across the screen.
    const flecks = Math.round(ASHFALL * moment.ash);
    const fall: Fall = { speed: 18, slant: 6, salt: 9 };
    for (let slot = 0; slot < flecks; slot++) {
      const at = dropAt(fall, slot, this.timeS, view.width, view.height);
      const sprite = this.weatherPool.next(this.sprites.fleck);
      sprite.position.set(Math.round(at.x), Math.round(at.y));
      sprite.scale.set(1, 1);
      sprite.tint = slot % 3 === 0 ? 0x8a7f80 : ASH;
      sprite.alpha = 0.9;
    }
    return moment.shake;
  }

  private paintFlood(land: Land, level: number): void {
    if (this.floodCanvas?.width !== land.width || this.floodCanvas.height !== land.height) {
      this.floodTexture?.destroy(true);
      this.floodCanvas = document.createElement("canvas");
      this.floodCanvas.width = land.width;
      this.floodCanvas.height = land.height;
      this.floodTexture = Texture.from({ resource: this.floodCanvas, scaleMode: "nearest" });
      this.flood.texture = this.floodTexture;
      // One texel to the cell, as the world layer is.
      this.flood.position.set(0, 0);
      this.flood.scale.set(1, 1);
    }
    const context = this.floodCanvas.getContext("2d");
    if (context === null) return;
    const image = context.createImageData(land.width, land.height);
    floodPixels(land, level, image.data);
    context.putImageData(image, 0, 0);
    this.floodTexture?.source.update();
  }

  /** What the atmosphere shows (tests). */
  get state(): {
    light: number;
    tint: number;
    rain: RainKind;
    burning: number;
    effects: string[];
    act: string | null;
  } {
    return {
      light: this.ease.value,
      tint: packRgb(this.shown),
      rain: this.rainKind,
      burning: this.burning.length,
      effects: this.effects.map((effect) => effect.kind),
      act: this.sequence.active ? this.sequence.moment.act : null,
    };
  }

  /** Sprites drawn last frame: lights, ground, weather (tests). */
  get counts(): {
    lights: number;
    ground: number;
    weather: number;
    flames: number;
    ripples: number;
    bolts: number;
  } {
    return {
      lights: this.lightPool.shown,
      ground: this.groundPool.shown,
      weather: this.weatherPool.shown,
      flames: this.flamePool.shown,
      ripples: this.ripplePool.shown,
      bolts: this.boltPool.shown,
    };
  }
}
