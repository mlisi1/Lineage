/**
 * Genome → body: a port of `lineage_sim/fauna/phenotype.py`, the single definition of
 * what the genes mean. The renderer draws from these values, so they must be the sim's:
 * `tests/creatures/phenotype.test.ts` checks the port against the sim's own results for
 * the fifteen specimen genomes of `sim/tests/fixtures/phenotypes.json`.
 *
 * The config is not the renderer's: the keys the function reads come with the world
 * (the fixture's `phenotype_config` until R1's state stream carries them), so a retuned
 * sim is drawn as it is.
 *
 * The sim works in 32-bit floats and this port in 64-bit ones, which differ in the last
 * places only. The one place that would show is rounding to whole leg pairs and young,
 * so those are rounded as NumPy does: from the 32-bit product, halves to even.
 */
import { Gene, type Genome } from "./genome";

/** The `[fauna]` keys `phenotype` reads (`CONFIG_KEYS` in the sim). */
export const PHENOTYPE_CONFIG_KEYS = [
  "mass_min",
  "mass_max",
  "metabolic_exponent",
  "limb_pairs_max",
  "speed_base",
  "speed_floor",
  "limbless_speed",
  "extra_limb_drag",
  "armour_slowdown",
  "armour_limb_relief",
  "aquatic_land_slowdown",
  "speed_mass_exponent",
  "swim_speed",
  "swim_floor",
  "swim_limb_drag",
  "cost_speed",
  "cost_sense",
  "cost_armour",
  "cost_jaw",
  "cost_limb_pair",
  "cost_aquatic",
  "cost_learning",
  "lifespan_base",
  "lifespan_mass_exponent",
  "sense_base",
  "sense_gain",
  "basal_rate",
  "move_cost",
  "capacity_per_mass",
  "graze_rate",
  "graze_jaw_floor",
  "diet_exponent",
  "meat_diet_exponent",
  "attack_jaw_floor",
  "armour_strength",
  "maturity_share",
  "brood_max",
  "learning",
  "learning_rate_max",
  "exploration_max",
  "social_copy_max",
] as const;

type NumberKey = Exclude<(typeof PHENOTYPE_CONFIG_KEYS)[number], "learning">;

/** The sim's config as the phenotype reads it: numbers, and whether creatures learn. */
export type PhenotypeConfig = Readonly<Record<NumberKey, number>> & { readonly learning: boolean };

/** Validate the config that comes with the world: every key, of the right type. */
export function parsePhenotypeConfig(raw: unknown): PhenotypeConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("phenotype config: not an object");
  }
  const document = raw as Record<string, unknown>;
  const out: Record<string, number | boolean> = {};
  for (const key of PHENOTYPE_CONFIG_KEYS) {
    const value = document[key];
    const expected = key === "learning" ? "boolean" : "number";
    if (typeof value !== expected) throw new Error(`phenotype config: bad or missing "${key}"`);
    out[key] = value as number | boolean;
  }
  return out as PhenotypeConfig;
}

/** Derived body values of one creature, as the sim's `Phenotype` has them. */
export interface Phenotype {
  mass: number;
  /** Whole numbers, 0 … limb_pairs_max. */
  limbPairs: number;
  /** Cells per hour. */
  landSpeed: number;
  swimSpeed: number;
  /** Cells. */
  senseRange: number;
  /** Energy per hour at rest. */
  basalBurn: number;
  /** Energy per cell travelled. */
  moveCost: number;
  /** Largest energy reserve. */
  capacity: number;
  /** Plant biomass (full cells) per hour. */
  grazeRate: number;
  plantEfficiency: number;
  meatEfficiency: number;
  attack: number;
  defence: number;
  lifespanH: number;
  maturityH: number;
  /** Young per brood, whole numbers. */
  brood: number;
  learningRate: number;
  exploration: number;
  social: number;
}

/** NumPy's `rint` of a 32-bit product: to the nearest whole number, halves to even. */
function rint32(value: number): number {
  const x = Math.fround(value);
  const floor = Math.floor(x);
  const rest = x - floor;
  if (rest > 0.5) return floor + 1;
  if (rest < 0.5) return floor;
  return floor % 2 === 0 ? floor : floor + 1;
}

export function phenotype(cfg: PhenotypeConfig, genome: Genome): Phenotype {
  // The sim holds genes as 32-bit floats.
  const gene = (index: number): number => Math.fround(genome[index] ?? 0);
  const size = gene(Gene.SIZE);
  const diet = gene(Gene.DIET);
  const speed = gene(Gene.SPEED);
  const armour = gene(Gene.ARMOUR);
  const aquatic = gene(Gene.AQUATIC);
  const jaw = gene(Gene.JAW);
  // Without lifetime learning (the M4 brain) the learning genes do nothing and cost nothing.
  const learns = cfg.learning ? 1 : 0;
  const learning = learns * gene(Gene.LEARNING);

  const mass = cfg.mass_min * (cfg.mass_max / cfg.mass_min) ** size;
  const scaled = mass ** cfg.metabolic_exponent;
  const limbPairs = rint32(Math.fround(gene(Gene.LIMBS) * cfg.limb_pairs_max));

  const muscle = cfg.speed_floor + (1 - cfg.speed_floor) * speed;
  const legs =
    cfg.limbless_speed +
    ((1 - cfg.limbless_speed) * Math.min(limbPairs, 2)) / 2 -
    cfg.extra_limb_drag * Math.max(limbPairs - 2, 0);
  const plates =
    1 - cfg.armour_slowdown * armour * Math.max(1 - cfg.armour_limb_relief * limbPairs, 0);
  const landSpeed =
    cfg.speed_base *
    muscle *
    legs *
    plates *
    (1 - cfg.aquatic_land_slowdown * aquatic) *
    mass ** cfg.speed_mass_exponent;
  const swimSpeed =
    cfg.swim_speed *
    (cfg.swim_floor + (1 - cfg.swim_floor) * aquatic) *
    (1 - (cfg.swim_limb_drag * limbPairs) / cfg.limb_pairs_max) *
    muscle *
    mass ** cfg.speed_mass_exponent;

  const upkeep =
    1 +
    cfg.cost_speed * speed +
    cfg.cost_sense * gene(Gene.SENSE) +
    cfg.cost_armour * armour +
    cfg.cost_jaw * jaw +
    cfg.cost_limb_pair * limbPairs +
    cfg.cost_aquatic * aquatic +
    cfg.cost_learning * learning;
  const lifespanH = 24 * cfg.lifespan_base * mass ** cfg.lifespan_mass_exponent;

  return {
    mass,
    limbPairs,
    landSpeed,
    swimSpeed,
    senseRange: cfg.sense_base + cfg.sense_gain * gene(Gene.SENSE),
    basalBurn: cfg.basal_rate * scaled * upkeep,
    moveCost: cfg.move_cost * scaled,
    capacity: cfg.capacity_per_mass * mass,
    grazeRate: cfg.graze_rate * scaled * (cfg.graze_jaw_floor + (1 - cfg.graze_jaw_floor) * jaw),
    plantEfficiency: (1 - diet) ** cfg.diet_exponent,
    meatEfficiency: diet ** cfg.meat_diet_exponent,
    attack: mass * (cfg.attack_jaw_floor + jaw),
    defence: mass * (1 + cfg.armour_strength * armour),
    lifespanH,
    maturityH: cfg.maturity_share * lifespanH,
    brood: 1 + rint32(Math.fround(gene(Gene.BROOD) * (cfg.brood_max - 1))),
    learningRate: cfg.learning_rate_max * learning,
    exploration: cfg.exploration_max * learns * gene(Gene.EXPLORATION),
    social: cfg.social_copy_max * learns * gene(Gene.SOCIAL),
  };
}
