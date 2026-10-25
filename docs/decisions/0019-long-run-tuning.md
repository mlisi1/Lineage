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

### Mechanism 4: seeds carried by grazers (schema v13, built 2026-10-21 after R4)

Seeds of fruiting plants travel in the gut of the grazer that ate them and are dropped
where it goes. A grazer on a fruiting plant swallows one seed at `[fauna]
gut_seeds_per_hour` (0.5 per hour of full bites; one at a time) and drops it
`gut_passage_hours` later (12 h, × 0.5–1.5 at random) on its cell, where it establishes
as any seed does (`Flora.drop_seeds`). Each creature's gut is saved (`gut_genome`,
`gut_rare`, `gut_h`): schema v13 on R4's v12, `v12_to_v13.py`, fixture `v13.lzma`. The
stand-in it replaces (fruit's far seeds as if wind-borne) is `[flora] fruit_by_wind`,
false now; the M11 report's "gut seeds" off run turns gut seeds off and the stand-in on.

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

### Sweep `mechanisms-2` (stopped at 13 of 31 points)

Narrowed by `mechanisms-1`: body mutation 0.035–0.055, later founding (cover 0.5–0.7),
predator levers where D3 passed. **The mutation trend did not extrapolate.** Past about
0.037 the herd becomes one continuous cloud: species alive fall from a median of 9 (at
0.025) through 6 (0.037) to 2 (0.055), splits stop (M6.2 1.17 → 0.80 → 0), and M6.1
falls with them (0.89 at 0.037, 0.32 at 0.053) as the island spends more time below the
band. M6.1 peaks near a mutation of 0.036; what it misses there is mostly the months after
founding with one or two species. The sweep was stopped, the rest of its points lying in
the collapsed range.

### Sweep `species-1`

Mutation kept in its sweet spot (0.025–0.038), and the species definition swept with it
(`[species] link_distance` 0.025–0.045, `min_members` 5–10; nothing in the sim reads the
census, so these change the counting, not the creatures), more variation among founders
(`founder_spread` 0.04–0.12) to shorten the one-species phase, and the predator and
founding levers where D3 and M3.5 passed.

**Stopped at 13 of 31 points** (2026-10-21; paused at 5 at 16:35, resumed at 17:10, stopped when strangers were removed, below). In its first points the species
definition moves M6.1 and M6.2 hard: at a link distance of 0.034–0.040 with mutation
0.027–0.029, the census finds many small species (2.8–3.8 splits a month) and M6.1 falls
to 0.23–0.37, mostly above the band. The best point, p004 (mutation 0.030, link 0.036,
founder spread 0.10), fails only M3.5 and M6.1 (0.77) among the M criteria and passes
D1 (0.45) and both D3 (predators 9.5 % of creatures, present on 86 % of days); p001
(mutation 0.036, link 0.031) reaches M6.1 0.89 but speciation 0.58. M3.5 failed in all
four sampled points, despite founding at cover 0.5 or more.

### Fourth round with the owner (2026-10-21): what the criteria judge, and a closed island

The owner's aim, in their words: "an interesting and balanced ecosystem that keeps
interesting over the years". Looking at why criteria fail rather than at their numbers
(`species-1`, 13 points), three of them judged the wrong thing:

- **M3.5 (no closed forest) is mostly open woodland.** In the failing seeds trees are
  there (p001 seed 1: broadleaf and conifer on 36 % of the land at year 3) but no cell
  holds a closed canopy (biomass ≥ 0.55). Their herds are much bigger (size gene 0.50–0.64
  against 0.33–0.43 in the passing seeds of the same point) and tree cover is half (0.09–0.17
  against 0.32–0.34): since the reach mechanism, big browsers keep the woods open, like a
  wood-pasture. The criterion dates from M3, without animals. **Decision**: a tenth of the
  seeds may stay open (`seeds_without_succession.share` ≤ 0.1); M3 is judged over 5 years.
- **M6.1 misses by its founding months.** The founders are one species; at the defaults
  the median seed takes 79 days to reach 3 species, 10 % of a 3-year run (about 2 % of a
  world of a decade), and after that it stays in the band (0.90). **Decision**: M6.1
  counts from the first day with 3 species, or a season (91 days) after founding,
  whichever comes first (`species_alive.in_band_after_founding`); the share over every
  inhabited day is still reported. `[species] link_distance` and `min_members` only
  change how the census counts, so tuning them to the band would redefine a species
  until it passes: they stay at the M6 values (0.035, 8) and are no longer swept.
- **D2's test does not fit plant genes**: fire-pine and mangrove are niche genes and can
  thrive in their niche without holding 5 % of all vegetation. To revisit with the plant
  sweep (after R4).

**Strangers removed** (the owner's proposal, 2026-10-21). Every predator lineage on the
island descended from strangers: at the defaults, 135 predator species arrived and 40
split from them, none from the founders' herd (p000, p004 of `species-1`). Six random
groups a year kept the hunters, part of the diversity (D1 followed immigration, ρ +0.53)
and dying herds supplied from outside. Without them every species descends from the
founders, and a niche that fills is one evolution filled. Built:

- `[fauna] immigrant_groups_per_year = 0` (the switch stays, for comparison runs).
- **Hunters are the second wave of founders**: once the herd (every non-predator)
  reaches `hunter_wave_herd` (120), a pack of `hunter_wave_count` (8) hunters lands, in
  spring or summer, once per world (never where a lineage already arrived as hunters;
  the founding record, `Fauna._ancestors`, tells, so the save is unchanged: no schema
  bump).
- **The ark brings hunters** when the herd has reached `hunter_wave_herd` and no predator
  is alive; the island then needs the ark fully (need 1).

To measure: whether predators persist and evolve again after dying out (3 years on 20
seeds, then 10 years on 5), how often worlds end without the rescue of strangers (the
owner's ceiling: about once a decade), and D1 without random genomes landing.

### Seeds in guts, R4 merged, the button: the mechanism set complete (2026-10-21)

The owner asked whether every mechanic was in before tuning ("I'm afraid we're leaving
something out"). An audit against what a run exercises found three gaps, all closed
before any further sweep: R4's sim changes were not yet in `m11-tuning` (merged,
`4d41ec4`); seeds in guts were not built (mechanism 4 above, `a7ab1d5`); and no run ever
pressed the god-power button, while the owner expects to press about once a week
(`fastforward --press-every-days 7`; tuning runs press nothing, so the island must stand
alone, and the tuned island is checked with weekly presses). Power cuts only test exact
resume; the species census and chronicle only watch.

### The closed island, first run (`m11-closed-office`, 2026-10-21)

3 years × 20 seeds (0–19), office, defaults at `a7ab1d5`, against `sweep-species-1/p000`
(the defaults with strangers, before R4 and gut seeds; so the difference is all three).

| | with strangers | closed |
|---|---|---|
| M4.3 both diets present in year 3 | 0.60 PASS | 0.08 FAIL |
| M6.1 species in band (after founding) | 0.88 | 0.94 PASS |
| M6.2 splits a month | 1.17 | 1.07 PASS |
| M7.2 no long fixation | 0.90 PASS | 0.80 FAIL |
| M3.5 seeds without succession | 0 | 0 PASS |
| D1 lowest gene's niche | 0.20 | 0.00 |
| D3a predators' share | 0.020 | 0.000 |
| D3b predators present after year 1 | 0.53 | 0.17 |
| worlds ended per seed-year | 0 | 0 |

Every other M criterion passes in both. **Predators do not last**: the hunter pack lands
in all 20 seeds, a few days after the herd reaches 120, grows to the cap of 16 within
weeks and dies out after a median of about 75 days; only seed 10 keeps hunters to the end
(seed 14 to day 950). Hunter species split only from the pack; none evolved from the
herd. One pack capped at 16 booms and busts on a herd that has never met a hunter, and at
that size a bad season ends it; strangers used to land a new pack every few months.
**Diversity came partly from strangers**: D1 falls to 0 (armour and swimming never reach
their extremes within 3 years from one founding genome), and longevity sweeps the herd
in 4 seeds (M7.2), with no newcomers competing.

To try next: weekly presses (the ark is drawn about half the time when a herd of 120 has
no hunters), 10 years on 5 seeds (does D1 come with time), and a sweep including the
predator levers (`predator_cap`, `hunter_wave_count`, `hunter_wave_herd`, `meat_energy`,
`defence_toxicity`). If hunters still cannot persist without the god, a mechanism by which
they arise from the herd (scavenging into omnivory) goes to the owner first.

### Hunters that find their prey; the first weekly presses (2026-10-22)

Replays of `m11-closed-office` seeds (hunters' deaths by cause, kills, distances)
showed the pack starving among plenty, for two reasons in the wave itself: it landed on
a random green spot, 22 cells on average from the nearest prey (prey within striking
reach on 0.3 % of its ticks), and it was built at least medium-sized like strangers'
hunters (mass 3–5) among founders of mass 0.3, so a kill paid 2.8 days of rest. Hunters
(the pack and the ark's) now land by a member of the herd (`hunter_landing_cells`) and
are built a little larger than it (`hunter_size_margin`). Replayed, seed 7 kept its
hunters 80 days instead of 20 and seed 4 held a pack at its cap beside a full herd for
about 200 days; seed 0 still lost its pack in 40. What remains (kills few and unevenly
shared, young starving, a cap of 16) is for the sweep `closed-1`.

**Weekly presses** (`m11-closed-presses`, with the fix above): hunters present 73 % of
days after year 1, 4.9 % of creatures (M4.3 0.69 PASS); but the island asked for the ark
as soon as it was empty, and arks landed plant eaters on bare ground in the first weeks,
which starved: 2–5 extinctions per seed (M4.1 0.33), one world ended. God-power entries
were 44 % of the notable ones (M9.2 0.40), and weekly seed and rain brought the first
closed forest at 8.6 months (M3.2). **The owner (2026-10-22)**: the ark is not drawn on
an empty island until it is green enough for founders (`Presence.closed`); god-power
entries stay major (importance 4, pushed); every M criterion is judged on runs without
presses, and the weekly-press run only checks for harm (extinctions, worlds ending,
predators, the chronicle's flood). Of the 3,085 presses, 42 % were rain, 31 % seed,
17 % ark, 10 % meteor.

### Ten years without presses (`m11-closed-10y`, 2026-10-22)

5 seeds × 10 years, office, no presses, defaults at `be75730` (hunters land by the herd).
Hunters vanish by year 3 in every seed and never return: present on 12–72 % of days in
year 2, 0 % in years 3–10. Nothing else makes hunters: no herbivore lineage turns into
one in a decade. The rest holds: no world ended, the herd at its cap, genetic distance
still rising at year 10 (+0.014), 9 species alive (median). D1 stays 0 (very armoured or
fully aquatic bodies in 1 seed of 5); in 3 seeds of 5 a rare gene stays fixed for long.

So on the island alone, levers cannot keep predators past their first boom and bust; the
first two `closed-1` points (cap 16 and 31) agree (M4.3 0.17 and 0.13). **Open, for the
owner**: rely on the weekly presses (the ark returns hunters, within the rule of
founders and god powers) and judge predators on press runs, or approve a mechanism by
which hunters arise from the herd (scavenging carrion into omnivory). The sweep is
stopped at 2 of 31 until then.

### Sweep `closed-1` and the second press check (2026-10-22 evening, overnight)

**Weekly presses with the ark rule** (`m11-closed-presses-2`, 20 seeds × 3 years,
office, at `43d0535`), against the first press run: early extinctions gone (M4.1 0.33 →
0), no world ended (was one), hunters present on 77 % of days after year 1 (73 %), 5.7 %
of creatures, M4.3 0.71. With weekly seed and rain the forest closes at 7.9 months and
M3.5 is 0.45: not judged on press runs (the owner, 2026-10-22).

**`closed-1`** (Latin hypercube, 10 levers, seeds 0–19, office, no presses): stopped by
the owner at 23 of 31 points (p000–p001 at `be75730`, p002–p022 at `43d0535`; the only
difference, the ark rule, acts only on presses). M4.3 fails at every point (best 0.29 at
p021, band ≥ 0.6); D1 is 0 at every point; hunters are present on at most 43 % of days
after year 1. The best points fail only M4.3 among the M criteria: p021 (cap 26, meat
2688, hunt below 0.68 of capacity, pack 14, size margin 0.24, cover 0.46, toxicity 0.44,
mutation 0.029, founder spread 0.054, longevity cost 0.29: M6.1 0.96, M3.5 0, D3b 0.43),
p018, p004. Failing elsewhere: M3.5 in 12 points, M6.2 in 8, M7.2 in 4, M6.1 in 3.
Rank correlations over 22 points (|ρ| < 0.43 is noise): hunters' presence follows the
pack's size (M4.3 +0.58, D3b +0.49) and build (`hunter_size_margin`, D3b +0.58);
`predator_cap` does not help; body mutation lowers speciation (−0.69).

So levers raise the hunters' first stay but cannot bring them back: on the island alone,
predators end with their pack. Open for the owner: rely on the weekly presses, or a
mechanism by which hunters arise from the herd.

### Hunters from the herd (the owner, 2026-10-23)

The owner: the weekly presses cannot be relied on to keep predators. Why no herbivore
lineage ever became a hunter: a hunter never attacks its own kind, and its own kind is
everyone it could mate with (`compat_distance` 0.10, mean gene difference). On a closed
island the herd is one interbreeding cloud, and a lineage drifting toward meat moves one
gene of fourteen (even 0.15 → 0.65 is a mean difference of 0.036), so it stays kin to the
whole herd and finds nothing it may hunt: meat never pays on the way, and selection has
no gradient to follow. The pack and strangers worked only because they were never kin.

**Decision**: a hunter may attack kin that eat far more plants, a diet gene at least
`[fauna] prey_diet_gap` (0.3) below its own; similar diets still spare each other.
Nature has it: the carnivore morph of spadefoot toad tadpoles and the cannibal morph of
tiger salamander larvae eat their own, more herbivorous kin. No saved state changes. Off
with `prey_diet_gap = 1.0` (the M11 report's "hunters from the herd" off run).

To measure: whether hunters arise again after the pack dies out (10 years, 5 seeds, no
presses, against `m11-closed-10y`), and M4.3/D3 on 20 seeds over 3 years (against
`closed-1` p000); risks: cannibal booms crashing the herd, omnivores everywhere, fewer
species (M6).

**Measured (2026-10-23).** The rule alone did nothing: in 10 years on seeds 0–4
(`m11-kin-10y`) hunters behaved exactly as without it, because the herd's diet drifts the
other way (mean 0.10 → 0.05) and nobody reaches the gap; 3 years on 20 seeds
(`m11-kin-office`): M4.3 0.12 against 0.17, noise. Meat must pay on the way up: with
`diet_exponent` 1 a creature of diet 0.3 absorbs 70 % of plant and 30 % of meat energy,
and before it can kill its only meat is carrion. A gentler trade-off (`diet_exponent`
< 1: generalists absorb more of both) opens the path. 10 years on seeds 0–4, hunters
present on most days of years 4–10: exponent 0.7 with gap 0.3 or 0.2, 1 seed of 5;
exponent 0.5, gap 0.3, 2 seeds (one world ended); **exponent 0.5, gap 0.2, 2 seeds, where
hunters died out and evolved again from the herd for good** (3 hunter species from the
herd). On new seeds 5–9 (`m11-diet-10y-b` against `m11-kin-10y-b`): hunters back in
seeds 8 and 9 (present 0.67 and 0.71 of years 4–10), partly in 6; the baseline, none; one
world ended in 50 seed-years. 3 years on 20 seeds (`m11-diet-office`): M4.3 0.53 (0.17),
D3a 7.4 % PASS, D3b 0.63 (0.26); every other M criterion passes (M4.4 read 677 ms on a
PC at load 64, not judged), no world ended, 8 species. **But where hunters come back the
whole herd turns omnivore** (about 190 of 200 at year 10, mean diet 0.6): hunters return
by way of omnivores, and grazers almost vanish. A grid of `diet_exponent` 0.6/0.65 ×
`prey_diet_gap` 0.15/0.2 (10 years, seeds 0–9) looks for the middle.

### References

- Pfennig, D. W. (1990). The adaptive significance of an environmentally-cued
  developmental switch in an anuran tadpole. *Oecologia* 85, 101–107 (spadefoot carnivore
  morphs).
- Collins, J. P., & Cheek, J. E. (1983). Effect of food and density on development of
  typical and cannibalistic salamander larvae in *Ambystoma tigrinum nebulosum*.
  *American Zoologist* 23, 77–84.

### Two islands, and why: the diet grid and the meat exponent (2026-10-23)

**Diet grid** (`m11-grid-e{0.6,0.65}-g{0.15,0.2}`, 10 years × seeds 0–9, office, no
presses, at `e8bba5f`). Seeds settle into one of two islands: grazers without hunters, or
omnivores with hunters (hunters evolve out of the omnivores, which then outcompete the
grazers). Best, `diet_exponent` 0.6 with `prey_diet_gap` 0.2: hunters present on most days
of years 4–10 in 3 of 10 seeds, and with more than 30 % grazers in only 1 (seed 7: hunters
0.68, grazers 0.47); no world ended. 0.6/0.15: 4 of 10, none with grazers; 0.65/0.15: two
worlds ended.

**A meat exponent apart from the plant one** (`[fauna] meat_diet_exponent`, `d1990f2`,
default 1.0, no change): plants stay linear so grazers keep their edge, and a little meat
pays. 10 years × seeds 0–9 (`m11-meat-m{0.6,0.5,0.4}-g0.2`, `m11-meat-m0.5-g0.15`):
hunters on most of years 4–10 in 1–3 seeds of 10, **never together with more than 30 %
grazers**; worlds ended 0–4 (4 at gap 0.15). 3 years × 20 seeds (`m11-meat-office`, 0.5 /
0.2): M4.3 0.16, D3b 0.30, M6.2 0.98 FAIL; no better than the defaults. The single
exponent at 0.5 stays the best 3-year result (`m11-diet-office`: M4.3 0.53, D3a 7.4 %
PASS, D3b 0.63).

**Diagnosis.** The split is about the hunters, not the herd's diet. Hunters that last are
ones that also eat plants (diet about 0.65–0.75, evolved from omnivores, grazing between
kills); pure meat-eaters starve among plenty of grazers, as the first pack did (replays,
"Hunters that find their prey"): too few kills, because prey flee more strongly than
hunters chase (`instinct_flee` 2.0 against `instinct_prey` 1.6), the striking reach is
short (`reach_cells` 1.2) and a strike costs energy (`attack_cost`). No sweep has touched
these hunting levers yet. **Next**: 10-year runs on the hunting levers, combined with the
best diet setting (one exponent 0.6, gap 0.2), aiming at hunters that live on grazers.

### The hunting levers, and what replays show instead (2026-10-24)

**Levers, one at a time** (`m11-hunt-*`, 10 years × seeds 0–9, office, no presses, on
`diet_exponent` 0.6 and `prey_diet_gap` 0.2, at `86452c5`; chains
`runs/m11-chain-2026-10-24{,b}.sh`). Judged per seed: hunters present on at least half
the days after year 3, and grazers more than 30 % of the creatures after year 5. The
baseline (`m11-grid-e0.6-g0.2`) passes in 1 seed of 10 (seed 7).

| Run | Change | Seeds passing | Worlds ended |
|---|---|---|---|
| `prey2.0`, `prey2.5` | `instinct_prey` 2.0, 2.5 | 0, 1 (seed 8) | 1, 2 |
| `reach1.6`, `reach2.0` | `reach_cells` 1.6, 2.0 | 0, 0 | 0, 1 |
| `rate5` | `attack_rate` 5.0 | 0 | 1 |
| `cost0.5` | `attack_cost` 0.5 | 0 | 0 |
| `night0.6`, `night1.0` | `night_sight` 0.6, 1.0 | 0, 0 | 0, 4 |

No lever helps; stronger hunting tends to end more worlds. Two levers are weaker than
they look: `instinct_prey` only shapes the brains of creatures that land (the pack, the
ark; `founder_weights`), not hunters born in the herd; and `reach_cells` is also the
mating distance, so it changes breeding across the herd too. `night_sight` 1.0 (no
darkness at all) was a diagnostic: blindness at night is not the block.

**Replays** (seeds 0, 6, 7 for 5 years, with `attack_cost` 0.5; hunters are creatures
with diet ≥ `predator_min_diet`, tallied per quarter-year by wrapping `Fauna._bury` and
`Fauna._hunt`):

- A hungry hunter has prey within striking reach on about 1 % of its ticks (0.2–3 %),
  the nearest prey a median 10–30 cells away, and most hunters die starved (the rest of
  old age). Yet the hunters' mean energy stays at 0.7–0.8 of capacity: with a diet
  near 0.7 they graze between kills.
- **Both hard caps bind for years.** In seeds 6 and 7 the herd sits at
  `population_cap` 200 and the hunters at `predator_cap` 16 from the first year to
  the fourth: births, not food, set both numbers, and the pack (16 of 216, 7 %) is
  far too small to buffer a bad season.
- **The herd evolves larger and faster under the hunters**: grazers' mean mass 0.4 → 2–4,
  and in seed 7 their speed (2.2 → 3.0 cells an hour) catches the hunters' (about 3).
  Kill chance falls with the prey's defence (mass × armour) and with its speed.
- **The end is the same in both**: kills rise two- to threefold for a few quarters, the
  herd falls (200 → 82 in seed 6, 200 → 78 in seed 7), and the hunters starve out
  within a quarter or two. Seed 0's pack never reached its cap and was gone in the
  second year.

**Reading.** Hunters do not fail for want of kills while the herd is full; they fail
when it dips, because a capped pack of 16 has no numbers to lose and every hunter is
hungry at once. The hunting levers act on a stage that is not the bottleneck. What
might act on it (none tried; mechanisms are the owner's):

1. **Soft caps**: births slowed by crowding instead of a hard stop at 200 and 16, so the
   herd's and the pack's numbers answer to food and kills (and the pack can grow when
   prey is plenty).
2. **Hunters that wait out lean times**: a lower resting burn for hunters, or torpor
   when hungry (as HIBERNATION already does for its carriers), so a pack survives the
   herd's dips.
3. A **separate hunting reach** from the mating distance, if reach is tuned later.

### Soft caps and resting hunters: predators that last (2026-10-25)

**Soft caps** (the owner's choice, `df17921`): a pair that may breed first waits, on
average `crowding_wait_days` (5) × c / (1 − c), with c = (N / cap)^`crowding_exponent`
(4) per kind; none on a sparse island, without end at the cap, which stays a ceiling.
Off (`crowding_wait_days` 0) keeps every draw as before. 10 years × seeds 0–9 on diet
0.6 / gap 0.2 (`m11-soft-*`): alone 0 of 10 seeds keep hunters beside grazers (the pack
now settles below 16); with `predator_cap` 32, 1 of 10 (seed 7: a pack of 25–30 beside
about 180 grazers for ten years); 48, 1 of 10. Packs fill the room and still die in
years 2–4. On today's defaults (3 years × 20 seeds, `m11-soft-office`) soft caps cost
nothing elsewhere and lift M6.2 from 0.94 to 1.19.

**Why packs still died** (replays of six seeds, `predator_cap` 32,
`runs/m11-replays/`): either the pack ate a young herd out (127 → 3, 37 → 0, 117 → 14)
and starved before it regrew within a year, or it starved slowly beside a full herd as
prey grew heavier (seed 3: prey mass 0.44 → 1.15, hunters' energy 0.74 → 0.59). A body
of mass 1 starves in about 6 days.

**Resting hunters** (the owner's choice, `f71d2a8`): a hunter (diet at or above
`predator_min_diet`) burns `hunter_rest_share` of its basal burn at rest; moving costs
the same. Ambush and pursuit predators alike spend most of their time resting and go
far longer between meals than their prey (references). 10 years, soft caps,
`predator_cap` 32, judged as above (`m11-rest*`):

| Diet | `hunter_rest_share` | Seeds 0–9 | Seeds 10–19 | Worlds ended | Hunters' share, median |
|---|---|---|---|---|---|
| 0.6 / gap 0.2 | 1.0 (off) | 1 | — | 0 | 0.1 % |
| 0.6 / gap 0.2 | 0.5 | 4 | — | 0 | 8.3 % |
| 0.6 / gap 0.2 | 0.3 | 6 | 9 | 1 | 11.7–14.4 % |
| today's (1.0 / 0.3) | 0.3 | 6 | 7 | 2 | 13.5–14.1 % |
| today's (1.0 / 0.3) | 0.2 | 8 | 7 | 0 | 16.8 % (0–9) |

Grazers stay above 75 % of the creatures in the median seed of every row: hunters no
longer need an omnivore herd. Resting hunters make the gentler diet unnecessary.

**M6.1's band** (the owner, 2026-10-25): with hunters that last, species split more
(the 3-year run spends 39 % of the time above 12 species, median seed 12, range 6–15;
below 3 unchanged at 8 %), and M6.1 fell to 0.545. The species definition stays fixed;
the band is now **3–16** species (`tools/milestones/m6.py` `ALIVE_BAND`).

**Defaults set**: `predator_cap` 32, `hunter_rest_share` 0.2, soft caps on, the diet as it
was. 3 years × 20 seeds, office, no presses (`m11-rest0.2-office`): **every M criterion
passes** (M4.3 0.91, M6.1 1.00, M6.2 1.71, M4.4 430 ms); D3a 13.7 % and D3b 0.92 pass
the proposed bands; D1 and D2 still 0. The best-diet alternative (0.6 / 0.2, rest 0.3,
`m11-rest0.3-office`) also passes everything, with one world ended in 20 ten-year seeds.

**Held out** (seeds 20–39, never used in tuning): 3 years × 20 (`m11-tuned-heldout`)
every M criterion passes (M4.3 1.00, M6.1 0.98, M6.2 1.65, M3.5 0.05, M4.4 442 ms; D3a
14.0 %, D3b 0.94); 10 years on seeds 20–29 (`m11-tuned-10y-s20`) hunters beside grazers
in 8 of 10, two worlds ended in seed 28. Over 30 ten-year seeds: 23 hold hunters beside
grazers, 2 worlds ended in 300 seed-years.

**D bands** (the owner, 2026-10-25). D1 took the worst gene, and swimming never finds a
niche on a closed island of walking founders (0 of 20 seeds; size 5–15 %; the other ten
genes 25–100 %). D2 took the worst rare gene, and hibernation, fire-pine, fruiting,
poisonous and amphibious (almost) never thrive. Now: **D1** at least 9 of the 12 body
genes find a niche in ≥ 25 % of seeds; **D2** at least 5 of the 14 rare genes thrive
(≥ 5 % of their population for ≥ 30 days) in ≥ 10 % of seeds; **D3** as proposed. They
are judged with the M criteria from now on. Today's defaults: D1 10 and 10, D2 5 and 8
(tuning and held-out seeds; D2 is at its edge on the tuning seeds), D3a 13.7 % and
14.0 %, D3b 0.92 and 0.94: **every criterion passes on both seed sets**.

References:
- Carbone, C., Teacher, A., & Rowcliffe, J. M. (2007). The costs of carnivory. *PLoS
  Biology* 5(2), e22.
- McCue, M. D. (2010). Starvation physiology: reviewing the different strategies animals
  use to survive a common challenge. *Comparative Biochemistry and Physiology A* 156(1),
  1–18.

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
