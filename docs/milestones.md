# Milestone status

Mirrors CLAUDE.md §8. Update in the same commit that changes a milestone's state.

| ID | Milestone | Status | Report |
|---|---|---|---|
| M0 | Repository and tooling | done | — |
| M1 | Core: clock, RNG, world loop, state, saves, migrations | done | — (not statistical) |
| M2 | Terrain generation and dynamics | done | [reports/M2-terrain](../reports/M2-terrain/README.md) |
| M3 | Flora | done | [reports/M3-flora](../reports/M3-flora/README.md) |
| M4 | Fauna I: genome, body, energy, reproduction, evolution | done | [reports/M4-fauna-evolution](../reports/M4-fauna-evolution/README.md) |
| M5 | Fauna II: lifetime learning | **done** 2026-10-18, merged into `main` (`f87f592`): M5.1 diet fit positive in 20/20 seeds PASS, M5.3 308 ms per sim-day PASS, M5.2 reported without a band (shielding, ADR 0009); M4.3 final-year mean 0.66 PASS; slow tests green. Meal learning, diet traditions, fading exploration, toxic plants, plant-form senses, scavenging | [reports/M5-fauna-learning](../reports/M5-fauna-learning/README.md) |
| M6 | Species, names, phylogeny | **done** 2026-10-18 on branch `m6-species` (awaiting merge into `main`): M6.2 1.08 splits / month PASS; M6.1 79 % of inhabited time with 3–12 species FAIL, deferred to M11 by the owner (ADR 0012). Species are genome clusters (`link_distance` 0.035); predator species split from groups of 5 | [reports/M6-species](../reports/M6-species/README.md) |
| M7 | Rare genes (creatures and plants) | not started | — |
| M8 | Presence, calendar, god powers | not started | — |
| M9 | Chronicle and bestiary | not started | — |
| M10 | Apocalypse and worlds | not started | — |
| M11 | Long-run tuning and stability | not started; plan and evidence so far in [m11-plan.md](m11-plan.md) (ADR 0011: tuning happens here, once) | — |
| R0 | Renderer spike on the device | **done** 2026-10-18: on the board with a 2560×1440 monitor standing in for the screen (ADR 0008), best profile `gpu-gles` on the GPU (Panfrost): map-view 59.5, mid-view 59.5, mid-crowd 30.0, local-view 59.9 fps median, all ≥ 30 (ADR 0010). A sprite in every cell (`spec-1x`) hangs the GPU: recorded, not judged | [reports/R0-renderer-spike](../reports/R0-renderer-spike/README.md); look: [reports/R0-look-sheet](../reports/R0-look-sheet/README.md) |
| R1 | Terrain and plants from the state stream | not started | — |
| R2 | Procedural creatures | not started | — |
| R3 | Documentary camera and captions | not started | — |
| R4 | Atmosphere | not started | — |
| R5 | Final rendering pass and device benchmark | not started; added 2026-10-18 (owner): every device benchmark of R1–R4 is taken here, on the final look | — |
| S1 | Server: real-time loop and persistence | not started | — |
| S2 | Device layer | not started | — |
| S3 | Phone app and API | not started | — |
| S4 | Notifications | not started | — |
| S5 | Public journal | not started | — |
| S6 | Deployment | not started | — |
| S7 | Soak test | not started | — |

## Handoff notes

State at 2026-10-18, end of M5, for the next session.

### M5 closed

M5 was merged into `main` on 2026-10-18 (`f87f592`); lint, types, the fast suite (441)
and the renderer tests (130) passed after the merge.

- **Schema v6 and `sim/tests/fixtures/saves/v6.lzma` are frozen**: any change to saved
  fields needs v7 and a migration.
- Branch `m8-daylight` (`67dfeb6`) parks the started day/night work. When M8 starts,
  branch from `main` and bring that commit over (`git cherry-pick 67dfeb6`); it does not
  type-check until M8 wires it in.
- *(Optional, not done)* Validate M5 on seeds the tuning never saw (seeds 20–39; about 17
  minutes on all cores). `docs/m11-plan.md` §2 makes this M11's first step anyway.

  ```sh
  uv run python -m tools.fastforward --years 3 --seeds 20 --seed-base 20 --save-days 30 --snapshot-days 60 --fork-days 60 --fork-length 28 --out runs/m5-on-fresh
  uv run python -m tools.fastforward --years 3 --seeds 20 --seed-base 20 --save-days 30 --snapshot-days 60 --set fauna.learning=false --out runs/m5-off-fresh
  uv run python -m tools.report M5 --runs runs/m5-on-fresh --baseline runs/m5-off-fresh --out /tmp/m5-fresh
  ```

### M6 (species) — state on `m6-species`, 2026-10-18

- Built: `species.py` (daily census, lineage labels, splits, genome names, phylogeny,
  `labels_now()` for the renderer), `SpeciesBorn` / `SpeciesExtinct`, schema **v7**
  (`v6_to_v7.py`, fixture `v7.lzma`, unreleased until merge), `[species]` config, the M6
  report (`tools/milestones/m6.py`). Decisions and sweep: ADR 0012 (status: proposed).
- Owner's decisions: all genes count; lineage labels + splits; M6.2 counts splits only;
  M6.1 on inhabited time, median seed; then (after the first runs) species are genome
  clusters (`link_distance` 0.035), finer than who can mate.
- Owner accepted M6 with M6.1 deferred to M11 (`docs/m11-plan.md` §6). ADR 0012 accepted.
- Next: merge `m6-species` into `main` (schema v7 and `v7.lzma` frozen from then); then M7.
- Parallel work: R1 and R2 run in other worktrees; the coordination board is
  `/home/elechim/Lineage-coord` (not in git). R1 will carry `species` in the protocol.
- To rebuild the report: `uv run python -m tools.fastforward --years 3 --seeds 20
  --save-days 30 --snapshot-days 0 --jobs 16 --out runs/m6-species-pred`, then
  `uv run python -m tools.report M6 --runs runs/m6-species-pred` (the committed report
  is from `runs/m6-species-pred`, the same command at `11a4640`).

### Starting M6 (species, names, phylogeny) — the brief, kept for reference

- **Branch**: `git switch main && git pull && git switch -c m6-species`.
- **Read first**: CLAUDE.md §8 M6 and §9; `docs/design/creatures.md` (genome, species
  section); ADR 0005 (fauna model) and ADR 0009 "Current design (summary)"; ADR 0011
  (features first: keep the island viable, do not tune); `docs/m11-plan.md` §6 (add
  M6's findings there).
- **What exists**: `sim/lineage_sim/species.py` is a skeleton. Fauna exposes `ids`,
  `genes` (14: eleven body genes, then `LEARNING`, `EXPLORATION`, `SOCIAL`),
  `generation`, and `origin` / `ancestors` (the genome each lineage arrived with).
  Pairwise genome distance: `lineage_sim.fauna.genome.distance_matrix`; mate compatibility is
  `compat_distance` 0.10 over all 14 genes. Plants already cluster their genomes
  (`Flora.species_count`), a possible pattern.
- **Questions to settle at the start** (CLAUDE.md §9: propose, then ask):
  - Do the three learning genes count for species, as they do for mating?
  - How do persistent ids follow clusters from day to day (member overlap, centroid
    distance)?
  - Fauna keeps no parent ids, so the phylogeny must come from species-level tracking of
    which cluster a new one split from.
- **Schema**: species state (registry, ids, phylogeny) is new saved state, so schema v7,
  a v6→v7 migration and a `v7.lzma` fixture (CLAUDE.md §4.4). A `species` period goes in
  `[schedule]` (daily).
- **Outputs**: species born and extinct as output events (CLAUDE.md §4.1 names
  `SpeciesBorn`), for M9's chronicle.
- **Report**: `tools/milestones/m6.py` registered in `tools/report.py`, 20 seeds × 3
  years. M5 added a generated "What the plots show" section to its report
  (`tools/milestones/m5.py`), a pattern worth reusing.

### Working notes

- **Owner's standing choices**:
  - balancing calls may be made autonomously, provided M4's criteria still pass;
  - between milestones keep the island viable, and tune in M11 (ADR 0011);
  - sources behind design decisions go in the ADR's References;
  - commits carry no co-author line.
- **The machine is shared**: the owner runs other simulations here. Check that it is
  idle before heavy runs (`uptime`), and use `nice` for light work.
- **Shell**: the owner's shell sources ROS. Prefix Python commands with
  `env -u PYTHONPATH`.
- **Golden hashes**: the root `conftest.py` keeps NumPy off AVX-512 kernels so that test
  machines agree. Hashes computed by scripts outside pytest match on this machine (no
  AVX-512), but check with pytest.
- **Local runs** (gitignored; deletable):
  - `runs/m5-on` and `runs/m5-off` are the M5 report's runs;
  - `runs/scav-*` and `runs/bal-*` are balance variants (ADR 0009);
  - `runs/m5-*-fresh` are incomplete (stopped).
