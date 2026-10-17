# Creatures

Creatures are individuals: a position, an energy reserve, an age, a genome, a brain with
what it has learned, and rare-gene slots. Implemented in `lineage_sim/fauna/` (M4, M5);
every number below is a
`[fauna]` key in `sim/config/default.toml`. Fauna ticks every 10 sim-minutes; smooth
movement between ticks is the renderer's job.

## Genome

Fourteen genes in `[0, 1]`: eleven body genes, then three for lifetime learning (M5). All
count toward mate compatibility and genetic distance.

| Gene | Gives | Costs |
|---|---|---|
| `SIZE` | mass: more attack, defence, reserve, lifespan, bite | more food; slower to mature |
| `DIET` | 0 digests plants … 1 digests meat (and hunts from 0.15) | the other diet |
| `LIMBS` | 0–4 leg pairs: two walk best, more carry armour better | energy; drag in water |
| `SPEED` | top speed on land and in water | energy |
| `ARMOUR` | defence against attacks | energy, speed |
| `SENSE` | perception range | energy |
| `AQUATIC` | swims fast and does not drown | slow on land, energy |
| `JAW` | attack power and grazing rate | energy |
| `BROOD` | many young per brood | each young starts with less |
| `HUE`, `PATTERN` | looks; count toward mate compatibility | — |
| `LEARNING` | learning rate during life | basal burn (`cost_learning`) |
| `EXPLORATION` | steering noise to learn from, fading with age | noisier steering |
| `SOCIAL` | share of its mother's plant preferences a newborn takes on | — (free) |

With `learning = false` the three learning genes do nothing and cost nothing.

Sixteen-bit **rare-gene slots** are inherited and occasionally gained or lost; the genes
and their effects arrive in M7.

## Phenotype

`fauna/phenotype.py` is the single definition of what the genes mean: mass, leg pairs,
land and swim speed, sense range, resting burn, cost per cell travelled, energy capacity,
grazing rate, plant and meat efficiency, attack, defence, lifespan, maturity, brood size,
learning rate, exploration, and social copying.
Bigger and better-equipped always burns more. The renderer draws bodies from the same
values; `sim/tests/fixtures/phenotypes.json` holds 15 specimen genomes with their
expected values for the cross-language check in R2.

## Brain

A small neural net per creature, inherited and mutated. It only steers:

- **Senses** (20): energy, plant food underfoot, direction of better food within sense
  range, direction of the nearest prey (when hungry), threat, mate (when ready to breed)
  and creature of its own kind, direction of land, being in water, crowding, and (M5)
  where there is more low growth (lichen, grass) and more woody growth (shrub, trees).
  A creature sees plant form, never plant defence.
- **Output**: a steering vector. Speed follows from the body and the ground.
- **Instincts**: founders arrive with direct sense-to-steering weights (go to food, chase
  prey in proportion to their diet, flee threats, go to a mate, stay on land or in water,
  keep some distance from their own kind); none for the plant-form senses, whose innate
  weights evolution sets. Evolution changes them; a hidden layer lets
  behaviour come to depend on state.
- **Roaming**: each creature keeps a heading that drifts slowly, so one with nothing to
  steer by covers ground instead of jittering in place.

## Lifetime learning (M5)

Every creature also learns during its life. What it learns is a **gain on each
directional sense** (food, prey, threat, mate, land, its own kind, low growth, woody
growth): how strongly to follow it. The plant-form gains are where learning can beat
instinct: which form is safe to eat depends on the place (defence differs between
forms from region to region), so genes can only carry a general bias, held in the
inherited weights on those senses, and learning corrects it locally. Senses are directions on the map, so a gain is the only thing about them
worth learning on an island with no preferred compass direction (an earlier version
that let 50 weights learn fitted noise into fixed directions and drifted).

- **Rule**: node perturbation (REINFORCE). Slowly varying noise (`exploration_hours`)
  is added to the steering drive; an eligibility trace (`trace_hours`) accumulates
  noise · sensed direction per gain; each tick the gains move along their trace by
  learning rate × (reward − baseline). Reward is the tick's energy balance from eating
  and moving, as a share of capacity per hour; the baseline is its running average
  (`baseline_hours`). Gains fade with `forget_hours` and stay within `learned_max`.
- **Learning from meals** (associative, like taste aversion): after each bite of plants,
  the learned gain on that plant form's sense (low or woody growth) moves by how much
  better or worse the bite was than the creature's usual meal (`meal_learning_gain`,
  `meal_memory_hours`). One clear signal per bite: this, not the steering noise, is what
  lets a creature pick up which form is safe where it lives.
- **Diet traditions** (social learning): at birth a newborn takes on its `SOCIAL` gene's
  share of its mother's learned plant preferences (only those). Its own meals confirm or
  correct them; forgetting fades what is never confirmed. Copying is free; whether it
  pays is left to evolution (Rogers' paradox: it pays only alongside learning one's own).
- **Exploration fades with age** (`exploration_fade_hours`, `exploration_floor`): full
  at birth, like juvenile play, down to a floor in adults, so grown creatures stop paying
  for noise they no longer learn much from.
- **Genes**: `SOCIAL` (diet traditions, free); `LEARNING` (rate, costs basal burn) and `EXPLORATION` (noise; its cost is
  noisier steering). Both count toward compatibility and genetic distance.
- **Not inherited**: newborns start with no learned gains; evolution sees only innate
  weights (the setting for a Baldwin effect).
- **Off switch**: `learning = false` is the M4 brain: no noise, no learning, no cost.
- **Measures**: a creature is *competent* from the first time its day-averaged energy
  balance stops being negative. When its youth ends (maturity or death) a
  `JuvenileGrown` event reports what it ate and burnt while young, its competence age
  and its generation (0: arrived from elsewhere).

Background and references (Baldwin effect, when learning evolves, evolved plastic
networks, predator–prey coexistence): ADR 0009, "References".

## Life

- **Energy**: resting burn, a cost per cell travelled, and a heavy cost for land animals
  in water. A creature with no energy left dies (starved, or drowned if in water).
- **Grazing**: through `Flora.graze`. Roots and stubble are out of reach, so pasture
  regrows; defended plants refuse part of each bite, and what is eaten is worth less:
  energy × (1 − `defence_toxicity` × defence gene). Grazers cannot sense defence.
- **Hunting**: a creature with diet ≥ 0.15 attacks the nearest creature of another kind
  in reach that it is strong enough for, but only while hungry. A hit kills with a
  probability that grows with attack over defence and with the hunter's speed over the
  prey's.
- **Breeding**: two adults whose genomes differ by at most `compat_distance`, close
  together, both well fed and past their cooldown, have a brood. Each parent invests
  energy; the young share it. Genes cross over and mutate. An adult that finds no mate
  for six days clones itself at a higher cost.
- **Ageing**: lifespan grows with mass (about 45 days for mass 1).
- **Caps**: 200 creatures, plus 16 predators counted apart so a full herd cannot crowd
  them out.

## Arrivals

- **Founders**: 40 small-to-medium land-walking plant eaters of one species land once
  half the land carries well-grown plants, in spring or summer, and again after a total
  extinction.
- **Strangers**: about six groups of eight per year reach an inhabited island. Half are a
  hunter species (land walkers, at least medium-sized, with jaw, legs and senses to
  match); the rest have a random genome. Most fail; some stay.

Every creature remembers the genome its lineage arrived with; its distance from it is
the measure of evolutionary drift.

## Species (M6)

Daily genome clustering with persistent ids, speciation and extinction detection,
syllable names derived from the genome with lineage-aware daughter names, a phylogeny.

## Rare genes (M7)

Rare genes carry an extreme bonus and a real cost (e.g. venom, glow, hibernation,
photosynthesis) and a visual signature for the renderer.

## Measured behaviour (M4 report, 20 seeds × 3 sim-years)

See `reports/M4-fauna-evolution/`. Targets from CLAUDE.md §8, and how they are read:

- Total extinction in `[< 20%]` of seed-years: the last creature died at some point in
  that year.
- Mean genetic distance from the ancestors rising: higher at the end than at two thirds
  of the run, in ≥ 80% of seeds.
- Herbivores and predators present at year 3 in `[≥ 60%]` of seeds: at least 3 of each.

## Open

- M5 (in progress, ADR 0009): learning tracks the local plants (diet fit +0.32 in 20 of
  20 seeds), but the feeding gain it buys is small (+5 %, against an original target of
  15 %), evolution keeps the learning rate low, and there is no clear Baldwin trend in
  three years. Proposed criteria await the owner.
- Predator lineages are cyclic: they persist on the island for up to about 16
  generations, and are fewer late in learning worlds than in non-learning ones.

- The mean diet gene of the founders' descendants stays near 0.1 or below: herbivores
  never evolve into predators (no omnivores in any run); hunters only come from arrivals.
- Creatures graze every plant form alike (same bite rate); forms differ only through the
  plants' genes (defence).
- No aquatic food: swimmers must feed on land.
