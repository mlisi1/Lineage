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

### Eating (2026-10-23, evening)

The owner asked whether animations were missing. Animals walked, rested and looked about,
but did nothing the simulation does, because no behaviour was on the wire. Eating came
first. The sim's per-tick meal (`_meal`) gained a meat share (`_meat`) and a read-only
`Population.eating` (0 nothing, 1 plants or algae, 2 meat). Both arrays are now kept in
step at deaths and births, which nothing needed before; they are not saved and draw no
random numbers, so the recordings are unchanged but for the new `grazing` and `feeding`
lists. The fauna's bare-rock golden hash (`test_golden_hash_from_bare_rock`) was found
failing already on `main` at R5's start (80e4a4c), not from R5; noted for M11.

### Round the bushes (2026-10-23, later)

The owner: "creatures still are a bit weird when walking through bushes", with the leaves
over them. A bush is a low mound seen from above, so being under its leaves is being in
it. Its footprint became its whole drawing, and the walk to the sim's place became a
planned way round trees and bushes (A* on a quarter-cell grid, pulled straight), not only
a local steer that went straight on when it found no way. The staged tests had been
misleading: the recording's next creatures message re-anchored the staged animals to the
sim's places. Staged animals now ignore the sim's places. Splitting bush drawings into
pieces, the owner's other idea, was kept in reserve: it matters for an animal between
the puffs of one clump, which a footprint over the whole drawing rules out.

### The scene's benchmark and the desk's build (2026-10-23)

The benchmark moved from the R0 spike to the real page (`index.html?bench`) and plays the
committed recordings, since there is no server yet. Besides the four views ADR 0010 judges,
it measures the atmosphere's costs R4 left to R5: night with glow, rain, a big fire, the
apocalypse's repaint and the shore's shader. Chromium has no flag that caps a page below
the display's rate, so the page caps itself at 30 fps (`?cap=30`), and the report gives
the share of frames over budget and the headroom left. The desk's build (`build:kiosk`)
compiles the demo paths out and connects to `ws://<host>/stream` (S1's to provide), with
`?bench` its one way to play recordings. The scrolls became two things: the chronicle an
illuminated scroll, and the name card a field-guide card with the animal's portrait (the
owner).

### Under the leaves (2026-10-23)

The owner still saw animals walking over bushes, and asked for the fade to be switched
off and for scenes staged by hand rather than waited for. With animals pinned round a
bush (`__pin`, `__send`), the split of round 1 worked for a body lying across a bush.
What remained was an animal in front of a bush, its body over the bush's lower edge. Top-down games put a
character in front of a plant whose base it is in front of, and that suits characters
drawn from the side. Our animals are drawn from above, so in front of a bush they seemed
to lie on its leaves. The rule now is that the leaves of a tree or bush are over any
animal they overlap. The animal is drawn in the row before the first plant whose drawing
overlaps it, and the two-part split is gone. A bush's footprint became a band along its
whole foot, so animals go round bushes or behind them and never stand across their
fronts. The fade in front of the animal followed is off for now.

### Chronicle places, wet feet, off the spike (2026-10-23)

The owner chose, by view: the map and the middle view mark an entry's place while its
scroll is out, and the local view's camera visits it and comes back to the animal it
follows (the time on the animal paused). This brings back a camera move made by the
chronicle, which R3 had dropped for dawn shots and recaps, but only while an entry is on
the scroll and only in the local view. At high tide the swash runs over the beach, and an
animal it reaches gets wet feet (the shore shader's swash replayed in
`Landscape.swashCovers`). It doesn't move away. The real scene no longer imports from the R0
spike: the creature layer, its atlas, habitat, seed type and the views' sizes moved to
`creatures/`.

### Deaths and landings (2026-10-22)

The owner chose deaths shown by cause, plus a carcass, and a splash only for landings
from the sea. The sim knew each death's cause (`Death`) but returned none of it, so it now
emits `CreaturesDied(ids, causes)` per tick, an output that changes no saved state and no
random draw (golden hashes unchanged). A blast's dead are reported as `blast` rather than
`killed`. Landings use the existing `CreaturesArrived`. The wire gains `died` and `landed`
on `creatures` (additive). The recordings differ from the old ones only by them. The
carcass is the renderer's, one per death, rather than the sim's carrion grid, which is not
on the wire and is eaten cell by cell, not body by body. It has bones (charred for the
burnt, none for the drowned or the blasted, as the sim leaves no carrion there), whole
for half a sim-day, then fading. The dying no longer get an alpha filter each (a known
device cost): whole sprites are hidden in steps. Left open: the ark's light hides the
splash; charred bones barely show on grass; the committed recordings have no landing or
burnt death.

### The name card (2026-10-22)

The owner chose a hybrid: the species' name, traits in words where words do well (size,
build, diet), pixel icons where they don't (water-loving, rare genes, night habits). It is
always on while following, in a corner. It is built in `card.ts` as R3's scroll, smaller,
in the top-left corner (the chronicle's scroll unrolls at the foot). The words follow the
genes by named thresholds (diet by the sim's own chronicle classes, 0.35 and 0.65). The
genome has no nocturnal gene, so none was invented: the glow rare gene is the one night
trait, with its icon. Left open: an animal with warning colours is drawn in warning bands
while its swatch shows its gene colours; three sizes make some lines three words with no
build word; the drop and warning icons are the weakest at seven pixels.

### Depth among plants (2026-10-22)

The owner, after the bush clips: "it still seems that creatures are over the bushes. Some
part of them are above the bushes… it's just to avoid a creature entering inside a tree.
Can you search online how they solve this problem?" Top-down pixel-art games draw by
the feet (a y-sort with the pivot at the base: a tree's trunk, a character's feet), block
only at a tree's base so a character can walk behind the canopy, sometimes make the
canopy see-through while the player is behind it, and split a sprite that spans depths
(a big tree drawn as several tiles) so that each piece sorts by its own base. Ours had the
first two. The third was missing: an animal was sorted whole by its lowest joint, so the
head of an animal walking up the screen was drawn over a bush that stood in front of it.

Now an animal that a tree or bush stands across is drawn in two parts, behind and in
front of the plant. It is not split into a piece per joint, because the body draws all
its outlines under all its fills, and per-joint pieces would show a dark seam at every
joint. With two parts the one seam lies under the plant. The fade in front of the animal
followed also went from 30 % to 60 % (bushes and trees) and from 40 % to 50 % (grass): a
bush nearly gone in front of the animal made it look as if it stood on top.

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
### Animations and bushes in pieces (2026-10-23 night to 2026-10-24)

The owner: "Eating is good. The bushes still do not satisfy me but honestly I don't know
how to solve it. Go on and implement the next animations." Four worktrees in parallel,
merged into `r5-final` on 2026-10-24: hunting and births, plants in the wind, sleep and
small life, and bushes in pieces as an experiment beside the whole bushes.

- **Hunting and births need two facts the stream lacked**: who killed and who bore. The
  sim already knew both at the moment; they leave as outputs (`CreaturesDied.killers`,
  `CreaturesBorn`) and on the wire (`died[].by`, `born[].parent`). Nothing saved
  changes, no draw is added or moved; the re-recorded streams equal the old ones but for
  the two fields. The hunt is not the sim's stalk, which spanned hours between messages:
  the scene shows its end, a run and a spring, and holds the prey until the strike.
- **Wind by whole pixels, not a shader**: a shader over the plant layer would move the
  animals sorted into its rows, one per sprite would break batching. Lean frames drawn
  lazily cost one small page instead of 50 MB of GPU memory up front.
- **Sleep is drawn only**: the sim has no sleep, so the scene lays animals down by the
  light, never against the sim's place (moved far, they get up and walk).
- **Small life** stays out of the sim and off the map, on a random stream of its own.
- **Bushes in pieces**: sorting a whole bush by one base cannot be right for an animal
  partly in front of it and partly behind; cutting it into puffs, each sorted and
  footprinted on its own (the forum's "split a sprite spanning depths"), lets an animal
  stand among them. Kept behind `?bushes=pieces` until the owner compares the films.
  Open: legs overlap the bush's lower edge when an animal is in front; sprouts are still
  walked over; a rare-gene overlay stays whole over the pieces.
- **Open points from the four**: the prey stands frozen up to 1.4 s before a strike; the
  middle view's hunt is quick (about 0.75 s); hearts and eggs are drawn over a canopy; a
  sleeper's shadow stays a full oval; the director still follows sleepers at night;
  butterflies use meadow cells for flowers; calm days barely stir the plants
  (`CALM_WIND`, `BREEZE` if the owner wants more); autumn leaves are not done (done
  below).

### Seasons, family and rare genes (2026-10-24)

- **Autumn leaves and animals in the rain, drawn only** (`atmosphere/leaves.ts`,
  `creatures/weather.ts`). The plant layer marks the crown of each broadleaf it builds in
  autumn (not one with `EVERGREEN` enough to keep its leaves in winter, no conifer), with
  the colours it has turned; leaves come loose where random tries over the view find a
  crown and the plants' gust (`gustAt`) lets one go, so a wood drops more than a lone tree,
  late autumn more than early, rain and storms more through the wind's strength. They fall
  on that wind, sorted among the plants by where they land, a pixel in the middle view and
  in the plants' two-pixel texels up close; none on the map. When a rain spell ends each
  animal that was out in it shakes once at its own moment (from its breathing offset, no
  new draw), a shiver of the joints aside for the drawing and a spray of drops; in a
  thunderstorm animals hunch (parts less lifted, feet in, head back, shorter and slower
  steps). Staged with `?season=autumn:0.9` (the clock rewritten) and `__rain(kind)`.
  Open: under a storm's grade the leaves barely show; shrubs drop none; the shake is
  checked on three animals at 30 fps, never on the board; drops are 1 art pixel, small in
  the middle view; a huddled animal's shadow is unchanged.

## Consequences

- The wire gains `young`, `died`, `landed`, `grazing`, `feeding`, `died[].by` and
  `born[].parent` (additive). S1 sends it as `tools/stream.py` does. M11's merge
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
- KidsCanCode, "Using YSort", Godot recipes, https://kidscancode.org/godot_recipes/3.x/kyn/ysort
  (draw order from the y of each object's base).
- Godot forum, "Player sometimes renders behind bushes/trees even when clearly in front",
  https://forum.godotengine.org/t/player-sometimes-renders-behind-bushes-trees-even-when-clearly-in-front-collision-issues/141959
  (the tree's sort origin at the trunk's base, the player's at the feet; a tree of several
  tiles sorts by its own base).
- Godot forum, "Alternative to Y-sort", https://forum.godotengine.org/t/alternative-to-y-sort/11307
  (a sprite spanning depths is split into pieces, each y-sorted).
- Bugnet, "How to fix Unity sprite sort point: pivot vs center",
  https://bugnet.io/blog/how-to-fix-unity-sprite-sort-point-pivot-vs-center (sorting by the
  centre instead of the feet makes tall sprites flicker in front of and behind each other).
- Codea forum, "Fake 3D effect", https://talk.codea.io/t/fake-3d-effect/8129 (collision
  at a tree's base only; draw the player behind the tree once above its base).
- Construct forum, "Tree opacity collision",
  https://www.construct.net/en/forum/construct-3/how-do-i-8/tree-opacity-collision-178855
  (the canopy see-through while the player is behind).
