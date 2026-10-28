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
