# M2 — Terrain generation and dynamics

Run `m2-terrain`: 20 seeds × 10 sim-years, commit `1c73eacd343d`, config `6f75c35e27ee71d4`, wall time 71.118 s.

- **PASS** M2.1: Land fraction never below the band (minimum over all seeds and samples) (measured 0.32, target ≥ 0.25)
- **PASS** M2.2: Land fraction never above the band (maximum over all seeds and samples) (measured 0.5588, target ≤ 0.6)
- **PASS** M2.3: Share of seeds with ≥ 1 landmass split or rejoin per 3 years (measured 1, target ≥ 0.5)
- **PASS** M2.4: Seeds that lost all their land at any time (measured 0, target ≤ 0)
- **PASS** M2.5: Step of the whole world (terrain and everything on it), median ms per sim-day (measured 11.62, target ≤ 25)

See `report.html` for figures and `metrics.json` for every number.
