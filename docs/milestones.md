# Milestone status

Mirrors CLAUDE.md §8. Update in the same commit that changes a milestone's state.

| ID | Milestone | Status | Report |
|---|---|---|---|
| M0 | Repository and tooling | done | — |
| M1 | Core: clock, RNG, world loop, state, saves, migrations | done | — (not statistical) |
| M2 | Terrain generation and dynamics | done | [reports/M2-terrain](../reports/M2-terrain/README.md) |
| M3 | Flora | done | [reports/M3-flora](../reports/M3-flora/README.md) |
| M4 | Fauna I: genome, body, energy, reproduction, evolution | done | [reports/M4-fauna-evolution](../reports/M4-fauna-evolution/README.md) |
| M5 | Fauna II: lifetime learning | in progress. Criteria revised with the owner (CLAUDE.md §8, ADR 0009). Built: meal learning, diet traditions, fading exploration, toxic plants, plant-form senses, scavenging (newest, not yet measured at world scale). Last report (before scavenging): M5.1 diet fit 100 % of seeds PASS, M5.2 60 % PASS (borderline), M5.3 PASS; M4.3 final-year mean 0.58 (band 0.6) | [reports/M5-fauna-learning](../reports/M5-fauna-learning/README.md) (predates scavenging) |
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
- **The newest change, scavenging (`d13ad12`), is tested but not yet measured in full
  worlds.**
  - The dead leave carrion, meat eaters eat it, and a carrion sense leads them to it.
  - It was added because hunters starve: 509 of 570 hunter deaths, median age 11 days.
    Wasted attacks are not the cause (attack costs are 0.2 % of resting burn), which is
    why strike-or-hold was not built.
  - The committed M5 report and the balance numbers in ADR 0009 predate it.
- **Next steps, in order**:
  1. Measure scavenging: learning-on runs (20 seeds × 3 years) with `meat_energy` 1 600
     (current) and 900 (the M4 value; carrion may make the richer meat unnecessary).
     Compare M4.3 final-year mean (target ≥ 0.6),
     predator presence, extinctions, omnivores (does a scavenger niche appear?).
     Commands are in ADR 0009, "Consequences and next steps"; the stopped runs were
     `runs/scav-on` and `runs/scav-on-meat900`.
  2. Pick the meat setting, rerun the M5 ON/OFF pair with forks, regenerate the M5 report,
     run the slow tests (`-m slow`), and update ADR 0009 with the numbers.
  3. Add a slow M5 statistical test (diet fit, competence trend, step cost), mark
     ADR 0009 accepted, and merge M5 to `main` (schema v6 frozen from then on).
  4. Later: rest (with M8's day and night), and the other candidates in ADR 0009
     (learning danger, cover refuge, evolved rewards).
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
