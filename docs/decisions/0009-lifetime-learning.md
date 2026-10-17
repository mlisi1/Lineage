# 0009 — Lifetime learning

- **Status**: proposed (M5 in progress: tuning and report outstanding; accept when the M5
  report passes)
- **Date**: 2026-10-16

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

