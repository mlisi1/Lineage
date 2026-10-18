# Milestone status

Mirrors CLAUDE.md §8. Update in the same commit that changes a milestone's state.

| ID | Milestone | Status | Report |
|---|---|---|---|
| M0 | Repository and tooling | done | — |
| M1 | Core: clock, RNG, world loop, state, saves, migrations | done | — (not statistical) |
| M2 | Terrain generation and dynamics | done | [reports/M2-terrain](../reports/M2-terrain/README.md) |
| M3 | Flora | done | [reports/M3-flora](../reports/M3-flora/README.md) |
| M4 | Fauna I: genome, body, energy, reproduction, evolution | done | [reports/M4-fauna-evolution](../reports/M4-fauna-evolution/README.md) |
| M5 | Fauna II: lifetime learning | **done** 2026-10-18 on branch `m5-lifetime-learning` (merge into `main` pending): M5.1 diet fit positive in 20/20 seeds PASS, M5.3 308 ms per sim-day PASS, M5.2 reported without a band (shielding, ADR 0009); M4.3 final-year mean 0.66 PASS; slow tests green. Meal learning, diet traditions, fading exploration, toxic plants, plant-form senses, scavenging | [reports/M5-fauna-learning](../reports/M5-fauna-learning/README.md) |
| M6 | Species, names, phylogeny | not started | — |
| M7 | Rare genes (creatures and plants) | not started | — |
| M8 | Presence, calendar, god powers | not started | — |
| M9 | Chronicle and bestiary | not started | — |
| M10 | Apocalypse and worlds | not started | — |
| M11 | Long-run tuning and stability | not started | — |
| R0 | Renderer spike on the device | **done** 2026-10-18: on the board with a 2560×1440 monitor standing in for the screen (ADR 0008), best profile `gpu-gles` on the GPU (Panfrost): map-view 59.5, mid-view 59.5, mid-crowd 30.0, local-view 59.9 fps median, all ≥ 30 (ADR 0010). A sprite in every cell (`spec-1x`) hangs the GPU: recorded, not judged | [reports/R0-renderer-spike](../reports/R0-renderer-spike/README.md); look: [reports/R0-look-sheet](../reports/R0-look-sheet/README.md) |
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

State at 2026-10-18 (after merging R0), for the next session:

- **Branches**: R0 is done and merged into `main` (`de7c8da`). `m5-lifetime-learning`
  holds M5 and has `main` merged in (`b6a0468`), so it merges back cleanly. Both are on
  the remote.
- **Read first**: ADR 0009, "Current design (summary)" at the top, then "Criteria
  adopted" and "Where M5 stands after balancing". The M5 report opens with a generated
  "What the plots show".
- **M5 is done** (ADR 0009 accepted): report regenerated at `0f7b41e`; slow tests green on
  this state (the five existing ones and `tools/tests/test_m5_statistical.py`).
- **Next steps, in order** (ADR 0011: features first, tuning once in M11):
  1. Merge `m5-lifetime-learning` into `main` (owner; `main` is already merged in, so no
     conflicts are expected). From the merge, schema v6 and `v6.lzma` are frozen.
  2. M6: species, names, phylogeny. Then M7 (with poisonous plants and diet traditions
     that matter), M8 (day and night: pick up the parked work on `m8-daylight`; check
     for weekend extinctions), M9 (chronicle; make learning visible), M10, and M11
     (tune everything together).
  3. Between milestones keep the island viable (no collapse, both diets present), not
     tuned.
- **Owner's standing choices**:
  - balancing calls may be made autonomously, provided M4's criteria still pass;
  - sources go in the ADR's References;
  - commits carry no co-author line.
- **Tests at `d13ad12`**: lint, format, types and the fast suite (404) pass. The slow M4
  test now reads M4.3 as the final-year mean; it was last run before scavenging (point
  measure 50 %; final-year mean then 0.58).
- **Local runs** (gitignored):
  - `runs/m5-on` and `runs/m5-off` are the current report's runs (pre-scavenging);
  - `runs/bal-*` are the balance variants;
  - `runs/scav-on*` are incomplete (stopped).
- **The machine is shared**: the owner runs other simulations here. Check that it is
  idle before heavy runs, and use `nice` for light work.
- **Shell**: the owner's shell sources ROS. Prefix Python commands with
  `env -u PYTHONPATH`.
