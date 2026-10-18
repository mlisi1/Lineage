# M5 — Fauna II: lifetime learning

Run `m5-on`: 20 seeds × 3 sim-years, commit `0f7b41e82cc3`, config `1238efbcf8bb919b`, wall time 597.643 s.
Baseline `m5-off`: config `5e15b4750c7577fa` (start 2026-01-01; 20 job(s); fauna.learning=false).

- **PASS** M5.1: Learning tracks the local environment: share of seeds whose final-year diet fit (learned plant preference against the local plant defence) is positive (measured 1, target ≥ 0.8)
- **FAIL** M5.2: Share of seeds whose median time to competence falls over generations (learning on) (measured 0.5, target ≥ 0.6)
- **PASS** M5.3: Step of the whole world with learning on, median ms per sim-day (measured 308.3, target ≤ 400)

See `report.html` for figures and `metrics.json` for every number.
