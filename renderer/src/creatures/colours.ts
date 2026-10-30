/**
 * An animal's colours from its genes (R5, the owner: colours straight from the genes, some
 * for the body, others for the markings).
 *
 *   body      hue HUE (off the ground's yellow-greens), saturation AQUATIC (the water's more vivid), lightness SIZE (the
 *             small light, the big deep)
 *   markings  hue away from the body's by SOCIAL (loners near it, the social in signal
 *             colours across the wheel), lightness EXPLORATION (the bold pale, the shy
 *             dark), saturation DIET (hunters vivid, grazers muted)
 *
 * Sister species differ by a few hundredths in every gene (the v9 world: eight of ten
 * species within 0.92–0.97 of HUE), so a gene's value as it is would draw them alike. A
 * species' colour reads its genes by **rank** among the species alive: each gene's
 * average, ranked, spread evenly over the gene's range. The order is the genes' own (the
 * redder species stays the warmer), the step between neighbours readable. Each animal
 * then shows its own genes a little against its species' average.
 */
import { geneOf, type GeneName, type Genome } from "./genome";

/** A colour as hue (0–1 round the wheel), saturation and lightness (0–1). */
export interface Hsl {
  hue: number;
  saturation: number;
  light: number;
}

/** An animal's two colours. */
export interface Colours {
  body: Hsl;
  mark: Hsl;
}

/** The genes the colours read. */
const COLOUR_GENES = ["HUE", "AQUATIC", "SIZE", "SOCIAL", "EXPLORATION", "DIET"] as const;
type ColourGene = (typeof COLOUR_GENES)[number];

/** Body: saturation from the land's to the water's, lightness from the small to the big. */
const BODY_SATURATION = [0.5, 0.78] as const;
const BODY_LIGHT = [0.66, 0.36] as const;
/** Markings: hue this far round from the body's, from loners to the most social. */
const MARK_HUE = [0.06, 0.5] as const;
const MARK_LIGHT = [0.22, 0.8] as const;
const MARK_SATURATION = [0.4, 0.76] as const;
/** The markings stay at least this much lighter or darker than the body, to be seen. */
const MARK_CONTRAST = 0.2;
/**
 * Hues kept off animals: yellow-green to green, the ground's and the grass's own, where a
 * body turned olive and was lost on the land (the owner, 2026-10-21: "avoid olive").
 */
const GROUND_HUES = [0.11, 0.42] as const;
const SPARE = 1 - (GROUND_HUES[1] - GROUND_HUES[0]);

/** A share (0–1) of the way round the wheel's hues an animal may have, from the ground's end on. */
const offGround = (share: number): number => (GROUND_HUES[1] + share * SPARE) % 1;

/** A hue moved out of the ground's band to its nearer edge. */
function awayFromGround(hue: number): number {
  const [from, to] = GROUND_HUES;
  if (hue <= from || hue >= to) return hue;
  return hue - from < to - hue ? from : to;
}

/** How far an animal's own genes move its colours from its species' (per unit of gene). */
const OWN_HUE = 0.4;
const OWN_LIGHT = 0.6;
/** ... and no further than this. */
const OWN_REACH = 0.04;

const lerp = ([from, to]: readonly [number, number], t: number): number => from + (to - from) * t;
const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/** A species' colours and the averages of its genes they were read from. */
export interface SpeciesColour {
  colours: Colours;
  means: Readonly<Record<ColourGene, number>>;
}

/** The colours of every species among `members`, ranked against each other. */
export function speciesColours(
  members: readonly { species: number; genome: Genome }[],
): Map<number, SpeciesColour> {
  const sums = new Map<number, { sum: Record<ColourGene, number>; count: number }>();
  for (const { species, genome } of members) {
    let entry = sums.get(species);
    if (entry === undefined) {
      entry = {
        sum: { HUE: 0, AQUATIC: 0, SIZE: 0, SOCIAL: 0, EXPLORATION: 0, DIET: 0 },
        count: 0,
      };
      sums.set(species, entry);
    }
    for (const gene of COLOUR_GENES) entry.sum[gene] += geneOf(genome, gene as GeneName);
    entry.count += 1;
  }
  const ids = [...sums.keys()].sort((a, b) => a - b);
  const means = new Map(
    ids.map((id) => {
      const { sum, count } = sums.get(id) ?? { sum: null, count: 1 };
      const mean = {} as Record<ColourGene, number>;
      for (const gene of COLOUR_GENES) mean[gene] = (sum?.[gene] ?? 0) / count;
      return [id, mean] as const;
    }),
  );
  /** Where species `id` ranks on `gene` among all: 0 lowest, 1 highest, 0.5 when alone. */
  const rank = (id: number, gene: ColourGene): number => {
    if (ids.length < 2) return 0.5;
    const own = means.get(id)?.[gene] ?? 0;
    let below = 0;
    let level = 0;
    for (const other of ids) {
      const value = means.get(other)?.[gene] ?? 0;
      if (value < own) below += 1;
      else if (value === own) level += 1;
    }
    return (below + (level - 1) / 2) / (ids.length - 1);
  };
  const out = new Map<number, SpeciesColour>();
  for (const id of ids) {
    // Hues spread round the wheel but for the ground's, the last a step short of the first.
    const hue = offGround((rank(id, "HUE") * (ids.length - 1)) / ids.length);
    const body: Hsl = {
      hue,
      saturation: lerp(BODY_SATURATION, rank(id, "AQUATIC")),
      light: lerp(BODY_LIGHT, rank(id, "SIZE")),
    };
    let markLight = lerp(MARK_LIGHT, rank(id, "EXPLORATION"));
    if (Math.abs(markLight - body.light) < MARK_CONTRAST) {
      markLight = body.light < 0.5 ? body.light + MARK_CONTRAST : body.light - MARK_CONTRAST;
    }
    const mark: Hsl = {
      hue: awayFromGround((hue + lerp(MARK_HUE, rank(id, "SOCIAL"))) % 1),
      saturation: lerp(MARK_SATURATION, rank(id, "DIET")),
      light: markLight,
    };
    out.set(id, { colours: { body, mark }, means: means.get(id) ?? mean0() });
  }
  return out;
}

function mean0(): Record<ColourGene, number> {
  return { HUE: 0, AQUATIC: 0, SIZE: 0, SOCIAL: 0, EXPLORATION: 0, DIET: 0 };
}

/** An animal's colours: its species', moved a little by its own genes against the average. */
export function ownColours(species: SpeciesColour, genome: Genome): Colours {
  const own = (gene: ColourGene, gain: number): number =>
    clamp((geneOf(genome, gene as GeneName) - species.means[gene]) * gain, -OWN_REACH, OWN_REACH);
  const { body, mark } = species.colours;
  const hue = own("HUE", OWN_HUE);
  const light = own("SIZE", -OWN_LIGHT);
  return {
    body: {
      ...body,
      hue: awayFromGround((body.hue + hue + 1) % 1),
      light: clamp(body.light + light, 0.2, 0.8),
    },
    mark: {
      ...mark,
      hue: awayFromGround((mark.hue + hue + 1) % 1),
      light: clamp(mark.light + own("EXPLORATION", OWN_LIGHT), 0.15, 0.88),
    },
  };
}
