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

## Decision

(Pending the sweeps.)

## Consequences

(Pending.)
