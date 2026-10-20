# M11 plan — tuning the island to be engaging over years

Written 2026-10-18, at the end of M5, for whoever runs M11 (CLAUDE.md §8: "every M2–M10
criterion passes simultaneously; mean genetic distance still rising at year 3"). ADR 0011
decided to build M6–M10 first and tune once, here. This plan collects what M5 taught
about the island's balance, so that M11 starts from evidence instead of guesses. Revise
it as M6–M10 land; each milestone should add its own findings below.

## 1. Goal: what "engaging" means, in numbers

Passing the criteria is necessary, not enough. The gadget sits on a desk for years; it
must keep producing stories. M11 should tune for these, measured on held-out seeds:

| Quality | Measure (per seed, 3 and 10 sim-years) | Target to agree with the owner |
|---|---|---|
| Life persists | extinct seed-years; worlds that collapse (M10) | rare, and never over a weekend |
| Something happens | chronicle entries per sim-month (M9) | M9's band `[2–15]` |
| Variety | species alive at once (M6); diet classes; plant forms | M6's band `[3–12]`; omnivores and predators present most of the time |
| Change continues | genetic distance from ancestors still rising; speciation per month | M11 and M6 criteria |
| Drama, not chaos | booms and crashes per year; predator cycles | a few per year, no permanent collapse |
| Learning shows | diet fit (M5); learning events per month in the chronicle (M9) | diet fit positive in ≥ 80 % of seeds; learning visible in captions |
| The owner matters | survival of a 3-week absence and of every Long Night (M8) | none lost to a weekend; ≥ 80 % survive 3 weeks |

## 2. Method

1. **Tune under the real light.** Every M11 run uses the office presence schedule (M8):
   weekdays about 9:00–18:00, weekends dark (about 63 hours). Constant light is an
   ablation, not the default.
2. **Hold out seeds.** Everything in M2–M5 was tuned and reported on seeds 0–19, so it may
   be fitted to those 20 worlds. Tune on one set (for example 0–19), judge on another
   (20–39, never looked at while tuning), and report both. (The M5 check on 20–39 was
   started and stopped unfinished; run it first.)
3. **Sweep, don't nudge.** Build `tools/tune/` (CLAUDE.md M11): run a grid or random
   search over the levers in §3, 20 seeds × 3 years each, in parallel, scoring each point
   on all criteria at once. Then a sensitivity report: which levers move which criteria.
   One knob at a time is how M5 spent its time.
4. **Fork to find causes.** The forked-world tool (`fastforward --fork-days`) answers "is
   it A or B?" in a minute where a full run takes ten. Use it before changing a lever: in
   M5 it showed that the feeding gain came from exploring, not learning, and that
   learning prey were not harder to catch.
5. **Then go long.** Ten-year runs of the tuned world, about five seeds: slow effects only
   show there (genes for learning decaying once instincts suffice, traditions lost,
   predator lineages over decades).
6. **Mind the device.** A sim-day costs about 308 ms on the PC (M5); the device is about
   10× slower, but has a whole real day for it. The bound to watch is RAM and the daily
   save (≤ 2 s), as M6–M10 add state.

## 3. The levers, and what is known about them

Values as of M5 (`sim/config/default.toml`). History and evidence in ADR 0009.

**Predators** — the most fragile part of the island.

- `meat_energy` 1 600 (M4: 900). Raised so hunters survive in a learning world; with
  scavenging, 900 was worse (M4.3 0.56 against 0.66).
- Scavenging: `carcass_share` 0.5, `carrion_decay_hours` 72, `scavenge_rate` 0.5,
  `instinct_scavenge` 1.6. Added because hunters starved (509 of 570 hunter deaths;
  median age at death 11 days). It brought predators back to M4's level.
- `predator_cap` 16, `immigrant_groups_per_year` 6, `immigrant_hunter_share` 0.5:
  predators still depend partly on arrivals; lineages last up to about 16 generations.
- Ruled out by data: attacking more often (`attack_rate` 3.5 starved hunters: every
  attempt costs energy) and strike-or-hold (attack costs were 0.2 % of resting burn).
- **Structural option if cycles stay too violent:** a cover refuge (prey in dense woody
  growth are harder to kill). Literature: type III responses and refuges stabilise
  coexistence (Křivan 2013; ADR 0009 references).

**Plants and toxins.**

- `defence_toxicity` 0.5. At 1.0 leaner herbivores starved the predators; at 0.5 a
  defended plant gives 55–95 % of its energy.
- Plant growth will need retuning under day and night: on an office schedule the island
  is lit about a quarter of the week. The parked presence model has a `night_growth`
  floor so a weekend slows plants rather than stopping them.

**Learning** (ADR 0009).

- `learning_rate_max` 3, `meal_learning_gain` 1, `perturbation_gain` 0.25,
  `cost_learning` 0.05, `exploration_max` 1, `exploration_fade_hours` 48,
  `exploration_floor` 0.25, `forget_hours` 72, `social_copy_max` 1.
- Learning tracks the local plants (diet fit +0.29), but buys only about +5 % food, and
  evolution keeps the learning rate low (0.25 against 0.37 drifting). Learning *shields*
  the genes: the inherited diet bias stays at +0.07 with learning and reaches +0.18
  without. That is a finding to keep and show, not a bug to tune away.
- **To make learning matter more:** poisonous plants (M7, rare plant gene), and learning
  the owner's rhythm (M8, with a rest action). Both are life-or-death decisions that vary
  in time or place, which is when learning pays (Stephens; Dunlap & Stephens).
- **Simplification candidates:** `SOCIAL` (diet traditions) has been selectively neutral;
  it should start to pay once poison makes tasting dangerous (Galef; Rogers' paradox).
  Trial-and-error learning (`perturbation_gain`) never paid in a full world and is kept
  as M5's specified mechanism. If neither earns its place by M11, remove them (schema
  bump) rather than tune them.

**Founding and early years.**

- `founder_min_plant_cover` 0.5, `founder_count` 40. Founders land after a median of 8.6
  months, a few months before their first winter: year 1 is the bottleneck (median
  lowest population 40, against 75–86 later). Options: land earlier (lower cover), a
  larger first group, or a second founding wave. Under the office schedule, check that
  founders do not land just before a dark weekend in winter.

## 4. Known risks to watch

- **Weekend extinctions.** The owner's explicit requirement. If herds starve through the
  Long Night in winter, the fix is a mechanism (rest at night, lower burn in the dark),
  decided in M8, not a number in M11.
- **Seed overfitting** (§2.2).
- **Goalposts.** M5's criteria were revised with the owner after seeing data (ADR 0009).
  M11 should not revise bands to pass; where a band is wrong, record why in an ADR, as
  CLAUDE.md §8 requires.
- **Predator boom and bust** dominating the chronicle, or empty months between them.
- **Compensating levers.** `meat_energy` at 1 600 offsets other choices. A sweep may
  find a simpler combination; prefer fewer, more natural settings.

## 5. Order of work in M11

1. Held-out validation of the M10 state (seeds 20–39), office schedule.
2. Build `tools/tune/`: sweep runner, multi-criteria score, sensitivity report.
3. Sweep the predator and plant levers first (they move everything), then learning, then
   founding.
4. Re-run every M2–M10 criterion on held-out seeds; regenerate their reports.
5. Ten-year runs; read them for slow effects and for how the chronicle reads over years.
6. Decide the simplification candidates (§3) with the owner.
7. M11 report: the full dashboard (CLAUDE.md §8), sensitivity of the key metrics, and the
   engagement measures of §1.

## 6. Findings from later milestones

(M6–M10: what each milestone learned about the balance.)

### M6 — species (ADR 0012, reports/M6-species)

- **One island, one gene pool.** With species defined by the mating distance (0.10), the
  founders' herd never splits: after 50–70 generations it is broad (mean pairwise distance
  0.09) but continuous. Nothing isolates groups. Species are therefore defined as genome
  clusters (`species.link_distance` 0.035), which split about once a month.
- **M6.1 fails as a structural matter (81 % of inhabited days in 3–12, target 90 %).**
  The first 4–5 months after the founders land hold one or two species, and seeds whose
  founders die out spend months empty. Levers for M11: an earlier and safer landing (the
  M5 bottleneck, §4), more or longer-lived stranger groups (they live a median of about a
  month), or a real isolating mechanism (assortative mating on HUE/PATTERN, which the
  genome already describes as mate recognition; landmass splits).
- **Splits come in bursts** when a widely spread herd shatters at the threshold; the
  species count follows the herd's genetic spread, so anything that changes mutation
  (`mutation_sigma_body`) or selection will move both M6 numbers.
- **Diet classes** (ADR 0012, "By diet class"): predator species now split from groups of
  5 (`predator_min_members`; 51 splits in 20 seeds × 3 years), but predators still
  starve (87 % of their deaths, 42 % before maturity) and are present on only a quarter
  to a half of days; omnivores have no source but random strangers and no room under a
  full herd's cap. Levers: hunter survival (the M5 levers above), room for newcomers, a
  mixed diet that pays.
- **M6.1 is deferred here** by the owner (79 % vs 90 % with the predator rule, 2026-10-18).
- `[species]` settings come from a 20-seed sweep (ADR 0012 table); recheck them after
  any fauna tuning — they are cheap to sweep (many censuses per run).

### M7 — rare genes (ADR 0015, reports/M7-rare-genes)

- **Rare genes stay rare.** Each creature gene holds about 0.1 % of the population
  (median of seeds) and mostly dies out with its first carriers within 10–20 days;
  peaks of 20–45 % happen in single seeds. The loss rate is not the brake (a preview at
  a quarter of it gave the same peaks): drift is. If rare genes should be seen on screen
  more often, the levers are `rare_gain_probability` and the size of each bonus.
- **Photosynthesis needs nights to be balanced** (M7.2, deferred to M8): in constant
  daylight it sweeps a few herds. Re-judge after M8 with real schedules; with office
  hours it may instead never pay (`photosynthesis_rate`).
- **Longevity** swept a herd until it was given slower breeding
  (`longevity_cooldown_factor` 2); it still swept one seed of 20 (171 days).
- **Predators carry no rare genes to speak of**: too few of them (cap 16) for a gain to
  arise; venom, the obvious hunter's gene, never took hold. Ties to the predator levers
  of §6 M6.
- Plants keep their rare genes for a year or more but at 0.1–1 % of cells; emergent
  trees and mangroves reach 5–25 % in the top seeds. Poisonous plants never spread far
  enough to test diet learning at scale (ADR 0009/0011's hope); a higher
  `rare_gain_probability` for poison, or a poisonous form, would.

### M8 — presence and god powers (ADR 0016, reports/M8-presence)

- **M8.1 is deferred here** by the owner (p = 0.15 vs 0.05, 2026-10-19). Hibernation is
  selected by the nights in about a third of office seeds; glow never is. Levers:
  `glow_burn_cost`, `night_sight` (how blind the dark is), and whether a glower is seen
  as far as it sees (a glow that lights the way without lighting the glower would pay
  for hunters). Recheck with the office schedule, the gadget's real light.
- **Run every M11 sweep under `--schedule office`.** Founders and plant growth match the
  always-lit runs (plants follow a week's light), but rare genes do not: photosynthesis
  is selected against by night (median 0.7 ‰ against 10 ‰).
- Holidays are survived in every seed (97 absences); there is room to make them darker
  (`moonlight`, `moonlight_after_hours`) if dark ages should leave a mark.

### M9 — chronicle and bestiary (ADR 0017, reports/M9-chronicle)

- Both criteria pass under the office schedule (3.5 notable entries per month, largest
  type 18.9 %); recheck them in every sweep, since the chronicle reads everything.
- Fires: only 5 of 150 reach `fire_cells` (300) in office light; lower it or accept a
  quiet fire record. Booms and crashes are 23 % of entries together (`boom_factor`,
  `crash_factor`, `swing_min_members`).
- The year before life is quiet (about 2 notable entries a month); a late founding seed
  falls below the band.

### M10 — worlds end (ADR 0018)

- **A world ends when its last creature dies once life is established** (30 days after
  the first landing; the owner, 2026-10-20). Before M10 such islands were re-founded. It
  is rare at today's tuning: 2 of 80 three-year runs (M8/M9, all schedules) emptied
  after first life, so a world lasts decades. Agree with the owner how often a desk
  should see a new continent (§1, "Life persists"). If it should be more often, the
  levers are the island's difficulty, immigration (`immigrant_groups_per_year`) and the
  ark, not the criterion (`[apocalypse] established_days`).
- **Endings change the statistics.** A run in which a world ends restarts every
  cumulative series and puts the next world's bare first year into the record (the
  founding bottleneck of §3 again). Criteria computed over a whole run (M4.1 extinct
  seed-years, M6.1 inhabited time) must treat a new world as a new start; check
  `worlds_ended` in each run before reading them.
