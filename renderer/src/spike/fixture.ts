/**
 * The world the spike draws: a snapshot exported from a sim save by
 * `uv run python -m tools.replay <save> --renderer-fixture renderer/public/spike`.
 * A stand-in until the state stream and its protocol exist (R1).
 */

export const FIXTURE_FORMAT = "lineage-spike-fixture/1";

export type Ramp = readonly [string, string, string];

export interface CreatureSeed {
  x: number;
  y: number;
  mass: number;
  limbPairs: number;
  landSpeed: number;
  diet: number;
  armour: number;
  hue: number;
  pattern: number;
}

export interface WorldFixture {
  width: number;
  height: number;
  /** Land-cover class per cell, row by row; an index into `coverClasses`. */
  cover: Uint8Array;
  /** Plant biomass per cell, 0–255. */
  biomass: Uint8Array;
  coverClasses: readonly string[];
  /** Dark, mid and light tone per class name (and "DORMANT"). */
  palette: Readonly<Record<string, Ramp>>;
  /** Low plants below this biomass (0–255) are drawn dry. */
  dormantBelow: number;
  dormantClasses: readonly string[];
  creatures: readonly CreatureSeed[];
  description: string;
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
  const cover = decodeBase64(field(raw, "cover", isString));
  const biomass = decodeBase64(field(raw, "biomass", isString));
  if (cover.length !== width * height || biomass.length !== width * height) {
    throw new Error("fixture: grid data does not match width × height");
  }

  const palette: Record<string, Ramp> = {};
  for (const [name, ramp] of Object.entries(field(raw, "palette", isObject))) {
    if (!isStrings(ramp) || ramp.length !== 3) throw new Error(`fixture: bad ramp ${name}`);
    palette[name] = [ramp[0] ?? "", ramp[1] ?? "", ramp[2] ?? ""];
  }

  const fields = field(raw, "creature_fields", isStrings);
  const column = (name: string): number => {
    const index = fields.indexOf(name);
    if (index < 0) throw new Error(`fixture: no creature field "${name}"`);
    return index;
  };
  const at = {
    x: column("x"),
    y: column("y"),
    mass: column("mass"),
    limbPairs: column("limb_pairs"),
    landSpeed: column("land_speed"),
    diet: column("diet"),
    armour: column("armour"),
    hue: column("hue"),
    pattern: column("pattern"),
  };
  const creatures = field(raw, "creatures", isRows).map((row) => ({
    x: row[at.x] ?? 0,
    y: row[at.y] ?? 0,
    mass: row[at.mass] ?? 1,
    limbPairs: row[at.limbPairs] ?? 2,
    landSpeed: row[at.landSpeed] ?? 1,
    diet: row[at.diet] ?? 0,
    armour: row[at.armour] ?? 0,
    hue: row[at.hue] ?? 0,
    pattern: row[at.pattern] ?? 0,
  }));

  const source = field(raw, "source", isObject);
  return {
    width,
    height,
    cover,
    biomass,
    coverClasses: field(raw, "cover_classes", isStrings),
    palette,
    dormantBelow: Math.round(field(raw, "dormant_below_biomass", isNumber) * 255),
    dormantClasses: field(raw, "dormant_classes", isStrings),
    creatures,
    description: `seed ${String(source["seed"])}, ${String(source["date"])} (${String(source["season"])})`,
  };
}
