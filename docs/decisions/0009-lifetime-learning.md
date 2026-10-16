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
  - *Early-life feeding success* = Σ eaten / Σ burnt over youths.
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
  | Early-life feeding gain, ON vs OFF (median across seeds) | **+1.5 %** (seeds from −4 % to +17 %) | ≥ 15 % |
  | Step cost | 176 ms per sim-day | ≤ 400 ms |
  | `LEARNING` gene at year 2 | 0.22–0.84 across seeds | — |

## Consequences and next steps

1. **Tune toward the 15 % target.** Likely cause of the shortfall: newborns inherit strong
   instincts, so there is little left to learn. Options, roughly in order:
   - weaker newborn instincts (`instinct_*`), or instincts that weaken over generations;
   - a higher learning rate in youth;
   - exploration that falls with age;
   - a reward that also counts danger avoided.

   Re-check M4's criteria after each change (`uv run pytest -m slow -k fauna`).
2. **Build `tools/milestones/m5.py`** with metrics, criteria and sections, register it in
   `tools/report.py`, and add a `--baseline runs/<off>` option for the OFF run. Report
   contents:
   - fork gain distribution;
   - survival and energy, ON vs OFF;
   - time to competence by generation in both runs (a decrease in OFF too would point to
     ecology, not a Baldwin effect);
   - `LEARNING` and `EXPLORATION` gene trajectories;
   - learned gains per sense.
3. **Add a slow M5 statistical test** in `sim/tests/` alongside the M4 one.
4. **Update this ADR** with the tuning and set its status to accepted once the report
   passes.
