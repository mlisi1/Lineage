import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { GENE_COUNT, GENE_NAMES, Gene, geneOf } from "../../src/creatures/genome";
import {
  PHENOTYPE_CONFIG_KEYS,
  parsePhenotypeConfig,
  phenotype,
  type Phenotype,
} from "../../src/creatures/phenotype";

/** The sim's reference: the specimens, their phenotypes and the config they come from. */
interface Reference {
  genes: string[];
  config: unknown;
  specimens: { name: string; genome: number[]; phenotype: Record<string, number> }[];
}
const reference = JSON.parse(
  readFileSync("../sim/tests/fixtures/phenotypes.json", "utf8"),
) as Reference;
const config = parsePhenotypeConfig(reference.config);

/** The sim's field names (`land_speed`) to the port's (`landSpeed`). */
const camel = (name: string): string => name.replace(/_(.)/g, (_, c: string) => c.toUpperCase());

describe("the genome", () => {
  it("has the sim's genes in the sim's order", () => {
    expect(GENE_NAMES).toEqual(reference.genes);
    expect(GENE_COUNT).toBe(14);
    expect(geneOf([0.1, 0.2, 0.3], "LIMBS")).toBe(0.3);
    expect(geneOf([0.1], "HUE")).toBe(0);
  });
});

describe("the phenotype, against the sim's", () => {
  it("reads the keys the sim ships, and refuses a config short of one", () => {
    expect(Object.keys(reference.config as object)).toEqual([...PHENOTYPE_CONFIG_KEYS]);
    const short = { ...(reference.config as object), mass_max: undefined };
    expect(() => parsePhenotypeConfig(short)).toThrow(/mass_max/);
    expect(() => parsePhenotypeConfig({ ...(reference.config as object), learning: 1 })).toThrow(
      /learning/,
    );
  });

  it("gives every value of the fifteen specimens", () => {
    expect(reference.specimens).toHaveLength(15);
    for (const specimen of reference.specimens) {
      const body = phenotype(config, specimen.genome);
      const fields = Object.keys(specimen.phenotype).map(camel).sort();
      expect(Object.keys(body).sort(), specimen.name).toEqual(fields);
      for (const [name, expected] of Object.entries(specimen.phenotype)) {
        const value = body[camel(name) as keyof Phenotype];
        // The sim works in 32-bit floats: the last places differ, nothing else.
        const tolerance = Math.max(Math.abs(expected) * 1e-5, 1e-6);
        expect(Math.abs(value - expected), `${specimen.name} ${name}`).toBeLessThanOrEqual(
          tolerance,
        );
      }
    }
  });

  it("rounds leg pairs and young as NumPy does: halves to even", () => {
    const genome = (limbs: number, brood: number): number[] => {
      const genes = new Array<number>(GENE_COUNT).fill(0.5);
      genes[Gene.LIMBS] = limbs;
      genes[Gene.BROOD] = brood;
      return genes;
    };
    // 0.625 × 4 = 2.5 and 0.875 × 4 = 3.5, both exact in 32 bits.
    expect(phenotype(config, genome(0.625, 0)).limbPairs).toBe(2);
    expect(phenotype(config, genome(0.875, 0)).limbPairs).toBe(4);
    expect(phenotype(config, genome(0.6251, 0)).limbPairs).toBe(3);
    for (let limbs = 0; limbs <= 1; limbs += 0.01) {
      const pairs = phenotype(config, genome(limbs, 0)).limbPairs;
      expect(Number.isInteger(pairs) && pairs >= 0 && pairs <= config.limb_pairs_max).toBe(true);
    }
    const most = phenotype(config, genome(0, 1)).brood;
    expect(phenotype(config, genome(0, 0)).brood).toBe(1);
    expect(most).toBe(config.brood_max);
  });

  it("makes the learning genes free when creatures do not learn", () => {
    const genes = reference.specimens.find((s) => s.name === "all-one")?.genome ?? [];
    const learns = phenotype(config, genes);
    const not = phenotype({ ...config, learning: false }, genes);
    expect([not.learningRate, not.exploration, not.social]).toEqual([0, 0, 0]);
    expect(not.basalBurn).toBeLessThan(learns.basalBurn);
    expect(not.mass).toBe(learns.mass);
  });
});
