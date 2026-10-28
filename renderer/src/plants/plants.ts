/**
 * The plant layer. Plants are kept in rows, from the top of the map down, so that what
 * stands nearer covers what stands farther; each row also has a place for the creatures
 * on it, which puts an animal behind the trees in front of it. Rows are built a chunk
 * at a time, when the view first comes near, and chunks off screen are skipped.
 *
 * Two kinds of layer. A drawing in the middle of every vegetated cell is the spike's
 * first look, which the benchmark's first scenarios measure. The other is the plants
 * that stand alone on a ground that is itself painted with what grows low: trees and
 * bushes by their stage of growth and the season, in the middle view; and in the local
 * view the same plants in the same places drawn large, with the grass as tufts to walk
 * through and among them what only shows from close: bushes just sprouting, flowers in
 * drifts, ferns and mushrooms under trees, herbs, reeds by the shore, stones, boulders,
 * logs, and stumps and snags where it burnt. No plant carries a shadow: the layer lists
 * them, for the ground to paint.
 */
import { PROBE } from "../frameprobe";
import { CanvasSource, Container, Rectangle, Sprite, Texture } from "pixi.js";
import { DEFAULT_LOOK, type Look, type PlantInks } from "../looks";
import { mulberry32 } from "../rng";
import { valueNoise, type Shadow } from "../terrain/ground";
import type { CellRect, Land, Ramp } from "../terrain/land";
import { cellHash, type Pixels } from "../terrain/pixels";
import { shoreSizes } from "../terrain/tide";
import { heightAt } from "../creatures/habitat";
import {
  SPRITE_WIDTH,
  VISIBLE_FROM,
  plantLook,
  plantOffset,
  standsAlone,
  type PlantLook,
} from "./look";
import {
  CAP_COLOURS,
  FLOWER_COLOURS,
  MOSS_COLOUR,
  PLANT_SCALE,
  SMALL_SIZES,
  STANDING_VARIANTS,
  GRASS_VARIANTS,
  colourArt,
  drawSmall,
  drawStanding,
  type PlantArt,
  type Small,
  type WinterHabit,
} from "./plantart";
import { piecesOf } from "./pieces";
import {
  GROWTHS,
  coldRamp,
  growthOf,
  seasonRamp,
  woodOf,
  type Growth,
  type Season,
} from "./seasons";
import {
  EMERGENT_TALLER,
  OVERLAYS,
  RARE_COLOURS,
  looksOf,
  overlayArt,
  type RareLook,
} from "./rareart";
import {
  groundEarliness,
  plantEarliness,
  seasonShown,
  seasonsInPlay,
  type YearTime,
} from "./turning";
import {
  MOST_LEAN_PER_REACH,
  ROCK_JITTER,
  bendOf,
  gustAt,
  leanedPixels,
  leansOf,
  type Bend,
  type Wind,
} from "./wind";

/** Cells per chunk of a row; whole chunks are built, and skipped, together. */
const CHUNK_CELLS = 16;
/** A plant may stand this far (cells) outside its own cell. */
const REACH_CELLS = 1;
/**
 * A plant in front of the animal the camera is on shows it through; grass and the small
 * things too (R5: a small animal was lost under the tufts). Only partly: a bush or a tree
 * nearly gone made the animal seem to stand on it (the owner, 2026-10-22), so it stays
 * clearly in front. Smaller than `FADES_FROM_CELLS` (pebbles) nothing hides it.
 * Off for now (1: whole), the owner, 2026-10-23: to see plainly how animals stand among
 * bushes while that is put right.
 */
const FADED = 1;
const FADED_SMALL = 1;
const SMALL_BELOW_CELLS = 0.9;
const FADES_FROM_CELLS = 0.2;
/** A plant's foot keeps this far (cells) beyond where the swash reaches. */
const SHORE_KEEP_CELLS = 0.05;
/** Seconds a plant takes to go see-through or back. */
const FADE_S = 0.25;
/**
 * A footprint's middle is this many of its half-heights above the plant's foot: the foot
 * is the front of what stands on the ground, the trunk's base or the bush's lowest puffs.
 */
const FOOTPRINT_RAISE = 0.6;
/** The salt of each plant's own rocking in the wind, by where its foot is. */
const PHASE_SALT = 977;

export interface Placed {
  texture: Texture;
  /** Where the plant stands, as a share of the texture's width and height. */
  anchorX: number;
  anchorY: number;
  /** Cells per texel. */
  scale: number;
  /** Offset of the foot from the middle of the cell's lower edge, in cells. */
  dx: number;
  dy: number;
  /** The shadow it throws at its foot, as half its width and height in cells, if any. */
  shadow?: { rx: number; ry: number };
  /** A tint over its colours (0xRRGGBB), if any: grass varies a little tuft to tuft. */
  tint?: number;
  /**
   * What animals keep out of (R5), for a tree or a bush: an ellipse about its foot, as
   * half its width and height in cells.
   */
  footprint?: { rx: number; ry: number; raise?: number };
  /**
   * For a plant that bends in the wind (`wind.ts`): its drawing leaning each whole pixel
   * from `lowest` up (`texture` the one at lean 0), how many pixels of lean the wind gives
   * it at strength 1 at the crest of a gust (`reach`), and the clear pixels the drawings
   * are widened by to lean in (`added`), which are no part of the plant.
   */
  sway?: { frames: readonly Texture[]; lowest: number; reach: number; added: number };
  /**
   * For a piece of a bush drawn in pieces, which bends with its bush (R5): it slides sideways
   * by whole art pixels, from `lowest` to `highest`, `reach` at strength 1 at the crest of a
   * gust, the share of its bush's lean at its height; its bush's foot is (`dx`, `dy`) cells
   * from its own, and the gust and the rocking are its bush's.
   */
  slide?: { lowest: number; highest: number; reach: number; dx: number; dy: number };
  /**
   * A piece of a bush drawn in pieces (R5, `?bushes=pieces`): its leaves are over an
   * animal only where some part of the animal is behind its foot (`PlantLayer.over`).
   */
  piece?: boolean;
  /**
   * A broadleaf's crown in autumn (R5, `atmosphere/leaves.ts`): where on it leaves come
   * loose, as its half width and the heights of its lower and upper edge above the foot
   * (cells), and the colours they come off in (0xRRGGBB, dark to light).
   */
  crown?: Crown;
}

/** A broadleaf's crown that drops its leaves in autumn (`Placed.crown`), and where it stands. */
export interface Crown {
  half: number;
  bottom: number;
  top: number;
  colours: readonly number[];
  /** Where its foot is (cells), once built. */
  x: number;
  y: number;
}

/** A plant that bends in the wind, as the layer moves it (`PlantLayer.blow`). */
interface Swaying {
  sprite: Sprite;
  frames: readonly Texture[];
  lowest: number;
  reach: number;
  /** Where its foot is (cells), and how far out of step its rocking is (radians, `gustAt`). */
  x: number;
  y: number;
  phase: number;
  /** The lean it is drawn at now (art pixels). */
  lean: number;
  /**
   * For a piece of a bush, which slides rather than leans: where it stands at lean 0, and
   * an art pixel (cells); its `frames` are all its one drawing.
   */
  slide?: { x: number; pixel: number };
}

/**
 * Cells of rows to a band (R5): the rows are kept in bands, each its own render group, so
 * that an animal stepping into the next row, or a row culled, rebuilds the draw list of its
 * band and not the world's (on the board, with thousands of plants, that rebuild took a
 * frame's whole budget several times a second in a crowd). The order drawn is the same.
 */
const BAND_CELLS = 4;

interface Row {
  container: Container;
  /** The plants of this row, by the first column of their chunk. */
  chunks: Map<number, Container>;
  /** Those of each chunk's plants that bend in the wind, by the same column. */
  swaying: Map<number, Swaying[]>;
  /** The creatures standing on this row, drawn over its plants. */
  guests: Container;
  /**
   * The row's trees and bushes (those with a footprint) by chunk, its first column `x`:
   * what `over` looks through for each animal every frame, without the grass.
   */
  leafy: { x: number; sprites: Sprite[] }[];
}

export interface PlantLayerOptions {
  /** Height in cells of the tallest plant: how far below the view a row can still show. */
  tall: number;
  /** Rows to the cell: more where plants and animals are large enough to sort finely. */
  rowsPerCell?: number;
  /** Build every chunk at once instead of as the view reaches it. */
  eager?: boolean;
  /** Called once chunks have been built: what they drew goes up to the GPU (`LeanSheet`). */
  built?: () => void;
}

export class PlantLayer {
  /** Add this to the world. */
  readonly container = new Container();
  /** Where the creatures of each row go, top row first; `rowsPerCell` rows to the cell. */
  readonly guests: readonly Container[];
  readonly rowsPerCell: number;
  /** Bumped when plants are built or a bush's piece slides: `Occluders.changes`. */
  changes = 0;
  private readonly rows: Row[] = [];
  /** The rows' bands, top first, each `BAND_CELLS` cells of rows (`BAND_CELLS`). */
  private readonly bands: Container[] = [];
  private readonly rowsPerBand: number;
  /** The first and last rows `cull` left shown (none: an empty range); at first, all. */
  private rowsShown: [number, number] = [0, Number.MAX_SAFE_INTEGER];
  private readonly built = new Set<number>();
  private readonly tall: number;
  private readonly onBuilt: (() => void) | undefined;
  private sprites = 0;
  /** Plants see-through, or on their way there or back. */
  private readonly faded = new Set<Sprite>();
  /** What else goes with the layer when it is destroyed: the texture its drawings are in. */
  private readonly owned: { destroy: () => void }[] = [];
  /**
   * The footprints of the trees and bushes built so far (R5), by the cell their middle is
   * in: four numbers each, the middle and the half width and height, in cells.
   */
  private readonly feet: (number[] | undefined)[];
  /** Of those, the pieces of bushes drawn in pieces, each sorted by its own foot. */
  private readonly pieced = new WeakSet<Sprite>();
  /** The largest half width or height of a footprint so far: how far round a place to look. */
  private widest = 0;
  /** The crowns of the broadleaves built so far that drop leaves (R5), by the cell of their foot. */
  private readonly crowns: (Crown | undefined)[];

  /** `place` says what stands on a cell (whose plant, if any, is `look`). */
  constructor(
    private readonly land: Land,
    private readonly place: (look: PlantLook | null, x: number, y: number) => Placed[],
    options: PlantLayerOptions,
  ) {
    this.tall = options.tall;
    this.onBuilt = options.built;
    this.rowsPerCell = options.rowsPerCell ?? 1;
    this.feet = new Array<number[] | undefined>(land.width * land.height);
    this.crowns = new Array<Crown | undefined>(land.width * land.height);
    this.rowsPerBand = BAND_CELLS * this.rowsPerCell;
    for (let row = 0; row < land.height * this.rowsPerCell; row++) {
      const made: Row = {
        container: new Container(),
        chunks: new Map(),
        swaying: new Map(),
        guests: new Container(),
        leafy: [],
      };
      made.container.addChild(made.guests);
      this.rows.push(made);
      if (row % this.rowsPerBand === 0) {
        const band = new Container({ isRenderGroup: true });
        this.bands.push(band);
        this.container.addChild(band);
      }
      this.bands[this.bands.length - 1]?.addChild(made.container);
    }
    this.guests = this.rows.map((row) => row.guests);
    if (options.eager === true) {
      this.cull({ x0: 0, y0: 0, x1: land.width, y1: land.height });
    }
  }

  /** Let `thing` be destroyed with the layer. */
  own(thing: { destroy: () => void }): void {
    this.owned.push(thing);
  }

  /** Take the layer off the screen for good, with what it owns. */
  destroy(): void {
    // Guests are not the layer's: they leave before it goes (and find another host).
    for (const guests of this.guests) guests.removeChildren();
    this.container.destroy({ children: true });
    for (const thing of this.owned) thing.destroy();
    this.owned.length = 0;
  }

  /**
   * Whether a body of radius `margin` (cells) whose middle is at (x, y) overlaps a tree's
   * foot or a bush (`Footprints`). Only plants built so far count: those of the view and
   * near it, which are the ones seen; an animal far off walks as it would on open ground.
   */
  blocked(x: number, y: number, margin: number): boolean {
    const { width, height } = this.land;
    const reach = this.widest + margin;
    const x0 = Math.max(Math.floor(x - reach), 0);
    const x1 = Math.min(Math.floor(x + reach), width - 1);
    const y0 = Math.max(Math.floor(y - reach), 0);
    const y1 = Math.min(Math.floor(y + reach), height - 1);
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const feet = this.feet[cy * width + cx];
        if (feet === undefined) continue;
        for (let k = 0; k < feet.length; k += 4) {
          const u = (x - (feet[k] ?? 0)) / ((feet[k + 2] ?? 0) + margin);
          const v = (y - (feet[k + 1] ?? 0)) / ((feet[k + 3] ?? 0) + margin);
          if (u * u + v * v < 1) return true;
        }
      }
    }
    return false;
  }

  /**
   * The trees and bushes built in `cells` (debugging the look): each one's foot, its
   * drawing's box (cells) and its footprint, if it keeps one.
   */
  standing(cells: CellRect): {
    x: number;
    y: number;
    left: number;
    top: number;
    wide: number;
    high: number;
  }[] {
    const out: { x: number; y: number; left: number; top: number; wide: number; high: number }[] =
      [];
    const first = Math.max(Math.floor(cells.y0 * this.rowsPerCell), 0);
    const last = Math.min(Math.ceil(cells.y1 * this.rowsPerCell), this.rows.length - 1);
    for (let index = first; index <= last; index++) {
      for (const [, chunk] of this.rows[index]?.chunks ?? []) {
        for (const child of chunk.children) {
          const sprite = child as Sprite;
          const wide = sprite.texture.width * sprite.scale.x;
          const high = sprite.texture.height * sprite.scale.y;
          if (high < SMALL_BELOW_CELLS) continue;
          if (sprite.x < cells.x0 || sprite.x > cells.x1) continue;
          out.push({
            x: sprite.x,
            y: sprite.y,
            left: sprite.x - sprite.anchor.x * wide,
            top: sprite.y - sprite.anchor.y * high,
            wide,
            high,
          });
        }
      }
    }
    return out;
  }

  /**
   * The crown of a broadleaf dropping its leaves whose foot is on cell (x, y), if one is
   * built there (R5, `atmosphere/leaves.ts`).
   */
  crownAt(x: number, y: number): Crown | undefined {
    const { width, height } = this.land;
    if (x < 0 || y < 0 || x >= width || y >= height) return undefined;
    return this.crowns[Math.floor(y) * width + Math.floor(x)];
  }

  /** Number of plant sprites built so far: all of them for an eager layer. */
  get count(): number {
    return this.sprites;
  }

  /**
   * The shadows of what stands on `cells` or near enough to throw one onto them, for
   * the ground to paint. Whether or not the plants themselves are built yet.
   */
  shadows(cells: CellRect): Shadow[] {
    PROBE.note("shadows");
    const { land } = this;
    const out: Shadow[] = [];
    const reach = Math.ceil(this.tall) + REACH_CELLS;
    for (let y = Math.max(cells.y0 - reach, 0); y < Math.min(cells.y1 + reach, land.height); y++) {
      for (let x = Math.max(cells.x0 - reach, 0); x < Math.min(cells.x1 + reach, land.width); x++) {
        for (const placed of this.place(this.lookAt(x, y), x, y)) {
          if (placed.shadow === undefined) continue;
          // No shadow of a plant left off the water (`ashore`).
          if (!this.ashore(x + 0.5 + placed.dx, y + 1 + placed.dy, 1 / placed.scale)) continue;
          // A little to the right of the foot: the light comes from the upper left.
          out.push({
            x: x + 0.5 + placed.dx + placed.shadow.rx * 0.16,
            y: y + 1 + placed.dy - placed.shadow.ry * 0.1,
            rx: placed.shadow.rx,
            ry: placed.shadow.ry,
          });
        }
      }
    }
    return out;
  }

  private lookAt(x: number, y: number): PlantLook | null {
    const { land } = this;
    const index = y * land.width + x;
    return plantLook(
      land.coverClasses[land.cover[index] ?? 0] ?? "",
      land.biomass[index] ?? 0,
      x,
      y,
      land.dormantBelow,
      land.dormantClasses,
    );
  }

  /**
   * Build what the view needs and hide what is outside it. Returns the number of plant
   * sprites left to draw.
   */
  cull(view: CellRect): number {
    const { width, height } = this.land;
    const firstChunk = Math.max(Math.floor((view.x0 - REACH_CELLS) / CHUNK_CELLS), 0);
    const lastChunk = Math.min(
      Math.floor((view.x1 + REACH_CELLS) / CHUNK_CELLS),
      Math.ceil(width / CHUNK_CELLS) - 1,
    );
    // A plant shows from its foot up to its top, so rows below the view count too.
    const firstY = Math.max(Math.floor(view.y0) - 1 - REACH_CELLS, 0);
    const lastY = Math.min(Math.ceil(view.y1 + this.tall), height - 1);
    const before = this.built.size;
    for (let y = firstY; y <= lastY; y++) {
      for (let chunk = firstChunk; chunk <= lastChunk; chunk++) this.build(y, chunk * CHUNK_CELLS);
    }
    if (this.built.size !== before) {
      this.changes += 1;
      PROBE.note("plants-built");
      this.onBuilt?.();
    }
    let drawn = 0;
    // The rows that show are one run (a row shows from its foot up to the tallest plant's
    // top): only rows round the view and those shown last time are looked at, the others
    // being hidden and staying so (R5, review P3: every row of the island was, each frame).
    const lastRow = this.rows.length - 1;
    const near0 = Math.floor((view.y0 - REACH_CELLS) * this.rowsPerCell) - 2;
    const near1 = Math.ceil((view.y1 + this.tall) * this.rowsPerCell) + 2;
    const from = Math.max(Math.min(near0, this.rowsShown[0]), 0);
    const to = Math.min(Math.max(near1, this.rowsShown[1]), lastRow);
    let shownFrom = Infinity;
    let shownTo = -Infinity;
    for (let index = from; index <= to; index++) {
      const row = this.rows[index];
      if (row === undefined) continue;
      const top = index / this.rowsPerCell;
      const bottom = (index + 1) / this.rowsPerCell;
      const visible = bottom + REACH_CELLS >= view.y0 && top - this.tall <= view.y1;
      if (row.container.visible !== visible) row.container.visible = visible;
      if (!visible) continue;
      shownFrom = Math.min(shownFrom, index);
      shownTo = Math.max(shownTo, index);
      row.chunks.forEach((chunk, x) => {
        const inside = x + CHUNK_CELLS + REACH_CELLS >= view.x0 && x - REACH_CELLS <= view.x1;
        if (chunk.visible !== inside) chunk.visible = inside;
        if (inside) drawn += chunk.children.length;
      });
    }
    // A band none of whose rows shows is left out whole: those of the rows looked at.
    const band = (row: number): number => Math.floor(row / this.rowsPerBand);
    const bandFrom = band(from);
    const bandTo = band(to);
    for (let index = bandFrom; index <= bandTo; index++) {
      const shown = index >= band(shownFrom) && index <= band(shownTo);
      const each = this.bands[index];
      if (each !== undefined && each.visible !== shown) each.visible = shown;
    }
    this.rowsShown = shownFrom === Infinity ? [lastRow + 1, -1] : [shownFrom, shownTo];
    return drawn;
  }

  /**
   * Lean the plants in view with `wind` (`wind.ts`): each that bends is drawn in the lean
   * the wind gives it where it stands, in whole art pixels; all straight without wind.
   * Only the chunks `cull` left visible are looked at, and a drawing is swapped only when
   * its lean changes.
   */
  blow(wind: Wind | null): void {
    for (const row of this.rows) {
      if (!row.container.visible) continue;
      // (`forEach`: a `for…of` over a map makes an array for each entry, every frame.)
      row.swaying.forEach((swaying, x) => {
        if (row.chunks.get(x)?.visible !== true) return;
        for (const plant of swaying) {
          // Too stiff ever to lean a whole pixel: it never moves (review P3).
          if (Math.abs(plant.reach) * MOST_LEAN_PER_REACH < 0.5) continue;
          const last = plant.lowest + plant.frames.length - 1;
          const lean =
            wind === null
              ? 0
              : Math.min(
                  Math.max(
                    Math.round(
                      wind.strength *
                        plant.reach *
                        gustAt(plant.x, plant.y, wind.timeS, plant.phase),
                    ),
                    plant.lowest,
                  ),
                  last,
                );
          if (lean === plant.lean) continue;
          plant.lean = lean;
          if (plant.slide !== undefined) {
            plant.sprite.x = plant.slide.x + lean * plant.slide.pixel;
            // A piece moved: what is over an animal may have changed (`changes`).
            this.changes += 1;
            continue;
          }
          const frame = plant.frames[lean - plant.lowest];
          if (frame !== undefined) {
            const was = plant.sprite.texture;
            // A drawing of another size: what is over an animal may have changed.
            if (frame.width !== was.width || frame.height !== was.height) this.changes += 1;
            plant.sprite.texture = frame;
          }
        }
      });
    }
  }

  /**
   * The row of the backmost tree or bush whose drawing overlaps `box` (cells), among those
   * whose foot lies from as far behind row `from` to as far in front of row `to` as a
   * plant's drawing reaches; -1 if none (R5: an animal is drawn under every tree and bush
   * that overlaps it, its leaves being over it, `CreatureLayer.hostIn`). Only trees and
   * bushes count, young ones too; grass, flowers and small things do not.
   *
   * A piece of a bush drawn in pieces is over the animal only where one of its `joints`
   * (with `radii`, cells) lies behind the piece's foot and reaches into its drawing: an
   * animal in front of a puff is drawn over it, as top-down games sort by the feet, and
   * one between the puffs of a clump is behind the back ones and under the front ones.
   */
  over(
    box: CellRect,
    from: number,
    to: number,
    joints?: readonly { x: number; y: number }[],
    radii?: readonly number[],
  ): number {
    const reach = Math.ceil(this.tall * this.rowsPerCell);
    const first = Math.max(from - reach, 0);
    const last = Math.min(to + reach, this.rows.length - 1);
    for (let index = first; index <= last; index++) {
      const leafy = this.rows[index]?.leafy ?? [];
      for (let k = 0; k < leafy.length; k++) {
        const { x, sprites } = leafy[k] as { x: number; sprites: Sprite[] };
        if (x + CHUNK_CELLS + REACH_CELLS < box.x0 || x - REACH_CELLS > box.x1) continue;
        for (let j = 0; j < sprites.length; j++) {
          const sprite = sprites[j] as Sprite;
          const high = sprite.texture.height * sprite.scale.y;
          const wide = sprite.texture.width * sprite.scale.x;
          const left = sprite.x - sprite.anchor.x * wide;
          const top = sprite.y - sprite.anchor.y * high;
          if (left > box.x1 || left + wide < box.x0) continue;
          // The drawing's own edges, not its foot: leaves and their outline hang below it.
          if (top > box.y1 || top + high < box.y0) continue;
          if (joints !== undefined && this.pieced.has(sprite)) {
            const behind = joints.some((joint, k) => {
              const r = radii?.[k] ?? 0;
              return (
                joint.y < sprite.y &&
                joint.y + r > top &&
                joint.x + r > left &&
                joint.x - r < left + wide
              );
            });
            if (!behind) continue;
          }
          return index;
        }
      }
    }
    return -1;
  }

  /**
   * Let an animal show through what stands in front of it: plants drawn over it (in a row
   * after the one it stands in, its lowest point `foot`, as `CreatureLayer.hostIn` puts it)
   * whose drawing covers `subject` (in cells) go see-through; the rest go back. They ease
   * there over `FADE_S` as `dtS` passes (R5: a tuft that snapped from see-through to whole
   * as the animal walked past it was seen to pop), at once when `dtS` is left out.
   */
  fade(subject: CellRect | null, foot = subject?.y1 ?? 0, dtS = Infinity): void {
    // Switched off (the owner, 2026-10-24) and nothing see-through: nothing to do (review P3).
    if (FADED === 1 && FADED_SMALL === 1 && this.faded.size === 0) return;
    const wanted = new Map<Sprite, number>();
    if (subject !== null) {
      const last = this.rows.length - 1;
      const own = Math.min(Math.max(Math.floor(foot * this.rowsPerCell), 0), last);
      const bottom = Math.min(Math.ceil((subject.y1 + this.tall) * this.rowsPerCell), last);
      for (let index = own + 1; index <= bottom; index++) {
        for (const [x, chunk] of this.rows[index]?.chunks ?? []) {
          if (x + CHUNK_CELLS + REACH_CELLS < subject.x0 || x - REACH_CELLS > subject.x1) continue;
          for (const child of chunk.children) {
            const sprite = child as Sprite;
            const wide = sprite.texture.width * sprite.scale.x;
            const high = sprite.texture.height * sprite.scale.y;
            if (high < FADES_FROM_CELLS) continue;
            const left = sprite.x - sprite.anchor.x * wide;
            const top = sprite.y - sprite.anchor.y * high;
            if (left > subject.x1 || left + wide < subject.x0) continue;
            if (top > subject.y1 || sprite.y < subject.y0) continue;
            wanted.set(sprite, high < SMALL_BELOW_CELLS ? FADED_SMALL : FADED);
          }
        }
      }
    }
    const step = (1 - FADED) * Math.min(dtS / FADE_S, 1e6);
    for (const sprite of new Set([...this.faded, ...wanted.keys()])) {
      if (sprite.destroyed) {
        this.faded.delete(sprite);
        continue;
      }
      const target = wanted.get(sprite) ?? 1;
      const alpha =
        sprite.alpha < target
          ? Math.min(sprite.alpha + step, target)
          : Math.max(sprite.alpha - step, target);
      sprite.alpha = alpha;
      if (alpha >= 1 && !wanted.has(sprite)) this.faded.delete(sprite);
      else this.faded.add(sprite);
    }
  }

  /**
   * Whether a plant's foot at (x, y) (cells) stands on the land as painted in a view of
   * `tile` art pixels to the cell: above the sea there, and as far from the waterline as
   * the swash runs up the beach at high tide.
   */
  private ashore(x: number, y: number, tile: number): boolean {
    const { land } = this;
    const reach = shoreSizes(tile).swash / tile + SHORE_KEEP_CELLS;
    for (const [dx, dy] of [
      [0, 0],
      [reach, 0],
      [-reach, 0],
      [0, reach],
      [0, -reach],
    ] as const) {
      if (heightAt(land, x + dx, y + dy) <= land.seaLevel) return false;
    }
    return true;
  }

  /** Keep a footprint about the foot at (x, y) (cells) for `blocked`. */
  private tread(
    x: number,
    y: number,
    { rx, ry, raise = FOOTPRINT_RAISE }: { rx: number; ry: number; raise?: number },
  ): void {
    const { width, height } = this.land;
    const middle = y - ry * raise;
    const column = Math.min(Math.max(Math.floor(x), 0), width - 1);
    const row = Math.min(Math.max(Math.floor(middle), 0), height - 1);
    const cell = row * width + column;
    const feet = this.feet[cell] ?? [];
    feet.push(x, middle, rx, ry);
    this.feet[cell] = feet;
    this.widest = Math.max(this.widest, rx, ry);
  }

  /** Build the plants of the cells of row `y` from column `left` on, once. */
  private build(y: number, left: number): void {
    const key = y * 4096 + left;
    if (this.built.has(key)) return;
    this.built.add(key);
    const { land } = this;
    const right = Math.min(left + CHUNK_CELLS, land.width);
    for (let x = left; x < right; x++) {
      for (const placed of this.place(this.lookAt(x, y), x, y)) {
        const sprite = new Sprite({
          texture: placed.texture,
          anchor: { x: placed.anchorX, y: placed.anchorY },
        });
        sprite.scale.set(placed.scale);
        if (placed.tint !== undefined) sprite.tint = placed.tint;
        // The foot of a cell is the middle of its lower edge. The drawing's corner goes on a
        // whole art pixel: one left between two would be rounded one way or the other as the
        // camera moves, and the plant would flicker a pixel back and forth over its ground.
        const tile = 1 / placed.scale;
        const whole = (at: number, foot: number): number =>
          (Math.round(at * tile - foot) + foot) / tile;
        const footY = whole(y + 1 + placed.dy, placed.anchorY * placed.texture.height);
        const footX = whole(x + 0.5 + placed.dx, placed.anchorX * placed.texture.width);
        // Nothing stands on the water as it is painted (R5): the coast is drawn between the
        // cells, and the swash runs up the beach at high tide, so a plant whose cell is land
        // may still have its foot in the sea.
        if (!this.ashore(footX, footY, tile)) {
          sprite.destroy();
          continue;
        }
        sprite.position.set(footX, footY);
        if (placed.crown !== undefined) {
          const cell = Math.floor(footY - 1e-6) * land.width + Math.floor(footX);
          this.crowns[cell] = { ...placed.crown, x: footX, y: footY };
        }
        if (placed.footprint !== undefined) {
          this.tread(footX, footY, placed.footprint);
          if (placed.piece === true) this.pieced.add(sprite);
        }
        // The row its foot is in: the last row of a cell for a foot on the cell's edge.
        const at = Math.min(
          Math.max(Math.ceil(footY * this.rowsPerCell) - 1, 0),
          this.rows.length - 1,
        );
        const row = this.rows[at];
        if (row === undefined) continue;
        let chunk = row.chunks.get(left);
        if (chunk === undefined) {
          chunk = new Container();
          row.chunks.set(left, chunk);
          // Before the row's creatures, which are drawn over its plants.
          row.container.addChildAt(chunk, row.container.children.length - 1);
        }
        chunk.addChild(sprite);
        this.sprites += 1;
        if (placed.footprint !== undefined) {
          let leafy = row.leafy.find((each) => each.x === left);
          if (leafy === undefined) {
            leafy = { x: left, sprites: [] };
            row.leafy.push(leafy);
          }
          leafy.sprites.push(sprite);
        }
        if (placed.sway !== undefined) {
          const { frames, lowest, reach } = placed.sway;
          let swaying = row.swaying.get(left);
          if (swaying === undefined) {
            swaying = [];
            row.swaying.set(left, swaying);
          }
          // Out of step by where its foot is: a plant and its overlays rock together.
          const phase =
            ROCK_JITTER * cellHash(Math.round(footX * tile), Math.round(footY * tile), PHASE_SALT);
          swaying.push({ sprite, frames, lowest, reach, x: footX, y: footY, phase, lean: 0 });
        } else if (placed.slide !== undefined) {
          const { lowest, highest, reach } = placed.slide;
          // Its bush's foot: every piece of a bush rocks with the same gust, in step.
          const x = footX + placed.slide.dx;
          const y = footY + placed.slide.dy;
          let swaying = row.swaying.get(left);
          if (swaying === undefined) {
            swaying = [];
            row.swaying.set(left, swaying);
          }
          const phase =
            ROCK_JITTER * cellHash(Math.round(x * tile), Math.round(y * tile), PHASE_SALT);
          // No drawings to swap: `frames` stands for the leans it may take.
          const frames = new Array<Texture>(highest - lowest + 1).fill(sprite.texture);
          const slide = { x: footX, pixel: placed.scale };
          swaying.push({ sprite, frames, lowest, reach, x, y, phase, lean: 0, slide });
        }
      }
    }
  }
}

interface Drawing {
  /** The drawing standing straight. */
  texture: Texture;
  art: PlantArt;
  /** How it bends in the wind (`wind.ts`), if it does. */
  bend: Bend | null;
  /** Its pixels, coloured again: for drawing it leaning when a plant first needs it to. */
  colour: () => Pixels;
  /**
   * Once a plant drawn so has been built (`leaningOf`): the drawing leaning each whole pixel
   * from `lowest` (against the wind) up, lean 0 among them, every one widened by clear
   * pixels to lean in, `left` of them on the left and `added` in all.
   */
  leaning?: { frames: Texture[]; lowest: number; left: number; added: number };
  /** A piece of a bush drawn in pieces: where it stands from the whole drawing's foot. */
  piece?: PieceAt;
}

/**
 * Where a piece of a bush stands (R5, `?bushes=pieces`): its foot's offset from the
 * whole drawing's foot, in pixels, and its puff's radius.
 */
interface PieceAt {
  dx: number;
  dy: number;
  r: number;
}

/**
 * How wide and how tall a texture the drawings are packed into may grow, in pixels: within
 * what every GPU takes (a texture too large draws black). Past the height, a new page.
 */
const SHEET_WIDTH = 2048;
const SHEET_HEIGHT = 2048;
/**
 * How tall each page of leaning drawings is (pixels, as wide as a sheet): they are drawn
 * as the plants that need them are built, a page at a time, so a page is smaller than a
 * sheet, not to hold memory for drawings never used.
 */
const LEAN_PAGE_HEIGHT = 1024;

/** Draw `arts` into textures (pages), in rows, a clear pixel between them. */
function strip(
  arts: readonly StandingArt[],
  inks: PlantInks,
): { drawings: Map<string, Drawing>; sources: CanvasSource[] } {
  // Where each goes: along a row until it is full, then on the next; a new page when full.
  const places: { page: number; left: number; top: number }[] = [];
  const pages: { wide: number; tall: number }[] = [];
  let page = 0;
  let left = 1;
  let top = 1;
  let rowTall = 0;
  let wide = 1;
  const close = (): void => {
    pages[page] = { wide, tall: top + rowTall + 1 };
  };
  for (const { art } of arts) {
    if (left + art.width + 1 > SHEET_WIDTH && left > 1) {
      left = 1;
      top += rowTall + 1;
      rowTall = 0;
    }
    if (top + art.height + 1 > SHEET_HEIGHT && top > 1) {
      close();
      page += 1;
      left = 1;
      top = 1;
      rowTall = 0;
      wide = 1;
    }
    places.push({ page, left, top });
    left += art.width + 1;
    rowTall = Math.max(rowTall, art.height);
    wide = Math.max(wide, left);
  }
  close();
  const contexts = pages.map(({ wide: width, tall: height }) => {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (context === null) throw new Error("no 2D canvas for the plants");
    return { context, source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) };
  });
  const drawings = new Map<string, Drawing>();
  arts.forEach(({ key, art, ramp, accent, wood, piece }, index) => {
    const at = places[index] ?? { page: 0, left: 1, top: 1 };
    const sheet = contexts[at.page];
    if (sheet === undefined) return;
    const colour = (): Pixels => colourArt(art, ramp, accent, wood, inks);
    const pixels = colour();
    sheet.context.putImageData(
      new ImageData(pixels.rgba, pixels.width, pixels.height),
      at.left,
      at.top,
    );
    const frame = new Rectangle(at.left, at.top, art.width, art.height);
    const texture = new Texture({ source: sheet.source, frame });
    // A piece of a bush stands still: its puffs leaning apart would tear the bush.
    const bend = piece === undefined ? bendOf(key) : null;
    drawings.set(
      key,
      piece === undefined ? { texture, art, bend, colour } : { texture, art, bend, colour, piece },
    );
  });
  for (const { source } of contexts) source.update();
  return { drawings, sources: contexts.map(({ source }) => source) };
}

/**
 * Pages the leaning drawings go into (R5, `wind.ts`), filled as the plants that need them
 * are built: along a row, then the next, then a new page. What is added since the last
 * `flush` goes up to the GPU then, once a frame at most.
 */
class LeanSheet {
  private readonly pages: { context: CanvasRenderingContext2D; source: CanvasSource }[] = [];
  private left = 1;
  private top = 1;
  private rowTall = 0;
  private readonly dirty = new Set<CanvasSource>();

  /** Put `pixels` on a page; the texture it is drawn in. */
  add(pixels: Pixels): Texture {
    if (this.left + pixels.width + 1 > SHEET_WIDTH && this.left > 1) {
      this.left = 1;
      this.top += this.rowTall + 1;
      this.rowTall = 0;
    }
    let page = this.pages[this.pages.length - 1];
    if (page === undefined || this.top + pixels.height + 1 > LEAN_PAGE_HEIGHT) {
      const canvas = document.createElement("canvas");
      canvas.width = SHEET_WIDTH;
      canvas.height = LEAN_PAGE_HEIGHT;
      const context = canvas.getContext("2d");
      if (context === null) throw new Error("no 2D canvas for the plants");
      page = { context, source: new CanvasSource({ resource: canvas, scaleMode: "nearest" }) };
      this.pages.push(page);
      this.left = 1;
      this.top = 1;
      this.rowTall = 0;
    }
    page.context.putImageData(
      new ImageData(pixels.rgba, pixels.width, pixels.height),
      this.left,
      this.top,
    );
    const frame = new Rectangle(this.left, this.top, pixels.width, pixels.height);
    this.left += pixels.width + 1;
    this.rowTall = Math.max(this.rowTall, pixels.height);
    this.dirty.add(page.source);
    return new Texture({ source: page.source, frame });
  }

  /** Send what was added to the GPU. */
  flush(): void {
    for (const source of this.dirty) source.update();
    this.dirty.clear();
  }

  destroy(): void {
    for (const { source } of this.pages) source.destroy();
    this.pages.length = 0;
    this.dirty.clear();
  }
}

/**
 * Drawing `drawing` leaning each whole pixel it can (`leansOf`), drawn into `sheet` the
 * first time a plant needs it; none for a drawing that does not bend.
 */
function leaningOf(drawing: Drawing, sheet: LeanSheet): Drawing["leaning"] {
  if (drawing.leaning !== undefined || drawing.bend === null) return drawing.leaning;
  const { bend, art } = drawing;
  const { lowest, highest } = leansOf(bend, art.footY);
  if (highest <= lowest) return undefined;
  const pixels = drawing.colour();
  const left = Math.max(-lowest, 0);
  const right = Math.max(highest, 0);
  const frames: Texture[] = [];
  for (let lean = lowest; lean <= highest; lean++) {
    frames.push(sheet.add(leanedPixels(pixels, art.footY, bend, lean, left, right)));
  }
  drawing.leaning = { frames, lowest, left, added: left + right };
  return drawing.leaning;
}

const NO_RAMP: Ramp = ["#000000", "#000000", "#000000"];
/** Grass in the local view: tufts of a cell stand this far (cells) round its clump's middle, the clump seen from above at a slant. */
const CLUMP_REACH = 0.42;
/**
 * Tints a tuft may take, at random (R5, the owner: "some random change in color"): none,
 * warmer (toward straw), cooler (toward teal), darker, and warmer and darker.
 */
const TUFT_TINTS = [0xffffff, 0xfff0c8, 0xd8f4ec, 0xe2e6dc, 0xf0e0b8] as const;
/** Tufts to a cell of grass (R5: small, so many): this many, and one more for each so much biomass. */
const TUFTS_FROM = 3;
const BIOMASS_PER_TUFT = 60;
const CLUMP_FLATTEN = 0.6;
/** Grass thinner than this (biomass) leaves this share of its cells without a tuft. */
const CLUMP_GAP_BELOW = 150;
const CLUMP_GAP = 0.3;
const standingKey = (form: string, growth: Growth, variant: number): string =>
  `${form}/${growth}/${variant}`;
/** A stump or a snag where it burnt is charred. */
const CHARRED = "#3a302b";
/** Blossom on a tree, on a bush (by its drawing), berries, and grass in seed. */
const BLOSSOM = { BROADLEAF: "#f6e6ee", SHRUB: ["#f4f1e4", "#e58fb1", "#f4f1e4"] } as const;
const BERRY = "#b8443a";
const SEED_HEAD = "#c9a94a";
/** Which flowers are out when; none in winter. */
const FLOWERS: Readonly<Record<Season, readonly Small[]>> = {
  spring: ["daisy", "bell"],
  summer: ["daisy", "bell", "spike", "umbel"],
  autumn: ["umbel", "daisy"],
  winter: [],
};
const ALL_FLOWERS = ["daisy", "bell", "spike", "umbel"] as const;
/** Land this little above the sea is shore: reeds grow there. */
const SHORE_BELOW = 0.012;
/** How often a cell carries each small thing in summer, by what covers it. */
const CHANCE = {
  bare: { stone: 0.16, boulder: 0.04, herb: 0.06 },
  heights: { stone: 0.26, boulder: 0.14 },
  shore: { reed: 0.3, stone: 0.1 },
  lichen: { stone: 0.3, boulder: 0.1 },
  grass: { herb: 0.14, flower: 0.1, dry: 0.3 },
  scrub: { fern: 0.18, herb: 0.12, flower: 0.05, sprout: 0.5 },
  wood: { mushroom: 0.16, fern: 0.25, log: 0.035, herb: 0.08 },
  pines: { mushroom: 0.2, fern: 0.1, log: 0.03, stone: 0.05 },
  burnt: { stump: 0.3, log: 0.08, snag: 0.2 },
} as const;
/** How much more or less of what lives and dies with the year there is in each season. */
const IN_SEASON: Readonly<Record<Season, Readonly<Record<string, number>>>> = {
  spring: { flower: 1.6, herb: 1, fern: 0.8, mushroom: 0.2, dry: 0.3 },
  summer: { flower: 1, herb: 1, fern: 1, mushroom: 0.6, dry: 1 },
  autumn: { flower: 0.25, herb: 0.6, fern: 1, mushroom: 2.2, dry: 1.6 },
  winter: { flower: 0, herb: 0, fern: 0.3, mushroom: 0, dry: 0 },
};
/** Flowers come in drifts: where this noise is high a cell of grown grass carries several. */
const DRIFT_FROM = 0.58;
const DRIFT_CELLS = 4;
/** `HEIGHT` gene (0–255) below which a tree or bush is drawn broad and low, and from which slender and tall. */
const BROAD_BELOW = 85;
const TALL_FROM = 170;
/** A number for a drawing's name, to place what lies on it the same way every time. */
function keySalt(key: string): number {
  let hash = 7;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  return hash & 0xffff;
}

/**
 * `EVERGREEN` gene (0–255) below which a bush standing in winter is bare twigs, not leaves,
 * and from which a broadleaf keeps its leaves (the simulation makes conifers of trees
 * from 128 on: these are the broadleaves just under it).
 */
const BARE_BELOW = 100;
const LEAFY_FROM = 77;
/**
 * Where a broadleaf's leaves come loose: its crown, as shares of the drawing's height above
 * the foot (from its lower edge to near its top) and of its width either side of the trunk.
 */
const CROWN = { from: 0.45, to: 0.92, across: 0.38 };
/** `EVERGREEN` from which the simulation makes a tree a conifer (`form_conifer_min_evergreen`, 0.5). */
const CONIFER_FROM = 128;

/** How a plant of `form` with `evergreen` (0–255; unknown where the land does not carry it) spends the winter, if not as its kind mostly does. */
function habitOf(form: string, evergreen: number | undefined): WinterHabit | null {
  if (evergreen === undefined) return null;
  if (form === "SHRUB" && evergreen < BARE_BELOW) return "bare";
  if (form === "BROADLEAF" && evergreen >= LEAFY_FROM) return "leafy";
  return null;
}
/**
 * A tree burnt where it stood (R4): its bare skeleton in charcoal, on burnt ground where
 * the fire was recent (`Land.scorch` from this, 0–255) and a tree grew (`HEIGHT` from
 * this: the simulation's trees, form_shrub_max_height 0.6). As the scorch fades it goes.
 */
const CHARRED_RAMP: Ramp = ["#1f1919", "#33292a", "#4d3f3b"];
const CHARRED_WOOD = "#1a1414";
const CHARRED_EMBER = "#7a4a32";
const CHARRED_FROM_SCORCH = 60;
const CHARRED_TREE_HEIGHT = 153;
/**
 * What animals keep out of (R5), as shares of the drawing's width: a tree's trunk with its
 * roots (this much less deep than wide, as the ground is seen); a bush's whole drawing,
 * an ellipse 0.45 of its width and `BUSH_DEPTH_SHARE` of its height either side of its
 * middle.
 */
const FOOTPRINT_SHARE = { tree: 0.13, bush: 0.45 } as const;
/** A bush's footprint: this share of its drawing's height, above and below its middle. */
const BUSH_DEPTH_SHARE = 0.4;
const FOOTPRINT_FLATTEN = 0.5;
/**
 * A piece of a bush drawn in pieces keeps a footprint of its own (R5, `?bushes=pieces`): an
 * ellipse resting on its foot, this share of its puff's radius either side across and
 * this share deep, the ground a ball of leaves sits on as the slanted view sees it.
 */
const PIECE_FOOTPRINT = { across: 0.85, deep: 0.5 } as const;

/** Snow (0–255) on a cell from which the plants on it carry some. */
const PLANT_SNOW_FROM = 96;

/**
 * What a standing plant of `form` is coloured with in `season`: the tones of its
 * leaves, the colour of its blossom or berries (or of a tuft's seed heads), its wood.
 */
export function standingColours(
  palette: Readonly<Record<string, Ramp>>,
  form: string,
  variant: number,
  season: Season,
  look: Look = DEFAULT_LOOK,
): { ramp: Ramp; accent: string; wood: string } {
  const flowers =
    form === "BROADLEAF"
      ? BLOSSOM.BROADLEAF
      : (BLOSSOM.SHRUB[variant % BLOSSOM.SHRUB.length] ?? BERRY);
  return {
    ramp: seasonRamp(palette, form, season, form === "GRASS" ? 0 : variant, look.seasons),
    accent:
      form === "GRASS" ? SEED_HEAD : season === "spring" && form !== "CONIFER" ? flowers : BERRY,
    wood: look.plants.wood[form] ?? woodOf(form),
  };
}

export interface StandingOptions {
  /**
   * The local view: grass as tufts in every cell that grows it, and the small things of
   * each kind of ground. Without it, the middle view: trees, bushes, a tuft here and there.
   */
  close?: boolean;
  /** The time of year the plants are drawn in; the world's own unless told otherwise. */
  season?: Season;
  /** Winter with snow lying on everything. */
  snow?: boolean;
  /** Build a middle view's plants as the view reaches them instead of all at once. */
  lazy?: boolean;
  /** The colours besides the land's palette (give the land the look's palette too: `dressed`). */
  look?: Look;
  /** The rare genes' looks to draw besides the usual drawings (`rareart.ts`). */
  rare?: readonly RareLook[];
  /**
   * Where the world is in its year: around a change of season each plant shows the
   * season of its own turn (`turning.ts`), instead of every plant showing `season`.
   */
  time?: YearTime;
  /** Cells something else covers (R4: a volcano's cone, a crater): nothing stands there. */
  covered?: (x: number, y: number) => boolean;
  /**
   * Draw the local view's bushes in pieces, a sprite for each puff (R5, an experiment the
   * owner asked for, `?bushes=pieces`; `pieces.ts`).
   */
  pieces?: boolean;
}

/** A drawing the layer uses, by the name it is placed under, with what it is coloured in. */
export interface StandingArt {
  key: string;
  art: PlantArt;
  ramp: Ramp;
  accent?: string;
  wood?: string;
  /** A piece of a bush drawn in pieces (`StandingOptions.pieces`). */
  piece?: PieceAt;
}

/** Whether a small thing of the local view (by its name) is out in `season`. */
export function outIn(season: Season, kind: string): boolean {
  if ((ALL_FLOWERS as readonly string[]).includes(kind)) {
    return (FLOWERS[season] as readonly string[]).includes(kind);
  }
  return (IN_SEASON[season][kind] ?? 1) > 0;
}

/**
 * Every drawing a layer of standing plants is made of, with `tile` art pixels to the
 * cell: trees and bushes at each stage of growth in three drawings each, tufts of
 * grass, and for the local view the small things. Named `FORM/growth/variant`, or
 * `kind/variant` for the small ones.
 */
export function standingArts(
  land: Land,
  tile: number,
  options: StandingOptions = {},
): StandingArt[] {
  const close = options.close === true;
  const season = options.season ?? land.season;
  // The simulation's snow lies in any season; the spike's only in winter.
  const snow = options.snow === true && (season === "winter" || land.snow !== undefined);
  const look = options.look ?? DEFAULT_LOOK;
  const detail = tile / SPRITE_WIDTH;
  const arts: StandingArt[] = [];
  const ramp = (form: string, variant = 0): Ramp =>
    seasonRamp(land.palette, form, season, variant, look.seasons);
  for (const form of ["SHRUB", "BROADLEAF", "CONIFER"] as const) {
    for (const growth of GROWTHS) {
      for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
        arts.push({
          key: standingKey(form, growth, variant),
          art: drawStanding(form, growth, variant, detail, season, snow, look.shapes),
          ...standingColours(land.palette, form, variant, season, look),
        });
      }
    }
  }
  // Trees burnt where they stood: bare and charred in every season (R4).
  for (const growth of GROWTHS) {
    for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
      arts.push({
        key: `${standingKey("BROADLEAF", growth, variant)}/charred`,
        art: drawStanding("BROADLEAF", growth, variant, detail, "winter", false, look.shapes),
        ramp: CHARRED_RAMP,
        accent: CHARRED_EMBER,
        wood: CHARRED_WOOD,
      });
    }
  }
  // In winter the habits their kind mostly does without (`habitOf`): a bush with little
  // EVERGREEN bare twigs, in the wood's russet; a broadleaf with much of it still in leaf,
  // in a colder green.
  if (season === "winter") {
    for (const [form, habit] of [
      ["SHRUB", "bare"],
      ["BROADLEAF", "leafy"],
    ] as const) {
      for (const growth of GROWTHS) {
        for (let variant = 0; variant < STANDING_VARIANTS; variant++) {
          const colours = standingColours(land.palette, form, variant, season, look);
          arts.push({
            key: `${standingKey(form, growth, variant)}/${habit}`,
            art: drawStanding(form, growth, variant, detail, season, snow, look.shapes, habit),
            ...colours,
            ramp:
              habit === "bare"
                ? look.seasons.russet
                : coldRamp(land.palette[form] ?? colours.ramp, look.seasons.cold),
          });
        }
      }
    }
  }
  for (const growth of ["sprout", "young", "grown"] as const) {
    for (let variant = 0; variant < GRASS_VARIANTS; variant++) {
      arts.push({
        key: standingKey("GRASS", growth, variant),
        art: drawStanding("GRASS", growth, variant, detail, season, snow, look.shapes),
        ...standingColours(land.palette, "GRASS", variant, season, look),
      });
    }
  }
  // Rare genes (M7) the land has carriers of: their drawings, beside the usual ones.
  const rare = options.rare ?? [];
  if (rare.length > 0) {
    const bases = [...arts];
    // An emergent tree: its drawing again, taller.
    if (rare.includes("crown")) {
      for (const base of bases) {
        const [form, growth, variant, habit] = base.key.split("/");
        if (form !== "BROADLEAF" && form !== "CONIFER") continue;
        arts.push({
          ...base,
          key: `${base.key}+crown`,
          art: drawStanding(
            form,
            (growth ?? "grown") as Growth,
            Number(variant ?? 0),
            detail,
            season,
            snow,
            look.shapes,
            habit === "bare" || habit === "leafy" ? habit : undefined,
            EMERGENT_TALLER,
          ),
        });
      }
    }
    for (const base of [...arts]) {
      const grass = base.key.startsWith("GRASS/");
      // A fire pine's wood: the same drawing, coloured otherwise.
      if (rare.includes("bark") && !grass) {
        arts.push({ ...base, key: `${base.key}+bark`, wood: RARE_COLOURS.bark });
        // And after a fire, which it lives through: its trunk charred, its crown kept.
        arts.push({ ...base, key: `${base.key}+charred`, wood: CHARRED });
      }
      for (const overlay of OVERLAYS) {
        if (!rare.includes(overlay) || (grass && (overlay === "stilts" || overlay === "berries"))) {
          continue;
        }
        arts.push({
          key: `${base.key}#${overlay}`,
          art: overlayArt(base.art, overlay, keySalt(base.key), grass),
          ramp: overlay === "clover" ? ramp("GRASS") : base.ramp,
          accent: overlay === "berries" ? RARE_COLOURS.berries : RARE_COLOURS.fruit,
          ...(base.wood === undefined ? {} : { wood: base.wood }),
        });
      }
    }
  }
  // A bush's drawing again in pieces, a puff to each, named `key@k` (R5, `pieces.ts`).
  if (close && options.pieces === true) {
    for (const whole of [...arts]) {
      if (!whole.key.startsWith("SHRUB/") || whole.key.includes("#")) continue;
      (piecesOf(whole.art) ?? []).forEach(({ art, left, top, r }, k) => {
        arts.push({
          ...whole,
          key: `${whole.key}@${k}`,
          art,
          piece: {
            dx: left + art.footX - whole.art.footX,
            dy: top + art.footY - whole.art.footY,
            r,
          },
        });
      });
    }
  }
  if (close) {
    const small = (
      kind: Small,
      variant: number,
      colours: Ramp,
      accent?: string,
      wood?: string,
      key = `${kind}/${variant}`,
    ): void => {
      const [width, height] = SMALL_SIZES[kind];
      const art = drawSmall(
        kind,
        [width * detail, height * detail],
        mulberry32(31 + variant),
        variant,
        snow,
        look.shapes,
      );
      arts.push({
        key,
        art,
        ramp: colours,
        ...(accent === undefined ? {} : { accent }),
        ...(wood === undefined ? {} : { wood }),
      });
    };
    const dried = land.palette["DORMANT"] ?? NO_RAMP;
    const rock = land.relief.highRock;
    const lichen = (land.palette["LICHEN"] ?? NO_RAMP)[2];
    for (let variant = 0; variant < GRASS_VARIANTS; variant++) {
      // Grass that has dried: the same tufts in the dry colours.
      arts.push({
        key: `dry/${variant}`,
        art: drawStanding("GRASS", "grown", variant, detail, season, snow, look.shapes),
        ramp: dried,
        accent: SEED_HEAD,
      });
      small("stone", 2 * variant, rock);
      small("stone", 2 * variant + 1, rock, lichen);
      small("mushroom", variant, land.palette["BARE"] ?? NO_RAMP, CAP_COLOURS[variant % 3]);
    }
    for (const kind of ALL_FLOWERS) {
      FLOWER_COLOURS.forEach((accent, colour) => {
        small(kind, colour, ramp("GRASS"), accent, undefined, `${kind}/${colour}`);
      });
    }
    // Ferns brown from autumn on; reeds are green only in summer.
    const browned = season === "autumn" || season === "winter";
    for (let variant = 0; variant < 2; variant++) {
      small("fern", variant, browned ? dried : ramp("SHRUB"));
      small("herb", variant, ramp("GRASS"));
      small("reed", variant, season === "summer" ? ramp("SHRUB") : dried);
      small("boulder", 2 * variant, rock);
      small("boulder", 2 * variant + 1, rock, variant === 0 ? MOSS_COLOUR : lichen);
      small("log", variant, land.palette["BARE"] ?? NO_RAMP, MOSS_COLOUR);
      small("snag", variant, land.palette["BURNT"] ?? NO_RAMP, undefined, CHARRED);
    }
    small("stump", 0, land.palette["BARE"] ?? NO_RAMP);
    small("stump", 1, land.palette["BURNT"] ?? NO_RAMP, undefined, CHARRED);
  }
  return arts;
}

/** The drawings of a layer packed into one texture, shared by the layers that want the same ones. */
interface Sheet {
  drawings: Map<string, Drawing>;
  /** Height in cells of the tallest drawing. */
  tall: number;
  /** Where its drawings go leaning, as plants that bend are first built (`leaningOf`). */
  lean: LeanSheet;
  /** One layer fewer uses it: the last to go destroys its texture. */
  release: () => void;
}
interface SharedSheet {
  drawings: Map<string, Drawing>;
  sources: CanvasSource[];
  lean: LeanSheet;
  tall: number;
  users: number;
}
/** Sheets by the palette they are coloured from, then by what they hold. */
const SHEETS = new WeakMap<object, Map<string, SharedSheet>>();

/**
 * The sheet of drawings for a layer of `tile` art pixels to the cell, in `look`, in the
 * seasons `shown`, with and without snow as `snows` says: drawn once and shared, so that
 * laying the plants out again each day does not draw them again (about a second on the
 * board for the local view). `arts` draws them when no layer has them yet.
 */
function sheetOf(
  land: Land,
  tile: number,
  look: Look,
  close: boolean,
  shown: readonly Season[],
  snows: readonly boolean[],
  rare: readonly RareLook[],
  pieces: boolean,
  arts: () => StandingArt[],
): Sheet {
  let byKey = SHEETS.get(land.palette);
  if (byKey === undefined) {
    byKey = new Map();
    SHEETS.set(land.palette, byKey);
  }
  const key = [
    tile,
    look.name,
    close,
    pieces,
    shown.join("+"),
    snows.join("+"),
    rare.join("+"),
  ].join("|");
  let shared = byKey.get(key);
  if (shared === undefined) {
    const drawn = arts();
    shared = {
      ...strip(drawn, look.plants),
      lean: new LeanSheet(),
      tall: Math.max(...drawn.map(({ art }) => art.height)) / tile,
      users: 0,
    };
    byKey.set(key, shared);
  }
  const mine = shared;
  const sheets = byKey;
  mine.users += 1;
  let released = false;
  return {
    drawings: mine.drawings,
    tall: mine.tall,
    lean: mine.lean,
    release: () => {
      if (released) return;
      released = true;
      mine.users -= 1;
      if (mine.users > 0) return;
      for (const source of mine.sources) source.destroy();
      mine.lean.destroy();
      sheets.delete(key);
    },
  };
}

/**
 * The plants that stand alone, drawn by rule with `tile` art pixels to the cell: every
 * tree and bush as far grown as its biomass says, in the season's leaves, blossom or
 * bare branches.
 */
export function standingPlants(
  land: Land,
  tile: number,
  options: StandingOptions = {},
): PlantLayer {
  const close = options.close === true;
  const season = options.season ?? land.season;
  const { time } = options;
  // Where the simulation has snow lying, a plant on a cell under enough of it carries
  // some, in whatever season; without the simulation's snow, `options.snow` says.
  const snowCells = land.snow;
  const anySnow = snowCells?.some((depth) => depth >= PLANT_SNOW_FROM) ?? false;
  // Every drawing in each season some of the plants are in, with snow and without where
  // some lies: named "season:key" and "season+snow:key".
  const shown = time === undefined ? [season] : seasonsInPlay(time);
  const snows =
    snowCells === undefined ? [options.snow === true] : anySnow ? [false, true] : [false];
  const look = options.look ?? DEFAULT_LOOK;
  // The rare genes' looks some plant of this land has (M7).
  const rareGenes = land.rareGenes ?? [];
  let carried = 0;
  for (const mask of land.plantRare ?? []) carried |= mask;
  const present = looksOf(carried, rareGenes);
  const looksAt = (x: number, y: number): RareLook[] =>
    land.plantRare === undefined ? [] : looksOf(land.plantRare[y * land.width + x] ?? 0, rareGenes);
  const pieces = close && options.pieces === true;
  const sheet = sheetOf(land, tile, look, close, shown, snows, present, pieces, () =>
    // Every drawing in each season some of the plants are in, with snow and without where
    // some lies: named "season:key" and "season+snow:key".
    shown.flatMap((when) =>
      snows.flatMap((snowy) =>
        standingArts(land, tile, { ...options, season: when, snow: snowy, rare: present }).map(
          (art) => ({
            ...art,
            key: `${when}${snowy && snowCells !== undefined ? "+snow" : ""}:${art.key}`,
          }),
        ),
      ),
    ),
  );
  /** The name of drawing `key` in `shown`, with snow on it if its cell (x, y) has snow. */
  const named = (shown: Season, x: number, y: number, key: string): string =>
    `${shown}${(snowCells?.[y * land.width + x] ?? 0) >= PLANT_SNOW_FROM ? "+snow" : ""}:${key}`;
  const { drawings } = sheet;
  const aboveSea = (x: number, y: number): number =>
    (land.heights[y * land.width + x] ?? 0) - land.seaLevel;
  /** The season the ground of cell (x, y) is in, and the season of the plant standing on it. */
  const groundSeason = (x: number, y: number): Season =>
    time === undefined ? season : seasonShown(time, groundEarliness(time, x, y, aboveSea(x, y)));
  const plantSeason = (x: number, y: number): Season => {
    if (time === undefined) return season;
    const evergreen = land.plantEvergreen?.[y * land.width + x];
    return seasonShown(
      time,
      plantEarliness(
        time,
        x,
        y,
        aboveSea(x, y),
        evergreen === undefined ? undefined : evergreen / 255,
      ),
    );
  };
  /** A tree's or a bush's build from its `HEIGHT` gene where it is known: broad and low, as the scale has it, or slender and tall. */
  const buildOf = (x: number, y: number): number => {
    const gene = land.plantHeight?.[y * land.width + x];
    if (gene === undefined) return variantOf(x, y, 17);
    return gene < BROAD_BELOW ? 2 : gene >= TALL_FROM ? 1 : 0;
  };
  const placed = (key: string, dx: number, dy: number): Placed[] => {
    const drawing = drawings.get(key);
    if (drawing === undefined) return [];
    const { art } = drawing;
    // A plant that bends is drawn in its leaning drawings, lean 0 to begin with.
    const leaning = leaningOf(drawing, sheet.lean);
    const left = leaning?.left ?? 0;
    const added = leaning?.added ?? 0;
    return [
      {
        texture: leaning?.frames[-leaning.lowest] ?? drawing.texture,
        anchorX: (art.footX + left) / (art.width + added),
        anchorY: art.footY / art.height,
        scale: 1 / tile,
        dx,
        dy,
        ...(leaning === undefined || drawing.bend === null
          ? {}
          : {
              sway: {
                frames: leaning.frames,
                lowest: leaning.lowest,
                reach: drawing.bend.flex * art.footY,
                added,
              },
            }),
        ...(art.shadow === undefined
          ? {}
          : { shadow: { rx: art.shadow.rx / tile, ry: art.shadow.ry / tile } }),
      },
    ];
  };
  const variantOf = (x: number, y: number, salt: number, of = STANDING_VARIANTS): number =>
    Math.floor(cellHash(x, y, salt) * of);
  /** A place inside the cell, different for each `salt`: offsets from the foot of the cell. */
  const within = (x: number, y: number, salt: number): [number, number] => [
    cellHash(x, y, salt) - 0.5,
    -cellHash(x, y, salt + 1),
  ];
  const burntClass = land.coverClasses.indexOf("BURNT");

  /** The small things of the local view on cell (x, y), whose plant is `look`. */
  const among = (look: PlantLook | null, x: number, y: number): Placed[] => {
    const out: Placed[] = [];
    // What is out on the cell is what is out in the season its ground is in.
    const here = groundSeason(x, y);
    const inSeason = IN_SEASON[here];
    const flowersNow = FLOWERS[here];
    const put = (key: string, dx: number, dy: number): Placed[] =>
      placed(named(here, x, y, key), dx, dy);
    let salt = 100;
    /** One of `kind` somewhere on the cell, with `chance`; `variants` drawings to pick from. */
    const maybe = (kind: string, chance: number, variants: number): void => {
      salt += 4;
      if (cellHash(x, y, salt) >= chance * (inSeason[kind] ?? 1)) return;
      out.push(...put(`${kind}/${variantOf(x, y, salt + 1, variants)}`, ...within(x, y, salt + 2)));
    };
    const cell = y * land.width + x;
    const above = (land.heights[cell] ?? 0) - land.seaLevel;
    // Nothing small grows in the sea, not even round a mangrove's roots.
    if (above <= 0) return out;
    if (look === null) {
      if (land.cover[cell] === burntClass) {
        maybe("stump", CHANCE.burnt.stump, 2);
        maybe("log", CHANCE.burnt.log, 2);
        maybe("snag", CHANCE.burnt.snag, 2);
      } else if (above < SHORE_BELOW) {
        maybe("reed", CHANCE.shore.reed, 2);
        maybe("reed", CHANCE.shore.reed, 2);
        maybe("stone", CHANCE.shore.stone, 6);
      } else if (above >= land.relief.highRockFrom) {
        maybe("stone", CHANCE.heights.stone, 6);
        maybe("boulder", CHANCE.heights.boulder, 4);
      } else {
        maybe("stone", CHANCE.bare.stone, 6);
        maybe("boulder", CHANCE.bare.boulder, 4);
        maybe("herb", CHANCE.bare.herb, 2);
      }
      return out;
    }
    const biomass = land.biomass[cell] ?? 0;
    if (look.form === "LICHEN") {
      maybe("stone", CHANCE.lichen.stone, 6);
      maybe("boulder", CHANCE.lichen.boulder, 4);
    } else if (look.form === "GRASS") {
      if (look.dormant) {
        maybe("dry", CHANCE.grass.dry, GRASS_VARIANTS);
        return out;
      }
      // Every cell of grass is tufts to walk through: more where it grows thick.
      const growth = growthOf(biomass);
      const tufts = TUFTS_FROM + Math.floor(biomass / BIOMASS_PER_TUFT);
      // Tufts stand in clumps that may cross into the next cell, with gaps of bare
      // ground between (R5): thin grass leaves a cell empty now and then.
      if (biomass < CLUMP_GAP_BELOW && cellHash(x, y, 49) < CLUMP_GAP) return out;
      const [centreX, centreY] = within(x, y, 51);
      for (let k = 0; k < tufts; k++) {
        const key = standingKey(
          "GRASS",
          growth === "old" ? "grown" : growth,
          variantOf(x, y, 50 + 3 * k, GRASS_VARIANTS),
        );
        const angle = 2 * Math.PI * cellHash(x, y, 52 + 3 * k);
        const reach = k === 0 ? 0 : CLUMP_REACH * (0.6 + 0.4 * cellHash(x, y, 53 + 3 * k));
        const at: [number, number] = [
          centreX + reach * Math.cos(angle),
          centreY + reach * CLUMP_FLATTEN * Math.sin(angle),
        ];
        // Each tuft a little warmer, cooler or darker than the next, at random (the owner).
        const tint = TUFT_TINTS[Math.floor(cellHash(x, y, 54 + 3 * k) * TUFT_TINTS.length)];
        out.push(...put(key, ...at).map((one) => (tint === undefined ? one : { ...one, tint })));
        // A rare gene's look on the first tuft: a seed head, clover at its foot.
        if (k === 0) {
          for (const overlay of looksAt(x, y)) {
            if (overlay === "fruit" || overlay === "clover") {
              out.push(...put(`${key}#${overlay}`, ...at));
            }
          }
        }
      }
      maybe("herb", CHANCE.grass.herb, 2);
      if (biomass < 128 || flowersNow.length === 0) return out;
      // One kind and colour of flower over several cells, thick in places and rare between.
      const kind =
        flowersNow[Math.floor(valueNoise(x / 6, y / 6, 71) * flowersNow.length)] ?? "daisy";
      const colour = Math.floor(valueNoise(x / 7, y / 7, 72) * FLOWER_COLOURS.length);
      const drift = valueNoise(x / DRIFT_CELLS, y / DRIFT_CELLS, 73);
      const many = (inSeason["flower"] ?? 1) >= 1;
      const flowers = drift >= DRIFT_FROM && many ? 2 + variantOf(x, y, 74, 3) : 0;
      for (let k = 0; k < flowers; k++) {
        out.push(...put(`${kind}/${colour}`, ...within(x, y, 75 + 2 * k)));
      }
      if (flowers === 0 && cellHash(x, y, 81) < CHANCE.grass.flower * (inSeason["flower"] ?? 1)) {
        out.push(...put(`${kind}/${colour}`, ...within(x, y, 82)));
      }
    } else if (look.form === "SHRUB") {
      // A bush that has died back to its roots, or only just come up: its first shoots.
      if (look.dormant && cellHash(x, y, 86) < CHANCE.scrub.sprout) {
        out.push(...put(standingKey("SHRUB", "sprout", variantOf(x, y, 87)), ...within(x, y, 88)));
      }
      maybe("fern", CHANCE.scrub.fern, 2);
      maybe("herb", CHANCE.scrub.herb, 2);
      const kind = flowersNow[0];
      if (kind !== undefined && cellHash(x, y, 83) < CHANCE.scrub.flower) {
        out.push(
          ...put(`${kind}/${variantOf(x, y, 84, FLOWER_COLOURS.length)}`, ...within(x, y, 85)),
        );
      }
    } else if (look.form === "BROADLEAF") {
      maybe("mushroom", CHANCE.wood.mushroom, STANDING_VARIANTS);
      maybe("fern", CHANCE.wood.fern, 2);
      maybe("log", CHANCE.wood.log, 2);
      maybe("herb", CHANCE.wood.herb, 2);
    } else {
      maybe("mushroom", CHANCE.pines.mushroom, STANDING_VARIANTS);
      maybe("fern", CHANCE.pines.fern, 2);
      maybe("log", CHANCE.pines.log, 2);
      maybe("stone", CHANCE.pines.stone, 6);
    }
    return out;
  };

  const { tall } = sheet;
  /**
   * A plant drawn as `base` (a drawing's name) with the looks of its rare genes: its own
   * drawing (taller if emergent, red-barked if a fire pine), then each overlay over it.
   */
  const withLooks = (
    shown: Season,
    x: number,
    y: number,
    base: string,
    looks: readonly RareLook[],
    tree: boolean,
    dx: number,
    dy: number,
    charred = false,
  ): Placed[] => {
    const drawn = looks.includes("crown") && tree ? `${base}+crown` : base;
    const wood = charred ? "+charred" : looks.includes("bark") ? "+bark" : "";
    const own = placed(named(shown, x, y, `${drawn}${wood}`), dx, dy);
    const overlays = OVERLAYS.filter((overlay) => looks.includes(overlay)).flatMap((overlay) =>
      placed(named(shown, x, y, `${drawn}#${overlay}`), dx, dy),
    );
    return [...own, ...overlays];
  };

  /**
   * A tree's or a bush's own drawing (the first of `plants`, before its overlays) with
   * the footprint animals keep out of; a sprout has none.
   */
  const standing = (plants: Placed[], kind: "tree" | "bush", sprout: boolean): Placed[] => {
    const own = plants[0];
    if (own === undefined || sprout) return plants;
    // The plant's own width, not the room its drawings have to lean in.
    const rx = (FOOTPRINT_SHARE[kind] * (own.texture.width - (own.sway?.added ?? 0))) / tile;
    if (kind === "bush") {
      // A bush is a low mound, and animals are seen from above: anywhere its drawing covers,
      // an animal would be inside it (R5, the owner: "avoid a creature entering inside a
      // tree"). So a bush keeps its whole drawing, an ellipse about its middle, and animals
      // go round it; what they brush in passing the leaves cover (`over`).
      const high = own.texture.height / tile;
      const ry = BUSH_DEPTH_SHARE * high;
      const middle = (own.anchorY - 0.5) * high;
      own.footprint = { rx, ry, raise: middle / ry };
    } else {
      own.footprint = { rx, ry: rx * FOOTPRINT_FLATTEN };
    }
    return plants;
  };

  /**
   * Drawing `name` (a bush's) in pieces with its foot at (dx, dy) from the foot of the cell,
   * each with its own footprint; the whole drawing's shadow goes with the piece nearest its
   * foot. Null if it has no pieces.
   */
  const inPieces = (name: string, dx: number, dy: number): Placed[] | null => {
    const whole = drawings.get(name);
    if (!pieces || whole === undefined) return null;
    const out: Placed[] = [];
    // The bush bends as a whole drawing would (`wind.ts`): a piece slides by its lean at
    // the height of its middle, none below the hinge, all of it from where it is stiff up.
    const bend = whole.bend;
    const high = whole.art.footY;
    const leans = leansOf(bend, high);
    for (let k = 0; ; k++) {
      const drawing = drawings.get(`${name}@${k}`);
      if (drawing?.piece === undefined) break;
      const { art, piece } = drawing;
      const middle = -piece.dy + art.footY - art.height / 2;
      const share =
        bend === null
          ? 0
          : Math.min(
              Math.max(
                (middle - high * bend.hinge) / Math.max(high * (bend.stiff - bend.hinge), 1),
                0,
              ),
              1,
            );
      const highest = Math.round(leans.highest * share);
      out.push({
        texture: drawing.texture,
        anchorX: art.footX / art.width,
        anchorY: art.footY / art.height,
        scale: 1 / tile,
        dx: dx + piece.dx / tile,
        dy: dy + piece.dy / tile,
        footprint: {
          rx: (PIECE_FOOTPRINT.across * piece.r) / tile,
          ry: (PIECE_FOOTPRINT.deep * piece.r) / tile,
          raise: 1,
        },
        piece: true,
        ...(bend === null || highest < 1
          ? {}
          : {
              slide: {
                lowest: leans.lowest,
                highest,
                reach: bend.flex * high * share,
                dx: -piece.dx / tile,
                dy: -piece.dy / tile,
              },
            }),
      });
    }
    if (out.length === 0) return null;
    const shadow = whole.art.shadow;
    if (shadow !== undefined) {
      const near = (one: Placed): number => Math.abs(one.dx - dx) + Math.abs(one.dy - dy);
      const nearest = out.reduce((a, b) => (near(b) < near(a) ? b : a));
      nearest.shadow = { rx: shadow.rx / tile, ry: shadow.ry / tile };
    }
    return out;
  };

  /** The colours a broadleaf of build `variant` drops its leaves in, as it turns in autumn. */
  const leafRamps = new Map<number, readonly number[]>();
  const leafColours = (variant: number): readonly number[] => {
    let colours = leafRamps.get(variant);
    if (colours === undefined) {
      const ramp = seasonRamp(land.palette, "BROADLEAF", "autumn", variant, look.seasons);
      colours = ramp.map((hex) => Number.parseInt(hex.slice(1), 16));
      leafRamps.set(variant, colours);
    }
    return colours;
  };

  const layer = new PlantLayer(
    land,
    (look, x, y) => {
      if (options.covered?.(x, y) === true) return [];
      const out = close ? among(look, x, y) : [];
      const cell = y * land.width + x;
      const biomass = land.biomass[cell] ?? 0;
      const looks = looksAt(x, y);
      const scorch = land.scorch?.[cell] ?? 0;
      const stood = (land.plantHeight?.[cell] ?? 0) >= CHARRED_TREE_HEIGHT;
      if (
        look === null &&
        land.cover[cell] === burntClass &&
        !looks.includes("bark") &&
        scorch >= CHARRED_FROM_SCORCH &&
        stood &&
        cellHash(x, y, 16) < PLANT_SCALE.treeDensity
      ) {
        // A tree the fire killed where it stood: its charred skeleton, until the scorch fades.
        const [dx, dy] = plantOffset(x, y);
        const key = `${standingKey("BROADLEAF", "grown", buildOf(x, y))}/charred`;
        return [
          ...out,
          ...standing(
            placed(named(plantSeason(x, y), x, y, key), dx / SPRITE_WIDTH, dy / SPRITE_WIDTH),
            "tree",
            false,
          ),
        ];
      }
      if (look === null && land.cover[cell] === burntClass && looks.includes("bark")) {
        // A fire pine (rare, M7) lives through a fire, which leaves nothing else: a tree on
        // the burnt ground, its trunk charred and its crown kept; a conifer if it is
        // evergreen enough to be one.
        if (biomass < VISIBLE_FROM) return out;
        const form = (land.plantEvergreen?.[cell] ?? 255) >= CONIFER_FROM ? "CONIFER" : "BROADLEAF";
        const shown = plantSeason(x, y);
        const base = standingKey(form, growthOf(biomass), buildOf(x, y));
        const [dx, dy] = plantOffset(x, y);
        return [
          ...out,
          ...standing(
            withLooks(shown, x, y, base, looks, true, dx / SPRITE_WIDTH, dy / SPRITE_WIDTH, true),
            "tree",
            growthOf(biomass) === "sprout",
          ),
        ];
      }
      // A mangrove in the sea is classed by its form (a bush, sometimes a tree), so it
      // stands below like any other plant: on stilt roots, being one.
      if (look === null) return out;
      if (!standsAlone(look, x, y)) return out;
      if (look.form === "GRASS") {
        // Close up the grass is the tufts above, not one in three cells.
        if (close) return out;
        const [dx, dy] = plantOffset(x, y);
        const base = standingKey("GRASS", "grown", variantOf(x, y, 17));
        return [
          ...out,
          ...withLooks(
            groundSeason(x, y),
            x,
            y,
            base,
            looks,
            false,
            dx / SPRITE_WIDTH,
            dy / SPRITE_WIDTH,
          ),
        ];
      }
      // Of a wood or of scrub only some cells carry a plant of their own; a carrier of a
      // rare gene always does, so that its look is seen.
      const density = look.form === "SHRUB" ? PLANT_SCALE.bushDensity : PLANT_SCALE.treeDensity;
      if (cellHash(x, y, 16) >= density && looks.length === 0) return out;
      const [dx, dy] = plantOffset(x, y);
      const shown = plantSeason(x, y);
      const habit = shown === "winter" ? habitOf(look.form, land.plantEvergreen?.[cell]) : null;
      const base = `${standingKey(look.form, growthOf(biomass), buildOf(x, y))}${habit === null ? "" : `/${habit}`}`;
      const tree = look.form === "BROADLEAF" || look.form === "CONIFER";
      const plants = withLooks(
        shown,
        x,
        y,
        base,
        looks,
        tree,
        dx / SPRITE_WIDTH,
        dy / SPRITE_WIDTH,
      );
      // A broadleaf in autumn, not one that keeps its leaves, drops a few (R5, `leaves.ts`).
      const own0 = plants[0];
      if (
        look.form === "BROADLEAF" &&
        shown === "autumn" &&
        growthOf(biomass) !== "sprout" &&
        (land.plantEvergreen?.[cell] ?? 0) < LEAFY_FROM &&
        own0 !== undefined
      ) {
        const high = (own0.anchorY * own0.texture.height) / tile;
        const wide = (own0.texture.width - (own0.sway?.added ?? 0)) / tile;
        own0.crown = {
          half: CROWN.across * wide,
          bottom: CROWN.from * high,
          top: CROWN.to * high,
          colours: leafColours(buildOf(x, y)),
          x: 0,
          y: 0,
        };
      }
      // A bush in pieces (`?bushes=pieces`): its pieces in place of its own drawing, its rare
      // genes' overlays over them whole. A fire pine's bark is drawn whole.
      const own =
        tree || looks.includes("bark") || growthOf(biomass) === "sprout"
          ? null
          : inPieces(named(shown, x, y, base), dx / SPRITE_WIDTH, dy / SPRITE_WIDTH);
      if (own !== null) return [...out, ...own, ...plants.slice(1)];
      return [...out, ...standing(plants, tree ? "tree" : "bush", growthOf(biomass) === "sprout")];
    },
    {
      tall,
      // Close up, plants and animals are large enough to be sorted four rows to the cell.
      ...(close ? { rowsPerCell: 4 } : { eager: options.lazy !== true }),
      built: () => sheet.lean.flush(),
    },
  );
  layer.own({ destroy: () => sheet.release() });
  return layer;
}
