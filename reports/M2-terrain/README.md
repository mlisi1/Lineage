# M2 — Terrain generation and dynamics

Run `m2-terrain`: 20 seeds × 10 sim-years, commit `6626e74e5e83`, config `c5f30c9157ab39f8`, wall time 24.191 s.

- **PASS** M2.1: Land fraction never below the band (minimum over all seeds and samples) (measured 0.3202, target ≥ 0.25)
- **PASS** M2.2: Land fraction never above the band (maximum over all seeds and samples) (measured 0.5599, target ≤ 0.6)
- **PASS** M2.3: Share of seeds with ≥ 1 landmass split or rejoin per 3 years (measured 1, target ≥ 0.5)
- **PASS** M2.4: Seeds that lost all their land at any time (measured 0, target ≤ 0)
- **PASS** M2.5: Terrain step, median ms per sim-day on the reference machine (measured 3.828, target ≤ 25)

See `report.html` for figures and `metrics.json` for every number.
