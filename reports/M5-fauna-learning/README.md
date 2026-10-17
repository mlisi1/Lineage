# M5 — Fauna II: lifetime learning

Run `m5-on`: 20 seeds × 3 sim-years, commit `ca4880383911`, config `43467e33b4fb015b`, wall time 648.153 s.
Baseline `m5-off`: config `89a00c01df813c25` (start 2026-01-01; 20 job(s); fauna.learning=false).

- **FAIL** M5.1: Early-life feeding success, learning on vs off in the same forked worlds: energy eaten per hour of youth, median gain across seeds (measured 0.08711, target ≥ 0.15)
- **FAIL** M5.2: Share of seeds whose median time to competence falls over generations (learning on) (measured 0.5, target ≥ 0.6)
- **PASS** M5.3: Step of the whole world with learning on, median ms per sim-day (measured 332.2, target ≤ 400)

See `report.html` for figures and `metrics.json` for every number.
