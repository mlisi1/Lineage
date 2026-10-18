/**
 * The sea moves (cosy look, after Stardew Valley's water), at almost no cost per frame:
 *
 *   surf    the three bands the painter leaves on layers of their own (`GroundOptions.surf`):
 *           a line of lighter water far out, one nearer, and the foam at the shore, shown
 *           one after another as a crest comes in; three opacities a frame
 *   glints  short light strokes on the open water that grow, drift a little with the
 *           waves and go, each on its own clock, in new places every time; a few dozen
 *           sprites of one white texture, moved a frame
 *
 * Nothing is painted again for it. Where a glint shows is a hash of its slot and of how
 * many times it has shown, so the sea looks the same at the same moment on every run.
 */
import { Container, Sprite, Texture } from "pixi.js";
import type { CellRect, Land } from "./land";
import { cellHash } from "./pixels";

/** Seconds for the surf to come in and go back. */
export const BREATH_S = 3.6;
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

/** Where glint `slot` is at `timeS` in `view`, and how long its stroke is (art pixels), if it shows. */
export function glintAt(
  land: Land,
  slot: number,
  timeS: number,
  view: CellRect,
  tile: number,
): { x: number; y: number; length: number } | null {
  const [shortest, longest] = GLINT_EVERY_S;
  const every = shortest + (longest - shortest) * cellHash(slot, 0, 201);
  const shifted = timeS + every * cellHash(slot, 0, 202);
  const showing = Math.floor(shifted / every);
  const phase = (shifted - showing * every) / every;
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

/** The moving sea of one view. */
export class Sea {
  /** Add this to the world over the ground and its surf. */
  readonly glints = new Container();
  private readonly sprites: Sprite[] = [];

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

  /** Move the sea on to `timeS` (wall seconds) over `view`; `surf` is the ground's two bands. */
  tick(timeS: number, land: Land, view: CellRect, surf: readonly Container[] | null): void {
    if (surf !== null) {
      const alphas = surfAlphas(timeS);
      surf.forEach((band, index) => {
        band.alpha = alphas[index] ?? 0;
      });
    }
    const { tile } = this;
    // Texture.WHITE is 16 texels: sized in cells, a stroke `length` art pixels long and one tall.
    const texel = Texture.WHITE.width;
    this.sprites.forEach((sprite, slot) => {
      const glint = glintAt(land, slot, timeS, view, tile);
      sprite.visible = glint !== null;
      if (glint === null) return;
      // On whole art pixels, as everything else.
      sprite.position.set(Math.round(glint.x * tile) / tile, Math.round(glint.y * tile) / tile);
      sprite.scale.set(glint.length / tile / texel, 1 / tile / texel);
    });
  }
}
