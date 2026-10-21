# R4 — Atmosphere

Every effect of the atmosphere filmed from the real renderer in the three views (the
apocalypse on the map), from streams recorded for it with `tools/stream.py --stage`:
`report.html`, one self-contained file (animated PNGs; open it in a browser).
Decisions: ADR 0021.

- Branch `r4-atmosphere` at `59414dc`
- Atmosphere unit tests run for the report: 43 passed, 0 failed;
  renderer 301 unit and 56 browser tests listed
- Films are caught in wall time; the streams are recorded afresh each run

Regenerate with `cd renderer && npm run atmosphere` (`R4_REPORT_REUSE_STREAMS=1` keeps
the streams already recorded); do not edit by hand. R4 has no statistical criterion.
