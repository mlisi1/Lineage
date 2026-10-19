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
| M7 | Rare genes (creatures and plants) | **done** 2026-10-18 on `m7-rare-genes` (awaiting merge): M7.1 lowest gene appears in 95 % of seeds PASS; M7.2 85 % of seeds free of long fixation FAIL, 95 % without photosynthesis, which meets no night before M8: deferred to M8 by the owner (ADR 0015). Eight creature genes beside the phenotype, six plant genes; no schema bump | [reports/M7-rare-genes](../reports/M7-rare-genes/README.md) |
| M8 | Presence, calendar, god powers | not started | — |
| M9 | Chronicle and bestiary | not started | — |
| M10 | Apocalypse and worlds | not started | — |
| M11 | Long-run tuning and stability | not started; plan and evidence so far in [m11-plan.md](m11-plan.md) (ADR 0011: tuning happens here, once) | — |
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

State at 2026-10-18, end of M7, for the next session (M8).

### M7 closed (on `m7-rare-genes`, not merged yet)

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

- **Branch**: `git switch main && git switch -c m8-presence` after `m7-rare-genes` is
  merged; cherry-pick the parked day/night work from `m8-daylight` (`67dfeb6`).
- **Wire daylight**: the presence model must call `Flora.set_daylight` and
  `Fauna.set_daylight` (hooks, not saved). With nights: sight dims to `night_sight`
  (glow pays), photosynthesis loses light (its cost), hibernators go torpid in darkness
  below `hibernation_daylight`. Re-run M7's report on M8's schedules and judge M7.2 in
  full there (photosynthesis included).
- M8's report compares schedules on "rare-gene frequencies (glow, hibernation,
  photosynthesis)": `_rare_daily` already records carriers per day by diet class, and
  torpid counts.

### Parallel work (other agents)

R1 (`r1-terrain`, `/home/elechim/Lineage-r1`) is in review; R2 (`r2-creatures`,
`/home/elechim/Lineage-r2`) is in progress. They coordinate through
`/home/elechim/Lineage-coord` (status files and inboxes). R1's protocol already carries
the rare-gene table, `born[].slots`, `torpid` and the plant rare mask; R1 has M7's
descriptions of the plant looks. R2 has M7's notes on the creature overlays (only GIANT
changes body size). On merge: M7 changed one line of `tools/replay.py`
(`write_renderer_fixture` draws genes-only bodies); R2's replay supersedes it.
ADR numbers: 0013 R2, 0014 R1, 0015 M7; the next free is 0016 (check the board).

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
