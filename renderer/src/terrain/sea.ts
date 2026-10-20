/**
 * The sea moves (cosy look, after Stardew Valley's water), at almost no cost per frame:
 *
 *   surf    the three bands the painter leaves on layers of their own (`GroundOptions.surf`):
 *           a line of lighter water far out, one nearer, and the foam at the shore, shown
 *           one after another as a crest comes in
 *   swash   (R4) the water running up the beach and draining back, in `SWASH_LEVELS`
 *           steps, also painted as layers; the higher the tide the further it runs
 *
 * One wave clock drives both: a crest comes in, breaks in foam, and the swash runs up
 * the beach after it and drains, smoothly (each step fades in as the water reaches it).
 * Every band is cut into tiles `SURF_TILE` art pixels across, each on the clock of its
 * place (`tidePhase`): waves come in from one side of the sea and sweep across the island
 * as one front, so that neighbouring stretches of coast are a moment apart and far ones
 * break at their own time. Opacities a frame, a few hundred of them. The map has the surf
 * only: a coast a pixel wide does not show a swash.
 *   glints  short light strokes on the open water that grow, drift a little with the
 *           waves and go, each on its own clock, in new places every time; a few dozen
 *           sprites of one white texture, moved a frame
 *
 * Nothing is painted again for it. Where a glint shows is a hash of its slot and of how
 * many times it has shown, so the sea looks the same at the same moment on every run.
 */
import { Container, Sprite, Texture } from "pixi.js";
import type { CellRect, Land } from "./land";
import { SWASH_LEVELS } from "./ground";
import { cellHash } from "./pixels";

/** Seconds of a wave: its crest coming in, breaking, the swash running up and draining. */
export const BREATH_S = 8;
/** Seconds of a tide, which sets how far the swash runs. */
const TIDE_S = 120;
/** Where in the wave the swash starts up the beach (as the foam breaks), and the share of the wave it runs up for. */
const SWASH_FROM = 0.58;
const SWASH_UP = 0.35;
/** Art pixels across a tile of the surf. */
export const SURF_TILE = 8;
/** The wave front: the way it travels (unit vector), its speed (cells a second); and how much it wanders (seconds, over cells). */
const WAVE_HEADING = [0.8, 0.6] as const;
const WAVE_SPEED = 3;
const WAVE_WANDER_S = 1.2;
const WAVE_WANDER_SPAN = 40;
/** Seconds between two showings of a glint (from, to), and the share of that it shows. */
const GLINT_EVERY_S: readonly [number, number] = [2.4, 5.2];
const GLINT_SHOWS = 0.42;
/** Longest stroke of a glint, in art pixels, by art pixels to the cell; how fast it drifts. */
const GLINT_LENGTH = (tile: number): number => (tile >= 32 ? 8 : tile >= 8 ? 4 : 1);
const GLINT_DRIFT_PX_PER_S = 2.5;
/** Glints are kept off water shallower than this, so that they do not crowd the foam. */
const GLINT_DEPTH = 0.012;
const GLINT_ALPHA = 1;
/** Slots per view: glints that land on land wait for their next showing. */
export const GLINT_SLOTS = 40;

/** Height between cells, interpolated as the painter reads it (x, y in cells from the corner). */
function heightAt(land: Land, x: number, y: number): number {
  const { width, height, heights } = land;
  const u = x - 0.5;
  const v = y - 0.5;
  const x0 = Math.floor(u);
  const y0 = Math.floor(v);
  const fx = u - x0;
  const fy = v - y0;
  const at = (cx: number, cy: number): number =>
    heights[Math.min(Math.max(cy, 0), height - 1) * width + Math.min(Math.max(cx, 0), width - 1)] ??
    0;
  return (
    (at(x0, y0) * (1 - fx) + at(x0 + 1, y0) * fx) * (1 - fy) +
    (at(x0, y0 + 1) * (1 - fx) + at(x0 + 1, y0 + 1) * fx) * fy
  );
}

/** What the sea is at a place: its colour (0xRRGGBB) and how deep, 0–1 down to the palette's deepest band. */
export type SeaAt = (x: number, y: number) => { colour: number; depth: number } | null;

/**
 * The sea of `land` at a place (x, y in cells from the world's corner), as the ground
 * paints it: the colour of its depth band, and its depth as a share of the way down to
 * the deepest band; null on land. For creatures under water to take its colour (R2).
 */
export function seaAt(land: Land): SeaAt {
  const bands = land.relief.seaBands.map((band) => ({
    limit: band.limit,
    colour: Number.parseInt(band.colour.replace("#", ""), 16),
  }));
  // The last band reaches to any depth: depth 1 is where the one before it ends.
  const deepest = bands.length > 1 ? (bands[bands.length - 2]?.limit ?? 1) : 1;
  return (x, y) => {
    const below = land.seaLevel - heightAt(land, x, y);
    if (below <= 0) return null;
    const band = bands.find((candidate) => below <= candidate.limit) ?? bands[bands.length - 1];
    return { colour: band?.colour ?? 0, depth: Math.min(below / deepest, 1) };
  };
}

/** Where in the swell each band's crest is (share of `BREATH_S`), from the shore out, and how long it lasts. */
const CRESTS: readonly number[] = [0.62, 0.38, 0.14];
const CREST_WIDTH = 0.26;
/** The foam never quite goes: this much of it stays between crests. */
const FOAM_REST = 0.3;

/**
 * The opacity of the surf's bands at `timeS`, from the shore out: a crest comes in, the
 * outer line first, then the nearer, then the foam flares at the shore and slowly fades.
 */
export function surfAlphas(timeS: number): number[] {
  const phase = (((timeS / BREATH_S) % 1) + 1) % 1;
  return CRESTS.map((crest, band) => {
    const apart = Math.min(Math.abs(phase - crest), 1 - Math.abs(phase - crest));
    // The foam lingers after its crest: twice as long to go as to come.
    const width = band === 0 && phase > crest ? 2 * CREST_WIDTH : CREST_WIDTH;
    const pulse = Math.max(0, 1 - apart / width);
    return band === 0 ? FOAM_REST + (1 - FOAM_REST) * pulse : pulse;
  });
}

/** Smooth noise in [0, 1) over the plane. */
function smooth(x: number, y: number, salt: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const top = cellHash(x0, y0, salt) * (1 - sx) + cellHash(x0 + 1, y0, salt) * sx;
  const bottom = cellHash(x0, y0 + 1, salt) * (1 - sx) + cellHash(x0 + 1, y0 + 1, salt) * sx;
  return top * (1 - sy) + bottom * sy;
}

/**
 * Where the waves are at a place of the island (x, y in cells), as seconds added to the
 * clock there: a front travelling across the sea at `WAVE_SPEED`, wandering a little, so
 * near places break a moment apart and the wave runs along a coast; the same in every view.
 */
export function tidePhase(x: number, y: number): number {
  const along = x * WAVE_HEADING[0] + y * WAVE_HEADING[1];
  const wander = WAVE_WANDER_S * smooth(x / WAVE_WANDER_SPAN, y / WAVE_WANDER_SPAN, 31);
  return -along / WAVE_SPEED + wander;
}

const ease = (t: number): number => t * t * (3 - 2 * t);

/**
 * How far up the beach the water has run at `timeS` (with the place's `tidePhase` added),
 * 0 to `SWASH_LEVELS`, smoothly: after the foam breaks it runs up, easing in and out, and
 * drains more slowly; the tide, rising and falling over `TIDE_S`, sets how far it reaches.
 */
export function swashHeight(timeS: number, levels = SWASH_LEVELS): number {
  const wave = (((timeS / BREATH_S - SWASH_FROM) % 1) + 1) % 1;
  const up = wave < SWASH_UP ? ease(wave / SWASH_UP) : 1 - ease((wave - SWASH_UP) / (1 - SWASH_UP));
  const tide = 0.6 + 0.4 * Math.sin((2 * Math.PI * timeS) / TIDE_S);
  return up * tide * levels;
}

/** Which showing of glint `slot` it is at `timeS`, and how far through it (0–1). */
export function glintShowing(slot: number, timeS: number): { showing: number; phase: number } {
  const [shortest, longest] = GLINT_EVERY_S;
  const every = shortest + (longest - shortest) * cellHash(slot, 0, 201);
  const shifted = timeS + every * cellHash(slot, 0, 202);
  const showing = Math.floor(shifted / every);
  return { showing, phase: (shifted - showing * every) / every };
}

/**
 * Where glint `slot` is at `timeS`, and how long its stroke is (art pixels), if it shows.
 * It is placed somewhere in `view`, the view as it was when this showing began: a glint
 * lies on the water, and stays there while the camera moves.
 */
export function glintAt(
  land: Land,
  slot: number,
  timeS: number,
  view: CellRect,
  tile: number,
): { x: number; y: number; length: number } | null {
  const [shortest, longest] = GLINT_EVERY_S;
  const every = shortest + (longest - shortest) * cellHash(slot, 0, 201);
  const { showing, phase } = glintShowing(slot, timeS);
  if (phase >= GLINT_SHOWS) return null;
  const x =
    view.x0 +
    (view.x1 - view.x0) * cellHash(slot, showing, 203) +
    (GLINT_DRIFT_PX_PER_S * phase * every) / tile;
  const y = view.y0 + (view.y1 - view.y0) * cellHash(slot, showing, 204);
  if (x < 0 || y < 0 || x >= land.width || y >= land.height) return null;
  if (heightAt(land, x, y) > land.seaLevel - GLINT_DEPTH) return null;
  // It grows and goes again: longest halfway through its showing.
  const length = Math.max(
    1,
    Math.round(GLINT_LENGTH(tile) * Math.sin((Math.PI * phase) / GLINT_SHOWS)),
  );
  return { x, y, length };
}

/** Each tile of surf's `tidePhase`, set as the tile is made (`grounds.ts`). */
export const tileTimes = new WeakMap<Container, number>();

/** The moving sea of one view. */
export class Sea {
  /** Add this to the world over the ground and its surf. */
  readonly glints = new Container();
  private readonly sprites: Sprite[] = [];
  /** Each slot's showing, and the view it was placed in when that showing began. */
  private readonly placed: { showing: number; view: CellRect }[] = [];

  constructor(
    private readonly tile: number,
    slots = GLINT_SLOTS,
  ) {
    for (let slot = 0; slot < slots; slot++) {
      const sprite = new Sprite(Texture.WHITE);
      sprite.alpha = GLINT_ALPHA;
      sprite.visible = false;
      this.sprites.push(sprite);
      this.glints.addChild(sprite);
    }
  }

  /**
   * Move the sea on to `timeS` (wall seconds) over `view`; `surf` is the ground's bands,
   * the surf's three then the swash's, each holding its paintings, each of them its tiles.
   */
  tick(timeS: number, land: Land, view: CellRect, surf: readonly Container[] | null): void {
    if (surf !== null) {
      surf.forEach((band, index) => {
        for (const painting of band.children) {
          for (const piece of painting.children) {
            const at = tileTimes.get(piece);
            const t = timeS + (at ?? 0);
            // The swash's steps fill in turn: each as the water reaches it, the last in part.
            piece.alpha =
              index < 3
                ? (surfAlphas(t)[index] ?? 0)
                : Math.min(Math.max(swashHeight(t) - (index - 3), 0), 1);
          }
        }
      });
    }
    const { tile } = this;
    // Texture.WHITE is 16 texels: sized in cells, a stroke `length` art pixels long and one tall.
    const texel = Texture.WHITE.width;
    this.sprites.forEach((sprite, slot) => {
      const { showing } = glintShowing(slot, timeS);
      let placed = this.placed[slot];
      if (placed?.showing !== showing) {
        placed = { showing, view: { ...view } };
        this.placed[slot] = placed;
      }
      const glint = glintAt(land, slot, timeS, placed.view, tile);
      sprite.visible = glint !== null;
      if (glint === null) return;
      // On whole art pixels, as everything else.
      sprite.position.set(Math.round(glint.x * tile) / tile, Math.round(glint.y * tile) / tile);
      sprite.scale.set(glint.length / tile / texel, 1 / tile / texel);
    });
  }
}
