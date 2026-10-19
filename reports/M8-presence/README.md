# M8 — Presence, calendar, god powers

Run `m8-office`: 20 seeds × 3 sim-years, commit `5951907f6fac-dirty`, config `17c377d0fa1788cd`, wall time 593.093 s.
Baseline `m8-always`: config `17c377d0fa1788cd` (start 2026-01-01; 10 job(s)).
Baseline `m8-office-august`: config `17c377d0fa1788cd` (start 2026-01-01; 10 job(s); schedule office-august).
Baseline `m8-conference`: config `17c377d0fa1788cd` (start 2026-01-01; 10 job(s); schedule conference).

- **FAIL** M8.1: Night traits (glow, hibernation) are more frequent under the office schedule than always-present: one-sided rank test across seeds, p-value (measured 0.1457, target ≤ 0.05)
- **PASS** M8.2: Share of seeds whose creatures survive every 3-week absence (1–21 October) (measured 1, target ≥ 0.8)
- **PASS** M8.3: Share of seeds whose creatures survive every August holiday (asked by the owner) (measured 1, target ≥ 0.8)
- **PASS** M7.2: Re-judged in the office's light: share of seeds where no rare gene stays above 90% of its population for more than 91 days (measured 0.95, target ≥ 0.9)

See `report.html` for figures and `metrics.json` for every number.
