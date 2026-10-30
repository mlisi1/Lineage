/**
 * The drawings of the plants that stand alone (`plants.ts`, `standingPlants`), and how a
 * sheet of them is packed into pages: no Pixi and no page, so that a worker can draw them
 * (R5, the optimization plan: `standing.worker.ts`, the views prepared ahead).
 */
import { DEFAULT_LOOK, type Look, type PlantInks } from "../looks";
import { mulberry32 } from "../rng";
import type { Land, Ramp } from "../terrain/land";
import type { Pixels } from "../terrain/pixels";
import { SPRITE_WIDTH } from "./look";
import {
  CAP_COLOURS,
  FLOWER_COLOURS,
  MOSS_COLOUR,
  SMALL_SIZES,
  STANDING_VARIANTS,
  GRASS_VARIANTS,
  colourArt,
  drawSmall,
  drawStanding,
  type PlantArt,
  type Small,
} from "./plantart";
import { piecesOf } from "./pieces";
import { GROWTHS, coldRamp, seasonRamp, woodOf, type Growth, type Season } from "./seasons";
import { EMERGENT_TALLER, OVERLAYS, RARE_COLOURS, overlayArt, type RareLook } from "./rareart";
import { type YearTime } from "./turning";

/**
 * Where a piece of a bush stands (R5, `?bushes=pieces`): its foot's offset from the
 * whole drawing's foot, in pixels, and its puff's radius.
 */
export interface PieceAt {
  dx: number;
  dy: number;
  r: number;
}

const NO_RAMP: Ramp = ["#000000", "#000000", "#000000"];

export const standingKey = (form: string, growth: Growth, variant: number): string =>
  `${form}/${growth}/${variant}`;

/** A stump or a snag where it burnt is charred. */
const CHARRED = "#3a302b";

/** Blossom on a tree, on a bush (by its drawing), berries, and grass in seed. */
const BLOSSOM = { BROADLEAF: "#f6e6ee", SHRUB: ["#f4f1e4", "#e58fb1", "#f4f1e4"] } as const;

const BERRY = "#b8443a";

const SEED_HEAD = "#c9a94a";

export const ALL_FLOWERS = ["daisy", "bell", "spike", "umbel"] as const;

/** A number for a drawing's name, to place what lies on it the same way every time. */
function keySalt(key: string): number {
  let hash = 7;
  for (let i = 0; i < key.length; i++) hash = (Math.imul(hash, 31) + key.charCodeAt(i)) | 0;
  return hash & 0xffff;
}

/**
 * A tree burnt where it stood (R4): its bare skeleton in charcoal, on burnt ground where
 * the fire was recent (`Land.scorch` from this, 0–255) and a tree grew (`HEIGHT` from
 * this: the simulation's trees, form_shrub_max_height 0.6). As the scorch fades it goes.
 */
const CHARRED_RAMP: Ramp = ["#1f1919", "#33292a", "#4d3f3b"];

const CHARRED_WOOD = "#1a1414";

const CHARRED_EMBER = "#7a4a32";

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

/**
 * Every drawing a layer of standing plants is made of, with `tile` art pixels to the
 * cell: trees and bushes at each stage of growth in three drawings each, tufts of
 * grass, and for the local view the small things. Named `FORM/growth/variant`, or
 * `kind/variant` for the small ones.
 */
export function standingArts(
  land: SheetLand,
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

/**
 * How wide and how tall a texture the drawings are packed into may grow, in pixels: within
 * what every GPU takes (a texture too large draws black). Past the height, a new page.
 */
export const SHEET_WIDTH = 2048;
const SHEET_HEIGHT = 2048;

/** A sheet's drawings coloured and packed into pages, and where each went. */
export interface PackedSheet {
  pages: Pixels[];
  places: { page: number; left: number; top: number }[];
  /**
   * The pages made into bitmaps where they were packed (a worker with `OffscreenCanvas`):
   * the page's thread then does not draw them (R5: 0.15 s on the board for the local
   * view's). The pages' pixels are left out then. Drawings are clear or solid, alpha 0
   * or 255, so a bitmap holds the same pixels a canvas would.
   */
  bitmaps?: ImageBitmap[];
}

/** Colour `arts` and pack them into pages, in rows, a clear pixel between them. */
export function packSheet(arts: readonly StandingArt[], inks: PlantInks): PackedSheet {
  // Where each goes: along a row until it is full, then on the next; a new page when full.
  const places: PackedSheet["places"] = [];
  const sizes: { wide: number; tall: number }[] = [];
  let page = 0;
  let left = 1;
  let top = 1;
  let rowTall = 0;
  let wide = 1;
  const close = (): void => {
    sizes[page] = { wide, tall: top + rowTall + 1 };
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
  const pages: Pixels[] = sizes.map(({ wide: width, tall: height }) => ({
    width,
    height,
    rgba: new Uint8ClampedArray(width * height * 4),
  }));
  arts.forEach(({ art, ramp, accent, wood }, index) => {
    const at = places[index];
    const sheet = at === undefined ? undefined : pages[at.page];
    if (at === undefined || sheet === undefined) return;
    const pixels = colourArt(art, ramp, accent, wood, inks);
    const row = pixels.width * 4;
    for (let y = 0; y < pixels.height; y++) {
      sheet.rgba.set(
        pixels.rgba.subarray(y * row, (y + 1) * row),
        ((at.top + y) * sheet.width + at.left) * 4,
      );
    }
  });
  return { pages, places };
}

/** What of a land its standing plants' drawings are made from. */
export type SheetLand = Pick<Land, "palette" | "relief" | "season" | "snow">;

/**
 * A sheet of standing plants' drawings: for a layer of `tile` art pixels to the cell, in
 * `look`, close (the local view) or not, its bushes in pieces or not, in the seasons
 * `shown`, with and without snow as `snows` says, with the rare genes' looks `rare`.
 */
export interface SheetAsk {
  tile: number;
  look: Look;
  close: boolean;
  pieces: boolean;
  shown: readonly Season[];
  snows: readonly boolean[];
  rare: readonly RareLook[];
}

/**
 * Every drawing of the sheet `ask`, in each season shown, with snow and without where
 * some lies: named "season:key" and "season+snow:key".
 */
export function sheetArts(land: SheetLand, ask: SheetAsk): StandingArt[] {
  const { tile, look, close, pieces, rare } = ask;
  return ask.shown.flatMap((when) =>
    ask.snows.flatMap((snowy) =>
      standingArts(land, tile, { close, look, pieces, season: when, snow: snowy, rare }).map(
        (art) => ({
          ...art,
          key: `${when}${snowy && land.snow !== undefined ? "+snow" : ""}:${art.key}`,
        }),
      ),
    ),
  );
}

/** A sheet asked of the plants' worker (`standing.worker.ts`): its drawings, if kept, sent. */
export interface SheetRequest {
  id: number;
  land: SheetLand;
  ask: Omit<SheetAsk, "look"> & { look: string };
  kept?: StandingArt[];
}

/** The worker's answer: the drawings, unless they were sent, and the pages packed. */
export interface SheetReply {
  id: number;
  arts?: StandingArt[];
  packed: PackedSheet;
}
