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
| R0 | Renderer spike on the device | in progress on branch `r0-renderer-spike` (not merged here; that branch's row is the current one): spike, benchmark and look built; the measurement on the board is pending | on that branch |
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
  - `m5-lifetime-learning`, branched from `main`, holds M5. It is local only and does not
    contain the R0 commits; expect conflicts only in shared files (this file,
    `CLAUDE.md`).
- **M5 state**: built and balanced. ADR 0009 opens with a summary of the current design,
  and "Where M5 stands after balancing" holds the latest numbers and the proposed
  criteria. The report (`reports/M5-fauna-learning/`) opens with a generated "What the
  plots show".
- **Waiting on the owner**:
  1. Accept or amend the proposed M5 criteria (M5.1 → diet fit; M5.2 → genetic
     assimilation; M4.3 read as the final-year mean). CLAUDE.md §8 is unchanged until
     then.
  2. Whether to add **eat-or-pass** (grazing becomes a decision, which gives meal
     learning a direct stake), the recommended next feature. Rest (with M8) and
     strike-or-hold (a later predator pass) come after.
- **Owner's earlier choices**:
  - the feeding criterion is measured on forked worlds, as energy eaten per hour of
    youth;
  - tuning within reason is allowed if M4's criteria still pass;
  - the agent may make balancing calls autonomously;
  - sources go in the ADR's References.
- **Tests on this state**: lint, format, types, the fast suite (396) and all tool tests
  pass.
  - The slow M4 test **fails M4.3** as a point measure: both diets at year 3 in 50 % of
    seeds, against ≥ 60 %. Its final-year mean is 0.58 (learning off 0.59, M4 0.62).
  - The slow flora test passes.
- **Before merging M5**:
  - settle the criteria;
  - add a slow M5 statistical test;
  - mark ADR 0009 accepted;
  - freeze schema v6 (amended while unreleased; frozen from the merge).
- **Local runs** (gitignored):
  - `runs/m5-on` and `runs/m5-off` are the report's runs;
  - `runs/bal-*` are the balance variants (see ADR 0009);
  - `runs/m5-weak-*` and `runs/m5-probe1` are earlier experiments.
- **The machine is shared**: the owner runs other simulations here. Check that it is
  idle before heavy runs, and use `nice` for light work.
- **Shell**: the owner's shell sources ROS. Prefix Python commands with
  `env -u PYTHONPATH`.
