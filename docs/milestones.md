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
| M6 | Species, names, phylogeny | **done** 2026-10-18, merged into `main` (`1dd1720`): M6.2 1.08 splits / month PASS; M6.1 79 % of inhabited time with 3–12 species FAIL, deferred to M11 by the owner (ADR 0012). Species are genome clusters (`link_distance` 0.035); predator species split from groups of 5 | [reports/M6-species](../reports/M6-species/README.md) |
| M7 | Rare genes (creatures and plants) | next: start on a branch from `main` (handoff below) | — |
| M8 | Presence, calendar, god powers | not started | — |
| M9 | Chronicle and bestiary | not started | — |
| M10 | Apocalypse and worlds | not started | — |
| M11 | Long-run tuning and stability | not started; plan and evidence so far in [m11-plan.md](m11-plan.md) (ADR 0011: tuning happens here, once) | — |
| R0 | Renderer spike on the device | **done** 2026-10-18: on the board with a 2560×1440 monitor standing in for the screen (ADR 0008), best profile `gpu-gles` on the GPU (Panfrost): map-view 59.5, mid-view 59.5, mid-crowd 30.0, local-view 59.9 fps median, all ≥ 30 (ADR 0010). A sprite in every cell (`spec-1x`) hangs the GPU: recorded, not judged | [reports/R0-renderer-spike](../reports/R0-renderer-spike/README.md); look: [reports/R0-look-sheet](../reports/R0-look-sheet/README.md) |
| R1 | Terrain and plants from the state stream | **in review** on `r1-terrain` (2026-10-18), not merged: everything in §8 delivered and tested on the PC (wire schema and generated types, the scene from recordings in the three views, grounds painted in a worker and faded in daily, plants by form, season and two genes), plus the cosy look after Stardew (ADR 0014), seasons turning over weeks, snow from the simulation, a moving sea, a winter recording, a leak test. Device measurements belong to R5 (owner); handoff below | look and films: [reports/R1-land-sheet](../reports/R1-land-sheet/README.md) |
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

### R1 (terrain and plants from the state stream): in review on `r1-terrain`

State at 2026-10-18. Worked in `/home/elechim/Lineage-r1`; the agents of M6 and R2 work
beside it and exchange notes in `/home/elechim/Lineage-coord/` (not in git).

- **Done and tested on the PC**: renderer 160 unit tests, 20 Playwright tests (seven
  snapshots, the leak test); Python fast suite; ruff, pyright, eslint, prettier clean.
  Design in `docs/design/renderer.md` "The land from the state stream", decisions in
  ADR 0014 and its amendment.
- **On the board: in R5**, which the owner made the home of every device benchmark once
  R1–R4 are in. What to look at then for R1: the scene at `/?view=middle&x=60&y=60`,
  `/?view=local&x=26&y=47` and `/?view=map` with `every=1000` (≥ 30 fps; the pause when a
  day comes in, ≤ 0.3 s on the PC at the board's speed; the middle view's surf adds about
  30 MB of GPU memory); `?painter=inline` to compare. If a day's pause shows, move the
  middle view's island-wide shadows and the plant drawings at a turn of season into the
  worker (renderer.md, Open).
- **Merging** (the owner decides when): `main` with M6 is merged into `r1-terrain`
  already. With `r2-creatures` expect conflicts in `renderer/public/spike/*` (regenerate
  with R2's `tools/replay.py` from `v7.lzma`), `renderer/vite.config.ts`,
  `renderer/package.json`; with `m7-rare-genes` in `sim/lineage_sim/flora.py`, `config.py`
  and `default.toml` (R1's two `[flora]` snow keys and `snow_cover` beside M7's rare ones). After R2 is in,
  remove the re-export shims in `renderer/src/spike/{ground,seasons,plantart,plants,rng}.ts`
  and put R2's creatures among the plant rows of the real scene (`Landscape.plants`).
- **Left for others**: the server's stream (S1: `SocketSource` is untried); rare-gene
  looks (M7 is coordinating: `plant_rare`, `born[].slots`, `torpid` and the `rare`
  signature table are in the stream, read from M7's code once it is merged); the
  creatures, species and rare messages are encoded but only R2 will read them.


State at 2026-10-18, end of M6, for the next session (M7).

### M6 closed

M6 was merged into `main` on 2026-10-18 (`1dd1720`); lint, types and the fast suite (476)
passed after the merge (the renderer was not touched).

- **Schema v7 and `sim/tests/fixtures/saves/v7.lzma` are frozen**: any change to saved
  fields needs v8 and a migration.
- What M6 left in place: `species.py` (daily census after fauna; lineage labels; splits of
  genome clusters, `link_distance` 0.035, groups of 8, 5 for predator species; genome
  names; phylogeny), `SpeciesBorn` / `SpeciesExtinct` events, `world.species.records()`
  and `labels_now()` (species per creature at any tick). Decisions, sweeps and findings:
  ADR 0012; report `reports/M6-species/`.
- M6.1 (79 % of inhabited time with 3–12 species, target 90 %) is deferred to M11 by the
  owner; M6.2 passes (1.08 splits / month). Predators still starve and depend partly on
  arrivals; omnivores are rare strangers (`docs/m11-plan.md` §6).
- Earlier parked work: branch `m8-daylight` (`67dfeb6`) holds the started day/night
  work; cherry-pick it when M8 starts (it does not type-check until M8 wires it in).

### Parallel work (other agents)

R1 (`r1-terrain`, worktree `/home/elechim/Lineage-r1`) and R2 (`r2-creatures`, worktree
`/home/elechim/Lineage-r2`) are in progress and not merged. They coordinate with the sim
work through plain files in **`/home/elechim/Lineage-coord`** (not in git; rules in its
README): read your inbox (`m7-inbox.md`) and the others' status files before
touching shared files, and keep a status file of your own (`m7.md`).

- R1 owns the wire schema (`server/lineage_server/protocol/`); it carries `species` per
  creature (from `labels_now()`), a species table, and M7's rare genes (see R1 above).
- R2 owns the renderer's creatures and a TypeScript port of `fauna/phenotype.py`
  (with `CONFIG_KEYS` / `phenotype_config` on its branch, and a test that
  `sim/tests/fixtures/phenotypes.json` matches the default `[fauna]` config). **Any
  change to the phenotype or to `[fauna]` keys it reads must be announced to R2.**
- Pending on those branches: R1 adds two `[flora]` keys (snow); R2 adds milestone R5 to
  CLAUDE.md §8 and `docs/milestones.md`. ADR numbers, settled on the board: 0012 M6,
  0013 R2, 0014 R1, 0015 M7.

### Starting M7 (rare genes, creatures and plants)

- **Branch**: `git switch main && git switch -c m7-rare-genes` (no remote push has been
  done for M6; `origin/main` is behind `main`).
- **Read first**: CLAUDE.md §8 M7 and §9; `docs/design/creatures.md` (genome, rare-gene
  slots) and `docs/design/plants.md` (rare genes); ADR 0004 (flora) and 0005 (fauna);
  ADR 0011 (features first: keep the island viable, do not tune); `docs/m11-plan.md` §3
  and §6 (add M7's findings there).
- **What exists**:
  - `sim/lineage_sim/rare.py` is a skeleton.
  - Creatures: `Fauna.slots` (uint16 per creature, saved), inherited bit by bit with
    gains and losses (`genome.inherit_slots`; `[fauna] rare_slots` 8,
    `rare_gain_probability` 0.0005, `rare_loss_probability` 0.02). **Nothing reads the
    slots yet**: no creature rare gene has an effect. Arrivals start with none.
  - Plants: `flora.Rare` (IntFlag, a bit mask per cell, `Flora.rare`): `FIRE_PINE`,
    `NITROGEN_FIXER`, `MANGROVE`, with effects and growth costs; `[flora]
    rare_gain_probability` 0.0002, `rare_loss_probability` 0.01. fastforward already
    records `rare_<name>` cell counts per sample.
  - Species and lineages (M6) are there to measure "lineage persistence per gene".
- **Questions to settle at the start** (CLAUDE.md §9: propose, then ask):
  - The full tables: which creature genes (the docs name venom, glow, hibernation,
    photosynthesis) and which further plant genes (ADR 0009 / 0011 slot **poisonous
    plants** here, to make diet learning and traditions matter).
  - Darkness-dependent genes (glow, hibernation, photosynthesis) before M8 brings night:
    `Flora.set_daylight` is a hook, but nothing sets daylight yet. Test them with an
    injected daylight in scenarios only, or pull a minimal daylight input forward?
  - Do creature rare genes act through the phenotype (shared with R2's renderer port) or
    beside it? Visual-signature flags for the renderer are a deliverable.
  - Gain rates: at 0.0005 per bit per newborn, does each gene appear in ≥ 30 % of 3-year
    seeds (M7's band)? Measure before choosing.
- **Schema**: any new saved state (per-creature state such as hibernating, new plant
  bits beyond the mask's width) means schema v8, a v7→v8 migration and a `v8.lzma`
  fixture.
- **Report**: `tools/milestones/m7.py` registered in `tools/report.py`, 20 seeds × 3
  years: appearance frequency, carrier lifespan, lineage persistence per gene, frequency
  trajectories; criteria: every gene appears in ≥ 30 % of seeds; none above 90 % of the
  population for more than 3 sim-months in ≥ 90 % of seeds. M5's and M6's modules
  generate a "What the plots show" section; reuse it.
- **A cheap pattern from M6**: when a mechanism is bookkeeping (it does not change what
  happens), many variants can run beside one world per seed (see ADR 0012, the sweeps).

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
  - `runs/m6-species-pred` is the M6 report's run (`runs/m6-preview`, `m6-species`,
    `m6-species-final` are earlier M6 runs);
  - `runs/m5-on` and `runs/m5-off` are the M5 report's runs;
  - `runs/scav-*` and `runs/bal-*` are balance variants (ADR 0009);
  - `runs/m5-*-fresh` are incomplete (stopped).
