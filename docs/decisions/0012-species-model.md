# 0012 — Species model: lineage labels, splits by interbreeding, genome names

- **Status**: proposed
- **Date**: 2026-10-18

## Context

M6 asks for daily genome clustering with persistent species ids, speciation and
extinction detection, syllable names derived from the genome with lineage-aware daughter
names, and a phylogeny store. Its bands: `[3–12]` species alive for ≥ 90 % of sim-time;
speciation `[≥ 1 / month]`, median.

What fauna gives: per creature an id, 14 genes, the arrival it descends from through its
mother (`origin`) and its generation. It keeps no parent ids. Mating already defines who
belongs together: two adults can breed when their genomes differ by at most
`compat_distance` (0.10, mean absolute difference over all 14 genes).

Questions settled with the owner at the start of M6 (all as proposed):

1. **Which genes count.** All 14, with the mating distance and threshold: a species is
   the creatures that can interbreed. The learning genes count, as they do for mating.
2. **Identity.** Lineage labels plus splits, rather than NEAT-style assignment to the
   nearest moving centroid (which misses a species whose two halves sit either side of
   its centroid, each within the threshold of it, yet unable to interbreed).
3. **What counts as a speciation** for M6.2: splits on the island only. Groups of
   strangers landing found species too; they are reported apart (arrivals).
4. **How M6.1 is measured**: per seed, the share of inhabited days (from the founders'
   landing on; days after a total extinction count) with 3–12 species alive after the
   daily census; the median seed must reach 90 %.

## Decision

- **A `species` subsystem**, ticking daily (`[schedule] species`), after fauna at
  midnight. It reads fauna (`ids`, `genes`, `origin`) and draws no random numbers.
  Fauna's state and behaviour are unchanged: species are bookkeeping, not biology (mating
  still uses the distance directly).
- **Labels follow lineages.** The subsystem keeps, for every living creature, the species
  it was given. A newcomer takes the species of its genetically nearest labelled
  creature of the same lineage (in practice a parent or sibling); if all of its kin died
  since the last census, the nearest living species of its lineage. Creatures of a
  lineage the island has not seen found a new root species: the founders are one, each
  group of strangers is another.
- **Splits are reproductive isolation that lasts.** Each day, within each species, the
  members are linked when they could breed (distance ≤ `compat_distance`), and the
  connected groups are found. When at least two groups hold `min_members` (5) creatures
  each, and that lasts `split_days` (7) days in a row, the largest group keeps the
  species and each other large group becomes a daughter. Smaller strays stay in the
  species, so a few odd mutants never make one; a separation that heals or dwindles
  within the week resets the count.
- **Extinction** is the census finding no member alive.
- **Ids are never reused**: species *k* is row *k − 1* of every record array. A parent
  always has a smaller id, so the phylogeny is a forest with one root per arrival.
  Records keep parent, lineage, birth and extinction times, current and peak members,
  founding and current mean genome, and the name.
- **Names from the genome**, without randomness. A syllable is an onset (16) picked by one
  gene and a vowel (5) by another. A root species takes three syllables from (size,
  diet), (limbs, speed), (hue, pattern). A daughter keeps the first two syllables of its
  parent's name and adds one whose onset names the gene it diverged on most and whose
  vowel is its value of that gene, so a lineage shares a stem. A name already taken in
  the world is lengthened deterministically (the next most diverged gene, more gene
  pairs, then every syllable in a fixed order).
- **Outputs**: `SpeciesBorn(species_id, name, parent, members)` (parent 0 for an arrival)
  and `SpeciesExtinct(species_id, name, born_t_ms)`, for M9's chronicle.
- **Schema v7.** The v6→v7 migration adds an empty species state; at the first census
  after loading, each lineage becomes one root species, which later splits as its groups
  drift apart.

## Consequences

- No fauna change, so terrain, flora, fire and fauna states and streams are bit-identical
  to M5's; golden hashes changed only for the schema version and the new state.
- The census costs well under a millisecond a day at a full population.
- The bands are initial ones; between milestones the island stays viable, not tuned
  (ADR 0011). What M6's report found, and what M11 can do about it, is below.

## Measured (M6 report, 20 seeds × 3 sim-years)

To be filled from `reports/M6-species/metrics.json`.

## References

- **Mayr's biological species concept** (species as groups of interbreeding natural
  populations, reproductively isolated from others): the reading behind "a species is
  who can interbreed". Cited from general knowledge; no source was re-read for M6.
- **Stanley, K. O. & Miikkulainen, R. (2002). Evolving neural networks through augmenting
  topologies.** *Evolutionary Computation* 10(2). NEAT's speciation (assignment to the
  first species whose representative is within a compatibility threshold) was the
  alternative considered and rejected above. Described from memory; not re-read for M6.
