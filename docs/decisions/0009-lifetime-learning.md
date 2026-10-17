# 0009 — Lifetime learning

- **Status**: proposed. M5 is built and balanced; it awaits the owner's decision on the
  proposed criteria ("Where M5 stands after balancing"). Accept once they are agreed and
  the report passes.
- **Date**: 2026-10-16 (last updated 2026-10-17)

## Current design (summary)

This ADR is written in the order things happened; this section states where they ended.

- **What is learned:** one gain per directional sense (food, prey, threat, mate, land, own
  kind, low growth, woody growth), added to the sense's direct weights. It is not
  inherited, except for diet traditions (below).
- **How, two ways:**
  - **Learning from meals** (main): after each bite of plants, the gain on that plant
    form's sense moves by how much better than usual the bite was (`meal_learning_gain`,
    `meal_memory_hours`).
  - **Trial and error** (node perturbation, M5's specified mechanism, weight
    `perturbation_gain` 0.25): exploration noise, an eligibility trace, energy balance
    against a running baseline.
  - Both decay with `forget_hours`, within `learned_max`.
- **Exploration** fades with age (`exploration_fade_hours`, `exploration_floor`).
- **The world gives learning something to do:** plant defence poisons grazers
  (`defence_toxicity` 0.5); creatures see plant form, never defence; which form is safe
  varies between neighbourhoods.
- **Genes:**
  - `LEARNING` (rate, costs `cost_learning` 0.05);
  - `EXPLORATION` (noise);
  - `SOCIAL` (diet traditions: a newborn takes on part of its mother's plant
    preferences).
- **Balance:** `meat_energy` 1 600 keeps predators going in a learning world.
- **Measures:** time to competence, `JuvenileGrown` youths, forked worlds (learning on vs
  off), `diet_fit`.
- **Scavenging** (an action added 2026-10-18): carrion from the dead, eaten by meat
  eaters, smelled through a scent; a carrion sense with a learned gain.
- **Schema v6** (22 senses, 246 weights, 9 gains, meal value, 14 genes, carrion and its
  scent); v6 was amended while unreleased.

## Context

M5 asks for reward-modulated learning during a creature's life, with eligibility traces
and exploration noise, learning-rate and exploration genes, and a "time to competence"
metric. It sets targets: learning ON improves early-life feeding success by ≥ 15 %; time
to competence trends down over generations in ≥ 60 % of seeds; step cost within budget.
M4's brain only steers, and founders arrive with strong instincts (ADR 0005).

## Decision

- **What is learned: one gain per directional sense** (`brain.FOLLOWED`: food, prey,
  threat, mate, land, own kind), added to both of the sense's direct weights (x from x,
  y from y). Six numbers per creature.
  - *Tried first and rejected*: letting the 50 direct and output weights learn. The
    output biases, the `ENERGY` weights (a near-constant input) and cross terms such as
    x-from-`FOOD_Y` grew largest. They encode fixed compass directions, which cannot
    help on an island with no preferred direction, so the rule fitted noise into them.
    In the food scenario, creatures got *slower* at reaching food as they learned.
- **Rule: node perturbation (REINFORCE).**
  - Noise is added to the steering drive.
  - The trace accumulates noise · sensed direction per gain.
  - Each tick, the gains move by rate × (reward − baseline) × trace.
  - Reward is the tick's energy balance from eating and moving (breeding excluded), as a
    share of capacity per hour. The baseline is its running average.
- **Exploration noise varies slowly** (an Ornstein–Uhlenbeck process, `exploration_hours`
  = 1 h). White noise every 10-minute tick averaged out before it moved the creature
  anywhere, and the learned food gain stayed near noise level.
- **Forgetting** (`forget_hours` = 72 h): gains that nothing rewards random-walk to the
  limit without it.
- **Not inherited**: newborns start with no learned gains, and evolution sees only innate
  weights. This is the setting in which a Baldwin effect can appear.
- **Genes `LEARNING` and `EXPLORATION`** are appended to the genome. They count toward
  mate compatibility and genetic distance, which dilutes `compat_distance` by 11/13.
  `LEARNING` costs basal burn; exploration's cost is noisier steering.
- **Off switch** `fauna.learning = false` is exactly the M4 brain: no noise, no learning,
  no cost.
- **Measurements**:
  - A creature is *competent* from the first time its day-averaged energy balance stops
    being negative.
  - Each youth ends (at maturity, or at death before it) with a `JuvenileGrown` event:
    eaten, burnt, competence age, generation.
  - *Early-life feeding success* = energy eaten per hour of youth (Σ eaten ÷ Σ youth
    hours), pooled over the youths of a seed's forks (owner's choice, after the probe).
    - *Tried first*: Σ eaten ÷ Σ burnt. On the probe it moved only +1.5 %, although youths
      that learn ate 36 % more (527 against 387 energy per youth), died young less often
      (30 % against 40 %) and failed to become competent less often (12 % against 18 %).
      They also live longer and move more, so they burn more: the ratio measures
      efficiency, not success at getting food. The report still shows it.
- **The 15 % criterion is measured on forked worlds** (owner's choice). Every 60 days, the
  same state runs 28 days twice, learning on and off, and the youths of creatures born in
  the first 14 days are compared. Survival and energy come from whole-world runs, ON
  against OFF (`--set fauna.learning=false`).
- **Schema v5**:
  - The migration gives v4 creatures zero learning genes, no learned state and
    generation 0, and treats them as already competent.
  - Fixture `v5.lzma` is added.
- **Tuning is allowed within reason** (owner's choice): learning tunables and instinct
  strengths may change, provided the M4 criteria still pass. Record the changes here.

## Evidence so far

- **Food scenario** (`test_a_creature_learns_to_approach_food`, 12 trials): a grazer with
  no food instinct learns a positive food gain in every trial (mean 1.82). Its time to
  reach food falls from about 2.1 h to 1.45 h over 60 episodes, against 3.75 h without
  learning.
- **First world probe** (`runs/m5-probe1`, 12 seeds × 2 years, forks every 60 days,
  untuned defaults):

  | Measure | Result | Target |
  |---|---|---|
  | Early-life feeding gain as eaten ÷ burnt (first definition) | +1.5 % (seeds from −4 % to +17 %) | ≥ 15 % |
  | Early-life feeding gain as energy eaten per hour of youth (adopted) | **+21 %** (all 12 seeds positive, +4 % to +48 %) | ≥ 15 % |
  | Survival of youth, ON vs OFF | +15 % (10 of 12 seeds positive) | — |
  | Step cost | 176 ms per sim-day | ≤ 400 ms |
  | `LEARNING` gene at year 2 | 0.22–0.84 across seeds | — |

- **Full M5 report** (`reports/M5-fauna-learning/`, runs `m5-on` and `m5-off`, 20 seeds ×
  3 years, default config, commit a5692db):

  | Criterion | Measured | Target | Result |
  |---|---|---|---|
  | M5.1 early-life feeding, energy eaten per hour of youth | +20.5 % (all 20 seeds positive) | ≥ 15 % | PASS |
  | M5.2 seeds whose time to competence falls over generations | 40 % (off: 50 %) | ≥ 60 % | FAIL |
  | M5.3 step cost | 202 ms per sim-day (off: 193) | ≤ 400 ms | PASS |

- **The feeding gain comes from exploring, not from learning.** Each seed's final world
  was forked for 90 days into three arms (learning on, exploration only with
  `learning_rate_max = 0`, off), comparing youths born in the first 60 days (a median of
  443 per arm and seed):
  - exploration only vs off: +21 % intake;
  - learning on vs exploration only: −1 % (positive in 8 of 20 seeds).

  Exploration noise spreads youths over more pasture. Learning on top adds nothing.
- **Evolution selects against learning.**
  - The `LEARNING` gene falls to 0.28 with learning on, against 0.52 drifting with it off.
  - `EXPLORATION` rises to 0.65, against 0.45.
  - Learned gains stay near zero (food gain 0.02 on average).
- **No Baldwin effect.**
  - Youths that learn take *longer* to become competent: 17–25 h against 11–15 h, in
    every generation. Noise wastes energy early, so the running balance turns positive
    later.
  - More of them get there in the end (86 % against 80 %).
  - Neither curve falls over generations.
- **Side effects in whole worlds** (medians per seed, 3 years, ON vs OFF):
  - drowned: 862 against 370 (noise drives land animals into the water);
  - births without a mate: 3 091 against 1 931 (explorers spread apart);
  - starved: 3 901 against 4 752.

  The mean population over the last two years is similar (187 against 191). The year-3
  values differ (136 against 199.5), but the run ends in midwinter.
- **Tuning tried** (bounded, within the owner's allowance; nothing adopted, the config is
  unchanged):
  - **Learning rate, trace and forgetting** (fork screen, learning beyond exploration):
    `learning_rate_max` 30 → −3.5 %, 100 → −10 %; with `trace_hours` 6 → −0.5 %; with
    `forget_hours` 500 → −0.1 %. A faster rule only adds noise.
  - **Weaker food instinct** (`instinct_food` 0.4, full 20-seed ON/OFF pair):
    - M5.1: +13.1 % (FAIL);
    - M5.2: 25 % (FAIL);
    - creatures learn more (food gain 0.10), but `LEARNING` is still selected down
      (0.29 against 0.43).
- **M4 re-check** (`pytest -m slow -k fauna`, M5 code, defaults): **fails M4.3**. Both
  diets are present at year 3 in 45 % of seeds, against ≥ 60 %. This is mostly the point
  measure: averaged over the last year the share is 0.59 with learning on, 0.59 with it
  off, and 0.62 in the M4 report. Predator packs last months, so one day swings it. The
  same reading with learning off gives 0.60. The other M4 criteria hold: no extinctions,
  drift rising in 85–100 % of seeds.

## Consequences and next steps

M5 is **not** done: M5.2 fails, and M5.1 passes only through exploration.

**Why learning does not pay.** Learning beats instinct only when the right behaviour changes
within a lifetime, or differs between individuals, in ways genes cannot predict. On this
island, how strongly to follow food, flee or keep distance is the same answer for
everyone, everywhere, so evolution fixes it in the innate weights and learning only adds
noise.

**Revised plan (agreed with the owner, 2026-10-17):** give learning something genes
cannot fully encode, and leave the bands alone until that has been tried.

1. **Exploration fades with age**, like juvenile play: full while young, down to a floor
   in adults. Youths that learn now become competent later (17–25 h against 11–15 h)
   because they pay for noise.
2. **Plant defence costs the grazer energy** (toxins), on top of refusing part of the bite,
   so a defended plant can cost more than it gives.
3. **Creatures see plant form, not defence.**
   - New directional senses: where there is more grazeable *low* growth (lichen, grass) and
     more *woody* growth (shrub, trees).
   - A learned gain on each, with the other learned gains.
   - The innate starting preference is the brain's inherited direct weights on these
     senses (founders start at 0), the channel through which genetic assimilation, the
     Baldwin effect, can act.
   - Learned values are not inherited.

   *Why the cue is form and not defence:* a creature that could sense defence would have
   it fixed in its genes ("avoid defence"), and learning would lose again. Form is visible
   and its value is hidden and local. In the final worlds of `m5-on`, woody growth is more
   defended on average (0.34 against 0.26: a general rule for genes), but which form is
   more defended varies between 32×32 regions in about half the seeds (woody more
   defended in 24–56 % of regions in 9 of 20 seeds): local exceptions only learning can
   catch.
4. **Schema v6** with a migration (weights gain zero columns for the new senses), scenario
   tests (a creature learns to avoid a defended form; the preference is local), then the
   full ON/OFF report.

**Still open: how M4.3 is read.** Recommended: the mean over the last year instead of one
day at year 3, band kept at 0.6 (0.59 with M5's code, so still just below), and predator
persistence logged as an M11 tuning item. Not changed until the owner agrees.

To reproduce:

```sh
uv run python -m tools.fastforward --years 3 --seeds 20 --save-days 30 --snapshot-days 60 --fork-days 60 --fork-length 28 --out runs/m5-on
uv run python -m tools.fastforward --years 3 --seeds 20 --save-days 30 --snapshot-days 60 --set fauna.learning=false --out runs/m5-off
uv run python -m tools.report M5 --runs runs/m5-on --baseline runs/m5-off
```

The three-arm fork screen (`runs/m5-on/saves/*.lzma`, 90-day forks) was a scratch script.
Turning it into a tool is part of option (a) or (b).

## Implementation notes (revised plan)

- **Steps 1–3 are in**: exploration fades with age (48 h time constant, 25 % floor),
  defended plants poison grazers (`defence_toxicity` = 1.0), creatures see low and woody
  growth (senses 16–19, learned gains 7–8), and schema v6 brings the migration and the
  `v6.lzma` fixture. Founders have no instinct for the form senses.
- **`learning_rate_max` lowered from 10 to 3.** In the plant-form scenario, an effective
  rate of 10 per hour was unstable: the learned preference had the right sign in only
  56 % of 16 trials, and time on the safe form did not rise. At 1–3 it had the right
  sign in 81–100 %, and time on the safe form rose by 5–14 points. The food scenario
  still passes at 3.
- **ADR 0005's "202 weights" was a miscount**: the v5 brain had 186 (32 direct, 128
  hidden inputs, 8 hidden biases, 16 outputs, 2 output biases). Corrected there; v6
  has 226.

## Results of the revised plan (2026-10-17)

Full report regenerated (`reports/M5-fauna-learning/`, runs `m5-on`, `m5-off`, 20 seeds ×
3 years, commit ca48803):

| Criterion | First report | Revised world | Target |
|---|---|---|---|
| M5.1 early-life feeding gain | +20.5 % PASS | **+8.7 %** FAIL (positive in 18 of 20 seeds) | ≥ 15 % |
| M5.2 seeds whose time to competence falls | 40 % FAIL | **50 %** FAIL (off: 45 %) | ≥ 60 % |
| M5.3 step cost | 202 ms PASS | **332 ms** PASS (off: 309) | ≤ 400 ms |

What changed and what did not:

- **Genes picked up the general rule.** The inherited weights on the form senses evolved
  toward low growth (+0.07) and away from woody growth (−0.13), matching "woody is usually
  more defended" (the genetic half of the design works).
- **Learning did not pick up the local exceptions.**
  - Learned gains stay small (mean |gain| 0.07–0.09, against 1–2 in the scenarios).
  - Learned preferences do not correlate with the local defence difference (median
    correlation 0.02 across seeds).
  - Three-arm fork screen on the final worlds: learning adds −0.9 % beyond exploration
    (positive in 9 of 19 seeds), and −1.6 % with `defence_toxicity` 2.0.
- **The learning gene is now slightly favoured** (0.37 against 0.32 with learning off),
  and exploration strongly (0.85 against 0.62).
- **Costs**: step cost +65 % (two more smelled fields per creature per tick; the OFF arm
  pays it too), extinct seed-years 6.7 % (off: 5 %), up from 0 %.

**Why.** The learning signal is too weak for the rule. Node perturbation learns from one
scalar, the energy balance, through steering noise. In real worlds the local defence
difference between forms is 0.1–0.3, so the energy difference is small beside the
noise of grazing in a herd, and a youth has about 150 hours to detect it. In the
scenarios the contrast is 0.9 against 0, with nothing else going on, and the same rule
learns in 60 episodes.

## Open decisions (for the owner)

1. **Associative learning of food value** (recommended next). Learn the value of each
   plant form from every bite, rather than from steering noise: after each meal, move
   the gain on the form eaten toward how much energy that bite gave against its usual
   yield. This is still reward-modulated learning (M5's deliverable). It is biologically
   ordinary (conditioned taste aversion), and gets one clear signal per bite instead of
   one diluted signal per tick. Node perturbation stays for the other senses.
2. **Accept and revise the bands** (option c): on this island exploration pays, genes
   carry the diet rule, and lifetime learning adds little; record it and move to M6.
3. **M4.3's reading** (unchanged): see above.

## Balancing (owner: "you are free to make the calls", 2026-10-17)

- **Plant toxicity starved the food chain.** Learning-off worlds, 20 seeds × 3 years:

  | `defence_toxicity` | Both diets at year 3 | Both, final-year mean | ≥ 3 predators, years 1–3 | Extinct seed-years |
  |---|---|---|---|---|
  | M4 report (no toxicity) | 0.70 | 0.62 | 0.61 | 0.05 |
  | 0 | 0.75 | 0.55 | 0.54 | 0.02 |
  | **0.5 (adopted)** | 0.80 | 0.62 | 0.57 | 0.00 |
  | 1.0 | 0.40 | 0.50 | 0.43 | 0.05 |

  At 1.0 leaner herbivores could not feed the predators. 0.5 restores M4's balance and
  keeps a diet signal (a defended plant gives 55–95 % of its energy).
- **Learning from meals added** (option 1 above, adopted). In the plant-form scenario at
  the learning gene evolved populations carry (0.3), the right preference is now learned
  in 16 of 16 trials in both worlds, against 56–88 % with node perturbation alone, and
  time on the safe plants rises to 86–91 %. Its running average is new per-creature
  state: folded into schema v6, which has never been released (this branch is
  unmerged), so the v5→v6 migration and `v6.lzma` were amended rather than a v7 added.

## Balancing with learning on (2026-10-17)

The default world runs with learning on, so it is the one M4's criteria apply to. With
meal learning and toxicity 0.5, predators fell again (≥ 3 predators in 0.42 of years
1–3, against 0.57 with learning off).

- **What it is not.** In 30-day forks from balanced worlds, kills, grazer movement and
  spacing, and hunter-to-prey distances were the same with learning on and off. The
  decline builds over months, at the population level.
- **What did not help** (learning-on runs, 20 seeds × 3 years; ≥ 3 predators in years
  1–3):
  - trial-and-error at 0.25: 0.34;
  - plus a higher `attack_rate` (3.5): 0.34, with kills down to 1 127, since every
    attempt costs the hunter energy;
  - meal learning alone: 0.47.
- **What did:**
  - richer meat (`meat_energy` 900 → 1 600): 0.46;
  - plus cheaper learning (`cost_learning` 0.2 → 0.05): **0.52**, with both diets at year
    3 in 0.65 of seeds (final-year mean 0.56), diet fit +0.33 (positive in all seeds),
    and the `LEARNING` gene selected down less (0.29).

  Hunters live on the energetic edge, so a few percent of basal burn for a learning gene
  tipped lineages over.
- **Adopted:** `meat_energy` 1 600, `cost_learning` 0.05, `perturbation_gain` 0.25 (trial
  and error never paid in a real world; kept at a quarter as M5's specified mechanism).
  M4.3's final-year mean (0.56) is still just below 0.6.
- **Diet traditions** (candidate 1 below) were implemented on top: a `SOCIAL` gene folded
  into the unreleased schema v6.

## Where M5 stands after balancing (report at commit 9f40056)

Full report `reports/M5-fauna-learning/` (runs `m5-on`, `m5-off`, 20 seeds × 3 years):

| Measure | Learning on | Learning off | Target |
|---|---|---|---|
| M5.1 early-life feeding gain (forks) | +5.1 % (positive in 70 % of seeds) | — | ≥ 15 %: **FAIL** |
| M5.2 seeds whose time to competence falls | 60 % | 50 % | ≥ 60 %: **PASS**, borderline |
| M5.3 step cost | 343 ms per sim-day | 315 | ≤ 400: **PASS** |
| Diet fit, final year (median) | +0.32, positive in 20 of 20 seeds | — | proposed |
| Both diets present at year 3 / final-year mean (M4.3) | 0.50 / 0.58 | 0.70 / 0.59 | ≥ 0.6 |
| ≥ 3 predators, years 1–3 | 0.48 | 0.52 | — |
| `LEARNING` / `EXPLORATION` / `SOCIAL` gene at year 3 | 0.24 / 0.77 / 0.67 | 0.42 / — / 0.64 (drift) | — |

What the plots show:

- **Diet fit** rises within months to about +0.3 and holds for three years; the 10th
  percentile of seeds stays above 0 after year 1. Learning does what it is for: each
  grazer learns which plant form is safe where it lives.
- **Time to competence**: learners no longer reach it later (fading exploration fixed
  that; both runs at about 12–18 h), but neither curve clearly falls over generations.
  The M5.2 pass is at the band and the learning-off run gets 50 %, so it is not evidence
  of a Baldwin effect. As in Ackley & Littman, a Baldwin effect may need far more
  generations than 3 years.
- **Predators** boom and bust in both runs. Late in the run there are fewer with learning
  on (median about 3–5 against 8–16), but they are present about as often.
- **Population bottlenecks** (report section of the same name; noticed by the owner).
  - **Year 1 is the riskiest year.** The lowest population per seed has a median of 51
    with learning on (40 off), against 83–87 in years 2–3.
  - **The cause is late landing.** Plants need about 7 months to cover half the land, so
    the founders land after a median of 8.6 months (mid-September), about three months
    before their first winter: forty animals of one species, at random ages, meet winter
    dieback with no time to grow.
  - **Later dips are winter dips** (the yearly minimum falls in December–February in 70 %
    of later seed-years with learning on, 83 % off). They rarely reach zero (the 10th
    percentile stays at 11–17 creatures) because herds enter winter larger and arriving
    strangers (about six groups a year) bring other genomes: a rescue effect.
  - **Extinctions are rare in every year** (0–2 of 20 seeds per year); the worst come
    within the first year or two after landing.
  - **Possible follow-ups** (not done): let founders land earlier (lower
    `founder_min_plant_cover`), or let the first group arrive larger. Either would ease
    the bottleneck of the founders; both change M4's calibration, so they belong with M11
    tuning.
- **Evolution of learning**: the learning rate settles low (0.24, selected down from the
  0.42 of drift), copying (`SOCIAL`) is not selected for or against, and exploration is
  selected up. Learning persists, but evolution keeps it cheap: the energy at stake in
  choosing plants is small.

**Proposed criteria (for the owner; CLAUDE.md §8 is unchanged until agreed).** M5.1's
15 % cannot be reached by diet choice on a balanced island: the local defence difference
between forms is worth about 6 % of a bite, and higher toxicity starves the predators.

- **M5.1** → *learning tracks the local environment*: final-year diet fit > 0 in ≥ 80 % of
  seeds (now 100 %). The feeding gain stays as a reported measure.
- **M5.2** → *genetic assimilation*: the inherited bias on the plant-form senses evolves in
  the direction the population learns, in ≥ 60 % of seeds (needs a new measure). Time to
  competence stays as a reported measure.
- **M5.3** unchanged.
- **M4.3**: read as the mean over the last year (0.58 now; band 0.6, or 0.55 if the owner
  accepts that predators are now more cyclic).

## Criteria adopted (owner: "if you think those are reasonable changes, go on", 2026-10-17)

CLAUDE.md §8 is revised accordingly.

- **M5.1 → learning tracks the local environment**: final-year diet fit positive in
  ≥ 80 % of seeds. The original "early-life feeding ≥ 15 %" is still measured and
  reported. Choosing plants is worth a few percent of a bite on a balanced island, so 15 %
  is out of reach without starving the predators.
- **M5.2 unchanged** (time to competence trends down in ≥ 60 % of seeds). The proposed
  replacement, *genetic assimilation*, is **not adopted**: the data show the opposite.
  - At year 3, grazers' inherited bias toward low growth is +0.117 with learning off
    (positive in 70 % of seeds) and only +0.015 with learning on (53 %), while the
    learners' learned bias is +0.062 (89 %).
  - Learning shields the genes (Ackley & Littman). The report now shows this ("Diet
    bias: born with, or learned") and says so in "What the plots show".
- **M5.3 unchanged.**
- **M4.3 reading**: both diets present, **mean over the final year**, band unchanged
  (≥ 60 %). One day at year 3 swung between 0.50 and 0.65 for the same configuration.
  The M4 report module and the slow M4 test use this reading. At this point it is 0.58,
  still short; the next balancing step targets it.

## New action: scavenging (2026-10-18)

The owner asked whether creatures need more actions to perform and learn from. The data
first ruled two out:

- **Strike or hold, for hunters**: attack costs are 0.2 % of hunters' resting burn, and
  about 85 % of strikes kill, so deciding not to strike would change almost nothing.
- **Learning danger from near misses**: prey almost never survive an attack, so there is
  hardly anything to learn from.
- **Eat or pass**: at toxicity 0.5 every plant still gives 50–100 % of its energy, so
  passing rarely pays.

What the data did show: **hunters starve**. In 60-day forks, 509 of 570 hunter deaths
were starvation, at a median age of 11 days, half before maturity. The meat is
concentrated in successful hunters. So the action added is **scavenging** (`d13ad12`;
see creatures.md, "Carrion"), as ADR 0005 suggested for newborn hunters. It should also
give half-meat diets a niche, and whether omnivores now evolve is one of the things to
measure. Where carrion lies depends on where hunters hunt, which varies in place and
time: the kind of thing learning is good at.

**Not yet measured in full worlds** (runs stopped at wrap-up). Next: compare
`meat_energy` 1 600 and 900 with scavenging, learning on, against M4.3 (final-year mean
≥ 0.6), predator presence, extinctions and omnivores; then regenerate the M5 report.
Commands:

```sh
uv run python -m tools.fastforward --years 3 --seeds 20 --save-days 1000 --snapshot-days 0 --out runs/scav-on
uv run python -m tools.fastforward --years 3 --seeds 20 --save-days 1000 --snapshot-days 0 --set fauna.meat_energy=900.0 --out runs/scav-on-meat900
```

## Candidate features (researched 2026-10-17, owner asked for ideas)

Ranked by fit for the gadget: what they add to evolution, how intriguing the learning
becomes to watch, and the risk to the predator–prey balance.

1. **Diet traditions (social learning).** Youths take on their mother's learned plant
   preferences during a weaning window, weighted by an evolvable gene, and keep learning
   from their own meals. In rats, juveniles acquire adults' food preferences (Galef), most
   strongly at weaning, and the effect lasts. Rogers' paradox predicts copying pays only
   alongside individual learning, so the mix is left to evolution. Herds would carry local
   food cultures: captions and chronicle material. *Implemented (SOCIAL gene).*
2. **Learning danger without dying.** A prey that survives an attack learns to flee harder
   (threat gain), and an attacked creature alerts nearby kin (alarm). This addresses the
   "death cannot teach" gap, but it makes prey harder to catch, so only once predators are
   robust.
3. **Cover refuge.** Prey in dense woody growth are harder to kill: a structural
   stabiliser of coexistence (Křivan; the PeerJ refuge study), and a second currency for
   learning plant form (grass feeds, cover protects).
4. **Evolved rewards.** Inherited weights on reward components (energy, safety, mates), as
   in Ackley & Littman's evaluation network and Singh, Lewis & Barto's optimal rewards.
   Brings Baldwin, shielding and goal-regression dynamics. Research-heavy.

## References

What each source contributed to the decisions above. Links were checked on 2026-10-17;
details not confirmed from the source itself are marked.

- **Hinton, G. E. & Nowlan, S. J. (1987). How learning can guide evolution.** *Complex
  Systems* 1. <https://www.cs.toronto.edu/~hinton/absps/evolution.htm>. The original
  computational Baldwin effect: learning smooths the fitness landscape, and what is
  learned can later become innate. It is why learned values here are not inherited and
  why innate weights stay evolvable.
- **Ackley, D. & Littman, M. (1991/1992). Interactions between learning and evolution.**
  In *Artificial Life II*, SFI Studies in the Sciences of Complexity, pp. 487–509.
  <https://www.cs.utexas.edu/~shivaram/readings/b2hd-AckleyLittman1992.html>. Its
  findings explain three of ours:
  - learning plus evolution beat either alone;
  - a Baldwin effect appeared only over millions of steps, far more generations than our
    3-year runs;
  - **shielding**: once the innate behaviour is good, learning genes lose their value and
    drift, as our `LEARNING` gene does.

  Its rewards come from an *evolved* evaluation network (inherited goals), the route to
  learning about danger without dying first; that is a candidate for later work. Its
  carnivores were hand-coded, and its population still died out after predator-prey
  "implosions".
- **Stephens, D. W. (1991). Change, regularity, and value in the evolution of animal
  learning.** (*Behavioral Ecology*; venue recalled, not confirmed.) Learning pays when
  what matters changes between generations or places but stays regular within a
  lifetime. This is the reason steering gains did not pay here (their best value is the
  same everywhere) and plant preferences can (defence differs between neighbourhoods).
- **Dunlap, A. S. & Stephens, D. W. (2009). Components of change in the evolution of
  learning and unlearned preference.** *Proc. R. Soc. B* 276. doi:10.1098/rspb.2009.0602.
  <https://profiles.umsl.edu/en/publications/components-of-change-in-the-evolution-of-learning-and-unlearned-p/>.
  Whether learning or a fixed preference evolves depends on the reliability of
  experience and on how certain the best action is.
- **Dunlap, A. S. & Stephens, D. W. (2014). Experimental evolution of prepared
  learning.** *PNAS* 111: 11750–11755. <https://pmc.ncbi.nlm.nih.gov/articles/PMC4136563>.
  In 40 fly lines over 40 generations, learning of a cue–quinine pairing tracked that
  cue's reliability. It supports a visible cue (plant form) with a hidden, locally
  reliable consequence (defence) as the right thing to learn.
- **Dunlap, A. S., Austin, M. W. & Figueiredo, A. (2019). Components of change and the
  evolution of learning in theory and experiment.**
  <https://www.journals.uchicago.edu/doi/pdfplus/10.1086/706252>. Asks for "change" to be
  defined and measured; here it is the spatial variation of defence between plant forms
  (ADR above, and the `diet_fit` measure).
- **Soltoggio, A., Stanley, K. O. & Risi, S. (2018). Born to learn: the inspiration,
  progress, and future of evolved plastic artificial neural networks.** *Neural
  Networks* 108: 48–67. <https://arxiv.org/abs/1703.10371>. A review of evolved plastic
  networks; background for keeping innate weights evolved and only a few plastic gains.
- **Yaeger, L. Polyworld.** <https://en.wikipedia.org/wiki/Polyworld>. The closest similar
  project: evolved neural agents with Hebbian plasticity that eat, mate and prey on one
  another; small populations (hundreds), like ours.
- **Křivan, V. (2013). Behavioral refuges and predator–prey coexistence.** *J. Theor.
  Biol.* <https://fix.prf.jcu.cz/~krivan/clanky/Krivan-JTB-2013.pdf>. Optimal foraging and
  prey anti-predator behaviour promote coexistence, and sigmoidal (type III) functional
  responses stabilise. A candidate if predator balance needs a structural fix (a cover
  refuge).
- **Individual-based refuge study, PeerJ (2017), article 2993.**
  <https://peerj.com/articles/2993>. More refuge allowed predator and prey to coexist by
  weakening interaction strength, and predators died out in the smallest patches.
- **Rikvold, P. A. (2009). Complex dynamics in coevolution models with ratio-dependent
  functional response.** <https://arxiv.org/abs/0910.4915>. In an individual-based
  coevolution model, adaptive foraging enhances coexistence.
- **Galef, B. G. Social learning of food preferences in rats** (lab work since 1969;
  reviews 1982 and 2004). <https://experts.mcmaster.ca/scholarly-works/2167372>.
  Juveniles acquire adults' food preferences; social influence is strongest at weaning;
  a single 30-minute interaction lasts at least a month; it is weaker in unstable
  environments. Basis for candidate 1. (Abstracts and metadata only; full texts not
  read.)
- **Rogers, A. (1988), "Rogers' paradox"**, as presented in Acerbi et al.'s
  individual-based cultural evolution notes.
  <https://acerbialberto.com/IBM-cultevo/rogers-paradox.html>. Cheap social learning
  alone does not raise mean fitness at equilibrium, because it only recycles information;
  it pays when combined with individual learning. Spatial heterogeneity and migration
  favour individual learning.
- **Singh, S., Lewis, R. L., Barto, A. G. & Sorg, J. (2010). Intrinsically motivated
  reinforcement learning: an evolutionary perspective.** *IEEE TAMD*.
  <https://web.eecs.umich.edu/~baveja/Papers/IMRLIEEETAMDFinal.pdf>. The optimal reward,
  for a given fitness and distribution of environments, need not resemble fitness
  itself. Basis for candidate 4.
- **Reggia, J. et al. Conditions enabling the evolution of inter-agent signaling.**
  <https://langev.com/pdf/reggia01conditionsEnabling.pdf>. Selection on survival alone
  favoured predator alarm signals more than survival plus food success. Basis for
  candidate 2.

