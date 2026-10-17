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

M5 is **not** done: M5.2 fails, and M5.1 passes only through exploration. These need the
owner:

1. **What M5 should show.** Options:
   - **(a) Change the learning rule.** A reward that also counts danger avoided and mates
     found, or exploration that falls with age so youths stop paying for noise once
     competent.
   - **(b) Make learning cheaper or the world harder to get by on instinct.** For example
     patchier food, or food that moves between seasons.
   - **(c) Accept what the simulation shows**: on this island, exploration pays and lifetime
     learning does not. Revise the M5 bands in this ADR.
2. **M4.3's reading.** Keep it as a point value at year 3 (it now fails at 45 %), or
   read it as the mean over the last year (0.59, still just below 0.6). Either way the
   band needs a decision.
3. **Once 1 and 2 are settled**: tune or revise, regenerate the report, add a slow M5
   statistical test in `sim/tests/`, and set this ADR to accepted.

To reproduce:

```sh
uv run python -m tools.fastforward --years 3 --seeds 20 --save-days 30 --snapshot-days 60 --fork-days 60 --fork-length 28 --out runs/m5-on
uv run python -m tools.fastforward --years 3 --seeds 20 --save-days 30 --snapshot-days 60 --set fauna.learning=false --out runs/m5-off
uv run python -m tools.report M5 --runs runs/m5-on --baseline runs/m5-off
```

The three-arm fork screen (`runs/m5-on/saves/*.lzma`, 90-day forks) was a scratch script.
Turning it into a tool is part of option (a) or (b).
