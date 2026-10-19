/**
 * The world the spike draws: a snapshot exported from a sim save by
 * `uv run python -m tools.replay <save> --renderer-fixture renderer/public/spike`.
 * A stand-in until the state stream and its protocol exist (R1).
 */

import { lookOf, type Look } from "../creatures/body";
import { GENE_NAMES, type Genome } from "../creatures/genome";
import { parsePhenotypeConfig, phenotype, type PhenotypeConfig } from "../creatures/phenotype";
import {
  parseRareConfig,
  rareLooks,
  withRare,
  type RareConfig,
  type Signatures,
} from "../creatures/rare";
import { seasonOf, type Season } from "./seasons";

export const FIXTURE_FORMAT = "lineage-spike-fixture/5";

export type Ramp = readonly [string, string, string];

/**
 * A creature as the sim describes it: where it is and its genome; and its look, which the
 * renderer derives from the genome with the sim's config.
 */
export interface CreatureSeed extends Look {
  x: number;
  y: number;
  genome: Genome;
  /** Its species as the sim has it, 0 for none yet (specimens, newcomers). */
  species: number;
  /** Its rare-gene slots (bits), as the sim has them. */
  slots: number;
  /** Lying torpid (a hibernator in winter or long darkness): curled up, still. */
  torpid: boolean;
  /** Cells it is kept within, when a picture wants it to stay in frame; the sim sets none. */
  pen?: { x0: number; y0: number; x1: number; y1: number };
}

/** Creatures chosen to show the range of bodies; the look sheet places them itself. */
export interface Cast {
  name: string;
  /** What each creature is called: a specimen's name, or the value of the swept gene. */
  members: readonly string[];
  creatures: readonly CreatureSeed[];
}

/** How the maps turn height into colour; the renderer does the same between cells. */
export interface Relief {
  /** The sea by depth, shallowest first: down to `limit` below the surface, this colour. */
  seaBands: readonly { limit: number; colour: string }[];
  /** Height gained per cell toward the light (north-west) from which a slope is lit. */
  slope: number;
  /** Bare ground this far above the sea is rock, and higher still snow. */
  highRockFrom: number;
  highRock: Ramp;
  snowFrom: number;
  snow: Ramp;
  shoreOutline: string;
}

export interface WorldFixture {
  width: number;
  height: number;
  /** Height of each cell (0–1), row by row; above `seaLevel` is land. */
  heights: Float32Array;
  seaLevel: number;
  relief: Relief;
  /** Land-cover class per cell, row by row; an index into `coverClasses`. */
  cover: Uint8Array;
  /** Plant biomass per cell, 0–255. */
  biomass: Uint8Array;
  coverClasses: readonly string[];
  /** Dark, mid and light tone per class name (and "DORMANT"). */
  palette: Readonly<Record<string, Ramp>>;
  /** The colours of the sea in the ground image, shallowest first. */
  sea: readonly string[];
  /** Low plants below this biomass (0–255) are drawn dry. */
  dormantBelow: number;
  dormantClasses: readonly string[];
  creatures: readonly CreatureSeed[];
  casts: readonly Cast[];
  /** The sim's config as its phenotype reads it: what bodies are derived with. */
  phenotypeConfig: PhenotypeConfig;
  /** What rare genes are drawn with, and the signature each slot bit is drawn by. */
  rareConfig: RareConfig;
  rareSignatures: Signatures;
  /** Diet gene at or below which a creature is a herbivore, at or above which a predator. */
  herbivoreMaxDiet: number;
  predatorMinDiet: number;
  description: string;
  /** The time of year in the world: what its plants are drawn in. */
  season: Season;
}

/** Decode base64 into bytes (browsers and Node both provide `atob`). */
export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

type Json = Record<string, unknown>;

function field<T>(document: Json, key: string, check: (value: unknown) => value is T): T {
  const value = document[key];
  if (!check(value)) throw new Error(`fixture: bad or missing "${key}"`);
  return value;
}

const isNumber = (value: unknown): value is number => typeof value === "number";
const isString = (value: unknown): value is string => typeof value === "string";
const isStrings = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every(isString);
const isRows = (value: unknown): value is number[][] =>
  Array.isArray(value) && value.every((row) => Array.isArray(row) && row.every(isNumber));
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Validate and unpack the contents of `world.json`. */
export function parseFixture(raw: unknown): WorldFixture {
  if (!isObject(raw)) throw new Error("fixture: not an object");
  if (raw["format"] !== FIXTURE_FORMAT) {
    throw new Error(`fixture: expected format ${FIXTURE_FORMAT}, got ${String(raw["format"])}`);
  }
  const width = field(raw, "width", isNumber);
  const height = field(raw, "height", isNumber);
  const packed = decodeBase64(field(raw, "heights", isString));
  const steps = field(raw, "height_steps", isNumber);
  const heights = new Float32Array(packed.length / 2);
  for (let i = 0; i < heights.length; i++) {
    // Little-endian 16-bit numbers.
    heights[i] = ((packed[2 * i] ?? 0) | ((packed[2 * i + 1] ?? 0) << 8)) / steps;
  }
  const cover = decodeBase64(field(raw, "cover", isString));
  const biomass = decodeBase64(field(raw, "biomass", isString));
  if (
    cover.length !== width * height ||
    biomass.length !== width * height ||
    heights.length !== width * height
  ) {
    throw new Error("fixture: grid data does not match width × height");
  }

  const palette: Record<string, Ramp> = {};
  for (const [name, ramp] of Object.entries(field(raw, "palette", isObject))) {
    if (!isStrings(ramp) || ramp.length !== 3) throw new Error(`fixture: bad ramp ${name}`);
    palette[name] = [ramp[0] ?? "", ramp[1] ?? "", ramp[2] ?? ""];
  }

  const ramp = (document: Json, key: string): Ramp => {
    const tones = field(document, key, isStrings);
    if (tones.length !== 3) throw new Error(`fixture: bad ramp ${key}`);
    return [tones[0] ?? "", tones[1] ?? "", tones[2] ?? ""];
  };
  const shading = field(raw, "relief", isObject);
  const highRock = field(shading, "high_rock", isObject);
  const snow = field(shading, "snow", isObject);
  const relief: Relief = {
    seaBands: field(shading, "sea_bands", Array.isArray).map((band: unknown) => {
      if (!Array.isArray(band) || !isNumber(band[0]) || !isString(band[1])) {
        throw new Error("fixture: bad sea band");
      }
      return { limit: band[0], colour: band[1] };
    }),
    slope: field(shading, "slope", isNumber),
    highRockFrom: field(highRock, "from", isNumber),
    highRock: ramp(highRock, "ramp"),
    snowFrom: field(snow, "from", isNumber),
    snow: ramp(snow, "ramp"),
    shoreOutline: field(shading, "shore_outline", isString),
  };

  // A row is where the creature is, its genome, then its species; the columns are named.
  const fields = field(raw, "creature_fields", isStrings);
  const column = (name: string): number => {
    const index = fields.indexOf(name);
    if (index < 0) throw new Error(`fixture: no creature field "${name}"`);
    return index;
  };
  const x = column("x");
  const y = column("y");
  const genes = GENE_NAMES.map((name) => column(name.toLowerCase()));
  const species = column("species");
  const slots = column("slots");
  const torpid = column("torpid");
  const phenotypeConfig = parsePhenotypeConfig(raw["phenotype_config"]);
  const rareConfig = parseRareConfig(raw["rare_config"]);
  const rareSignatures = new Map<number, string>();
  for (const entry of field(raw, "rare_signatures", Array.isArray)) {
    if (!isObject(entry) || !isNumber(entry["bit"]) || !isString(entry["signature"])) {
      throw new Error("fixture: bad rare signature");
    }
    rareSignatures.set(entry["bit"], entry["signature"]);
  }
  const seed = (row: readonly number[]): CreatureSeed => {
    const genome = genes.map((index) => row[index] ?? 0);
    const bits = row[slots] ?? 0;
    const look = lookOf(genome, phenotype(phenotypeConfig, genome));
    return {
      x: row[x] ?? 0,
      y: row[y] ?? 0,
      genome,
      species: row[species] ?? 0,
      slots: bits,
      torpid: (row[torpid] ?? 0) !== 0,
      ...withRare(look, rareLooks(bits, rareSignatures), rareConfig),
    };
  };
  const creatures = field(raw, "creatures", isRows).map(seed);
  const casts = field(raw, "casts", Array.isArray).map((cast: unknown): Cast => {
    if (!isObject(cast)) throw new Error("fixture: a cast is not an object");
    const members = field(cast, "members", isStrings);
    const rows = field(cast, "creatures", isRows);
    if (members.length !== rows.length) throw new Error("fixture: cast members and rows differ");
    return { name: field(cast, "name", isString), members, creatures: rows.map(seed) };
  });
  const diet = field(raw, "diet_classes", isObject);

  const source = field(raw, "source", isObject);
  return {
    width,
    height,
    heights,
    seaLevel: field(raw, "sea_level", isNumber),
    relief,
    cover,
    biomass,
    coverClasses: field(raw, "cover_classes", isStrings),
    palette,
    sea: relief.seaBands.map((band) => band.colour),
    dormantBelow: Math.round(field(raw, "dormant_below_biomass", isNumber) * 255),
    dormantClasses: field(raw, "dormant_classes", isStrings),
    creatures,
    casts,
    phenotypeConfig,
    rareConfig,
    rareSignatures,
    herbivoreMaxDiet: field(diet, "herbivore_max", isNumber),
    predatorMinDiet: field(diet, "predator_min", isNumber),
    description: `seed ${String(source["seed"])}, ${String(source["date"])} (${String(source["season"])})`,
    season: seasonOf(String(source["season"])),
  };
}
