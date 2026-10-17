# Milestone status

Mirrors CLAUDE.md §8. Update in the same commit that changes a milestone's state.

| ID | Milestone | Status | Report |
|---|---|---|---|
| M0 | Repository and tooling | done | — |
| M1 | Core: clock, RNG, world loop, state, saves, migrations | done | — (not statistical) |
| M2 | Terrain generation and dynamics | done | [reports/M2-terrain](../reports/M2-terrain/README.md) |
| M3 | Flora | done | [reports/M3-flora](../reports/M3-flora/README.md) |
| M4 | Fauna I: genome, body, energy, reproduction, evolution | done | [reports/M4-fauna-evolution](../reports/M4-fauna-evolution/README.md) |
| M5 | Fauna II: lifetime learning | in progress, waiting on the owner's decision on the criteria. Balanced and extended (meal learning, diet traditions, fading exploration, toxic plants, plant-form senses, schema v6). Report: M5.1 +5.1 % FAIL (structurally out of reach, see ADR), M5.2 60 % PASS (borderline), M5.3 343 ms PASS; diet fit +0.32 in 20/20 seeds. Proposed criteria in [ADR 0009](decisions/0009-lifetime-learning.md) | [reports/M5-fauna-learning](../reports/M5-fauna-learning/README.md) |
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

State at 2026-10-17, for the next session:

- **Branches**:
  - `r0-renderer-spike` holds R0. It is local only (not pushed or merged) and waits for
    the board measurement (`deploy/board-setup.md`).
  - `m5-lifetime-learning` is branched from `main` and holds M5. It doesn't contain the R0
    commits, so expect conflicts only in shared files (this file, `CLAUDE.md`).
- **M5 next steps**: the owner decides on the proposed criteria (ADR 0009, "Where M5
  stands after balancing"); then a slow M5 statistical test, and the ADR accepted.
  Candidate features for later are listed there too. The owner
  chose earlier:
  - the 15 % feeding criterion is measured on forked worlds, as energy eaten per hour of
    youth;
  - tuning within reason is allowed, provided M4's criteria still pass.
- **Tests after M5**: the fast suite and all 25 tool tests pass. The slow M4 test fails
  M4.3 (both diets at year 3 in 45 % of seeds, against ≥ 60 %). ADR 0009 explains why
  this is mostly a point-measure effect, and the decision it needs.
- **Local runs** (gitignored): `runs/m5-on`, `runs/m5-off` (the report's runs) and
  `runs/m5-weak-on`, `runs/m5-weak-off` (`instinct_food` 0.4).
- **Probe run** `runs/m5-probe1` (gitignored, local): 12 seeds × 2 years with forks, made
  with `--save-days 1000 --snapshot-days 0 --fork-days 60 --fork-length 28`.
