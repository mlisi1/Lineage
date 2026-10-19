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
| M9 | Chronicle and bestiary | **done** 2026-10-19, merged into `main` (`1a1513c`): M9.1 3.5 notable entries / month PASS (19/20 seeds in band); M9.2 largest type extinction 18.9 % PASS (ADR 0017). Importance 1–5 (notable ≥ 3, major ≥ 4), English templates, history and bestiary in the save (schema v9), observer hook in `World` | [reports/M9-chronicle](../reports/M9-chronicle/README.md) |
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

### Starting M10 (apocalypse and worlds)

- **Branch**: `git switch main && git switch -c m10-worlds`. Spec: CLAUDE.md §8 M10 and
  `docs/design/concept.md` "World lifecycle". Read "Working on a milestone here" below
  first.
- **Ask the owner before coding** (`concept.md` lists both as open):
  1. *What ends a world.* Today a collapse never sticks: when the last creature dies
     (`PopulationExtinct`), `Fauna.tick` waits for spring or summer and lands 40 new
     founders once plants cover half the land (`_await_founders`, `[fauna]`
     `founder_*`, `arrival_delay_days`); strangers also land about 6 times a year
     (`immigrant_groups_per_year`) and the ark god power brings 12. Total extinction is
     rare anyway: 0–5 % of seeds over 3 years (M8 report, all schedules). So the owner
     must say what "life collapses" means: no creatures for N days, too few species for
     N months, the land drowned, the island emptied of plants, or something else; and
     whether re-founding should then stop. Propose a criterion with numbers from a run.
  2. *How many archived worlds the device keeps* (SD card; S1 owns the files).
- **What exists**: `sim/lineage_sim/apocalypse.py` is a 4-line skeleton; the
  `APOCALYPSE` stream name is reserved in `rng.py` (no `[schedule]` key, no config
  section yet). `World` has no world number; `WorldState` holds `seed`, `epoch_unix_ms`,
  `t_ms`, `rng`, `subsystems` (`state/schema.py`, `SCHEMA_VERSION = 9`).
- **What the chronicle gives an archive** (ADR 0017): the world's whole history is in
  its save. `world.chronicle.entries()` (numbered `ChronicleEntry`), `bestiary()` (one
  `BestiaryRecord` per species, founding genome = portrait), `world.species.records()`
  (phylogeny), `terrain.height`, `flora.cover()` for the final map. The chronicle writes
  `last_creature` (importance 5); an end-of-world entry would be a new `Kind` with its
  own `importance_*` key, and `first_life` is once per world (the chronicle's state is
  per world, so a new world needs a fresh chronicle).
- **Design questions to settle in the plan** (CLAUDE.md §4.1: the sim is pure, outputs
  are returned): how the World starts over (a new seed drawn from the `APOCALYPSE`
  stream, the epoch moved to the end instant, a world number carried over); what the
  archive is (the final `WorldState`, or a slimmer tree) and how it leaves the sim (an
  output event such as `WorldEnded(archive=…)`, or a method the server calls); "migrations
  cover archives": an archive saved at v10 must load after v11, so it should go through
  the same `state/migrations` chain; schema v10 for the world number and apocalypse state.
- **Report**: M10 is not statistical in §8 (accept: archives load and render, a new world
  starts within budget), but a forced-collapse run and a benchmark of starting a new
  world belong in the tests; "render" means `tools/replay.py --still` draws an archive.
- Next free ADR: 0018 (claim it in `/home/elechim/Lineage-coord/README.md`).

### Working on a milestone here (lessons so far)

**Adding a subsystem or persisted state** (the chronicle, M9, did all of this):

1. The class in `sim/lineage_sim/`, following the `Subsystem` protocol (`subsystem.py`):
   `name` (= its stream and `[schedule]` key), `initialize`, `tick`, `handle`,
   `get_state`, `set_state`. To see other subsystems' outputs, also implement `observe`
   (`Observer`); the World calls it after each batch. Read other subsystems through
   narrow `Protocol`s (see `chronicle.py`, `species.py`) so tests can use doubles.
2. Register it in `world.default_subsystems` (order is tick order at equal times) and
   add a typed property on `World` if callers need it.
3. Config: a frozen dataclass in `config.py` with checks in `__post_init__`, its section
   name in `parse_config`'s known sections, the section in `sim/config/default.toml`
   with units and intent for every key, and the `[schedule]` period.
4. Schema: bump `SCHEMA_VERSION` in `state/schema.py`, add `migrations/vN_to_vN+1.py`
   (raw trees, never current classes; an empty world, no `terrain`, only bumps the
   version) and register it in `migrations/__init__.py`; generate `vN+1.lzma` with a
   short script and record its recipe in `sim/tests/fixtures/saves/README.md`; add
   `test_vN+1_fixture_values` and an upgrade test in `test_migrations.py`. A fixture is
   frozen from the merge on; before that it may be regenerated.
5. Tests that list subsystems or the schedule must change with it: `test_config.py`
   (`test_default_config` schedule dict), `test_flora.py`
   (`test_streams_are_per_subsystem`), `test_migrations.py` (subsystem lists of v3/v4).
   Golden hashes all change with a schema bump (the version is hashed): update them in
   `test_determinism.py`, `test_flora.py`, `test_fauna.py`, `test_terrain.py` and say why
   in the commit message. Prove the new part does not disturb the others (M9:
   `test_the_chronicle_only_watches`).

**Reports**: `tools/milestones/mN.py` (`CRITERIA`, `SERIES_LABELS`, `metrics(run)`,
`sections(run, run_dir)`), registered in `tools/report.py` (`MODULES`, `CRITERIA`,
`SERIES_LABELS`). New per-seed data goes into fast-forward's series as `_`-prefixed
extras (`tools/fastforward.py`, column tuples beside the others). Tests:
`tools/tests/test_mN_report.py` with a synthetic run (see `test_m9_report.py`), and a
slow `test_mN_statistical.py` for the criteria on 20 seeds. Run statistical milestones
under `--schedule office` (ADR 0016).

**Pitfalls met** (more under "Working notes" at the end):
- Commit before a fast-forward run: the manifest stamps the commit, `-dirty` if
  anything outside `reports/` is modified, even a fixture being regenerated.
- Timings on this PC at `--jobs 10` / 8 workers: a 20-seed × 3-year office run 15–22 min,
  the full fast suite 5–9 min, the slow M9 tests 13–19 min.
- Never wait on a process with `pgrep -f`/`pkill -f` and a pattern that also appears in
  the waiting command itself: it matches its own shell (and `pkill` kills it). Wait on
  an output file instead (fast-forward writes `manifest.json` last).
- Scripts in the session scratchpad (`/tmp/…`) are lost on reboot; fixture recipes live
  in the fixtures README.
- ruff rejects `# fmt: skip` inside an expression (RUF028); use it only on statements.

### M9 closed (merged into `main` at `1a1513c`, 2026-10-19)

- What M9 leaves: `sim/lineage_sim/chronicle.py` (detectors, filters, templates,
  `entries()`, `bestiary()`), `subsystem.Observer` and the hook in `World`,
  `[chronicle]` in `default.toml`, schema v9 (`v8_to_v9`, fixture `v9.lzma`),
  `Presence.absent_hours`, fast-forward's `_chronicle` tables, `tools/milestones/m9.py`
  (sample chronicle, entries per month, types, importance, bestiary), the slow
  `tools/tests/test_m9_statistical.py`. Design: `docs/design/chronicle.md`; decisions
  and results: ADR 0017.
- Report run `m9-office` (office schedule) at `3097936`, 22 min at 10 jobs. Tests: fast
  suite 621 passed; slow `tools/tests/test_m9_statistical.py` passed (18 min 42 s at 8
  workers). Added after the merge: a scenario test for every record, and a slow test
  that checks every seed's 3-year history for spam (daily cap, repeated sentences,
  swings and migrations within their gaps); both slow tests passed (12 min 45 s). Golden hashes changed (schema version and the chronicle's state, explained
  in the commits); a world without the chronicle is bit-identical to one with it.
- Schema v9 is released: `v9.lzma` is frozen. Branch `m9-chronicle` deleted; `main`
  pushed to `origin` (at `11fde65`).
- For R3: captions from `ChronicleEntry` (`kind`, `importance`, `text`, `species`, `x`,
  `y`, -1 when no place); the wire schema does not carry entries yet.
- For S4: push `importance >= config.chronicle.major_importance` (about 0.7 a month).
- For M10: the archive of a world is its save; `Chronicle.bestiary()` gives the records.
- For M11: big fires are rare in office light (5 of 150 reach 300 cells); booms and
  crashes are 23 % of entries together.

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

No other agent is active (2026-10-19): R1, R2, M6–M9 are merged and closed. Agents
coordinate through `/home/elechim/Lineage-coord` (README with the worktree table and
claimed ADR numbers, a status file and an inbox per agent); a new milestone adds its row
and claims its ADR there. ADRs so far: 0001–0017; the next free is 0018.

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
  - `runs/m9-office` is the M9 report's run (at `3097936`); its saves feed the report's
    bestiary section, so keep it to rebuild the report;
  - `runs/m8-office`, `m8-always`, `m8-office-august`, `m8-conference` are the M8
    report's runs (`m8-preview-office` a preview);
  - `runs/m7-rare2` is the M7 report's run (`runs/m7-rare` before the longevity fix,
    `runs/m7-preview` and `runs/m7-loss005` are previews);
  - `runs/m6-species-pred` is the M6 report's run (`runs/m6-preview`, `m6-species`,
    `m6-species-final` are earlier M6 runs);
  - `runs/m5-on` and `runs/m5-off` are the M5 report's runs;
  - `runs/scav-*` and `runs/bal-*` are balance variants (ADR 0009);
  - `runs/m5-*-fresh` are incomplete (stopped).
