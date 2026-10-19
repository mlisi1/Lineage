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
| M7 | Rare genes (creatures and plants) | **done** 2026-10-19, merged into `main` (`d2f2d88`): M7.1 lowest gene appears in 95 % of seeds PASS; M7.2 85 % of seeds free of long fixation FAIL, 95 % without photosynthesis, which meets no night before M8: deferred to M8 by the owner (ADR 0015). Eight creature genes beside the phenotype, six plant genes; no schema bump | [reports/M7-rare-genes](../reports/M7-rare-genes/README.md) |
| M8 | Presence, calendar, god powers | **done** 2026-10-19, merged into `main` (`ab0165b`): M8.2 3-week absence survived in 100 % of seeds PASS; M8.3 August holiday 100 % PASS (added by the owner); M7.2 95 % PASS in office light; M8.1 night-trait selection p = 0.15 FAIL, deferred to M11 by the owner (ADR 0016). Light from presence (plants follow a week's light), a god-power button drawing by need, schema v8 | [reports/M8-presence](../reports/M8-presence/README.md) |
| M9 | Chronicle and bestiary | not started | — |
| M10 | Apocalypse and worlds | not started | — |
| M11 | Long-run tuning and stability | not started; plan and evidence so far in [m11-plan.md](m11-plan.md) (ADR 0011: tuning happens here, once) | — |
| R0 | Renderer spike on the device | **done** 2026-10-18: on the board with a 2560×1440 monitor standing in for the screen (ADR 0008), best profile `gpu-gles` on the GPU (Panfrost): map-view 59.5, mid-view 59.5, mid-crowd 30.0, local-view 59.9 fps median, all ≥ 30 (ADR 0010). A sprite in every cell (`spec-1x`) hangs the GPU: recorded, not judged | [reports/R0-renderer-spike](../reports/R0-renderer-spike/README.md); look: [reports/R0-look-sheet](../reports/R0-look-sheet/README.md) |
| R1 | Terrain and plants from the state stream | **done** 2026-10-19, merged into `main` (`8e51666`) after M7: everything in §8 delivered and tested on the PC (wire schema and generated types, the scene from recordings in the three views, grounds painted in a worker and faded in daily, plants by form, season and two genes), plus the cosy look after Stardew (ADR 0014), seasons turning over weeks, snow from the simulation, a moving sea, a winter recording, a leak test. Device measurements belong to R5 (owner); handoff below | look and films: [reports/R1-land-sheet](../reports/R1-land-sheet/README.md) |
| R2 | Procedural creatures | **done** 2026-10-19, merged into `main` (`0168618`) after R1: everything in §8 delivered and tested on the PC: the phenotype ported to TypeScript and held to the sim's 15 specimens (largest difference 2e-7), bodies from genes in the cosy look after Stardew (ADR 0013), chain, leg IK and fins, all eight rare-gene overlays and torpid animals curled up, one body plan per species, life between sim ticks, swimmers seen through the water (murk), 15 specimen snapshots. Device measurements belong to R5; drawing creatures in the real scene from the stream is R3's (handoff below) | [reports/R2-creature-sheet](../reports/R2-creature-sheet/README.md) |
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

### M8 closed (merged into `main` at `ab0165b`, 2026-10-19)

- What M8 left: `sim/lineage_sim/presence.py` (light from `PresenceChanged`; the button,
  `GodPower()`, with weighted powers and a cooldown), `[presence]` in `default.toml`,
  schema v8 (`v7_to_v8`, fixture `v8.lzma`), `tools/schedules.py` and
  `fastforward --schedule`, `tools/milestones/m8.py` (`--baseline` is repeatable).
  Design: `docs/design/presence.md`; decisions and results: ADR 0016.
- **Hardware change** (owner): a push button, not a covered switch; S2 builds
  `button.py`. The LED follows `GodPowerReady` / `Presence.ready_t_ms`.
- Golden hashes changed (schema version and the presence stream); an always-present
  world is otherwise bit-identical to M7.
- For R4: `Presence.light` is the light of the moment, `Fauna.torpid` who sleeps.
- For M9: `GodPowerUsed`, `GodPowerRefused`, `GodPowerReady` outputs; long absences
  (the dark ages) can be read from `Presence.present` and the light.
- Tests: fast suite 578 passed; slow `tools/tests/test_m8_statistical.py` passed
  (3 m 48 s at 8 workers).
- Branches `m8-presence` and `m8-daylight` deleted (both in `main`); nothing pushed.

### Starting M9 (chronicle and bestiary)

- **Branch**: `git switch main && git switch -c m9-chronicle`. Spec: CLAUDE.md §8 M9 and
  `docs/design/chronicle.md` (open: the importance scale and the "major" threshold for
  notifications; ask the owner).
- **What exists**: `sim/lineage_sim/chronicle.py` is a skeleton; the `CHRONICLE` random
  stream is reserved in `rng.py`. Output events already returned by `World.step` /
  `World.apply` (`events.py`): `DayStarted`, `SeasonStarted`, `VolcanoErupted`,
  `EarthquakeStruck`, `CraterFormed`, `LandmassSplit`, `LandmassesRejoined`,
  `FireStarted`, `FireEnded`, `CreaturesArrived`, `PopulationExtinct`, `JuvenileGrown`,
  `SpeciesBorn`, `SpeciesExtinct`, `GodPowerUsed`, `GodPowerRefused`, `GodPowerReady`.
  The chronicle subsystem can read these plus world state (species records and names in
  `Species.records()`, populations, rare carriers, `Presence.present`/`light` for dark
  ages). Detectors still to build: firsts, records, booms and crashes, migrations,
  anniversaries, dark ages (long absences).
- **Order**: a chronicle subsystem that sees other subsystems' outputs needs either a
  hook in `World` (outputs handed to it) or detectors run by the world after each step;
  decide in the plan. Its state (dedup/rate-limit memory, bestiary) is saved: schema v9.
- **Bestiary**: one record per species ever (genome snapshot for the portrait = the
  species' founding/centroid genome, `Species.records()`), dates, ancestry, facts.
- **Report** (CLAUDE.md §7, §8 M9): a sample 3-year chronicle, entries per month,
  importance distribution; run under `--schedule office` (ADR 0016: the gadget's light).
  Accept: `[2–15]` notable entries per sim-month median; no event type > 30 %.
- **Machine**: other simulations share this PC; pass `--jobs 8`–`10` to fast-forward
  (the default is every core). A 20-seed × 3-year run takes about 10 min at 10 jobs.
- Next free ADR: 0017 (check `/home/elechim/Lineage-coord/README.md`).


### R2 closed (merged into `main` at `0168618`, 2026-10-19)

Worked in `/home/elechim/Lineage-r2` (branch `r2-creatures`, which merged M7 and then
main with R1); notes with the other agents in `/home/elechim/Lineage-coord/`.

- **Done and tested on the PC**: renderer 209 unit tests, 22 Playwright tests (the 15
  specimens compared pixel for pixel from the canvas, not from a page screenshot);
  Python fast suite; ruff, pyright, eslint, prettier clean. Design in
  `docs/design/renderer.md` (Creatures: cosy, under water, rare genes, between sim ticks,
  one plan per species), decisions in ADR 0013 and its "Under water" amendment.
- **Where things are**: `renderer/src/creatures/` (genome, phenotype port, body plans,
  chain and curl, motion between ticks, species plans, water, rare genes);
  `CreatureLayer` is still `renderer/src/spike/creatures.ts` (it leans on the spike's
  atlas, habitat and camera types). The creature sheet is `renderer/creatures.html`
  (`npm run creatures`). The spike fixture is format 5 from `v7.lzma` (genomes, species,
  slots, torpid, `phenotype_config`, `rare_config`, signatures, casts).
- **For R3 (creatures in the real scene)**: feed the stream into a `CreatureLayer` with
  `life: "anchored"`: on each `creatures` message call `layer.anchor(i, x, y)`, never move
  bodies directly; genomes arrive in `born[]` (derive looks with `phenotype()` and
  `withRare()` from `fauna.phenotype_config` / `rare_config`); `species` per creature
  gives one plan per species (`speciesPlans`), to be recomputed when the census changes;
  `torpid` curls an animal up. Put the layer's containers among `Landscape.plants` rows
  (`hostIn`), and use R1's `seaAt(land)` (`src/terrain/sea.ts`) as the layer's `SeaAt`
  in place of the spike's `seaIn` (same bands).
- **On the board: in R5.** Cosy adds a ground shadow (and small glints) per animal: 2.5 %
  more sprites in the middle view; mid-crowd held exactly 30 fps in R0. `glass`, the
  see-through water look, stays on the sheet if R5 wants to try it (an `AlphaFilter` per
  swimmer in sight).
- **Glow** spots are drawn but never lit: the night and the glow pass are M8 and R4.

### R1 closed (merged into `main` at `8e51666`, 2026-10-19)

Merged into `main` on 2026-10-19, after M7. Worked in `/home/elechim/Lineage-r1` (branch
`r1-terrain`); the other agents exchange notes in `/home/elechim/Lineage-coord/` (not in git).

- **Done and tested on the PC**: renderer 166 unit tests, 20 Playwright tests (seven
  snapshots, the leak test); Python fast suite (533); ruff, pyright, eslint, prettier clean.
  Design in `docs/design/renderer.md` "The land from the state stream", decisions in
  ADR 0014 and its amendment.
- **On the board: in R5**, which the owner made the home of every device benchmark once
  R1–R4 are in. What to look at then for R1: the scene at `/?view=middle&x=60&y=60`,
  `/?view=local&x=26&y=47` and `/?view=map` with `every=1000` (≥ 30 fps; the pause when a
  day comes in, ≤ 0.3 s on the PC at the board's speed; the middle view's surf adds about
  30 MB of GPU memory); `?painter=inline` to compare. If a day's pause shows, move the
  middle view's island-wide shadows and the plant drawings at a turn of season into the
  worker (renderer.md, Open).
- **R2's merge** (next): expect conflicts in `renderer/public/spike/*` (regenerate with
  R2's `tools/replay.py` from `v7.lzma`), `renderer/vite.config.ts`,
  `renderer/package.json`, `docs/design/renderer.md`. After R2 is in, remove the re-export
  shims in `renderer/src/spike/{ground,seasons,plantart,plants,rng}.ts` and put R2's
  creatures among the plant rows of the real scene (`Landscape.plants`; R3's scene).
- **Rare plants** (M7's signatures) are drawn from the stream's `plant_rare`, fire pines
  surviving a fire included; the stream also carries M7's `born[].slots`, `torpid` and
  the `rare` table.
- **Two worktrees, one test port**: Playwright reuses a server already on its port, so
  R1's and R2's browser tests run at once tested each other's build (the "flaky" first
  runs). `PLAYWRIGHT_PORT` sets the port (R1 used 4573, R2 4373; 4173 by default).
- **Left for others**: the server's stream (S1: `SocketSource` is untried); the
  creatures, species and rare messages are encoded but only R2 will read them.

State at 2026-10-18, end of M7, for the next session (M8).

### M7 closed (merged into `main` at `d2f2d88`, 2026-10-19)

- What M7 left: `sim/lineage_sim/rare.py` (creature table `CreatureRare` in the bits of
  `Fauna.slots`; `rare.adjust` / `rare.body_of` change carriers' body values after
  `phenotype()`, which is untouched; torpor, sunlight, sight in the dark, toxic kill
  odds, waterproofing; signature tables for the renderer). Plants: `flora.Rare` gained
  POISONOUS, FRUITING, EMERGENT (`Flora.meal_factor`, `Flora.shade`, `flora.stature`).
  Decisions and results: ADR 0015; report `reports/M7-rare-genes/` (run `runs/m7-rare2`).
- **No schema bump** (v7 stays current). Golden hashes changed (one more flora draw per
  plant rare gene at establishment).
- M7.2 (85 %) is deferred to M8: photosynthesis sweeps herds in constant daylight; read
  without it, 95 % PASS. Longevity was given slower breeding after it swept a herd.
- Rare genes stay rare (≈ 0.1 % of creatures; most die out with their first carriers).
- Tests: scenarios per gene (`sim/tests/test_rare.py`, plant genes in test_flora.py);
  slow `sim/tests/test_rare_statistical.py` guards M7.1 and M7.2 without photosynthesis
  (17 min at 4 workers). Fast suite 517 passed; slow suite 7 passed (2026-10-19).
- For the renderer: `rare.RENDER_KEYS` / `rare.render_config` (giant_mass_factor), sent
  beside the phenotype config (R2's request).

### Starting M8 (presence, calendar, god powers)

- **Branch**: `git switch main && git switch -c m8-presence`; cherry-pick the parked day/night work from `m8-daylight` (`67dfeb6`).
- **Wire daylight**: the presence model must call `Flora.set_daylight` and
  `Fauna.set_daylight` (hooks, not saved). With nights: sight dims to `night_sight`
  (glow pays), photosynthesis loses light (its cost), hibernators go torpid in darkness
  below `hibernation_daylight`. Re-run M7's report on M8's schedules and judge M7.2 in
  full there (photosynthesis included).
- M8's report compares schedules on "rare-gene frequencies (glow, hibernation,
  photosynthesis)": `_rare_daily` already records carriers per day by diet class, and
  torpid counts.

### Parallel work (other agents)

R1 and R2 are merged (2026-10-19). Agents coordinate through
`/home/elechim/Lineage-coord` (status files and inboxes). R1's protocol already carries
the rare-gene table, `born[].slots`, `torpid` and the plant rare mask; R1 has M7's
descriptions of the plant looks. R2 has M7's notes on the creature overlays (only GIANT
changes body size). On merge: M7 changed one line of `tools/replay.py`
(`write_renderer_fixture` draws genes-only bodies); R2's replay supersedes it.
ADR numbers: 0013 R2, 0014 R1, 0015 M7; the next free is 0016 (check the board).
R2's `tools/replay.py` (fixture format 5) is the one in `main`.

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
  - `runs/m7-rare2` is the M7 report's run (`runs/m7-rare` before the longevity fix,
    `runs/m7-preview` and `runs/m7-loss005` are previews);
  - `runs/m6-species-pred` is the M6 report's run (`runs/m6-preview`, `m6-species`,
    `m6-species-final` are earlier M6 runs);
  - `runs/m5-on` and `runs/m5-off` are the M5 report's runs;
  - `runs/scav-*` and `runs/bal-*` are balance variants (ADR 0009);
  - `runs/m5-*-fresh` are incomplete (stopped).
