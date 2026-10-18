# CLAUDE.md — Lineage

Guidance for Claude (and humans) working in this repository. Read this file fully before
making changes. When this file and a request disagree, ask.

## 1. What Lineage is

Lineage is an idle desk gadget: a small procedurally generated island where creatures and
plants evolve over **years** of real time. It sits on a work desk, runs 24/7, and writes its
own history.

- **Creatures**: genome → procedural body; small neural brain; evolution plus lifetime
  learning (reinforcement); rare genes with an extreme bonus and a real cost.
- **Plants**: vegetation grid; 8-gene plant genome; succession (bare → grass → shrub →
  forest), fire, grazing; rare plant genes.
- **Terrain**: height + fertility grids; plate drift, sea-level cycles, erosion, volcanoes;
  everything changes slowly and never resets except at the end of a world.
- **The owner's presence is the sun**: a PIR sensor sets daylight. Evenings are dusk,
  weekends are the "Long Night", holidays are dark ages. Seasons follow the real calendar.
- **One rare intervention**: a covered switch triggers a "god power" (meteor, rain, seed…)
  with a 7-day cooldown, shown by an LED.
- **Worlds end**: if life collapses, an apocalypse plays and a new continent is generated.
  Past worlds are archived.
- **Chronicle and bestiary**: an event detector writes dated history entries; every species
  that ever lived is recorded.
- **Outputs**: one continuous scene on a 7" screen (documentary camera + captions), a phone
  web app, push notifications for major events, and a daily public journal (static site).
- **Look**: pixel art everywhere (flat palettes, stepped shading, hard pixel edges); see
  `docs/design/concept.md`. The screen shows the world from three distances: the
  continent as a map, a region, and one animal from close to the ground
  (`docs/design/renderer.md`, ADR 0007).

Design references live in `docs/design/` and `mockups/`. They are the spec; keep them in
sync when behaviour changes.

## 2. Target hardware (for context; hardware work comes later)

- Orange Pi Zero 2W (Allwinner H618, quad A53; the 2 GB model), Debian-based OS, Python 3.11.
- Waveshare 70H-1024600 7" IPS, 1024×600, HDMI via adapter board + 15 cm FPC; backlight
  enable/PWM pins driven from GPIO.
- PIR sensor, covered toggle switch, cooldown LED, 18650 UPS module with mains-loss sense.
- The software must also run fully on a normal PC with no hardware attached.

## 3. Repository layout

```
lineage/
├── CLAUDE.md                 # this file
├── README.md
├── docs/
│   ├── design/               # spec: concept, creatures, plants, terrain, chronicle, presence
│   ├── decisions/            # ADRs: NNNN-short-title.md (context, decision, consequences)
│   ├── milestones.md         # status table mirrored from section 8 of this file; handoff notes
│   └── m11-plan.md           # how M11 will tune the island (evidence from M5 onward)
├── sim/                      # Python package `lineage_sim` — the world. Pure. No I/O.
│   ├── pyproject.toml
│   ├── lineage_sim/
│   │   ├── clock.py          # sim time, calendar, seasons; time is INJECTED, never read
│   │   ├── rng.py            # seeded streams per subsystem
│   │   ├── config.py         # typed config loaded from TOML
│   │   ├── world.py          # World: owns subsystems, step(dt), apply(event)
│   │   ├── subsystem.py      # Context + Subsystem protocol (what the World drives)
│   │   ├── terrain.py
│   │   ├── flora.py
│   │   ├── fauna/            # genome.py, phenotype.py, brain.py, creature.py, population.py
│   │   ├── species.py        # clustering, persistent ids, names, phylogeny
│   │   ├── rare.py           # rare gene tables (creatures + plants)
│   │   ├── presence.py       # presence/daylight model, god powers, cooldown
│   │   ├── chronicle.py      # event detectors → entries; bestiary records
│   │   ├── apocalypse.py     # end-of-world detection, new continent
│   │   ├── events.py         # input events (presence, switch, power) and output events
│   │   └── state/
│   │       ├── schema.py     # versioned, serialisable state
│   │       ├── io.py         # save/load (compressed), atomic writes handled by caller
│   │       └── migrations/   # vN_to_vN+1.py, one file per bump, never edited after release
│   ├── config/default.toml   # every tunable lives here, documented inline
│   └── tests/                # fauna_site.py: hand-built site shared by fauna scenario tests
├── tools/                    # dev-only CLIs (not deployed)
│   ├── fastforward.py        # run N sim-years headless for M seeds → runs/<id>/
│   ├── report.py             # build a milestone report from runs → reports/<milestone>/
│   ├── runs.py               # on-disk format of runs/<id>/
│   ├── milestones/           # per-milestone metrics, acceptance criteria, report sections
│   ├── viz/                  # shared plotting style + figure helpers
│   ├── replay.py             # load a save, inspect, render stills and renderer fixtures
│   └── kiosk_bench.py        # benchmark a renderer page in Chromium kiosk on the device (R0);
│                             #   standard library only: copied to the board as one file
├── renderer/                 # TypeScript + PixiJS (WebGL). One renderer for desk and phone.
│   ├── src/                  # terrain/, plants/, creatures/, camera.ts, captions.ts, protocol.ts
│   │   └── spike/            # R0 spike: the scene, its in-page benchmark (spike.html) and
│   │                         #   the look sheet (look.html)
│   ├── scripts/              # look-report.mjs: write the look sheet to reports/
│   ├── public/spike/         # the world the spike draws; generated by tools/replay.py
│   └── tests/                # vitest unit tests + Playwright visual snapshots
├── server/                   # Python package `lineage_server` — runs on the device
│   └── lineage_server/       # main.py (sim loop + persistence), ws.py, api.py, notify.py, journal.py
├── device/                   # Python package `lineage_device` — the ONLY code touching GPIO
│   └── lineage_device/       # presence.py, switch.py, led.py, backlight.py, power.py, fake.py
├── app/                      # phone PWA shell, reuses renderer/
├── journal/                  # static site templates
├── deploy/                   # os notes, systemd units, setup.sh, kiosk, backups, tailscale
├── mockups/                  # HTML mockups and enclosure concepts (reference only)
├── reports/                  # committed milestone reports (HTML + metrics.json), see §7
├── runs/                     # gitignored raw fast-forward output
├── hardware/                 # LATER: bom/, electrical/, cad/ (see §10)
└── .github/workflows/        # ci.yml (fast), nightly.yml (long runs), journal.yml
```

Do not create directories outside this layout without updating this file.

## 4. Architecture rules (non-negotiable)

1. **The simulation is pure.** `lineage_sim` never reads the wall clock, filesystem,
   network, environment, or GPIO. Time advances only through `World.step(dt)`; the real world
   reaches it only as events (`PresenceChanged`, `GodPower`, `PowerLost`…) via
   `World.apply(event)`. Outputs are returned (`ChronicleEntry`, `SpeciesBorn`…), not
   pushed anywhere.
2. **Determinism.** Same seed + same config + same event sequence ⇒ bit-identical state.
   Every random draw comes from `rng.py` streams (one stream per subsystem, so adding draws
   in fauna does not change terrain). No `random`, no `np.random` global state, no
   iteration over sets/dicts whose order can vary, no time-based seeds.
3. **One time model.** Sim time is seconds since world creation, mapped 1:1 to wall time on
   the device. Fast-forward runs the same code with large `dt`/many steps. Subsystems run
   on their own schedules (see `config/default.toml` `[schedule]`): creatures at a
   behaviour rate, flora and terrain on coarse ticks. Never hard-code a schedule elsewhere.
4. **Saves outlive code.** The world will run for years while the code changes.
   - State carries `schema_version`. Any change to persisted fields bumps it and adds a
     migration in `state/migrations/`.
   - Every migration has a test that loads a frozen fixture save from the previous version
     (`sim/tests/fixtures/saves/vN.lzma`) and checks invariants after upgrading.
   - Never delete or edit a released migration or fixture.
5. **Tunables live in config.** Rates, thresholds and probabilities go in
   `config/default.toml` with a comment giving units and intent. Code reads them through
   the typed `config.py`. Magic numbers in sim code are a review blocker.
6. **Hardware isolation.** Only `lineage_device` touches GPIO. It exposes the same
   interface as `lineage_device.fake`, which maps keyboard keys / a small web panel to
   presence, switch and power events, so everything runs on a PC.
7. **One renderer.** The desk kiosk and the phone draw the same scene from the same state
   stream. The wire format is defined once (`server/.../protocol` JSON schema) and the
   TypeScript types are generated from it. If the on-device graphics spike (R0) fails, a
   native renderer may be added beside `renderer/`, consuming the same protocol.
8. **Performance budget on the device.** Sim ≤ 25% of one core on average; renderer ≥ 30 fps
   at 1024×600; daily save ≤ 2 s; RAM for sim + server ≤ 300 MB. Benchmarks guard these.

## 5. Tooling and conventions

- **Python** 3.11 (device OS version). Managed with `uv`; one workspace with `sim`,
  `server`, `device`, `tools` as members.
- **Numerics**: NumPy, vectorised over grids and populations. No per-cell Python loops in
  hot paths (flora/terrain); creatures may loop in Python only if the benchmark allows it.
  Numba or a small C extension only after an ADR.
- **Lint/format/type**: `ruff check`, `ruff format`, `pyright --strict` on `sim/`.
- **TypeScript**: strict mode, Vite, PixiJS, vitest, Playwright; `eslint` + `prettier`.
- **Commands** (keep this list accurate):
  - `uv sync` — install the workspace (Python 3.11, all members, dev tools)
  - `uv run ruff check . && uv run ruff format --check . && uv run pyright` — lint/format/types
  - `uv run pytest -m "not slow"` — fast suite (CI on every push)
  - `uv run pytest -m slow` — long statistical tests (nightly)
  - `uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/<id>`
    (`--save-days 30` for long statistical runs; `--power-cut-day N` to test resume;
    `--set fauna.learning=false` to change one config key for an ablation;
    `--fork-days 60 --fork-length 28` to fork every 60 days with learning on and off, M5)
  - `uv run python -m tools.report <milestone> --runs runs/<id>`
    (`--baseline runs/<id>` for ablation reports, M5: the run with the mechanism off)
  - `uv run python -m tools.replay <save.lzma> [--still out.png] [--renderer-fixture DIR]`
    — inspect a save; `--renderer-fixture renderer/public/spike` regenerates the spike's world
  - `cd renderer && npm run build` — build the pages into `renderer/dist`
  - `cd renderer && npm run look` — write the look sheet (how terrain, plants and creatures
    are drawn) to `reports/R0-look-sheet/`; live at `/look.html` under `npm run dev`
  - `cd renderer && npm run creatures` — write the creature sheet (phenotype port against
    the sim, creature styles side by side) to `reports/R2-creature-sheet/`; live at
    `/creatures.html`
  - on the board: `python3 kiosk_bench.py --dist dist` (procedure in `deploy/README.md`;
    from a board in its box, `deploy/board-setup.md`),
    then `uv run python -m tools.report R0 --runs <directory holding kiosk-bench.json>`
  - `cd renderer && npm test && npx playwright test`
  - `cd renderer && npm run typecheck && npm run lint`
- **Dependencies**: ask before adding any new dependency; record why in the PR/commit.
- **Commits**: small, one concern each, message `area: imperative summary`
  (`flora: add fire spread`). Reference the milestone id (`[M3]`).
- **Docs**: when behaviour changes, update `docs/design/*` in the same commit.
- **Naming in code**: genes are named constants/enums, never bare indices.

## 6. Testing policy

Every code addition ships with tests. A milestone is not done until its tests, its report
(if statistical) and its docs are in.

**Kinds of tests, by layer**

| Kind | Where | What |
|---|---|---|
| Unit | everywhere | pure functions: genome → phenotype, suitability, naming, migrations |
| Property (Hypothesis) | sim | invariants under random inputs: heights in [0,1], energy never negative, populations finite, gene values clamped, save→load→save identical |
| Determinism | sim | golden hash of state after N steps for fixed seeds; two runs equal; independent subsystem streams |
| Scenario | sim | hand-built worlds that must produce a specific outcome (a fire spreads through dry forest and stops at water; a strait closes when uplift exceeds threshold; a chronicle trigger fires exactly once) |
| Statistical | sim (`slow`) | many seeds, many sim-years; assert on distributions with tolerance bands, never on one seed |
| Migration | sim | fixture save of every past schema version loads and passes invariants |
| Benchmark | sim, server | `pytest-benchmark`; fail if > budget (§4.8) on CI reference machine; on-device numbers recorded in reports |
| Visual | renderer | Playwright screenshots of fixed states (seeded) compared to baselines |
| Integration | server, device | sim ↔ server ↔ fake device end to end; power-loss → save → restart resumes identical state |
| Soak | device | multi-day run on hardware; memory, CPU, temperature, saves |

**Rules**
- Fix the seed in every test. Statistical tests use ≥ 20 seeds and report the spread.
- A failing statistical test is investigated, never "re-run until green". If tolerance
  bands change, the report must show why.
- Golden hashes change only with an explanation in the commit message.
- Tests must not depend on wall-clock time or network.

## 7. Milestone reports (visualisation and artifacts)

Any milestone that involves statistical behaviour (terrain dynamics, succession, evolution,
learning, tuning) must produce a report:

```
reports/<MID>-<slug>/
├── report.html      # self-contained: figures inline, readable without the repo
├── metrics.json     # every number the acceptance criteria check, plus seeds and config hash
├── config.toml      # exact config used
└── README.md        # 10-line summary: what was run, PASS/FAIL per criterion, notes
```

Report content standard:
- **Header**: milestone, git commit, config hash, seeds, sim-years, wall time.
- **Acceptance table**: each criterion from §8, measured value, target band, PASS/FAIL.
- **Time series** with the median across seeds and a 10–90% band, never a single seed alone.
- **Distributions** (histograms/violin) for per-seed outcomes (e.g. time to first forest).
- **Spatial snapshots**: map grids at fixed sim-times for 2–3 representative seeds
  (and one worst-case seed), plus an animated GIF/WebP where change over time matters.
- **Comparison/ablation** plots when the milestone introduces a mechanism (on vs off).
- Shared plotting style from `tools/viz/style.py`: consistent colours per land-cover class,
  per species, per event type; axes labelled with units; one axis per chart.

Raw runs go to `runs/` (gitignored). Only the report directory is committed. Reports are
regenerated, never hand-edited.

A milestone measured on the device (R0) has no fast-forward run: its report is built from
the file the device benchmark wrote, and that file is committed in the report directory
in place of `config.toml`, because a PC cannot regenerate it.

## 8. Milestones

Tracks run partly in parallel: **M** = simulation, **R** = renderer, **S** = server/device/
deploy. Each milestone lists deliverables, tests and acceptance criteria. Targets in
`[brackets]` are initial bands to be refined by the milestone's own report; changing them
needs a note in `docs/decisions/`.

### M0 — Repository and tooling
- **Deliver**: layout from §3 with package skeletons, `uv` workspace, ruff/pyright, pytest +
  hypothesis + pytest-benchmark, vitest + Playwright skeleton, CI workflow (fast suite),
  nightly workflow (slow suite), `tools/viz/style.py`, report scaffolding (`tools/report.py`
  producing an empty report with header), `docs/design/` populated from the design notes.
- **Tests**: CI green on an empty-but-real test per package; report tool produces a valid
  HTML for a dummy run.
- **Done when**: `uv run pytest`, `npm test`, and a dummy report all run from a fresh clone.

### M1 — Core: clock, RNG, world loop, state, saves, migrations
- **Deliver**: `clock.py` (calendar, seasons, day/week from injected time), `rng.py`
  (named streams), `world.py` (step/apply/outputs), state schema v1, compressed save/load,
  migration framework with a toy v0→v1 migration and fixture.
- **Tests**: determinism (two runs same hash; reordering unrelated subsystems keeps
  streams independent), save→load→continue equals uninterrupted run, migration fixture,
  property tests on clock (season boundaries, leap years, DST irrelevant because UTC
  internally), benchmark of empty step.
- **Done when**: a 3-sim-year empty world fast-forwards, saves daily, survives a simulated
  power cut mid-run and resumes bit-identical.

### M2 — Terrain generation and dynamics
- **Deliver**: island generation (noise + falloff), fertility layer, sea-level cycle,
  moving uplift/subsidence, erosion (vegetation-aware hook), events: volcano, earthquake,
  crater; landmass counting.
- **Tests**: properties (bounds, no NaN, mass roughly conserved by erosion), scenario
  (volcano creates new land at the right place; strait closes under uplift), determinism.
- **Report** (20 seeds × 10 sim-years): land fraction, sea level, landmass count over time;
  coastline change per year; snapshot grid + GIF; event frequency.
- **Accept**: land fraction stays in `[0.25, 0.6]`; ≥ 1 split/rejoin per 3 years in
  `[≥ 50%]` of seeds; no seed loses all land; terrain step within budget.

### M3 — Flora
- **Deliver**: vegetation grid, 8-gene plant genome, growth/suitability, dispersal (wind,
  fruit), shading succession, soil building, grazing hook, fire (spread, fire-pine
  survival), winter dieback, plant rare genes, erosion feedback.
- **Tests**: unit (suitability, form classification), scenario (fire stops at water; trees
  cannot establish on infertile soil; flooded cells die), properties, determinism,
  benchmark (full grid step).
- **Report** (20 seeds × 5 sim-years from bare rock): land-cover stacked area (median +
  band), time to first shrubland / first forest (distributions), plant species count,
  soil fertility, fire sizes (log histogram), map snapshots per season and per year.
- **Accept**: grass covers ≥ 50% of land within `[3–9 sim-months]`; first closed forest
  within `[12–24 sim-months]`; ≥ 4 distinct plant forms coexist at year 3 in ≥ 80% of
  seeds; no seed ends at 100% one class.

### M4 — Fauna I: genome, body, energy, reproduction, evolution
- **Deliver**: creature genome (body genes + rare slots), phenotype function (shared spec
  with renderer), movement on terrain, metabolism, eating plants/meat, sexual reproduction
  with mate compatibility, mutation, asexual fallback, population cap; brains are evolved
  only (no lifetime learning yet).
- **Tests**: phenotype unit tests (trade-offs hold: bigger ⇒ costlier), energy
  conservation bounds, scenario (starving creature dies; compatible pair breeds;
  incompatible pair does not), properties, determinism, benchmark at 150 creatures.
- **Report** (20 seeds × 3 sim-years): population, births/deaths, trait means and
  distributions over time (size, diet, limbs, speed, armour), habitat occupancy,
  extinction events.
- **Accept**: total extinction in `[< 20%]` of seed-years; trait distributions drift
  measurably from ancestors (mean genetic distance rising); both herbivores and predators
  present during year 3 in `[≥ 60%]` of seeds (mean over the final year, not one day:
  predator packs boom and bust within months; ADR 0009).

### M5 — Fauna II: lifetime learning
- **Deliver**: reward-modulated policy update with eligibility traces and exploration
  noise; learning-rate and exploration genes; "time to competence" metric. (As built,
  ADR 0009: learning from meals, diet traditions, plant-form senses, scavenging.)
- **Tests**: unit (update rule on a toy bandit improves reward), scenario (a single
  creature in a food field learns to approach food within N steps), determinism.
- **Report**: ablation learning ON vs OFF (same seeds): survival, mean energy, time to
  competence across generations (Baldwin effect plot), learning-rate gene trajectory.
- **Accept**: learning tracks the local environment: final-year diet fit (learned plant
  preference against local plant defence) positive in `[≥ 80%]` of seeds; step cost within
  budget. Reported without a band: early-life feeding gain (originally `[≥ 15%]`, out of
  reach on a balanced island), time to competence across generations (originally a
  downward trend in `[≥ 60%]` of seeds), and shielding versus genetic assimilation; every
  run shows shielding, the opposite of a Baldwin effect. Revised 2026-10-17 and
  2026-10-18 (ADR 0009).

### M6 — Species, names, phylogeny
- **Deliver**: daily genome clustering with persistent ids, speciation/extinction
  detection, syllable names derived from genome with lineage-aware daughter names,
  phylogeny store.
- **Tests**: clustering stability (small noise does not split species), split detection
  scenario, name determinism and uniqueness, phylogeny is a valid tree.
- **Report**: species count over time, speciation and extinction rates per sim-month,
  rendered phylogenetic tree for 3 seeds, name samples.
- **Accept**: species alive in `[3–12]` for ≥ 90% of sim-time; speciation `[≥ 1 / month]`
  median. (As built, ADR 0012: species are genome clusters, finer than who can mate;
  sim-time is inhabited time, median seed; speciation counts splits only. M6.1 measured
  79 % and was deferred to M11 by the owner, 2026-10-18.)

### M7 — Rare genes (creatures and plants)
- **Deliver**: full rare tables for both kingdoms, appearance and loss rates, effects and
  costs, visual-signature flags for the renderer.
- **Tests**: each rare gene's bonus and cost measurable in a controlled scenario
  (e.g. venom kills larger prey; photosynthesis starves in darkness).
- **Report**: appearance frequency, carrier lifespan and lineage persistence per gene,
  frequency trajectories, which genes dominate under which conditions.
- **Accept**: every rare gene appears in `[≥ 30%]` of 3-year seeds; none reaches fixation
  (> 90% of population) for more than `[3 sim-months]` in `[≥ 90%]` of seeds.

### M8 — Presence, calendar, god powers
- **Deliver**: daylight from presence events with hold logic handled upstream, dusk/dawn,
  weekend Long Night, holiday darkness, moonlight floor after N days, seasons from
  calendar, god powers (meteor, rain, seed, ark) with cooldown state.
- **Tests**: synthetic presence schedules; cooldown enforced; scenario (3-week absence
  does not auto-extinguish all life above `[x%]` of seeds).
- **Report**: compare schedules — always present, office hours, office + August break,
  3-week conference — on populations, nocturnal trait frequency, rare-gene frequencies
  (glow, hibernation, photosynthesis).
- **Accept**: office schedule produces measurable selection on night traits vs
  always-present; 3-week absence survival `[≥ 80%]` of seeds.

### M9 — Chronicle and bestiary
- **Deliver**: event detectors (speciation, extinction, firsts, records, booms/crashes,
  migrations, splits/rejoins, fires, volcanoes, god powers, anniversaries), templated
  text, importance scores, deduplication/rate limiting, bestiary records with portraits'
  genome snapshot.
- **Tests**: each detector fires exactly once on its scenario; no duplicate spam over a
  long run; text templates render for all event types.
- **Report**: sample 3-year chronicle (rendered), entries per month histogram, importance
  distribution.
- **Accept**: `[2–15]` notable entries per sim-month median; no event type > 30% of all
  entries.

### M10 — Apocalypse and worlds
- **Deliver**: collapse detection, end-of-world event, new continent with new seed,
  archive of the previous world (chronicle, bestiary, phylogeny, final map), world
  numbering.
- **Tests**: scenario (forced collapse ends world exactly once), archive integrity,
  migrations cover archives.
- **Accept**: archives load and render; new world starts within budget.

### M11 — Long-run tuning and stability
- **Deliver**: tuned `default.toml`; `tools/tune/` sweeps. Plan and evidence so far:
  `docs/m11-plan.md` (ADR 0011: features first, tuning once here).
- **Tests**: nightly 3-year × 20-seed run with all acceptance criteria from M2–M10.
- **Report**: full dashboard — all prior metrics at 3 sim-years, genetic distance from
  ancestors, sensitivity of key metrics to the top tunables.
- **Accept**: every M2–M10 criterion passes simultaneously; mean genetic distance still
  rising at year 3 (no stagnation).

### R0 — Renderer spike on the device (gates R1+)
- **Deliver**: PixiJS scene with 50 animated chain-of-circles creatures, a terrain bitmap,
  plant sprites and a full-screen tint, in Chromium kiosk on the Orange Pi at 1024×600.
- **Measure**: fps (median, 1% low), CPU, GPU driver in use, RAM.
- **Accept**: ≥ 30 fps median in each of the three views and the crowded middle one
  (ADR 0010; the first scene, a sprite in every cell, is measured but not judged).
  Otherwise write an ADR choosing the native fallback. A larger HDMI display may stand
  in for the 7" screen (ADR 0008).

### R1 — Terrain and plants from the state stream
- **Deliver**: protocol types generated from the schema; the ground painted from the
  cells for the three views (ADR 0007), cross-faded when it changes and painted off the
  frame; the plants that stand on it, by form and season.
- **Tests**: vitest for plant form mapping; Playwright snapshots of fixed states.

### R2 — Procedural creatures
- **Deliver**: body from genes (spine, limbs, mouth, eyes, armour, patterns, rare
  overlays), procedural animation (chain follow, leg IK, fins). Phenotype spec shared with
  `fauna/phenotype.py`; a cross-language test checks both produce the same derived values
  for a fixture set of genomes.
- **Tests**: vitest geometry tests, Playwright snapshots of the 15 specimen genomes.

### R3 — Documentary camera and captions
- **Deliver**: subject selection (interest score), the three views (map, region, one
  animal followed from close by) and the moves between them, wide shots at dawn, captions
  from chronicle entries, Monday recap tour.
- **Tests**: subject selection unit tests; snapshot of caption layout; no caption overlaps.

### R4 — Atmosphere
- **Deliver**: day/night tint from presence, glow pass, seasons, weather of events,
  apocalypse sequence.
- **Tests**: snapshots per lighting state. (Its device benchmark moved to R5.)

### R5 — Final rendering pass and device benchmark
- **Deliver**: the look of terrain, plants, creatures and atmosphere tuned together, as one
  pass over R1–R4 (the cosy palette, ADR 0013, is the starting point); the R0 benchmark's
  views rebuilt on the real renderer and the state stream; on-device numbers in a report.
  R1–R4 do not measure on the device; they keep within the PC-side checks and leave the
  board to R5.
- **Tests**: Playwright snapshots of the final look; the benchmark runs on the board
  (`tools/kiosk_bench.py`, procedure in `deploy/README.md`).
- **Accept**: ≥ 30 fps median in each of the three views and the crowded middle one, as R0
  (ADR 0010), with the final look; Chromium's memory within the board's budget (§4.8).

### S1 — Server: real-time loop and persistence
- **Deliver**: run the sim in real time, daily atomic saves (write temp → fsync → rename),
  keep last N saves, WebSocket state stream, recovery on start.
- **Tests**: integration with fake device; kill -9 during save leaves a loadable save.

### S2 — Device layer
- **Deliver**: PIR with configurable hold, switch with debounce, LED, backlight
  sleep/dim, mains-loss detection → save → clean shutdown, `fake.py` parity.
- **Tests**: unit with mocked GPIO; fake ↔ real interface conformance test.

### S3 — Phone app and API
- **Deliver**: read-only API (chronicle, bestiary, stats, phylogeny), PWA reusing the
  renderer, follow-a-creature.
- **Tests**: API contract tests; Playwright mobile viewport snapshots.

### S4 — Notifications
- **Deliver**: ntfy/Telegram adapter for major events, rate limited, quiet hours.
- **Tests**: adapter mocked; rate limit scenario.

### S5 — Public journal
- **Deliver**: daily static site (chronicle, creature of the day, map, archive of worlds),
  publish to GitHub Pages; doubles as off-device backup of the save.
- **Tests**: site builds from fixture state; links valid.

### S6 — Deployment
- **Deliver**: `deploy/setup.sh` for a fresh SD card, systemd units, kiosk, display
  timings, Tailscale notes, log rotation, SD-wear settings.
- **Tests**: shellcheck; dry-run in a Debian container.

### S7 — Soak test
- **Deliver**: 7-day run on the device with telemetry.
- **Report**: CPU, RAM, temperature, fps, save durations, any restarts.
- **Accept**: no leak trend, no crashes, all budgets in §4.8 met.

**Suggested order**: M0 → M1 → R0 (as soon as hardware is on the desk) → M2 → M3 → M4 →
M5 → M6 → M7 → M8 → M9 → M10 → M11, with R1–R4 following M3/M4, R5 once R1–R4 are in,
and S1–S7 after M8.

## 9. How to work on a milestone (for Claude)

1. Read the milestone in §8 and the related `docs/design/` page. If the spec is ambiguous,
   ask before coding; propose the interpretation.
2. Write a short plan in the PR/commit description: files touched, new config keys, schema
   changes (and the migration), tests to add.
3. Implement in small commits. Tests come with the code, not after.
4. Run the fast suite. For statistical milestones, run the fast-forward and build the
   report (§7); read the plots yourself before claiming success and describe what they
   show, including anything surprising.
5. Update `docs/milestones.md` status, `docs/design/*`, and this file if commands or
   layout changed.
6. Never claim a criterion passes without the number from `metrics.json`.

## 10. Hardware (later)

Not in scope yet. When it starts:
- `hardware/cad/` — **SolidWorks** native files (`.SLDPRT`, `.SLDASM`, `.SLDDRW`) tracked
  with **Git LFS**; every release also exports `step/` and print-ready `stl/` so the design
  is usable without SolidWorks. Measured part dimensions recorded in
  `hardware/cad/params.md` (single source of truth).
- `hardware/electrical/` — schematic, `pinout.yaml` (the only place GPIO numbers are
  defined; `lineage_device` reads it), power budget.
- `hardware/bom/bom.csv` — part, qty, source, price, link, owned.
Add `.gitattributes` LFS rules before the first CAD commit.
