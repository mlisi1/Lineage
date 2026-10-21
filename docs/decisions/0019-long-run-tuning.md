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

- **M2.5 measured the wrong thing.** Its 25 ms budget dated from M2, when the world
  held only terrain. A whole inhabited world takes 350–450 ms per sim-day on this PC,
  depending on how busy the PC is. Settled with the owner (2026-10-20, below): M2.5 is
  retired and M4.4/M5.3 budget the whole world at 600 ms.
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

### Mechanism 2: reach (no schema change)

A creature reaches plants up to `reach_at_unit_mass` (0.5) × mass^(1/3), in the plants'
height units (`Flora.stature`). Of a taller plant it bites `browse_floor` (0.3) of a
full bite plus the share of the height it reaches, and it smells that plant's food the
same way. `browse_floor` 1 turns it off (and reproduces the run without it).

**Measured** (`m11-reach-on` against `m11-algae-on`, seeds 0–19, office, 3 years): the
median size gene rose 0.30 → 0.35; D1 for size 0.45 → 0.55 of seeds, for limbs
0.30 → 0.55, for swimming 0.05 → 0.15; M3.2 came back into its band (25.1 → 21.8
months); M6.1 0.81 → 0.83 and speciation 1.14 → 1.34 a month. Predators fell back
(5 % → 2.9 % of creatures) and omnivores too (23 % → 17 % of inhabited time).

### Mechanism 3: cover (no schema change)

Prey standing among plants taller than it reaches is hidden by the share of the plants'
height above its reach, times their density (biomass over a closed canopy); a kill's
chance is × (1 − `cover_protection` (0.6) × hidden). Small bodies hide in shrubs and
forest, large ones cannot, so size trades browsing against hiding. In a scenario of 40
one-on-one encounters in tall forest, hunters kill 26 small prey with cover against 38
without; in low grass, cover changes nothing. A refuge is the classic stabiliser of
predator–prey cycles (Křivan 2013, ADR 0009). `cover_protection` 0 turns it off.

**Measured** (`m11-cover-on` against `m11-reach-on`): the niches widened (D1 for diet
0.45 → 0.60 of seeds, armour 0.35 → 0.50, speed 0.35 → 0.55, size 0.55 → 0.60) and the
median size gene rose to 0.40, but hunters, already scarce, lost kills: predators fell
from 2.9 % to 1.5 % of creatures and **M4.3 fails** (0.61 → 0.56). Cover has to be tuned
with the predator levers (the second sweep pairs them).

### Mechanism 5: nutrients (no schema change)

A land cell gains `dung_fertility` (0.05) fertility per unit of plant biomass eaten there
and `carrion_fertility` (0.2) per unit of carrion that rots there. Herds keep their
pastures fertile; a kill leaves a rich patch. The saved state is the terrain's
fertility, as before.

**Measured** (`m11-nutrients-on` against `m11-cover-on`): **M3.5 passes** for the first
time in 3-year office runs (seeds without closed forest 2 → 0); M3.2 21.3 months. M4.3
0.53 and M6.1 0.80 still fail.

**Reading single runs.** The per-gene D1 shares moved by 0.15–0.25 between runs that
differ by one mechanism (swimming 0.15 → 0.00 with nutrients), which is about the
binomial noise of a share over 20 seeds (± 0.11). One 20-seed run cannot resolve a
change below about 0.2 in a share; the sweeps judge levers by trends over many points,
and the D1–D3 bands need more seeds.

### Third round with the owner (2026-10-20)

- **Wading.** Algae alone did not open the swimmers' niche (D1 for `AQUATIC` at 1 seed
  in 20 with or without them): a land animal paid the full water penalty as soon as it
  stepped into the shallows. Now no creature struggles in water no deeper than
  `[fauna] wading_depth` (0.03, the algae's shelf). Land animals can graze the shallows,
  slowly (they move at their swimming speed) and only smelling algae through `AQUATIC`,
  so swimming pays as the next step out. In six hours on the shelf a land grazer loses
  5 % of its reserve, against 12 % in deep water. `wading_depth` 0 turns it off.
- **Tune now, gut seeds later.** The tuning sweep runs with mechanisms 1, 2, 3 and 5
  and wading. Mechanism 4 comes after R4 reaches `main` (schema v13 on its v12), then a
  short re-check sweep.
- **Step budget.** The 400 ms per sim-day of M4.4 (and M5.3) was a PC-side guard, not
  derived from the device: on the board the sim uses far less than 1 % of a core
  (about 4 s of CPU per real day if the board is 10× slower), against the 25 % of
  CLAUDE.md §4.8. What a higher budget costs is turnaround on the PC (runs, sweeps,
  slow tests). Raised to **600 ms**; **M2.5 retired**. The sim is to be measured once on
  the Orange Pi before M11 closes, to replace the 10× estimate.

### Mechanism 4: seeds carried by grazers (waits for schema v13)

Seeds of fruiting plants travel in the gut of the grazer that ate them and are dropped
where it goes. That is per-creature saved state, so a schema bump: v13, after R4's v12
(weather, burnt deaths) reaches `main`. Until then fruiting plants keep their stand-in,
far seeds as if wind-borne.

### Sweep `mechanisms-1`

Every mechanism in (with wading), 12 levers, 41 Latin-hypercube points, seeds 0–19,
office, 3 years (`tools/tune/sweeps/mechanisms-1.toml`; points 0–22 at `145efe5`, the
rest at `7c32dfb` after a pause, same code). **No point passes every M criterion.**
Failing, out of 41 points: M6.1 in all (best 0.87), M3.5 in 30, M4.3 in 19, M6.2 in 13;
of the proposed criteria, D2 in all, D3b in 39, D1 in 35, D3a in 17. The defaults rank
first (only M6.1 fails, at 0.82); p021 passes D3 (predators 10 % of creatures, present
on 90 % of days) and M4.3 (0.87) but has M6.1 at 0.72; p023 reaches M6.1 0.87 but fails
M6.2.

Rank correlations over the 40 sampled points (|ρ| < 0.32 is noise):

- **M6.1** follows `mutation_sigma_body` (+0.84) and nothing else: more genetic spread,
  more clusters (as M6 found). Omnivores follow it too (+0.75). Speciation falls with it
  (−0.37).
- **Succession and world endings** pull the other way: seeds without closed forest
  (M3.5) rise with mutation (+0.35) and fall when founders wait for more plant cover
  (`founder_min_plant_cover`, −0.59); worlds end less often with later founding (−0.64)
  and a smaller predator cap (+0.33). Worlds ended in 17 of the first 23 points, up to
  0.1 per seed-year (the owner's ceiling); none in the defaults.
- **Predators** (D3, M4.3) follow `meat_energy` (+0.60 to +0.74) and
  `immigrant_groups_per_year` (+0.62 to +0.66), and fall with `predator_cap` (−0.28 to
  −0.38) and `defence_toxicity` (−0.30 to −0.33).
- **D1** (the lowest gene's niche) follows immigration (+0.53) and falls with the hunter
  share among strangers (−0.56).
- `cover_protection`, `browse_floor`, `algae_meal_share`, `dung_fertility` and
  `founder_count` move nothing beyond noise within their ranges.
- **D2 is held back by the plants.** Holding ≥ 5 % of the vegetated cells for 30 days,
  fire-pine and nitrogen-fixer thrive in no seed at any point; poisonous and fruiting in
  at most 5–10 %. Creature genes reach 0.15–0.45 at their best points. No swept lever
  acts on plant rare genes (`[flora] rare_gain_probability` and the genes' growth costs
  would), and "5 % of every vegetated cell" may be the wrong test for a plant gene.

The next sweep (`mechanisms-2`) narrows on these: higher mutation (0.035–0.055) with
later founding (cover 0.5–0.7), and the predator levers where D3 passes.

### R4's changes to the simulation

R4 (atmosphere, ADR 0021) changes the sim by the owner's choice, as schema v12 on top of
v11: a weather subsystem (fires start only in storms; `[flora]
fire_strikes_per_storm_hour` replaces `fire_ignitions_per_year`), fire burns animals
(death cause `BURNT`), and volcanoes and craters leave barren land for `barren_days`.
These move what M11 tunes (plant cover, succession, food, mortality, the chronicle), so
the tuned config is re-checked with a short sweep after R4 reaches `main`, together with
mechanism 4.

## Decision

(Pending the sweeps.)

## Consequences

(Pending.)
