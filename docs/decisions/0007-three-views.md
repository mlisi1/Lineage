# 0007 — Three views of the world, and the look chosen for them

- **Status**: accepted; amended the same day after the first sight of the local view
  (see the end). Open: the style of its trees, how calm its ground, the size of animals
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

## Amendment: after the first sight of the local view

The owner's verdict on the sheet with the three views: the map is good and the middle
view close; in the local view the ground changed too often from spot to spot, the
animals were far too large against the trees (the heaviest three times a young tree),
the trees were not liked and had faults in the drawing, and there was not enough to see
on the ground. Settled and changed:

- **The local view is 32 art pixels to the cell** (L2). The 24 and 48 are dropped.
- **Animals are smaller in every view**: 0.5 × 1.1 cells at mass 1 is proposed, with 0.4
  and 0.62 beside it. One world scale stays the rule, so the middle view shrinks with
  the local one.
- **A close view reads the ground over the cells around** each cell (two proposed, one
  and three beside it) instead of cell by cell, so that patches are several cells wide,
  and spends its pixels on what the ground is made of: blades, pebbles, ripples, litter,
  and lichen as rosettes on soil and rock. The shore is not smoothed. In this one way the
  local view is no longer the middle view with more worked out: a lone cell of scrub
  that shows as a speck in the middle view is ground like its surroundings in the local
  one (the bush on it still stands).
- **Shadows belong to the ground**, painted once under whatever stands, not to each
  plant.
- **Trees and bushes of the local view are drawn in a style still to be chosen** among
  three rules written after references (bundles of leaves, domes, limbs), each in three
  builds. The middle view keeps its P3 trees until then and follows the choice after.
- **Small plants** are placed by what covers a cell: flowers in drifts, ferns,
  mushrooms, reeds, stones and boulders, logs, stumps.
- **Creatures are shaded on their far side** as well as lit, markings too, each fitted
  to the mass it is on. **The aquatic gene turns legs into fins**: webbed feet from 0.3,
  flippers that row from 0.6; with three or four pairs only the last.

Consequence for R1: the painter needs the neighbourhood of a piece (two cells of it) and
the shadows of the plants on it, so painting off the frame has to carry both.
