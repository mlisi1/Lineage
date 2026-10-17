# M5 — Fauna II: lifetime learning

Run `m5-on`: 20 seeds × 3 sim-years, commit `a5692dbe1c27`, config `14429abcd91dfc34`, wall time 396.011 s.
Baseline `m5-off`: config `4cab6f603ad3f161` (start 2026-01-01; 20 job(s); fauna.learning=false).

- **PASS** M5.1: Early-life feeding success, learning on vs off in the same forked worlds: energy eaten per hour of youth, median gain across seeds (measured 0.2046, target ≥ 0.15)
- **FAIL** M5.2: Share of seeds whose median time to competence falls over generations (learning on) (measured 0.4, target ≥ 0.6)
- **PASS** M5.3: Step of the whole world with learning on, median ms per sim-day (measured 202.1, target ≤ 400)

See `report.html` for figures and `metrics.json` for every number.
