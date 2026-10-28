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
