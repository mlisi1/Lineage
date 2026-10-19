/**
 * The creature genome as the sim defines it (`lineage_sim/fauna/genome.py`): fourteen
 * genes, each in [0, 1], in this order. `phenotypes.json` lists the sim's own names, and a
 * test holds the two together.
 */

export const Gene = {
  SIZE: 0, // body mass
  DIET: 1, // 0 eats plants … 1 eats meat
  LIMBS: 2, // number of leg pairs
  SPEED: 3, // muscle: top speed
  ARMOUR: 4, // plates: protection, weight
  SENSE: 5, // eyes and ears: perception range
  AQUATIC: 6, // 0 land animal … 1 swimmer
  JAW: 7, // bite: grazing rate and attack power
  BROOD: 8, // 0 one large young … 1 many small ones
  HUE: 9, // body colour (and mate recognition)
  PATTERN: 10, // body pattern (and mate recognition)
  LEARNING: 11, // how fast the brain learns during life
  EXPLORATION: 12, // how much it tries out while steering
  SOCIAL: 13, // how much of its mother's learned plant preferences a newborn takes on
} as const;

export type GeneName = keyof typeof Gene;

/** The genes' names in genome order. */
export const GENE_NAMES = Object.keys(Gene) as readonly GeneName[];
export const GENE_COUNT = GENE_NAMES.length;

/** One value per gene, in `Gene` order. */
export type Genome = readonly number[];

/** The value of `gene` in `genome` (0 if the genome is short of it). */
export function geneOf(genome: Genome, gene: GeneName): number {
  return genome[Gene[gene]] ?? 0;
}
