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
| `HUE`, `PATTERN` | looks (body colour; one of twelve markings); count toward mate compatibility | — |
| `LEARNING` | learning rate during life | basal burn (`cost_learning`) |
| `EXPLORATION` | steering noise to learn from, fading with age | noisier steering |
| `SOCIAL` | share of its mother's plant preferences a newborn takes on | — (free) |

With `learning = false` the three learning genes do nothing and cost nothing.

Sixteen-bit **rare-gene slots** are inherited bit by bit (each from one parent) and
occasionally gained or lost at birth; eight of them carry the rare genes below (M7).

## Phenotype

`fauna/phenotype.py` is the single definition of what the genes mean: mass, leg pairs,
land and swim speed, sense range, resting burn, cost per cell travelled, energy capacity,
grazing rate, plant and meat efficiency, attack, defence, lifespan, maturity, brood size,
learning rate, exploration, and social copying.
Bigger and better-equipped always burns more. How each gene shows on the body (a plan
per kind of animal, picked by leg pairs, water, armour and speed) is in `renderer.md`.
The renderer draws bodies from the same
values; `sim/tests/fixtures/phenotypes.json` holds 15 specimen genomes with their
expected values for the cross-language check in R2.

## Brain

A small neural net per creature, inherited and mutated. It only steers:

- **Senses** (22): energy, plant food underfoot, direction of better food within sense
  range, direction of the nearest prey (when hungry), threat, mate (when ready to breed)
  and creature of its own kind, direction of land, being in water, crowding, and (M5)
  where there is more low growth (lichen, grass), more woody growth (shrub, trees) and
  more carrion (smelled through its scent). A creature sees plant form, never plant
  defence.
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
growth, carrion): how strongly to follow it. The plant-form gains are where learning can beat
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
- **Carrion**: the dead leave remains on land, in units of meat mass: what a hunter could
  not eat of its kill, and `carcass_share` of the body of those that starved or died of
  age (the drowned are lost). Remains rot (`carrion_decay_hours`). Creatures that digest
  meat (diet gene ≥ 0.15) eat carrion where they stand (`scavenge_rate`), and smell it
  through a scent spread over `carrion_scent_cells`. It feeds young and unlucky hunters
  between kills, and gives half-meat diets a niche. Founders arrive with an instinct for
  carrion in proportion to their diet.
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

A species is a cluster of similar genomes: creatures linked, directly or through others,
by genetic steps of at most `link_distance` (0.035, mean gene difference over all 14
genes, learning genes included). That is finer than who can mate (`compat_distance`
0.10): a whole herd can interbreed through intermediates and still hold several species.
Decisions, alternatives and the sweep behind the numbers: ADR 0012.

- **Daily census** (`species.py`, after fauna at midnight; no randomness). Every living
  creature keeps the species it was given. A newcomer joins the species of its nearest
  relative: the genetically closest labelled creature of its lineage (the arrival it
  descends from through its mother). A lineage the island has not seen (the founders,
  each group of strangers) founds a new **root** species.
- **Splits.** When a species' members fall into separate clusters of at least
  `min_members` (8; 5 for predator species, whose numbers have their own cap) and stay apart for `split_days` (3 days), the largest group keeps the
  species and every other one becomes a **daughter** species. Smaller strays stay; a
  separation that heals within the week does not count.
- **Extinction**: the last member died.
- **Names** are read off the genome: a syllable is an onset chosen by one gene and a vowel
  by another. A root species has three syllables, from (size, diet), (limbs, speed) and
  (hue, pattern). A daughter keeps its parent's first two syllables and adds one for the
  gene it diverged on most (the gene picks the onset, its value the vowel), so a lineage
  shares a stem: a daughter of *Malesha* that diverged most on its senses, to keen ones,
  is *Maleku*. Names are unique within a world.
- **Phylogeny**: one record per species that ever lived (parent, lineage, born,
  extinct, members, peak, founding and current mean genome, name); ids are never reused
  and parents are always older, so it is a forest with one root per arrival.
- **Outputs**: `SpeciesBorn` and `SpeciesExtinct`, for the chronicle (M9);
  `Species.labels_now()` gives every creature's species at any tick (for the renderer).

Measured (M6 report): about 7 species alive once the herd has spread, a split a month;
herbivores split most; predator lines branch too (51 splits in 20 seeds × 3 years, from
groups of 5), though predators still starve often and depend partly on new arrivals;
omnivores are rare strangers (ADR 0012, "By diet class").

## Rare genes (M7)

Each rare gene is one bit of the creature's slots (`lineage_sim/rare.py`,
`CreatureRare`): an extreme bonus at a real cost, and a visual signature for the
renderer. A newborn gains each with probability `rare_gain_probability` (0.0005) and
loses one it inherited with `rare_loss_probability` (0.02); arrivals carry none. Every
rare gene also costs resting burn, like a body gene (`*_burn_cost` × basal_rate ×
mass^0.75). Numbers are `[fauna]` keys.

| Gene | Bonus | Cost | Signature |
|---|---|---|---|
| `VENOM` | attack × 3: a hunter kills prey far larger than itself | burn | `venom`: bright fangs |
| `TOXIC` | warning colours: a hunter's kill chance × 0.2 | burn | `warning`: bold bands |
| `GIANT` | mass × 2, with everything that scales with mass (reserve, attack, defence, speed, lifespan) | burn (mass and extra), matures 1.5× later | `giant`: drawn larger |
| `LONGEVITY` | lifespan × 2, maturity unchanged | broods halved (at least one young), burn | `elder`: grizzled |
| `AMPHIBIOUS` | walks as a land animal and swims as a swimmer; no struggle in water | burn | `gills` |
| `HIBERNATION` | torpid in winter (and in darkness, M8) while its reserve is above 30 %: burns 20 %, ages at 25 % | torpid: does not move, eat or breed, cannot flee; burn | `coat`; curled while torpid |
| `PHOTOSYNTHESIS` | energy from sunlight on land (less under a canopy) | land speed × 0.7; burn, so it starves faster in the dark | `leaves`: green tint |
| `GLOW` | in darkness sees others at full range | in darkness everyone sees it at full range (hunters too); burn | `glow` |

The rare genes act **beside the phenotype**: `phenotype()` is a function of the genes
only (the renderer ports it), and `rare.adjust` changes the carriers' body values
afterwards (`rare.body_of`); `Fauna.body` holds the result. What is not a body value is
read by the fauna tick: torpor (`Fauna.torpid`), sunlight, sight in the dark, the kill
odds of toxic prey, and amphibians' ease in water.

**Darkness** comes with M8. Until then daylight is 1 (`Fauna.set_daylight`, like
`Flora.set_daylight`): sight is never dimmed, so glow pays only its cost, photosynthesis
never lacks light, and hibernators sleep through winter only. In the dark every creature
sees others out to `night_sight` (0.3) of its sense range, scaling up to the full range
in daylight; smell is unaffected.

The renderer draws each gene by its signature key (`rare.CREATURE_SIGNATURES`,
`rare.signature_table()` for the wire protocol); only `GIANT` changes the body's size.
Decisions: ADR 0015.

## Measured behaviour (M4 report, 20 seeds × 3 sim-years)

See `reports/M4-fauna-evolution/`. Targets from CLAUDE.md §8, and how they are read:

- Total extinction in `[< 20%]` of seed-years: the last creature died at some point in
  that year.
- Mean genetic distance from the ancestors rising: higher at the end than at two thirds
  of the run, in ≥ 80% of seeds.
- Herbivores and predators present at year 3 in `[≥ 60%]` of seeds: at least 3 of each.

## Open

- M5 (done, ADR 0009): learning tracks the local plants (diet fit +0.29, positive in 20
  of 20 seeds), but the feeding gain it buys is small (about +5 %); evolution keeps the
  learning rate low; learning shields the genes (the inherited diet bias stays lower
  than without learning), so there is no Baldwin trend.
- Predator lineages are cyclic: they persist on the island for up to about 16
  generations, and are fewer late in learning worlds than in non-learning ones. Hunters
  died mostly of starvation (half before maturity); with scavenging they are present
  about as often as in M4 (≥ 3 predators in 60 % of years 1–3).

- The mean diet gene of the founders' descendants stays near 0.1 or below: herbivores
  never evolve into predators (no omnivores in any run); hunters only come from arrivals.
- Creatures graze every plant form alike (same bite rate); forms differ only through the
  plants' genes (defence).
- No aquatic food: swimmers must feed on land.
