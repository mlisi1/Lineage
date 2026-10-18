# 0014 — The land and its plants in the cosy look; seasons that turn over weeks

- **Status**: accepted for the look (the owner, 2026-10-18); open: whether the report
  maps take the cosy palette, and whether winter has snow
- **Date**: 2026-10-18

## Context

ADR 0007 chose the three views and drew the land in the report maps' palette, with
trees as crowns of many small bundles of leaves (T1). During R2 the owner asked for
Stardew Valley as the inspiration for the creatures (ADR 0013: its style, the camera
staying top-down), and at the start of R1 for the ground and the plants too. R1 also
owes the turn from one season to the next over days rather than at once (ADR 0007,
third amendment), and plant genes in the drawing.

The first cosy proposal changed only colours. The owner liked it, asked for Stardew's
shapes for trees, bushes and plants as well, and pointed out that without outlines a
snowy tree is barely told from snowy ground.

## Decision

- **A look is a parameter** (`renderer/src/looks.ts`): the land's palette, the tones the
  seasons bring, what the ground painter lays besides the palette (litter, leaves,
  lichen, shadow, foam, sand), the plants' inks, and the rules the plants are drawn by.
  `maps` is the R0 look; `cosy` is the one chosen. The plum of outlines, the violet of
  shade and the gold of light are shared with the creatures (`renderer/src/palette.ts`).
- **Cosy colours**: saturated yellow-greens, brown earth, sand of its own, a bright teal
  sea with white foam, lavender rock and snow shadows, autumn in strong golds and reds.
- **Cosy shapes** (`renderer/src/plants/cosyart.ts`), in the same boxes and places as
  the bundles, so nothing moves between looks: a broadleaf is a cloud of a few large
  scalloped puffs (three rows on a grown tree), each lit as a ball (a highlight up and
  to the left, its far rim in shade, flecks of leaves) and shading the puffs behind it,
  on a stout trunk that shows under the crown and flares into roots; a conifer is a few
  bold tiers with large teeth; a bush a dome of three to five puffs; grass a tuft of
  broad blades. **Everything is outlined on its outside**, wood in its own outline, so
  that bare branches under snow keep their edge.
- **Seasons turn over about four weeks** (`renderer/src/plants/turning.ts`). Each place
  has an earliness from a low-frequency front, its height (the hills first into autumn
  and winter, last into spring), and for a plant its own chance and its `EVERGREEN`
  gene (the more, the later into autumn and winter). The ground painter takes a season
  per place, dithered at the front; a plant layer given the world's time draws each
  plant in the season of its own turn.
- **`HEIGHT` picks a tree's or bush's build** where the stream carries it: broad and
  low, as the scale has it, or slender and tall. The fixture has no genes, so until the
  stream exists the build is chosen by chance, as before.

## Consequences

- The look sheet of R1 (`renderer/land.html`, `reports/R1-land-sheet/`) shows both looks
  side by side; `maps` stays in the code as the one compared against until the owner
  drops it.
- "One palette" (renderer.md) no longer holds for the cosy look: the desk and the report
  maps differ in colour until `tools/viz/pixelmap.py` follows or is left as it is.
- A plant layer is built for one moment of the year; R1's scene rebuilds it when the
  day changes (with the ground, once a sim-day), which carries the turn forward.
- Drawings around a change of season are made for two seasons, about twice as many
  for a few weeks (93 local, 45 middle: cheap, see the cost estimate in renderer.md).

## References

- Stardew Valley (ConcernedApe, 2016): its trees, bushes, grass and forage as the
  reference for shapes and palette, as the owner asked for it,
  <https://www.stardewvalley.net/>.
- Raymond Schlitter (Slynyrd), *Pixelblog 44 — Top Down Trees* (one bundle of foliage
  repeated and layered by the light: ADR 0007's T1, from which the puffs differ in size
  and number), <https://www.slynyrd.com/blog/2023/5/22/pixelblog-44-top-down-trees>.
