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
| M10 | Apocalypse and worlds | **done** 2026-10-20, merged into `main` (`af98573`): archives load and render (an ended real world drawn by `replay --still`), ending a world and starting the next 73 ms median (budget 0.3 s on the PC). The last creature's death ends a world once life is established (the owner); the World archives itself and starts the next at once; every archive kept; schema v10 (ADR 0018) | — (not statistical) |
| M11 | Long-run tuning and stability | next (brief below); plan and evidence so far in [m11-plan.md](m11-plan.md) (ADR 0011: tuning happens here, once) | — |
| R0 | Renderer spike on the device | **done** 2026-10-18: on the board with a 2560×1440 monitor standing in for the screen (ADR 0008), best profile `gpu-gles` on the GPU (Panfrost): map-view 59.5, mid-view 59.5, mid-crowd 30.0, local-view 59.9 fps median, all ≥ 30 (ADR 0010). A sprite in every cell (`spec-1x`) hangs the GPU: recorded, not judged | [reports/R0-renderer-spike](../reports/R0-renderer-spike/README.md); look: [reports/R0-look-sheet](../reports/R0-look-sheet/README.md) |
| R1 | Terrain and plants from the state stream | **done** 2026-10-19, merged into `main` (`8e51666`) after M7: everything in §8 delivered and tested on the PC (wire schema and generated types, the scene from recordings in the three views, grounds painted in a worker and faded in daily, plants by form, season and two genes), plus the cosy look after Stardew (ADR 0014), seasons turning over weeks, snow from the simulation, a moving sea, a winter recording, a leak test. Device measurements belong to R5 (owner); handoff below | look and films: [reports/R1-land-sheet](../reports/R1-land-sheet/README.md) |
| R2 | Procedural creatures | **done** 2026-10-19, merged into `main` (`0168618`) after R1: everything in §8 delivered and tested on the PC: the phenotype ported to TypeScript and held to the sim's 15 specimens (largest difference 2e-7), bodies from genes in the cosy look after Stardew (ADR 0013), chain, leg IK and fins, all eight rare-gene overlays and torpid animals curled up, one body plan per species, life between sim ticks, swimmers seen through the water (murk), 15 specimen snapshots. Device measurements belong to R5; drawing creatures in the real scene from the stream is R3's (handoff below) | [reports/R2-creature-sheet](../reports/R2-creature-sheet/README.md) |
| R3 | Documentary camera and captions | **done** 2026-10-20, merged into `main`: the owner's view button steps map → middle (drifting over the island) → local (following an animal of a random species, about five minutes each, glided or cut to) → map, and the map comes back after 15 minutes; springs, not locks; dips to dark between views; notable chronicle entries on a parchment scroll in a pixel font; the stream's animals drawn in the scene; a `chronicle` message on the wire. Dawn shots and the Monday recap dropped by the owner (ADR 0020). Device measurements belong to R5 | — |
| R4 | Atmosphere | **done** 2026-10-21, merged into `main` (`d9770d3`) after seven rounds of the owner's look tuning: moonlit-blue nights, rose dusks and lilac dawns eased between the sim's light steps, the day graded by the season and greyed under cloud; an additive glow pass; the island's own weather in the sim (rain spells, thunder, storms whose lightning alone starts fires, overcast; schema v12 on M11's v11 algae), fire and new cones and craters kill animals; rain, snow, flames, charred woods, terraced cones with lava, lit craters, quake shake, meteor streak and flash, the seed's sprouts and the ark's newcomers; tides by a shader and the open sea's swell; the three-minute apocalypse on the map; `sky` and `events` on the wire (ADR 0021). Films at 1024×600, 30 fps, are not in git; the report keeps stills. Device measurements belong to R5 | [reports/R4-atmosphere](../reports/R4-atmosphere/README.md) |
| R5 | Final rendering pass and device benchmark | **in progress** from 2026-10-21 on `r5-final` (worktree `../Lineage-r5`): the owner's look rounds and checklist items 1–16, 21, 22 in (gene colours, map dots, ground, grass, the young, water, bushes, bodies and legs, deaths, the name card and scroll, eating, hunting, births, wind, sleep, small life; ADR 0022); the owner called the look final on 2026-10-25; tests in (item 20, 2026-10-25); left: the board run (17–19), the merge; checklist under "R5 checklist"; added 2026-10-18 (owner): every device benchmark of R1–R4 is taken here, on the final look | — |
| S1 | Server: real-time loop and persistence | not started | — |
| S2 | Device layer | not started | — |
| S3 | Phone app and API | not started | — |
| S4 | Notifications | not started | — |
| S5 | Public journal | not started | — |
| S6 | Deployment | not started | — |
| S7 | Soak test | not started | — |

## Handoff notes

### R4 closed (merged into `main` at `d9770d3`, 2026-10-21; branch `r4-atmosphere` and its worktree removed)

- **What it left**: `renderer/src/atmosphere/` (`light.ts`, `apocalypse.ts`,
  `particles.ts`, `sprites.ts`, `demo.ts`, `atmosphere.ts`), wired in `src/main.ts`;
  `Herd.glowing` and `CreatureLayer.spine`; the map painted with surf (`landscape.ts`,
  `terrain/ground.ts`); `sky` and `events` messages (`schema.json`, `encode.sky_message`,
  `events_message`, `entries_message`); `Presence.raining` (read-only, no schema bump);
  `tools/stream.py --sky-every --schedule --press-days --famine-day`; the recordings
  `office.json` and `end.json`. Design: `docs/design/renderer.md` "The atmosphere";
  decisions: ADR 0021.
- **Round 2** (owner's comments, 2026-10-20): in the sim, the island's own weather
  (`weather.py`: rain spells, visual thunder, thunderstorms whose lightning alone starts
  fires; `[flora] fire_ignitions_per_year` became `fire_strikes_per_storm_hour`) and fire
  kills animals (`[fauna] fire_damage_per_hour`, `BURNT`), schema v12 on top of M11's
  algae v11 (cherry-picked). Renderer: flame sprites, charred trees and ground, ripples,
  three sizes of lightning, drawn cones and craters, the powers' real effects, algae.
  Wire: `sky.rain`, `land.scorch` and `land.algae`, `creatures_arrived`, land after events.
  Tool: `--stage`. All committed recordings regenerated with the new sim.
- **Rounds 3 and 4** (owner, 2026-10-20): the report films every view at 1024×600 and
  30 fps (ffmpeg; films gitignored). In the sim, a barren ring round cones and craters
  (`[flora] barren_reach`, `barren_days`, `Flora.barren`) and newcomers never scattered
  into the sea. Renderer: terraced cones with flowing lava (`marks.ts`, eight frames) in
  a skirt of scree; a crater drawn from a lit height field; a pulsing ring glow; rain
  sized to the view in three wind-leaning layers under grey cloud; two large flames to a
  cell up close; the scorch cell by cell; `fireReach` for the made-up fire; the ark's
  newcomers coming into being (`CreatureLayer.arrive`, `Herd.arrival`); the seed's
  sprouts; tides (`terrain/sea.ts` `tidePhase`, `swashLevel`; surf and swash bands cut
  into 16-pixel tiles in `terrain/grounds.ts`).
- **Round 5** (owner, 2026-10-20, ADR 0021 "Round 5"): in the sim, overcast spells seen
  only (`Rain.CLOUD`, `[weather] cloud_*`, `sky.rain = "cloud"`; golden hashes changed),
  `World.witness` (a tool's staged events reach the observers), and `tools.stream` sends
  an event's land after its news. Renderer: waves as one travelling front (`tidePhase`,
  `swashHeight`, 8-pixel tiles, no swash on the map); the world colour-graded toward grey
  under cloud (`Atmosphere.grade`, a filter on only while overcast); rain over the tint
  in pale blue, its strength per spell; thunder at random times; `Landscape.floor` under
  the plants for craters, scree and embers, and `RowPool` sorting flames, cones, lava and
  sprouts among the plants' rows; a new close flame (15 × 24, six frames, slow,
  see-through) in embers with small flames, lit at night; radial lava; a crater's land
  held until its meteor strikes; sprouts found as bare cells that grew; the ark's beam
  pooled at its foot; fainter glow closer in.
- **Round 6** (owner, 2026-10-21, ADR 0021 "Round 6"): a frame-by-frame hunt for pops
  (flames, cones, craters, sprouts, plants, the dead and born now fade or rise); in the sim,
  creatures under a new cone or crater die (`[fauna] blast_kill_reach`, `Fauna.observe`);
  nothing placed on cones or craters (`Landscape.covered`), a dust cloud hides the change;
  tides by a GL shader from the shore's distance field (`terrain/tide.ts`, `sea.ts`,
  `Pixels.shore`); snow falls where snow lies; rain streaks as long as a frame's fall;
  plant drawings paged within 2048 × 2048 (black squares in winter close views, since R1).
- **Round 7** (owner, 2026-10-21, ADR 0021 "Round 7"): a view's fall is all rain or all
  snow (snow where half its land has snow lying), cross-fading; the open sea's swell on the
  map and fainter in the middle view (`tide.ts` `swellAt`, drawn by the shore's shader);
  the meteor 1.8× in the middle view; dust clouds painted once and stretched (they
  popped). The owner then called the look final.
- **Closing** (2026-10-21): tests for rounds 5–7 added (tides and swell, one kind of fall,
  the crater past its flash, a new cone or crater killing the creatures on it,
  `World.witness`), the stale apocalypse test fixed (the next world waits for full black),
  every snapshot baseline refreshed and looked at (the winter close view now shows its
  plants). Golden hashes and the five committed recordings did not change: no natural
  volcano or crater falls in their windows. The films are kept outside git; the owner has
  the full report as a claude.ai artifact.
- **To look at** (`cd renderer && npm run dev`): `/?recording=office` (dusks and nights,
  rain), `/?recording=end` (a day, then the end of the world and the next),
  `/?view=middle&x=120&y=60&recording=autumn&every=0&show=night,fire` (any of day, dusk,
  dawn, night, moon, rain, fire, volcano, quake, meteor, seed, ark, end).
- **Tests at the close**: renderer 301 unit, 56 Playwright; Python fast suite 707 (weather,
  storms, fire and blast kills, the v11→v12 migration, protocol and stream).
- **Report**: `reports/R4-atmosphere/` (`cd renderer && npm run atmosphere`): films of
  every light, the glow, each event's weather, the map's waves and a world's end.
- **For S1**: send `sky` at every presence tick; `chronicle` and `events` from each step's
  outputs, a world's last lines before its `world_ended`, then the next world as on
  connect (as `tools/stream.py` does).
- **For R5**: measure the atmosphere on the board (one multiplied sprite, up to a few
  hundred additive halos in a big fire, 180 raindrops; a world-sized texture repainted
  10 times a second during an apocalypse; the tide's surf and swash tiles, a few hundred
  opacities a frame). Keep `Director.toMap` (the apocalypse uses it);
  of the R3 demo clicks remove the pointer handler and `Director.nextSubject` only.
  Seen by the owner at the close, not R4's to fix there: plants that seem to stand on the
  water and animals that seem to walk on it. One renderer cause is known: plants are
  allowed by their cell's height while the ground paints a coast blended between cells
  (`plants/plants.ts` `aboveSea`), so a plant near the shore can stand on painted water.
  Animals in the shallows may be M11's wading.

### Starting R5 (final rendering pass and device benchmark)

- **Branch**: in a worktree of its own, so that M11 keeps `/home/elechim/Lineage`:
  `git worktree add -b r5-final ../Lineage-r5 main`; announce it on the coordination board
  (`/home/elechim/Lineage-coord/`, next free ADR 0022). Spec: CLAUDE.md §8 R5; ADR 0010
  (views judged), ADR 0013/0014 (the cosy look), ADR 0021 (the atmosphere and what R5
  measures), `deploy/README.md` and `deploy/board-setup.md` (the board).
- **Ask the owner first**: what in the look to tune together (R4's atmosphere is final by the
  owner's word, 2026-10-21); whether the board run uses the 7" screen or the 2K monitor
  (ADR 0008); the fan in the enclosure (the board nears 80 °C at 60 fps).
- **Known to fix**: plants that seem to stand on water (`plants/plants.ts` `aboveSea` reads
  the cell's height while the ground paints a coast blended between cells); animals seen on
  water (check against M11's wading first); remove the R3 demo clicks (pointer handler,
  `Director.nextSubject`; keep `Director.toMap`).
- **Measure**: the R0 views rebuilt on the real renderer and the state stream, with the
  atmosphere's costs listed in "R4 closed" (big fires, rain, the apocalypse's repaint, the
  shore shader). Tests are deferred while the owner tunes the look, as in R4.

### R5 in progress (handoff)

- **Where**: worktree `/home/elechim/Lineage-r5`, branch `r5-final` (from main 80e4a4c);
  ADR 0022 (decisions round by round, references); coordination board `r5.md`. No other
  R5 worktree is open: hunting, wind, sleep and the bush pieces were built in their own
  (`r5-hunt`, `r5-wind`, `r5-sleep`, `r5-puffs`) and merged into `r5-final` on 2026-10-24.
- **Done**: checklist items 1–16 and 21–23 (below); the owner called the look final on
  2026-10-25 with the report `reports/R5-final/` (1e07964; `R5_REPORT_NEW=id,…` tags
  sections the owner has not seen).
- **Next, in order**:
  1. Items 17–19 on the board with the owner (item 20, the tests, is in).
  2. Merge into `main` (M11 re-records the streams if it merges after: `by`, `parent`,
     `grazing`, `feeding`, `died`, `landed`, `young` are new on the creatures message).
- **How a round goes**: change, look at the scene (`npm run dev -- --force`;
  `?view=local&seed=3&still&quiet` for the upland grass, `?seed=9&follow=60` then press V
  twice to follow an animal), stage by hand what is to be seen (below), regenerate the
  report, show the owner. No tests until the owner calls the look final.
- **Staging by hand** (`?film&view=local&x=64&y=71&quiet&seed=1`, step with
  `window.__frame(1/30)`): `__pin(id,x,y,heading)` then `__send(id,x,y)` puts an animal and
  holds it there; `__feed(id,"plants"|"meat")`, `__hunt(hunter,prey)`,
  `__birth(mother,child,egg?)`, `__sleep(id)`, `__ambient()`, `__standing`, `__swash`,
  `__screenOf`, `__blocked`, `__card`, `__colours`. Ids 2048 (a large lizard), 2184,
  2220 live in the creatures' recording; the bush cluster at (92, 124) is the one staged.
- **Pitfalls**: Vite shares its `.vite` cache across worktrees: start it with `--force`
  or pages fail with "504 Outdated Optimize Dep". It does not reload the paint worker
  when `terrain/ground.ts` changes (restart it, or `?painter=inline`); a screenshot taken
  before the worker has painted shows blue squares of unpainted ground. Re-record `life`,
  `office` and `end` after a stream change (CLAUDE.md §5). `test_golden_hash_from_bare_rock`
  already fails on main 80e4a4c (told to M11; not R5's). Never `pkill -f` a pattern that
  is in your own command line: kill dev servers by PID.

### R5 checklist (the owner, 2026-10-21)

The owner's answers at the start: the known fixes, plus tuning rounds on creatures and on
ground and plants (R4's atmosphere stays final); the board run on the 7" screen at
1024×600; the kiosk capped at 30 fps on the board (no fan yet), so "≥ 30 fps" is read as
holding the cap (median, 1 % low and frame-time headroom reported; ADR 0022). Everything
below was taken in scope by the owner. Tests wait until the look is called final.

**Known from R3 and R4**
- [x] Plants that seem to stand on water (`plants.ts` `aboveSea` against the blended coast):
  a plant's foot must be on the painted land and beyond the swash (`PlantLayer.ashore`)
- [x] Animals seen on water (check against M11's wading first): the sim does put walkers
  in the sea (they pay for it and drown; M11 lets them wade the shelf free); the renderer
  now shows it: wading in the shallows, struggling out of their depth (`creatures/wading.ts`)
- [x] The R3 demo clicks out: a click or tap is the view button (`toMap` stays)
- [x] Animals do not walk through bushes and trees (plant footprints, steering, a drawn
  anchor beside the plant: `PlantLayer.blocked`, `motion.ts` `steer`, `clearAnchor`)
- [x] A body never folds through itself as it turns (bend limits per kind, `chain.ts`)
- [x] Legged animals step with their legs in turn (a gait cycle, `walk`)
- [ ] Plants do not pop in over animals (round 2: no tuft pops over the animal followed;
  rows a quarter of a cell tall may still swap a plant and an animal at a row line).
  2026-10-22, the owner: creatures still seem over the bushes. 2026-10-23: every tree and
  bush is drawn over any animal it overlaps (animals are seen from above); a bush's
  footprint is a band along its foot; the fade is off while the owner looks
- [x] A name scroll by the animal followed: its species' name and a few genes (S3 reuses it).
  The owner (2026-10-22): name, traits in words (size, diet, build) and pixel icons for what
  words do badly (aquatic, rare genes, night habits); always on while following, in a corner.
  Done: `card.ts`, top-left; the genome has no night gene, so glow is the night trait

**Seen on screen at the start**
- [x] 1. The animal followed can be tiny and lost under the grass tufts drawn over it
- [x] 2. Species are not told apart: nearly every animal red or magenta (colour is each
  animal's own HUE, not its species'); round 2: no olive
- [x] 3. Map markers are plain squares (and large ones by mass)
- [x] 4. The ground is noisy: a busy brown and green patchwork in the middle view; hard,
  jagged lime grass edges beside soft dithered ones in the local view
- [x] 5. Grass tufts repeat visibly (few drawings, even spacing); rounds 3–4: grass
  redrawn as a texture of small unoutlined tufts after references, nine sizes, random tints
- [x] 6. A snow cap on a low bare summit in August (the renderer's own snow line)

- [x] 21. The two scrolls differ and are better (the owner, 2026-10-23): the chronicle an
  illuminated scroll (an icon for the kind of event, an illuminated initial in the
  species' colour, the date on a ribbon, a larger font); the name card a field-guide card
  with a portrait of the animal itself, its name as a heading, its traits and icons. Done:
  `illumination.ts` + `HAND_FONT`; `card.ts` + `creatures/portrait.ts`

- [x] 22. Animations the owner asked for after the look (2026-10-23): eating (grazing
  nibbles, feeding tugs, flecks; `grazing`/`feeding` on the wire); then (2026-10-24)
  hunting, a run and a spring (`creatures/hunting.ts`, `died[].by`), births beside the
  mother with hearts, eggs for large broods (`creatures/nursery.ts`, `born[].parent`),
  plants leaning in the wind by whole pixels (`plants/wind.ts`), sleep at night
  (`creatures/sleep.ts`), fireflies, gulls, butterflies and dust (`atmosphere/ambient.ts`).
  The owner approved them all on 2026-10-24. Then, the owner's last pass on what was missing
  (2026-10-24, drawn only, nothing in the sim): autumn leaves blown off broadleaves, animals
  shaking off the rain and hunching in thunderstorms (`atmosphere/leaves.ts`,
  `creatures/weather.ts`); photosynthesisers bask, venom's green strike, swimmers' wakes
  (`creatures/basking.ts`, `venom.ts`, `wake.ts`; `__grant` to stage); the young trail their
  mothers until grown, a pair touches heads before a birth (`creatures/family.ts`)
- [x] 23. Bushes in pieces, an experiment (2026-10-24, the owner: "maybe draw the bushes
  in pieces"): each puff its own sprite and footprint (`plants/pieces.ts`), behind
  `?bushes=pieces`. The owner chose the pieces (2026-10-24): the default now
  (`?bushes=whole` to compare), no fade, each piece leaning in the wind with its bush

**Not drawn yet**
- [x] 7. Young animals look like adults (age is not on the wire)
- [x] 8. Deaths all look alike: no carcasses, no telling a kill from starving or drowning.
  The owner (2026-10-22): by cause, and a carcass left where it died, fading. Done:
  `died` on the wire (the sim's `CreaturesDied`), `creatures/remains.ts`
- [x] 9. Animals that come by sea (the founders, the hunters' second wave) fade in like births.
  The owner (2026-10-22): a splash and ripples where they appear, no journey. Done:
  `landed` on the wire (from `CreaturesArrived`)
- [x] 10. Wading has no look (after M11 reaches main): drawn from the depth, ready for
  M11's shelf (`WADE_DEPTH` = its `wading_depth`)
- [x] 11. Chronicle entries carry a place and a species the scroll does not use.
  The owner (2026-10-23): map and middle views mark the place; the local view's camera
  visits it while the scroll is out. Done: `marker.ts`, `Scene.place` in `director.ts`

**Rough edges**
- [x] 12. The scroll and the dip stay daylight-bright at night and in an apocalypse.
  The owner (2026-10-23): lit like a lantern (the name card too). Done: `lantern` in
  `captions.ts`; the dip unchanged (it goes to dark anyway)
- [x] 13. The tide moves the painted water line; plants and animals test a fixed sea level.
  The owner (2026-10-23): wet feet when the swash reaches an animal. Done:
  `Landscape.swashCovers` replays the shore shader's swash; `wading.ts` "feet"
- [x] 14. Demo code (`?show=`, the recordings) in the kiosk build: behind a dev flag.
  Done: `npm run build:kiosk` (`dist-kiosk/`), demo paths compiled out, the server's stream
  by default, `?bench` kept

**For the benchmark**
- [x] 15. The real scene off the spike: `CreatureLayer`, the atlas and the habitat into
  `creatures/` (where the legs, folding and bush fixes go). Done 2026-10-23: `layer.ts`,
  `atlas.ts`, `habitat.ts`, `seed.ts`, `views.ts`; the spike imports from them
- [x] 16. A benchmark mode on the real page (map, middle, crowded middle, local) and
  `tools/kiosk_bench.py` pointed at it. Done: `index.html?bench` (`bench.ts`,
  `benchplan.ts`), nine scenarios (the four judged, night, rain, fire, apocalypse, shore),
  `?cap=30`, `kiosk_bench.py --fps-cap 30`; on the PC all four hold 30 fps capped.
  The board's run becomes `reports/R5-device/` (`tools.report R5`, `tools/milestones/r5.py`:
  R5.1 the cap held, R5.2 over budget ≤ 5 %, R5.3 PSS ≤ 800 MB, R5.4 as specified)
- [ ] 17. Per-frame costs, fixed where the board shows they matter: a filter pass per
  animal fading in or out (`depart`, `materialise`), the grade matrix rebuilt every frame
  and the cloud's full-screen filter, the shore shader's colours re-parsed each frame,
  `Herd.subjects` and `glowing` allocating each frame, `PlantLayer.fade`, every animal
  moved in the local view, the apocalypse's repaint, the scroll painted while it rolls
- [ ] 18. The atmosphere on the board (R4 closed): big fires, rain, the apocalypse, the shore
  shader; surf's ~30 MB of GPU memory; the shadows and plant redraws on the page's thread
- [ ] 19. On-device report; R5 accepted on the 7" screen with the final look
- [x] 20. Tests for all of the above once the owner calls the look final (called final
  2026-10-25). Done 2026-10-25: vitest for the creatures (steering, trailing, bend limits,
  the gait run through a real `CreatureLayer`, hunting, family, sleep, weather, basking,
  venom, wakes, remains, colours, marks, the herd's news), the plants and atmosphere (wind,
  pieces, tufts, the plant layer's footprints, crowns, depth and lean, the swash, leaves,
  ambient life), the card, scroll, lantern, marker, visits and the benchmark plan (628
  tests, 2 todos: a joint bends past its limit for a moment while a body turns; dust rises
  in storms and in an apocalypse, against `ambient.ts`'s header); Playwright baselines of
  the final look and stills of what R5 drew (`tests/e2e/final.spec.ts`, staged as the
  report's films, a fixed number of frames so two runs draw the same); Python tests of the
  sim's `CreaturesDied`/`CreaturesBorn`, `maturity`, the encoder's new fields and the
  stream (`sim/tests/test_fauna_outputs.py`, `server/tests/test_protocol.py`,
  `tools/tests/test_stream.py`)

### Starting R4 (atmosphere)

- **Branch**: in a worktree of its own, so that M11 keeps `/home/elechim/Lineage`:
  `git worktree add -b r4-atmosphere ../Lineage-r4 main`; announce it and claim the next
  ADR on the coordination board (`/home/elechim/Lineage-coord/`, next free ADR 0021).
  Spec: CLAUDE.md §8 R4; `docs/design/renderer.md`, `presence.md` (light), ADR 0016 (light
  and god powers), ADR 0020 (the camera).
- **Deliver**: day/night tint from presence, glow pass, seasons, weather of events, the
  apocalypse sequence, and (the owner, 2026-10-20) waves breaking on every coast in all
  three views, the map too (today `surf: close` in `landscape.ts` leaves the map without).
- **Not on the wire yet**, so R4 starts there (`schema.json`, `encode.py`, `tools/stream.py`,
  additive like R3's `chronicle`): the light of the moment (`Presence.light`,
  `Presence.present`), the events the weather and the sequence play (`FireStarted`/`Ended`,
  `VolcanoErupted`, `EarthquakeStruck`, `CraterFormed`, `GodPowerUsed`, `WorldEnded`,
  `WorldBegan`). The clock already carries the season; `torpid` already comes with the
  creatures; the land message carries snow.
- **What it builds on**: the dip to dark between views is a plain overlay (`DARK` in
  `src/main.ts`, a page element over the canvas); glow spots are drawn on creatures but
  never lit (R2); the scroll and the dip are page elements and do not take the scene's tint.
- **Ask the owner before coding**: how dark a night is (a moonlit scene or nearly black);
  whether the tint follows the light step by step (10-minute presence ticks) or eases;
  what the apocalypse sequence shows and how long; which events get weather (rain for the
  rain god power, smoke for fires, ash for volcanoes).
- **Device**: R4 keeps to the PC; every board measurement is R5's.
- **Not to carry into the final build**: the demo clicks (below, "R3 closed").

### R3 closed (merged into `main`, 2026-10-20; branch `r3-camera` and its worktree removed)

- **What it left**: `renderer/src/director.ts` (the camera's rules), `camera.ts` (spring,
  framing), `herd.ts` (the stream's animals in the scene), `captions.ts` and
  `pixelfont.ts` (the scroll), `main.ts` rewired; `CreatureLayer` takes a changing cast;
  the `chronicle` message (`schema.json`, `encode.chronicle_message`); `tools/stream.py
  --creatures-every`, species resent on a change, chronicle recorded; the recording
  `renderer/public/stream/life.json` (and the two R1 recordings regenerated: only
  `chronicle` and `species` messages added). Design: `docs/design/renderer.md` "The
  camera and captions"; decisions: ADR 0020.
- **After the owner's demo**: pans slide the canvas by the camera's fraction of a pixel
  (a screen pixel at a time), plants sit on whole art pixels (they had flickered), glints
  keep their place on the water, local-view animals are drawn 1.2 times larger, and in the
  local view a click picks another animal and a double click the map. **Demo only** (the
  owner, 2026-10-20): the final build does not have it; R5 takes it out (the pointer
  handler in `src/main.ts`, `Director.nextSubject` and `toMap` with their tests), leaving
  a click or tap as the view button. (R4: the apocalypse uses `toMap`; it stays.)
- **Shared files it changed**: `schema.json` / `encode.py` (additive), `tools/stream.py`,
  `docs/design/renderer.md`, this file and CLAUDE.md. No sim change, no schema bump: M11
  (on `m11-tuning`) merges main with conflicts in the docs only.
- **Tests at the merge**: renderer 255 unit, 25 Playwright; Python fast suite 656.
- **For S2**: a second push button, `view`, debounced like the god power's; its presses
  reach the page as `window.__press()` (or a reverse-channel message once S1 has one).
- **For R4**: the dip is a plain plum overlay (`DARK` in `main.ts`); `WorldEnded` is still
  not on the wire for the apocalypse sequence.
- **For R5**: the local view moves every animal (about 200 in the v9 world) each frame;
  measure it on the board with the rest.
- **Noted by the owner at the R3 demo (2026-10-20), given to later milestones** (CLAUDE.md
  §8). What is known of each so far, not yet investigated:
  - *R4: waves on every coast, in every view.* The surf (`terrain/sea.ts`, R1) is painted
    only for the middle and local views (`surf: close` in `landscape.ts`); the map has
    none.
  - *R5: animals walk into bushes and trees.* Strolls between sim ticks
    (`creatures/motion.ts`) only ask whether a place is land or water (`Passable`); the
    plants' footprints are not in it. The sim's own positions may lie in a wood, so the
    anchor itself may need to be drawn beside the trunk rather than on it.
  - *R5: a body folds through itself as it turns.* The chain (`creatures/chain.ts`)
    follows the head with no limit on the angle between joints, so a sharp turn (the
    motion's `TURN_RATE`, pauses that look about) bends it back over itself.
  - *R5: some animals drag all their legs at once.* In `spike/creatures.ts` `walk` a foot
    steps when its rest point is `0.8` leg lengths away, so on a short-legged or slow body
    every foot crosses that threshold on the same frame; legs need a phase (left/right,
    front/back alternating) and one foot of a pair down while the other swings.
  - *R5: plants pop in over animals.* Candidates: the plants in front of the animal
    followed turn see-through (`PlantLayer.fade`) and back as its box crosses rows;
    an animal changes row (`hostIn`) and a plant goes from behind it to in front at once;
    the middle view builds plant chunks as they come into sight (`lazy`).
  - *R5 (and S3): a name scroll by the animal followed.* R3's scroll (`captions.ts`) and
    font, small, beside it in the local view: its species' name (`Herd.names`) and a few
    genes in words (size, diet, rare genes from `slots`).

### Starting M11 (long-run tuning and stability)

- **Branch**: `git switch main && git switch -c m11-tuning`. Spec: CLAUDE.md §8 M11.
  **Read `docs/m11-plan.md` first**: goals in numbers (§1), method (§2), every lever with
  its history (§3), risks (§4), order of work (§5) and what M6–M10 learned (§6). Read
  "Working on a milestone here" below too.
- **Accept**: every M2–M10 criterion passes at once, and mean genetic distance is still
  rising at year 3. Three criteria were deferred here by the owner and fail today:
  **M6.1** (3–12 species for 79 % of inhabited time, against 90 %; ADR 0012),
  **M8.1** (selection on night traits, p = 0.15 against 0.05; ADR 0016), and M5's
  feeding gain, which is reported without a band (ADR 0009). Bands change only with an
  ADR (CLAUDE.md §8), never just to pass.
- **Ask the owner before coding**:
  1. The engagement targets in `m11-plan.md` §1, the "target to agree with the owner"
     column, including how often a world may end (M10: today about once in decades).
  2. Whether tuning may change mechanisms (a prey refuge in cover, dropping `SOCIAL` or
     trial-and-error learning, schema bumps), or only numbers in `default.toml`.
  3. The compute budget: a 20-seed × 3-year office run takes 15–22 min at 10 jobs, and
     this PC is shared (memory `shared-machine`: check the load, `--jobs` 8–10).
- **What exists**: every criterion is computed by `tools/milestones/mN.py` (M2–M9;
  M10 has none, its tests cover it), and fast-forward takes `--set` overrides,
  `--schedule office` and `--fork-days`. There is no `tools/tune/` yet; building it is
  M11's first deliverable (sweep runner, score on every criterion, sensitivity report).
  The slow tests `tools/tests/test_m*_statistical.py` hold the criteria on 20 seeds.
- **Report**: statistical (§7): the full dashboard, held-out seeds (20–39) beside the
  tuning seeds (0–19), and the sensitivity of the key metrics to the top levers.
- **Since M10**: a seed whose island empties after life is established now ends its
  world and goes on in the next one. Cumulative series (fauna tallies, `species_ever`)
  restart there; read them with the `world` series, and count endings with
  `worlds_ended`. Earlier worlds are in `runs/<id>/archives/`.
- Next free ADR: 0019 (claim it in `/home/elechim/Lineage-coord/README.md`).

### M10 closed (merged into `main` at `af98573`, 2026-10-20)

- The owner's answers (ADR 0018): once life is established (`[apocalypse]
  established_days`, 30 days after the first landing), the last creature's death ends
  the world, with no re-founding; a landing that dies out sooner is re-founded as before.
  Keep every archive.
- What M10 leaves: `sim/lineage_sim/apocalypse.py` (an observer that reports
  `WorldCollapsed` with the next seed); `World` hands over to the next world by itself
  (`WorldEnded` with the archive, `WorldBegan`, `number`, `past_worlds`, `unix_ms`,
  `advance_to_unix`; `create`/`restore` take a `factory` for the next world's
  subsystems); observers see what earlier observers added; chronicle kinds `world_end`
  (5) and `world_begin` (4); schema v10 (`world`, `worlds`, subsystem `apocalypse`;
  `v9_to_v10`, fixture `v10.lzma` = world 2 after the v9 island was emptied by a meteor).
  Fast-forward steps by the desk's clock, writes `archives/<seed>/world-<n>.lzma`, has a
  `world` series and a `worlds_ended` count; the owner's schedule follows the desk
  (`desk(world)`). `replay` prints `history(world)` beside the summary.
- No report: M10 is not statistical (CLAUDE.md §7); its criteria are tests. Fast suite
  653 passed; slow suite 11 passed (1 h 22 min). Schema v10 is released: `v10.lzma` is
  frozen. Branch `m10-worlds` deleted.
- Tests: `sim/tests/test_apocalypse.py` (toy hand-over: once, timing, chunking, save
  and resume, next seed, archive; the real v9 world emptied by a meteor; the apocalypse
  only watches), migrations, `test_bench_new_world` (73 ms), `tools/tests/test_worlds.py`
  (a doomed fast-forward: archives, `world` series, a power cut after an ending resumes
  identically), `test_replay.py` (an archive renders). Golden hashes changed (schema
  version and the new state keys only; `test_the_apocalypse_only_watches`).
- For S1: write `WorldEnded.archive` (`io.dumps`) atomically when it arrives, then save
  the new world; drive the sim with `advance_to_unix` so world changes need no tracking.
- For S3/S5: `World.past_worlds` lists the ended worlds; their archives hold the
  histories, bestiaries and final maps.
- For R3/R4: `WorldEnded`/`WorldBegan` cue the apocalypse sequence and the first wide
  shot of the new continent; not on the wire yet.
- For M11: worlds end rarely (2 of 80 three-year runs emptied after first life). If the
  desk should see new continents more often, make the island harder (immigration, the
  ark), not this criterion. Cumulative series (tallies, species ever) restart with each
  world; read them with the `world` series.

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
