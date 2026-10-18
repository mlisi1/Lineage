/**
 * One body plan per species. The kind of animal a body is drawn as (worm, lizard,
 * beetle…) changes at thresholds of its genes, so two animals of one species either side
 * of a threshold would look like different kinds. Each species is drawn as the kind of its
 * average member; within the plan, each animal still shows its own genes (size, build,
 * colour, markings).
 *
 * An animal takes its species' kind only where it lives where its species does (in the
 * water or on land): a fish is not drawn walking on the shore.
 */
import { SWIMS_FROM, kindOf, type Kind, type Look } from "./body";

/** An animal as the plan per species needs it: its look and its species (0: none yet). */
export type Member = Look & { species: number };

/** What a species is drawn as: its average member's kind, and whether it lives in the water. */
export interface SpeciesPlan {
  kind: Kind;
  swims: boolean;
  members: number;
}

const NUMBERS = [
  "mass",
  "limbPairs",
  "landSpeed",
  "swimSpeed",
  "diet",
  "speed",
  "armour",
  "sense",
  "aquatic",
  "jaw",
  "hue",
  "pattern",
] as const satisfies readonly (keyof Look)[];

/** The plan of every species among `members`, from its average member. */
export function speciesPlans(members: readonly Member[]): Map<number, SpeciesPlan> {
  const sums = new Map<number, { look: Record<keyof Look, number>; count: number }>();
  for (const member of members) {
    if (member.species === 0) continue;
    let sum = sums.get(member.species);
    if (sum === undefined) {
      sum = {
        look: Object.fromEntries(NUMBERS.map((key) => [key, 0])) as Record<keyof Look, number>,
        count: 0,
      };
      sums.set(member.species, sum);
    }
    for (const key of NUMBERS) sum.look[key] += member[key];
    sum.count += 1;
  }
  const plans = new Map<number, SpeciesPlan>();
  for (const [species, { look, count }] of sums) {
    const mean = {} as Record<keyof Look, number>;
    for (const key of NUMBERS) mean[key] = look[key] / count;
    plans.set(species, { kind: kindOf(mean), swims: mean.aquatic >= SWIMS_FROM, members: count });
  }
  return plans;
}

/** The kind `member` is drawn as: its species', where it lives where its species does. */
export function kindFor(member: Member, plans: ReadonlyMap<number, SpeciesPlan>): Kind {
  const plan = member.species === 0 ? undefined : plans.get(member.species);
  if (plan === undefined || plan.swims !== member.aquatic >= SWIMS_FROM) return kindOf(member);
  return plan.kind;
}
