# 0007 — Three views of the world, and the look chosen for them

- **Status**: accepted (the local view's distance is still open)
- **Date**: 2026-10-11

## Context

The renderer spike first drew the world two ways: the whole island as a flat map, and a
close-up four times nearer with a drawing in every vegetated cell. The owner judged the
look from the look sheet (`reports/R0-look-sheet/`) over several rounds of proposals:
the plants did not sit on the map, the ground was too square, grass was as big as a
tree, every creature was the same chain of circles. And the close-up was not close: it
showed a sixteenth of what is meant to be a continent, where the view imagined was a
camera on one animal, near the ground.

## Decision

- **Three views.** The map (2 art pixels to the cell, the whole continent), the middle
  view (8: a region) and the local view (32 proposed: one animal and what it walks
  through). Art pixels are 2 screen pixels in all of them.
- **One world scale.** Nothing is rescaled between views: an animal is 0.85 × 1.1 cells
  long at mass 1 and a grown tree three cells tall everywhere. The local view is larger
  on screen because it is closer, and shows more because it is drawn with more detail.
- **Map**: the ground interpolated between cells, animals as dots (proposal M3).
- **Ground of the closer views**: interpolated and dithered (G4). All three grounds are
  one painter at three sizes, working from the cells' heights, cover and biomass.
- **Plants**: grass and lichen are ground; trees and bushes stand, drawn by rule, the
  large size (P3: a grown tree 24 art pixels in the middle view). The local view draws
  the same plants in the same places, larger and richer, and adds grass as tufts,
  flowers and stones.
- **Creatures**: a body plan per kind of animal, outlined and lit (C3), with twelve
  markings in four colours from the one pattern gene. Drawn a little smaller than the
  first look (0.85); from close they gain glints, edged legs and feet, and amble.
- **Sorting**: plants in rows with the creatures of each row, so an animal passes behind
  what stands in front of it; in the local view what covers the animal the picture is
  about goes see-through.

## Consequences

- R1 is no longer "a terrain bitmap and a sprite per plant". It is the painter for three
  distances, the plants that stand at two of them, and painting off the frame: the map's
  and the middle view's ground are one picture each, repainted once a sim-day; the local
  view's is painted in pieces around the camera.
- R2's bodies are plans chosen by thresholds on the genes, which makes two animals of
  one species either side of a threshold look like different kinds. To be judged there.
- R3's camera has three distances to move between. Zooms in between make painted pixels
  shimmer, so it cuts or cross-fades rather than glides.
- R0's benchmark has scenarios for the three views beside the first look's. Its
  acceptance scenario (`spec-1x`, a sprite in every cell) measures a shot the renderer
  will not draw; it moves to the three views once the local view is settled.
- The estimated cost on the board (`docs/design/renderer.md`) says drawing fits and
  painting ground does not fit in a frame. The graphics driver remains the open risk.
