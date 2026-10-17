# M5 — Fauna II: lifetime learning

Run `m5-on`: 20 seeds × 3 sim-years, commit `9f4005671052`, config `777fb5dd70d273c3`, wall time 670.646 s.
Baseline `m5-off`: config `55d0459620c7b33a` (start 2026-01-01; 20 job(s); fauna.learning=false).

- **FAIL** M5.1: Early-life feeding success, learning on vs off in the same forked worlds: energy eaten per hour of youth, median gain across seeds (measured 0.05055, target ≥ 0.15)
- **PASS** M5.2: Share of seeds whose median time to competence falls over generations (learning on) (measured 0.6, target ≥ 0.6)
- **PASS** M5.3: Step of the whole world with learning on, median ms per sim-day (measured 343.3, target ≤ 400)

See `report.html` for figures and `metrics.json` for every number.
