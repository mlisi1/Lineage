# 0019 — Long-run tuning

- **Status**: in progress (M11)
- **Date**: 2026-10-20

## Context

M11 tunes the island once, after every feature is in (ADR 0011). It is done when every
M2–M10 criterion passes at the same time and the mean genetic distance from the ancestors
is still rising at year 3. `docs/m11-plan.md` holds the evidence collected from M5
onward. Three criteria come to M11 already failing, deferred here by the owner: M6.1
(species band), M8.1 (selection on night traits) and M5's feeding gain (reported
without a band).

The owner answered the M11 brief's three questions at the start (2026-10-20):

1. **Engagement targets.** The targets in `m11-plan.md` §1 are accepted as written. A
   world should end **rarely, about once a decade**: today's difficulty stays roughly
   as it is, and tuning does not try to make worlds end more often. Measured as
   `worlds_ended` per seed-year, at most 0.1, reported but not judged.
2. **Scope.** **Numbers first, then mechanisms.** Sweeps change `default.toml` only.
   Where a criterion still fails afterwards, a mechanism change (a prey refuge in cover,
   assortative mating, a different glow, dropping `SOCIAL` or trial-and-error learning,
   schema bumps) is proposed with evidence and goes ahead only after the owner agrees.
3. **Compute.** 8–10 worker processes on the shared PC, sweeps of about 30–60 points
   (10–20 hours in all), the load checked before each run; then 10-year runs on about
   five seeds.

## Method

- **Tuning seeds 0–19, held-out seeds 20–39**, both under the office schedule. The
  held-out seeds are run only with the defaults and the final config, never inside a
  sweep.
- **One score for every criterion** (`tools/tune/score.py`). A sweep point is one
  20-seed × 3-year office run. Every milestone module that reads a single run
  contributes its metrics and criteria: M2, M3, M4, M5.1 (diet fit, from the run
  alone), M6, M7, M9 and M11.1. The step-time budgets (M2.5, M4.4, M5.3) measure the
  shared PC's load as much as the island, so they are left out of sweeps and checked in
  the final runs. So are M5's fork and baseline readings and M8's schedule comparison,
  which need several runs each. Points are ranked by failing criteria, then by shortfall
  (how far outside its band each failing value lies, relative to the bound).
- **Latin-hypercube sweeps** (`tools/tune/sweep.py`), then rank correlations of every
  metric with every lever (`tools/tune/sensitivity.py`).

## Findings

(Filled in as the sweeps land.)

- **Held-out check of the M10 defaults** (`m11-heldout-base`, seeds 20–39, office, 3
  years, 18 min at 10 jobs): the same two criteria fail as on seeds 0–19 (`m9-office`),
  and nothing else does, so M2–M10's tuning did not overfit its seeds. M6.1 is 82 %
  (target 90 %; 80 % on 0–19), and M3.5 has 2 seeds without closed forest in 3 years (see
  below). M4.3 is 0.69 (0.63 on 0–19). Predators are present for 52 % of inhabited time
  and omnivores for 23 %. No world ended, and there are 15 notable booms and crashes a year.

- **M2.5 measures the wrong thing now.** Its 25 ms budget dates from M2, when the world
  held only terrain. A whole inhabited world takes about 390 ms per sim-day on this PC,
  and M4.4's 400 ms is the whole-world budget. To be settled before the final report.
- **M3 is judged over 5 years** (CLAUDE.md §8). In 3-year office runs, 2 of 20 seeds
  have no closed forest by the end of the run (M3.5). The final M3 check must use a
  5-year run.

## Second round with the owner (2026-10-20)

The first sweep (`fauna-1`) was stopped after 15 of its 31 points, kept as a map of the
predator levers. Looking at the island as an evolving world rather than as a list of
numbers, the owner asked for criteria on diversity (every gene should have conditions in
which it can thrive, eventually) and on the balance of hunters and grazers. Measured on
today's defaults (seeds 0–19 and 20–39):

- **Genes without a niche.** Swimming (`AQUATIC`) is high in no seed's final population:
  there is no food at sea. Large size and meat-eating are high in 10–25 % of seeds; the
  founders' descendants never become hunters.
- **Rare genes that never establish.** Holding ≥ 5 % of their population for ≥ 30 days:
  hibernation in 20–35 % of seeds, venom, giant, glow and toxic in 5–15 %, and four plant
  genes (fire-pine, nitrogen-fixer, poisonous, fruiting) in none.
- **Hunters are scarce.** Predators are about 1–2 % of creatures, and ≥ 3 of them live on
  57 % of inhabited days after year 1.

Decisions:

1. **New criteria D1–D3** (`tools/tune/score.py`). D1: every gene (looks aside) has a
   niche, meaning both ends of its range each hold ≥ 10 % of creatures at some time.
   D2: every rare gene thrives (≥ 5 % for ≥ 30 days) somewhere. D3: predators are a
   real share of creatures and present most of the time. Reported now. They become M11
   pass/fail criteria once the mechanisms below are in, with bands proposed from what the
   island then reaches. Proposed bands: D1 ≥ 30 % of seeds, D2 ≥ 20 %, D3 predators
   3–20 % of creatures and ≥ 3 present on 80 % of inhabited days after year 1.
2. **Photosynthesis stays.** It swept herds only in constant light (M7). In office light
   it is held back (0.7 ‰ median, M8), so the score now watches it (a majority of
   creatures for a month in any seed) and `photosynthesis_rate` is the fix if it ever
   sweeps.
3. **Five mechanisms, one at a time**, each with tests and an on/off comparison before
   the next: food at sea; tall plants only tall bodies reach; cover for prey in dense
   woody growth; fruit seeds carried by the grazers that eat them; dung and carcasses
   feed the soil. Tuning resumes after them (ADR 0011: features first, tune once).

### Mechanism 1: food at sea (schema v11)

Algae grow on sea cells no deeper than `algae_max_depth` (0.03, about 5 % of the map)
where no plant stands, logistically towards `algae_capacity` (0.4) with daylight, rain
and the season. Grazers eat them where they swim, for `algae_meal_share` (0.8) of a
plant's energy. A creature smells them in proportion to its ease in water (its `AQUATIC`
gene, or fully if amphibious), so the food it senses is land plants + ease × algae and a
land animal is not lured out to sea. Meals of algae teach nothing about plant forms.
`algae_capacity` 0 turns them off. Migration `v10_to_v11` adds an empty algae grid; the
next flora tick sows the shelf. Design: `plants.md`, "Algae"; `creatures.md`, "Life".

**Measured** (seeds 0–19, office, 3 years; `m11-algae-on` against `m11-algae-off`,
which reproduces the defaults metric for metric, so the switch is clean):

- The algae stand mostly uneaten (mean 0.30 of 0.4). 2 % of creatures are in water;
  the median `AQUATIC` gene ends at 0.10 (max 0.35). **D1 for `AQUATIC` is unchanged at
  1 seed in 20**, a stranger species in either run. Food alone does not open the niche:
  a land animal pays the full water penalty as soon as it wades into the shallows, and
  barely smells algae, so there is no gentle path from shore to sea. To try in the
  tuning sweep: `water_stress`, `aquatic_land_slowdown`, `algae_meal_share`; as
  mechanisms if numbers fail, wading without penalty on the shelf for anyone, or
  stranger groups that are swimmers (as half of them are hunters).
- Indirectly, predators rose (1.2 % → 5 % of creatures; present 53 % → 60 % of days
  after year 1), and M3.2 moved from 21.4 to 25.1 months. **M3.2's median is fragile**:
  forests close in two clusters, the second summer (about 21 months) or the autumn
  after (about 27 months), and the median falls between them; a few seeds crossing
  over shift it by four months. M3's report should show the distribution.

Alternatives considered: an aquatic plant form inside the plant genome (entangled with
temperature, fertility and dispersal; a separate grid is simpler and cheaper); a new
brain sense for sea food (changes the brain's size and every saved brain; weighting the
food sense by ease in water needs no new weight).

## Decision

(Pending the mechanisms and the sweeps.)

## Consequences

(Pending.)
