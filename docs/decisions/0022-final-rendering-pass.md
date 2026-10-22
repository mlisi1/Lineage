# 0022 — The final rendering pass: the look tuned together, and the board at 30 fps

- **Status**: in progress (R5)
- **Date**: 2026-10-21

## Context

R5 is the last pass over the look of R1–R4 and the home of every device benchmark
(CLAUDE.md §8 R5). R4's atmosphere was called final by the owner on 2026-10-21. The R3
demo had left a list of things to fix (animals through bushes, bodies folding on a turn,
legs that all step together, plants popping in over animals, a name scroll by the
animal followed, the demo's clicks), and R4 left two more (plants and animals that seem
to stand on water).

The brief asked the owner three things before starting. Their answers (2026-10-21):

1. **What to tune**: the known fixes, plus tuning rounds on the creatures and on the
   ground and plants. R4's atmosphere stays as it is.
2. **Screen**: the board run on the real 7" screen at 1024×600, not the 2K monitor that
   stood in for it in R0 (ADR 0008).
3. **Heat**: there is still no fan for the board (it neared 80 °C at 60 fps in R0), so
   the kiosk is **capped at 30 fps** on the device.

An audit of the scene and the code at the start found twenty more items (screenshots of
every view; a sweep of the code and the docs). The owner took all of them into scope:
the checklist in `docs/milestones.md`, "R5 checklist".

## Decision

**The acceptance under a cap.** With the kiosk capped at 30 fps, "≥ 30 fps median" is
read as holding the cap. The report gives the median, the 1 % low and how much of each
frame's 33 ms budget is left (frame-time headroom), so that a scene running at the cap
with little room is told apart from one with plenty.

**The report.** `reports/R5-final/` (`npm run final`), like R4's: it builds the renderer
as it was when R5 began (a temporary worktree at `R5_REPORT_BEFORE`, default the commit
R5 branched from) and as it is, and films the same places in both at 1024×600. Stills
can be compared by dragging, and films that follow an animal play side by side. The films
are a few MB, so they are committed (the owner).

### Round 1 (2026-10-21): checklist items 1–7

- **The demo clicks out.** A click or tap is the view button in every view;
  `Director.nextSubject` is gone; `toMap` stays for the apocalypse.
- **1. The animal followed shows through grass.** Grass and small things in front of it
  go see-through (40 %), as trees do (30 %). The owner chose this over a minimum size.
- **2. Colours from the genes** (the owner: "directly from their genes… 3 genes for the
  pattern, others for the body"). The body takes its hue from `HUE`, its saturation from
  `AQUATIC` and its lightness from `SIZE`. The markings take their hue from the body's,
  turned by `SOCIAL`, their saturation from `DIET` and their lightness from
  `EXPLORATION`. Sister species differ by a few hundredths in every gene (in the v9
  recording, eight of ten species have `HUE` between 0.92 and 0.97). So each gene is read
  by its species' **rank** among the species alive, spread over its range. Three ways
  were drawn for the owner: the genes as they are (eight near-identical species), stretched
  by min–max (two outliers take the range), and ranked (ten clearly apart). The ranks are
  read again when a species appears or dies out, and every animal is then redrawn where
  it stands.
- **3. Map dots**: round dots of whole pixels with a dark edge, three sizes by mass,
  rings for swimmers, and the smallest dot for the young.
- **4. The ground**: the middle view reads the cover of neighbouring cells (`calm` 1).
  Borders between kinds wander with noise. Growth beside bare ground has a lip, lit from
  the upper left.
- **6. Snow** lies only where the simulation has it; bare heights are rock.
- **7. The young**: `young` on the `creatures` message, each young animal's id and how
  far it has grown in sixteenths (from `Population.maturity`, a read-only property:
  additive, no schema bump). A newborn is drawn at half its grown length, its head 35 %
  larger for its body.

### Round 2 (2026-10-21): the owner's comments

- **No olive** (the owner: "avoid olive"). Body hues keep off the ground's yellow-greens
  (0.11–0.42 of the wheel); markings that fall there are pushed to its nearer edge;
  saturation starts at 0.5, not 0.32.
- **A tuft that popped as an animal walked through it.** Two causes. "In front" was judged
  by the bottom of the animal's box, while the animal is drawn in the row of its lowest
  joint: a tuft between the two was drawn over it but never made see-through. And the
  fade snapped in one frame. Now "in front" is a row after the animal's own, and plants
  ease to see-through and back over 0.25 s. Plants and animals are still sorted in rows
  a quarter of a cell tall; finer rows or a sort by exact height are the next step if a
  pop is still seen.

### Rounds 3 and 4 (2026-10-21): grass after references

The owner: "grass blades are still not there. Search for references". In top-down pixel
art (The Minish Cap, which the grass tutorials take as their model), grass is a texture of
small, unoutlined tufts, not objects standing on the ground. Ours were 24×16 art pixels
(three quarters of a cell) and outlined like bushes. A tuft is now about a third of a
cell. It has three to five spikes fanning in a V from a narrow foot, darkest at the foot
and brightest at the tips, with no outline. Three to six stand in a cell by biomass, in
clumps.

The owner liked it and asked for several sizes and "some random change in color". There
are now nine drawings, from 0.6 to 1.45 times the size; a large tuft grows wider, with
more spikes, rather than taller. Each tuft takes one of five tints at random (none,
warmer, cooler, darker, warmer and darker), as a sprite tint, which costs nothing.

### Plants on water (2026-10-21)

A plant was allowed by its cell's height, but the ground paints the coast between cells
(bilinear) and the swash runs up the beach at high tide, so near the shore a plant could
stand in the sea. Reeds were the worst, and since round 3 grass clumps spill into the
next cell. A plant's foot must now be on the painted land and as far from the waterline
as the swash reaches in its view; otherwise it and its shadow are left out.

### Animals in the water (2026-10-22)

On `main` the simulation lets a land animal into the sea. It pays heavily for each hour
there and drowns when its energy runs out (M11, on the coordination board), so 1.1 % of
the land animals' positions in `life.json` are on the water, and a few swim far out for
days. On `m11-tuning`, the shallow shelf (≤ `wading_depth`, 0.03) costs nothing. The owner:
"creatures can be in shallow water as long as it's clear they're struggling more than on
land, unless they have some share of the aquatic gene". The renderer shows the
simulation's place and never moves an animal out of the water. It draws the effort,
`1 − AQUATIC / 0.6`: in the shallows legs under the water, slower and ripples; out of its
depth legs out of sight, the body sunk but for the head, slower still, bobbing, faster
and wider ripples. Whether wading on the shelf should also cost energy in the simulation
is M11's lever and the owner's call: M11 made it free on the owner's word (2026-10-20).

### Trees and bushes (2026-10-22)

Strolls between sim ticks asked only whether a place was land or water, so animals walked
through bushes and stood on trunks. Trees and bushes now leave footprints (the trunk and
roots of a tree, the lower puffs of a bush) that strolls avoid and that the walk to the
sim's place steers round. A sim place inside one is drawn beside it, without changing the
sim's data. Measured in the page, the middle view at (64, 64) went from 1–3 of about 14
animals in a footprint at any moment to almost always none. The footprint sizes are first
guesses. In dense scrub in the middle view an animal sits in the gaps, or goes straight
through when there is no way round.

### Legs and bodies (2026-10-22)

Worked on in parallel worktrees and merged. **Legs**: a foot stepped when its rest point
was 0.8 leg lengths away, so on a short-legged or slow body every foot crossed that line
on the same frame. Now each leg has a phase in a gait cycle tied to the distance walked:
diagonal feet together, a pair's feet half a cycle apart, 40 % of the cycle in the air.
No foot slides, and a stopping body steps its feet back under it. Logged over about
5 000 animal-frames (seeds 2, 4, 7, 10, 11 and 12), no frame had every foot in the air.
**Bodies**: the chain followed the head with no limit on the angle between joints. Now
each kind has a total bend (`BODY_BEND`), the head a neck limit (0.6 rad), long bodies
turn in arcs and short stiff ones on the spot. In a stress test (10 simulated minutes per
kind, a new anchor every 3 s), joints of non-neighbouring segments came within 1.2
spacings in 16–26 % of frames before, and none after. Arc-turning bodies spend more time
beyond their leash in that test (about 40 % of frames against 26–30 %), which looks minor
at the scene's pace.

## Consequences

- The wire gains `young` (additive). S1 sends it as `tools/stream.py` does. M11's merge
  regenerates the recordings as usual.
- Colours now depend on which species are alive, not only on an animal's own genes. A
  species keeps its place in the order but not an exact hue across the years.
- Tests are written once the owner calls the look final (as in R4).

## References

- imonk, "Pixel tutorial: Zelda style mockup, part 1: grass", itch.io,
  https://itch.io/t/2758242/pixel-tutorial-zelda-style-mockup-part-1-grass (The Minish
  Cap's grass as the model: a texture of small tufts, hue-shifted spikes).
- "Pixel tutorial: grass patches", itch.io,
  https://itch.io/t/2197445/pixel-tutorial-grass-patches (a blob with blades along its
  upper edge, light on the tips, the inside kept flat, darks shifted toward blue).
- Slynyrd, "Pixelblog 20: top-down tiles", 2019,
  https://slynyrd.com/blog/2019/8/27/pixelblog-20-top-down-tiles (a few key shapes
  repeated, clusters across tile edges, few colours, low contrast, negative space).
