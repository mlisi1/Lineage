# 0022 — The final rendering pass: the look tuned together, and the board at 30 fps

- **Status**: accepted: the look (the owner called it final, 2026-10-25) and the board's
  measurement (R5.1–R5.4 pass, `reports/R5-device/`, 2026-10-27)
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
  stand among them. Kept behind `?bushes=pieces` until the owner compared the films; chosen
  on 2026-10-24 (below).
  Open: legs overlap the bush's lower edge when an animal is in front; sprouts are still
  walked over; a rare-gene overlay stays whole over the pieces.
- **Open points from the four**: the prey stands frozen up to 1.4 s before a strike; the
  middle view's hunt is quick (about 0.75 s); hearts and eggs are drawn over a canopy; a
  sleeper's shadow stays a full oval; the director still follows sleepers at night;
  butterflies use meadow cells for flowers; calm days barely stir the plants
  (`CALM_WIND`, `BREEZE` if the owner wants more); autumn leaves are not done (done
  below).

### Seasons, family and rare genes (2026-10-24)

The owner, after the report with the animations (2026-10-24): "Everything seems good." The
bushes are drawn in pieces from now on (`?bushes=whole` draws them whole, to compare),
with no fade in front of the animal followed; each piece leans in the wind by the lean
the whole drawing would have at its height, every piece of a bush in step. Before the
look is called final, a last pass on what animations were still missing; of four groups
proposed the owner chose three (not the reactions to danger: prey bolting, fleeing fire,
a startle at quakes), all drawn only, so that nothing changes M11's simulations.

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

- **Rare genes in action, drawn only** (worktree `r5-genes`): the rare genes come on the
  wire already (`born[].slots`, `rare` signatures), so nothing new is sent and the sim is
  unchanged. A photosynthesiser (`leaves`) standing about in daylight on dry land, under
  a clear sky, settles and spreads out flat to the sun (wider, parts further out and
  lower, legs straight out), a star of sunlight glinting on its back now and then, and
  gets up when it moves on, at dusk or under cloud (`creatures/basking.ts`; the
  atmosphere's eased `overcastNow` reaches the layer with the light). A venomous hunter's
  strike adds a lime flash and drips at the bite, green in the prey's scuffle and green
  wisps (`venom.ts`, `remains.ts`). A swimmer, or an amphibian (`gills`) in the water,
  leaves a V of foam dashes while it moves, none standing still (`wake.ts`, on
  `Landscape.floor` under the plants and animals). All are pooled marks of whole art
  pixels moved by whole pixels (`sparks.ts`), timed from the scene's clock and each
  animal's own offset, with no random draws. Staged with `window.__grant(id, look)`,
  a debug hook that draws an animal with a rare gene it lacks.
  Open: no recording has a true swimmer (AQUATIC ≥ 0.6), so the wake was seen on an
  amphibian only; the middle view's wake is a narrow line rather than a V; "open land"
  is read as dry land, not as out from under a canopy; a basker caught by the sim's
  move flattens back up in a third of a second while it already walks.

- **Family life, drawn only** (`creatures/family.ts`): the sim has no families beyond
  `born[].parent`, so the scene remembers the mother of each young animal it sees born
  (a page loaded mid-life has no pairs until the next births) and forgets her when the
  young one comes of age or either dies. While the sim has the two within 3 cells, the
  young one's strolls make for a spot behind her tail and a little to one side, trotting
  to catch up; the spot is kept within its leash of where the sim has it (`motion.trail`),
  so it is never drawn off its own place. A brood trails in a line, each behind the one
  born before it. At a birth the grown one of her kind nearest her head (within 2.2 cells
  and a 2.5 s trot) comes to the side of her head away from her young; their heads lean
  together for 1.4 s under two hearts, then the young are born as before. Staged at the
  birth, not predicted: the newborn comes that much later than the message. Open: young
  pass through each other and their mother's legs (animals never avoid one another);
  slow species rarely find a mate near enough, so most births have no nuzzle; on the
  recordings' fast clock the sim's places move every third of a second and the trailing
  shows mostly while the young walk to them.

### The look called final (2026-10-25)

The owner, after the report with the new sections tagged: "I'd say it's all good", then
"Yes, i think we can call it final" (2026-10-25). The look of R5 is final as the report
`reports/R5-final/` (1e07964) shows it; the open points above stay open, the reactions to
danger stay out. What follows is the tests (checklist item 20), the board (items 17–19)
and the merge into `main`.

The tests (2026-10-25) found two places where the drawing did not do what its notes said,
and the owner chose for each:

- **No dust in rain.** Running animals raised dust in a thunderstorm and during an
  apocalypse, against `ambient.ts`'s own header. The owner: none while it rains or a
  world ends (wet ground raises none). Fixed.
- **A soft turn kept.** While a body turns hard, a joint may bend past its kind's limit
  for a moment (up to about 0.1–0.2 rad) and is eased back (`followChain` is given the
  frame's time, `STRAIGHTEN_RATE`); the body never comes onto itself. The owner keeps it:
  it reads as a soft turn. A test holds it under 0.25 rad and back within once it walks on.

The report's films (about 60 MB) leave git, as R4's did (the owner, 2026-10-25): the page
keeps a poster of each, and `npm run final` films them again.

### The board (2026-10-27)

Twelve runs of the scene's benchmark on the board's 7" screen at the 30 fps cap took the
crowded middle view from 20 fps, 84 % of frames late, to 30 fps and 4.6 %, the other
judged views to 1–2 %, with memory near 580 MB of 800 and the board under 77 °C. Each
step was measured on the board before it was kept; every one but two left every pixel
of the screenshots as it was.

- **What the frames spent.** In the crowd 47 ms of a frame were the page's own work,
  the GPU far from busy: PixiJS rebuilt its draw list of some 22,000 objects every frame
  (any sprite shown or hidden, any animal stepping into the next plant row, made the
  world's structure change), and every animal on the island was moved and placed among
  the rows each frame. Kept: effects that show and hide sprites each frame in render
  groups of their own; the plant rows in bands of four cells, each its own render group,
  so an animal changing row rebuilds one band; what stands among the plants (flames,
  lava, leaves) put last in its row only where it is not already; the grey under cloud
  told the canvas as its filter area (Pixi measured the world's bounds for it every
  frame); an animal posed from just what it was posed from last frame posed again only
  in its breathing chest; fewer objects made per frame (one walker for every animal, no
  arrays per leg or map entry).
- **Two that change what is drawn, a little.** Animals out of sight live one frame in
  three with the time of all three, and wait in their row until they come into sight
  (only where they walk while unseen changes; staged stills taken again). In the middle
  view, where an animal is a few art pixels long, an animal in sight is posed on two
  frames in three, staggered, with the time it missed (the owner's choice, 2026-10-27,
  after a film of the crowd before and after).
- **The ground.** One picture of the middle view's whole island took the board some 25 s
  before anything showed, and the local view's pieces as long: the middle view is now
  painted in pieces of 32 cells, the screen and a piece round it first; two workers
  paint (the cores less two, at most three: three took the frames' time on four cores); pieces come on the screen nearest first, four a frame. The owner: "save
  the world once generated and pre-compute all we can": every piece painted is kept in
  the browser's storage under a stamp of what it was painted from (the build, the world,
  the land message, the day, the look) and shown as it is when the stamp is today's;
  an older one is shown at once while today's is painted over it, so bare ground shows
  only the first time a world is seen; the workers read and write it, the page's thread
  only reads what it shows; after each new day the rest of the island is painted ahead
  and kept, resting 30 s between pieces and only while the frames have come on time for
  3 s (painting ahead made the crowd's frames late on four cores). The crowded middle
  view is ready 10 s after loading instead of 26, the local view 35 s instead of 83.
- **How it is measured** (the owner's choices). The plain kiosk alone (every GPU profile
  draws through the same path on the board, ANGLE on OpenGL ES with Panfrost; the CPU's
  drawing is not run, it cannot draw the scene); 20 s measured a scenario (in 8 s, some
  240 frames, where a day's turn fell decided the result); a view measured only once it
  is painted; the sim-day held while a scenario is measured, as on the desk where it
  turns once a day (the recording is played 1800 times as fast: a day every 48 s, each
  turn some 12 s of late frames as the new day's plants and ground fade in over the
  old); a day's turn measured apart, reported and not judged (20 % of its frames late);
  the page's size read as each scenario is measured (read when the run began it was the
  kiosk window before it went full screen).
- **R5.2 near its band.** Run to run the crowd lands between about 4 % and 6 % late
  frames; the owner (2026-10-27): 5.5 % is acceptable given a 5 % limit. The run kept,
  the twelfth, measured 4.6 %.
- **Open.** A big fire draws at 20 fps (300 burning cells, its flames and smoke placed
  every frame; reported, not judged): capping the flames drawn would change how a big
  fire looks. A day's turn costs some 12 s of late frames once a day. Rain and night in
  the crowd are at 6 %.

### M11 merged in, and the showcase (2026-10-27)

`main` (M11) was merged into `r5-final` on 2026-10-27: R5 merged second, so it re-recorded
the streams with M11's tuned simulation (the creatures message keeps R5's fields), kept
both sides of `population.py` (R5's outputs for the scene beside M11's soil, wading and
seeds in guts), regenerated the spike's fixture (M11's phenotype reads
`meat_diet_exponent`) and took the screenshot baselines again from the new recordings.

The owner, after the board's run: "create a demo/showcase of the whole thing ... the
overall concept of Lineage, some close ups, effects, animations ... almost like a trailer
(with text that describes what is being shown) ... a way of seeing the actual thing
rendered on the board with no memory refreshes and no clear cache", with a frame counter
in the corner and a summary on Ctrl+C. Chosen: about two and a half minutes (now nearly
three), the counter on the board only, an end card with the hardware and 30 fps. Built as
a mode of the page in the desk's build (`?showcase`), run on the board by
`tools/showcase.py`, filmed on the PC for the README.

What the board showed on its first runs, and what changed:

- **Bare ground at cuts.** The tour jumps between places; the first loop painted each
  when the camera got there. The showcase now waits in the dark at a cut until the ground
  of its next shot is painted, and paints the next shot's ground ahead while an act plays
  (`PieceGround.prefetch`); it paints nothing else ahead.
- **The cache could not keep up.** It kept the latest painting of each piece only, and the
  tour goes from autumn to snow to a crater and back each loop. It now keeps several
  stamps per piece, the least used let go beyond twelve; the painting workers read it
  themselves and hand pieces over without copying, the page reading it only for a piece
  late (a third of a second), to show the latest kept at once.
- **Freezes.** A new land laid out every view built on the page's thread; now only the
  view on the screen, the others when shown. The showcase's clock steps at most a tenth of
  a second, so a freeze lengthens the dark rather than cutting a scene short.
- **The owner's notes.** The meteor left its trees standing (the showcase held the
  sim-day, and with it the crater's land; it holds none now); the ark's light was where the
  meteor fell (each power has a place of its own); the snow and the night came too fast
  (snow now falls and settles on the high ground, then lower, over 18 s; night falls over
  9 s); the transitions jolted (eased fades out and in, the caption after the picture);
  the winter shot showed past the world's edge (shots kept inside the world).

Open: on the board's first runs, the weather act (a thunderstorm up close) ran at some 16
fps and the night act at 22; the world's end and the end card were slow. The owner then
moved the showcase and its trailer to a milestone of their own, R6 (2026-10-27): R5 closes
on its look, its tests and its measurement on the board; the first version of the showcase
stays on `r5-final` as R6's start, only on `?showcase` (the desk's page is unchanged by
it). The changes to the ground it led to (several stamps kept, the workers reading the
cache, a new land laid out per view) are R5's and stay.

### The review of the pipeline (2026-10-28)

A review of the renderer's per-frame costs (`docs/renderer-performance-review.md`,
profiled on the PC) ranked what could be made cheaper, each change marked as leaving the
pixels as they are or not. Those that leave them were made, checked against every
screenshot and against film frames before and after, byte for byte:

- **What stands over an animal** (P2): asked of the plants again only when the animal
  has moved or the plants have changed (built, a bush's piece slid, a drawing of another
  size swapped in); in the crowd seven questions in ten are answered from what was kept.
- **Plants** (P3): culled and blown in the view shown only; a plant whose lean cannot
  reach a whole pixel is not blown; only rows near the view are looked at.
- **Small writes** (P6): transforms, opacity, the grade and the sea's shore uniforms
  written only when they change; the animals in sight and the glowing spots kept for the
  frame.
- **The scroll** (P7): repainted only when its paper moves a pixel (a repaint costs some
  0.2 ms on the PC and lasts the second and a half a scroll rolls, so no more than that).
- **The ground** (P8): pieces go to the GPU from the painter's pixels, no canvas between
  (two copies fewer, and no canvas kept per piece).
- **Fire** (P1): a sprite passed over keeps its place in its pool, so those after it are
  not rewritten; tints written only when they change; no objects per cell per frame. On
  the PC, `drawFires` fell from 23 % to 16 % of the fire scenario's script. Keeping a set
  of sprites per burning cell, as the review suggested, would have changed the order in
  which overlapping flames are drawn: not done.

Left for the board, which alone decides: the plant bands' size (P4), and drawing each
animal as one batch rather than some 45 sprites (the review's §2), both to be measured
there before they are kept. Left for the owner, since they change pixels: dots on the map
at a lower cadence (P5), simpler bodies in the middle view, and leans on alternate frames.

### The optimization plan (2026-10-28)

The owner: "Make a thorough plan on how to further optimize the rendering", then "Go on,
and implement the changes. Be sure also to optimize the terrain rendering". The plan and
its status: `docs/renderer-optimization-plan.md`. Kept, all the same pixels:

- **A frame probe** in the benchmark (`src/frameprobe.ts`): each frame's phases and what
  happened in it, and for each late frame the phase that took most of it or "outside".
  The board's long frames (230–320 ms in every scenario) are to be named by it before the
  work that can wait is put under a budget.
- **The card's portrait** drawn in the dark of the dip and read back without waiting for
  the GPU (a pixel-pack buffer and a fence); its `readPixels` had waited for every draw
  queued before it, up to four times per portrait.
- **A day that looks the same is not laid out.** Away from a turn of the season, a day
  that brings no land shows exactly what the day before showed; it was laid out and
  painted again all the same. Now only a new land or a day in a turn is, and the kept
  paintings are stamped by the season. The benchmark's `day-turn` has a land come instead.
- **The painters** 8–13 % faster: a pixel's season worked out only in a turn, a calm
  pixel adding only the kinds of cover around it. Then a piece's margin painted only as
  land or sea past a rim of 8 pixels: a local piece in a little over half the time it
  took (checked on every piece of the island in three seasons, every pixel shown the
  same). Left to the owner: WebAssembly (same bits, a new toolchain) or a shader (much
  faster, not the same bits).

Not done: each animal as one batch (it would have to redo what sleep, the rare overlays,
eating and the water do to a body's sprites, for some 7–10 % of the crowd's script by the
PC's profile), left to the owner and the board's probe; one texture for the ground's
pieces (few binds are the ground's).

## Consequences

- The wire gains `young`, `died`, `landed`, `grazing`, `feeding`, `died[].by` and
  `born[].parent` (additive). S1 sends it as `tools/stream.py` does. M11's merge
  regenerates the recordings as usual.
- Colours now depend on which species are alive, not only on an animal's own genes. A
  species keeps its place in the order but not an exact hue across the years.
- Tests were written once the owner called the look final (as in R4), on 2026-10-25:
  vitest for the pure pieces and the layers run in Node, Playwright stills of what R5
  drew (`tests/e2e/final.spec.ts`), the sim's new outputs and the encoder in Python.

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
