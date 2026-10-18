/**
 * The state stream's messages, generated from server/lineage_server/protocol/schema.json
 * by `npm run protocol` (json-schema-to-typescript). Do not edit by hand.
 */

/**
 * The state stream from the server to every renderer (desk kiosk and phone), one JSON message per WebSocket frame (CLAUDE.md §4.7). The TypeScript types in renderer/src/protocol.ts are generated from this file (`cd renderer && npm run protocol`); the Python encoder is server/lineage_server/protocol/encode.py. A renderer that meets a message type it does not know ignores it. Bump `protocol` only for a change an older renderer would misread.
 */
export type Message =
  ClockMessage | LandMessage | FaunaMessage | CreaturesMessage | SpeciesMessage | RareMessage;
/**
 * Version of this protocol.
 */
export type Protocol = 1;
/**
 * Sim time in milliseconds since the world was created.
 */
export type SimTime = number;
export type Season = "spring" | "summer" | "autumn" | "winter";

/**
 * Where the world is in time. Sent on connect and then often (every server tick): cheap.
 */
export interface ClockMessage {
  type: "clock";
  protocol: Protocol;
  t_ms: SimTime;
  /**
   * The calendar date in the world (UTC), YYYY-MM-DD.
   */
  date: string;
  season: Season;
  /**
   * Share of the current season gone by, 0–1.
   */
  season_progress: number;
  day_of_year: number;
  days_in_year: number;
}
/**
 * The land and what grows on it, every cell. Sent on connect and whenever it changes (once a sim-day, after the plants grow, and after terrain events). The palette is not sent: the renderer has the report maps' own (renderer/src/terrain/palette.json). Grids: heights: Height of each cell, 0–1 (u16le, scale 65535). cover: Land-cover class of each cell: an index into `cover_classes` (u8, scale 1). biomass: Plant biomass of each cell, 0–1 (u8, scale 255). snow: Depth of lying snow on each cell, 0–1 (u8, scale 255), as the simulation has it from the season and the height. plant_height: HEIGHT gene of the plant on each cell, 0–1 (u8, scale 255); 0 where none grows. plant_evergreen: EVERGREEN gene of the plant on each cell, 0–1 (u8, scale 255); 0 where none grows. plant_rare: Rare genes of the plant on each cell, as a bit mask (u8, scale 1): bit k is `rare_genes[k]`.
 */
export interface LandMessage {
  type: "land";
  protocol: Protocol;
  t_ms: SimTime;
  /**
   * Which world this is: a new continent after an apocalypse has another seed.
   */
  world: {
    seed: number;
  };
  /**
   * Cells across.
   */
  width: number;
  /**
   * Cells down.
   */
  height: number;
  /**
   * Height of the sea, 0–1.
   */
  sea_level: number;
  /**
   * Land-cover class names, in the order of their numbers in `cover`.
   */
  cover_classes: string[];
  heights: Grid;
  cover: Grid;
  biomass: Grid;
  snow: Grid;
  plant_height: Grid;
  plant_evergreen: Grid;
  plant_rare: Grid;
  /**
   * Names of the plants' rare genes, bit 0 first.
   */
  rare_genes: string[];
}
/**
 * A grid of the world's cells, row by row from the top-left cell, as little-endian whole numbers in base64. A cell's value is its number divided by `scale`.
 */
export interface Grid {
  /**
   * u8: one byte per cell; u16le: two bytes per cell, little-endian.
   */
  encoding: "u8" | "u16le";
  /**
   * What a cell's whole number is divided by: 1 for classes and bit masks, 255 or 65535 for shares.
   */
  scale: number;
  data: string;
}
/**
 * What every creature's body is derived from (R2). Sent on connect and when it changes. The renderer derives bodies itself (renderer/src/creatures/phenotype.ts); derived values are never sent.
 */
export interface FaunaMessage {
  type: "fauna";
  protocol: Protocol;
  /**
   * Creature gene names, in genome order.
   */
  genes: string[];
  /**
   * The [fauna] config keys the phenotype function reads (lineage_sim.fauna.phenotype.CONFIG_KEYS): numbers, and `learning` a boolean.
   */
  phenotype_config: {
    [k: string]: number | boolean;
  };
}
/**
 * Where every living creature is (R2). Sent after every fauna tick. A creature's genome comes once, the first time its id is sent; an id missing from `ids` has died.
 */
export interface CreaturesMessage {
  type: "creatures";
  protocol: Protocol;
  t_ms: SimTime;
  /**
   * Every living creature, by an id it keeps for its life.
   */
  ids: number[];
  /**
   * Where each of `ids` is, in cells: [x, y].
   */
  positions: [number, number][];
  /**
   * The species of each of `ids` (M6; 0 for none yet). Absent before species exist.
   */
  species?: number[];
  /**
   * Creatures not sent before (all of them on connect): id and genome, genes in `FaunaMessage.genes` order, each 0–1.
   */
  born: {
    id: number;
    genome: number[];
    /**
     * Its rare genes, as the bits of `RareMessage.genes` of kingdom creature (M7); fixed for life. Absent before rare genes exist.
     */
    slots?: number;
  }[];
  /**
   * Ids of the creatures that are torpid now (hibernating, lying still: M7). Absent before rare genes exist.
   */
  torpid?: number[];
}
/**
 * Every species that has lived (M6). Sent on connect and when a species is born or dies out.
 */
export interface SpeciesMessage {
  type: "species";
  protocol: Protocol;
  species: {
    id: number;
    name: string;
    /**
     * The species it split from; null for one of the first.
     */
    parent: number | null;
    extinct?: boolean;
  }[];
}
/**
 * The rare genes of both kingdoms and how each shows (M7): lineage_sim.rare.signature_table(). Sent on connect. Bits are stable; new genes only append. A creature's genes are the bits of its `slots`, a plant's the bits of `LandMessage.plant_rare`.
 */
export interface RareMessage {
  type: "rare";
  protocol: Protocol;
  genes: {
    kingdom: "creature" | "plant";
    /**
     * The gene's bit value in the kingdom's mask (1, 2, 4, …).
     */
    bit: number;
    name: string;
    /**
     * A key naming the visual signature, for the renderer to draw by.
     */
    signature: string;
    /**
     * What the signature looks like, in words.
     */
    look: string;
  }[];
}
