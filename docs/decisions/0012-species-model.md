# 0012 — Species model: lineage labels, genome clusters, genome names

- **Status**: accepted
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

1. **Which genes count.** All 14, as for mating; the learning genes count. First decided
   with the mating threshold too (a species is who can interbreed); revised after the
   first runs (below, "Species are clusters, not breeding groups").
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
- **Splits are clusters that last.** Each day, within each species, members are linked
  when their genomes differ by at most `link_distance` (0.035), and the connected groups
  are found. When at least two groups hold `min_members` (8; `predator_min_members`, 5,
  for a predator species, below) creatures each, and that
  lasts `split_days` (3) days in a row, the largest group keeps the species and each
  other large group becomes a daughter. Smaller strays stay in the
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

## Species are clusters, not breeding groups (revised the same day)

With the mating threshold (0.10), a 4-seed preview had about two species alive (the
founders' herd and a group of strangers, which lasts a median of 28 days) and one split
in 12 seed-years (M6.1 15 %, M6.2 0). The reason is structural: after 50–70 generations
the founders' herd is genetically broad (mean pairwise distance 0.09, extremes
0.16–0.20; many pairs could not breed directly), but it is one continuous cloud, linked
through intermediates, and on one island nothing opens a gap in it. Speciation in that
sense needs an isolating mechanism (assortative mating on hue and pattern, landmasses
that split, disruptive selection).

The owner chose a finer species definition over such a mechanism now: **a species is a
cluster within the cloud**, linked by its own `link_distance`, finer than mating. Fauna
does not change; mating still uses `compat_distance`. Two daughters may therefore still
interbreed: a species here is a recognisable kind of animal, not a closed gene pool.

The threshold was chosen from a sweep. Species are bookkeeping, so one run per seed can
carry many censuses side by side (20 seeds × 3 years, settings in `[species]`):

| link | split after | min group | in band (median seed) | splits / month |
|---|---|---|---|---|
| 0.10 (mating) | 7 d | 5 | 19 % | 0.00 |
| 0.06 | 7 d | 5 | 36 % | 0.18 |
| 0.05 | 3 d | 5 | 57 % | 1.27 |
| 0.04 | 3 d | 10 | 77 % | 0.79 |
| **0.035** | **3 d** | **8** | **81 %** | **1.00** |
| 0.035 | 2 d | 10 | 83 % | 0.69 |

Below about 0.035 the herd shatters into many small groups (up to 20 species at once);
above about 0.05 it stays one. No setting reaches 90 % in the band: the first months
after the founders land hold one or two species until the herd has spread genetically,
and those months count. 0.035, 3 days, 8 creatures is the only region meeting M6.2 while
keeping the count mostly within 3–12; it is a definition chosen to fit the bands, and
M11 may revisit it with the rest.

## Consequences

- No fauna change, so terrain, flora, fire and fauna states and streams are bit-identical
  to M5's; golden hashes changed only for the schema version and the new state.
- The census costs well under a millisecond a day at a full population.
- The bands are initial ones; between milestones the island stays viable, not tuned
  (ADR 0011). What M6's report found, and what M11 can do about it, is below.

## Measured (M6 report, 20 seeds × 3 sim-years)

From `reports/M6-species/metrics.json` (run `m6-species-final`, code `35fd586`):

After the predator rule (run `m6-species-pred`, code `11a4640`): M6.1 79 % FAIL, M6.2
1.08 PASS; splits by founding diet: herbivores 498, omnivores 4, predators 51 (17 of 20
seeds). The numbers below are from the run before it (`m6-species-final`):

- **M6.1 FAIL**: the median seed has 3–12 species alive on 81 % of its inhabited days
  (10th percentile 59 %, worst 38 %); 16 % below the band, almost never above. Median
  alive 7 (10–90 %: 1–12). The shortfall is the months after landing (one or two species
  until the herd spreads) and seeds whose founders die out (the island is empty).
- **M6.2 PASS**: 1.00 splits per inhabited sim-month, median seed (10–90 %: 0.53–1.31);
  every seed has splits. Arrivals add 0.36 species a month; 1.12 die out a month.
- Arrived species live a median of 29 days, species born by a split 110 days.
- Splits come in bursts: the most daughters one species had within 30 days has a
  median of 6 per seed, up to 13.
- Census cost: well under a millisecond a day (benchmark budget 50 ms).

**Owner's decision (2026-10-18):** M6 is done; M6.1 is deferred to M11 ("fairly close
to the hoped result").

### By diet class

From the same run, by each species' founding diet:

| Founding diet | Species | Arrived | Born by a split | Median peak | Deepest descent |
|---|---|---|---|---|---|
| herbivores | 544 | 46 | 498 | 18 | 4 |
| omnivores | 33 | 29 | 4 | 3 | 1 |
| predators | 132 | 128 | 4 | 8 | 1 |

At first only herbivores speciated on the island. Predators, capped at 16 and arriving eight at a
time, can split only if the whole capped population divides into two groups of
`min_members` (8), and their few founders are genetically narrow; their persistence on
the island is repeated arrival, not descent. Omnivores only come from random-genome
strangers, share the herbivores' cap (so a group landing beside a full herd lands with
almost nobody, most likely why their median peak is 3) and last a median of 16 days.
No herbivore daughter ever became an omnivore or a predator.

**Predator lines (owner: "try solving this carnivore situation as you prefer").** A
diagnosis over 8 seeds × 3 years showed that predator lineages do continue: 86 % of
predator deaths were born on the island, usually one predator lineage at a time breeds
for months. 87 % of predator deaths are starvation (42 % before maturity); predators are
present on 23–57 % of days. Their lines were invisible only because the census could not
split them. Two census rules were swept (census only, 20 seeds × 3 years):

- `min_members` scaled with a species' own size: rejected. Herds that have already split
  are small, so they shatter too (1 300–4 000 herbivore splits, 14–28 species at once).
- A smaller group for **predator species** (mean diet ≥ `predator_min_diet`), since
  their numbers have their own cap: herbivore splits unchanged (498); predator splits
  3 → 141, 4 → 87, **5 → 51 (17 of 20 seeds)**, 6 → 28; M6.1 76–80 %.

`predator_min_members` = 5 is adopted: two groups of five in a pack of at least ten.
Making predators themselves last longer (they starve) is balance, left to M11
(ADR 0011); omnivores remain rare strangers (no source, no room under a full herd's
cap). Options for those, in M11: room for newcomers under the cap, a mixed diet that
pays.

## References

- **Mayr's biological species concept** (species as groups of interbreeding natural
  populations, reproductively isolated from others): the reading behind the first
  definition, "a species is who can interbreed", later replaced by genome clusters.
  Cited from general knowledge; no source was re-read for M6.
- **Stanley, K. O. & Miikkulainen, R. (2002). Evolving neural networks through augmenting
  topologies.** *Evolutionary Computation* 10(2). NEAT's speciation (assignment to the
  first species whose representative is within a compatibility threshold) was the
  alternative considered and rejected above. Described from memory; not re-read for M6.
