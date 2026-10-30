# Optimizing the renderer further — plan and status

Written 2026-10-28 on `r5-final`, after the review of the pipeline
(`docs/renderer-performance-review.md`, its [same pixels] items done). The owner: "Make a
thorough plan on how to further optimize the rendering", then "Go on, and implement the
changes. Be sure also to optimize the terrain rendering".

## Why go further

The four judged views hold the 30 fps cap (`reports/R5-device/`). What is left:

| Scenario | fps | late % | script median / p99 (ms) | worst frame (ms) |
|---|---|---|---|---|
| middle-crowd | 29.9 | 4.6 | 22.6 / 63.1 | 251 |
| night | 29.9 | 6.0 | 25.1 / 68.0 | 251 |
| rain | 29.9 | 6.4 | 25.0 / 74.2 | 317 |
| fire | 20.0 | 84.6 | 45.6 / 76.9 | 267 |
| day-turn | 29.9 | 20.4 | 26.3 / 72.8 | 301 |

Every scene, the map too, has frames of 230–320 ms: hitches. And the board will also run
the simulation and the server (S1, §4.8) with no fan: CPU saved is headroom and heat.

Where the page's time goes (PC profiles, the machine idle, shares of busy time): Pixi's
draw 40–47 % in every view (in the crowd, transform updates 17–19 %; in the local view,
texture binds 11 %); the animals 35 % of the crowd (posing 19 %); bodies nobody sees 30 %
of the map; fire 16 % of its scenario; the card's portrait, read back from the GPU, 8 % of
the local view's.

## Phases

Each change is tagged **[same pixels]** (every screenshot and, with
`renderer/scripts/compare-films.mjs`, every film frame byte for byte the same) or
**[owner's call]** (shown side by side first). Only the board decides whether a change is
kept: each claimed win is measured there against the board's own noise.

0. **Measure what cannot be seen yet.** A frame probe (`src/frameprobe.ts`): each frame's
   phases (messages, director, landscape, herd, atmosphere, overlays, render) and what
   happened in it (a message's type, a portrait drawn, a ground piece placed, a lay-out,
   plants built, shadows); for each late frame, the phase that took the most of it or
   "outside" (garbage collection, the GPU, the compositor). In the bench's results
   (`probe`) and `kiosk_bench.py`'s summary. A trace of the GPU process on the board.
   `scripts/compare-films.mjs` as the pixel guard.
1. **Hitches.** The portrait drawn once, at a size worked out from the body, not up to
   four times to find it; the work that can wait (pieces placed, plants built, shadows,
   portraits) under a budget per frame; whatever the probe names on the board.
2. **The animals.** Each animal one batch instead of some 45 sprites (no node per part for
   Pixi's transform pass), pixel for pixel; on the map no work on bodies nobody sees
   ([owner's call] only for the moment after leaving the map).
3. **Fire.** What does not change in a burning cell worked out once; its particles on one
   texture.
4. **Terrain and Pixi's draw.** The ground painted faster in the workers (same pixels);
   the ground's pieces of a view on one texture (fewer binds and batches); fewer texture
   sources; draw lists rebuilt only where needed; the shore's filter as a mesh.
5. **The day's turn.** Painters held back while frames are late; the turn's work spread
   over frames; the middle view's plants built lazily (memory).
6. **[Owner's call]**: the map's dots at a lower rate, simpler bodies in the middle view,
   leans on alternate frames, fewer flames far off.

## Status

- Phase 0: done (probe, bench fields, `kiosk_bench.py` summary, `compare-films.mjs`). The
  GPU trace waits for the board.
- Phase 1: the portrait done (drawn in the dip, read back without waiting, once per shape;
  the same bytes, checked in the browser). The per-frame budget waits for what the probe
  names on the board.
- Terrain: done, all [same pixels]: a day that brings no land and is not in a turn of the
  season is no longer laid out or repainted (about 70 % of the year's days on the desk);
  kept paintings stamped by the season, so they last all season; the painters 8–13 %
  faster (a pixel's season only in a turn; a calm pixel adds only the cover around it),
  52 paintings over four times of year, with and without snow, byte for byte the same.
  Then a piece's margin (a cell round it, painted so that its shore meets its
  neighbours', then cut off) painted only as land or sea past a rim of 8 pixels the
  detail's drawings can reach in from: a local piece some 35–40 % faster again (it is 320
  pixels square to show 256); every piece of the island, 1 296 in all over summer, an
  autumn turn and winter snow, the same in every pixel shown. All told a local piece
  paints in a little over half the time it took before (608 pieces: about 38 s → 21 s on
  the PC), a middle one some 8 % faster, the map some 12 %.
  Then, the owner's choice (2026-10-28: "If you tell me that the result with the shader is
  identical to the eye and not byte per byte, then fine"): the colour pass on the GPU
  (`terrain/gpuground.ts`), three quarters of a painting's time on the CPU. Each painter
  worker has a WebGL2 context of its own (an `OffscreenCanvas`) and reads the pass back
  there; the passes after it stay on the CPU; the CPU paints it all where a worker has no
  WebGL2, in tests, and with `?painter=cpu` (kept paintings are stamped `gpu` or `cpu`).
  Against the CPU's painting: 2 or 3 pixels of 65 536 differ, on the edge of a threshold,
  in the cases looked at (summer, an autumn turn, winter snow; local, middle, map). What
  stays on the CPU: about 3 ms of a local piece's 29 and 7 ms of a middle piece's 26 on the
  PC, now that a land's cells are worked out once rather than for every piece. On the PC
  the GPU is SwiftShader, the CPU pretending: the gain is the board's to measure (the
  benchmark's `ground_made` and `?painter=cpu` to compare).
  Tried and dropped: a cache of the noise's corners (no gain: the fine noise changes cell
  every pixel); one texture for the ground's pieces (the scene binds some 40–50 textures a
  frame, counted on the PC, few of them the ground's; their share of the PC's profile is
  SwiftShader's, not the board's). The `day-turn`
  scenario now has a new land come, the case left on the desk.
- Phase 2 (each animal one batch): not started. A closer look: a body's sprites are
  reached by sleep, the rare overlays, eating, ripples and the water's colouring and glass
  filter; a batch element must redo all of that and Pixi's vertex maths to the bit; and
  in the crowd's profile it can save some 7–10 % of the script (the packing and the GPU
  stay), not the 15–20 % first estimated. The owner's call whether to build it before the
  board's probe says where the late frames come from.
- Phase 3 (fire): working out each burning cell's fixed parts once would save some 3 % of
  the fire scenario; its frame is mostly the animals and Pixi's draw. Not done.
- 2026-10-29, the board's numbers (build 33e218c) and what followed. Ground on the GPU
  against the CPU: a piece 0.7–0.9 s in the worker against 1.3–2.1 s (its GPU pass
  0.13–0.26 s; the rest, 0.5–0.7 s, is the CPU's passes and the cache, to be split next),
  the views ready 6–9 s sooner (middle 23.5 → 17.5 s, local 29.3 → 22.1 s, shore 25.3 →
  16.7 s), the day's turn 24 → 14 % late. Pieces wait 3–5 s in the queue of two workers.
  The board's traces: in the crowd's late frames the page's script and its garbage
  collection (a quarter), the GPU process busy alongside; the big fire held by the page's
  script, Pixi's updates of changed sprites a third of it.
  Kept, same pixels: a pool's unused sprites see-through before hidden (draw lists not
  rebuilt every frame; the fire's draw −27 % at the board's speed on the PC) and the
  visible flag written only when it changes. Kept, a timing change only: an animal is
  drawn again only when its drawing changed, and in the view not in use only when that
  view comes on (it was drawn again in both at once, every body straightened behind its
  head); two stills taken again (`follow`, `eating`: the same animals a moment further
  on). Tried and dropped, measured: each burning cell's fixed parts worked out once (no
  gain); each animal drawn as one view (the same pixels, but slower: the parts' maths is
  the cost, whoever does it). The owner kept every flame (no limit on the cells drawn).
  At the board's speed on the PC (`--throttle` 20, which matches the board's crowd), every
  scenario but the big fire holds the cap with ≤ 2.5 % late; the big fire ~30 %, held by
  its ~2 400 sprites and the animals' posing.
- 2026-10-30, the ground's loading (the owner: "the loading time max 3 s on every view",
  the map "really fast"). Each painting now tells where its time went (`paintSteps`, the
  cache's read and write); `renderer/scripts/slow-bench.mjs` runs the benchmark on a PC
  with the page's CPU slowed to the board's (it does not slow the painters' workers). The
  cache's lookup was the largest part of a piece's worker time after the GPU's (30–50 ms
  on the PC, waiting behind other pieces' writes): a piece not kept is now known at once
  from a list of the names kept, shared by the painters (`BroadcastChannel`), and the
  store is written without a flush per piece. A piece no burnt cell reaches skips the burnt
  ground's pass (608 pieces, with and without burns, byte for byte the same). The map's
  painting is kept as the pieces are, and at a start the latest kept shows while today's
  comes. The painters make their shader when first needed or when idle (made as the land
  came, it held the cache's answers up). The benchmark's `switches`
  scenario presses round the views twice, timing each press until its ground is painted,
  and every page says when it got going (`boot`). On the PC: a middle piece 74 → 47 ms, a
  local one 122 → 62 ms in the worker; the map from the cache at 0.3 s; each switch 1.1–2.1
  s, a second of it the dip. The board's numbers are next.
  On the board (build c2ead0f, with what earlier runs kept): the map painted 2.6–3.0 s
  after the page starts; the first switch to the middle view 5.4 s, to the local 3.9 s;
  later ones 1.1–1.8 s.
- 2026-10-30, later (the owner: the 3 s "was more of a goal"; "we just have to mask the
  load times"). The views not shown are laid out in the background, their plants' sheets
  drawn and packed in a worker and handed back as bitmaps (the same pixels); the middle
  view's place is chosen ahead as the local view's animal is, and the ground is painted
  ahead for the view the button leads to next and, behind it, the one after; a piece's
  shadows are worked out when a painter takes it up. Live, an iris masks the rest
  (`src/iris.ts`, ADR 0022 "Loading the views"). On the board, warm: switches after the
  first round 1.1–1.5 s, the first round 3–5 s behind the iris, the worst frame during
  switches 100 ms. The owner is satisfied with the performance for now.

## For later

What could still be done, should the board need it (none of it started; each to be
measured on the board first, as everything here was):

- **The map's long frames while the hidden views are made** (0.45–0.7 s, "outside" the
  frame's phases, a few in the first seconds after a start). Profile them on the board
  (the probe service and `scripts/board-trace.mjs`, or a CPU profile through its DevTools
  port). Suspects: the plants' drawings cloned between the page and the worker (thousands
  of small arrays each way: the drawings kept are sent to the worker, the ones drawn come
  back), which keeping the art cache in the worker and sending the page only what it uses
  would avoid; and laying a hidden view out in one task, which could be spread over frames.
- **The first switches straight after a start.** Paint ahead round a few animals the
  local view might follow, not one; or let the board warm its caches once after a new
  build is installed (one quiet pass round the views), so that the first start of a build
  is not the cold one.
- **The big fire** (about 30 % of frames late at the board's speed): its ~2 400 sprites and
  the animals' posing. Each animal as one batch (§2 of the review: some 7–10 % of the
  crowd's script, a large rewrite) and the fire's particles on one texture.
- **Garbage collection** in the crowd's late frames (a quarter of them on the board): find
  what is still made per frame (the frame probe and a heap profile).
- **The ground's last quarter on the CPU** (shore distances, the detail's drawings): only
  if pieces are again what a view waits for.
- **How many painters**: two on the board now; once the simulation and the server run
  beside the kiosk (S1, S7), check whether two still fit the CPU budget (§4.8).
