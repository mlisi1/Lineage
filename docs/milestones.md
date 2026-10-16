# Milestone status

Mirrors CLAUDE.md §8. Update in the same commit that changes a milestone's state.

| ID | Milestone | Status | Report |
|---|---|---|---|
| M0 | Repository and tooling | done | — |
| M1 | Core: clock, RNG, world loop, state, saves, migrations | done | — (not statistical) |
| M2 | Terrain generation and dynamics | done | [reports/M2-terrain](../reports/M2-terrain/README.md) |
| M3 | Flora | done | [reports/M3-flora](../reports/M3-flora/README.md) |
| M4 | Fauna I: genome, body, energy, reproduction, evolution | done | [reports/M4-fauna-evolution](../reports/M4-fauna-evolution/README.md) |
| M5 | Fauna II: lifetime learning | in progress on branch `m5-lifetime-learning`: learning rule, genes, schema v5, scenario tests and fork/ablation tooling built; report module built (`tools/milestones/m5.py`, `tools.report --baseline`). First probe (12 seeds × 2 years): early-life feeding, measured as energy eaten per hour of youth, +21 % median against the ≥ 15 % target. Next: the full 20-seed run and report, then a slow test. See [ADR 0009](decisions/0009-lifetime-learning.md) | — |
| M6 | Species, names, phylogeny | not started | — |
| M7 | Rare genes (creatures and plants) | not started | — |
| M8 | Presence, calendar, god powers | not started | — |
| M9 | Chronicle and bestiary | not started | — |
| M10 | Apocalypse and worlds | not started | — |
| M11 | Long-run tuning and stability | not started | — |
| R0 | Renderer spike on the device | not started | — |
| R1 | Terrain and plants from the state stream | not started | — |
| R2 | Procedural creatures | not started | — |
| R3 | Documentary camera and captions | not started | — |
| R4 | Atmosphere | not started | — |
| S1 | Server: real-time loop and persistence | not started | — |
| S2 | Device layer | not started | — |
| S3 | Phone app and API | not started | — |
| S4 | Notifications | not started | — |
| S5 | Public journal | not started | — |
| S6 | Deployment | not started | — |
| S7 | Soak test | not started | — |

## Handoff notes

State at 2026-10-16, for the next session:

- **Branches**:
  - `r0-renderer-spike` holds R0. It is local only (not pushed or merged) and waits for
    the board measurement (`deploy/board-setup.md`).
  - `m5-lifetime-learning` is branched from `main` and holds M5. It doesn't contain the R0
    commits, so expect conflicts only in shared files (this file, `CLAUDE.md`).
- **M5 next steps**: listed under "Consequences and next steps" in
  [ADR 0009](decisions/0009-lifetime-learning.md). The owner chose:
  - the 15 % feeding criterion is measured on forked worlds, as energy eaten per hour of
    youth (not eaten ÷ burnt, which the report still shows);
  - tuning within reason is allowed, provided M4's criteria still pass and the changes are
    recorded in the ADR.
- **Not yet re-checked after M5**: the slow M4 statistical test
  (`uv run pytest -m slow -k fauna`). Adding two genes loosens mate compatibility
  slightly.
- **Not run since the report tooling changed**: the report tests that fast-forward
  (`tools/tests/test_report.py` without `-k`), skipped while other simulations used the
  machine. The rest of `test_report.py` and `test_m5_report.py` pass.
- **Probe run** `runs/m5-probe1` (gitignored, local): 12 seeds × 2 years with forks, made
  with `--save-days 1000 --snapshot-days 0 --fork-days 60 --fork-length 28`.
