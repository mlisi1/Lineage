# Renderer

One renderer draws the scene for the desk screen and for the phone (CLAUDE.md §4.7):
TypeScript and PixiJS in a browser, which on the device is Chromium in kiosk mode at
1024×600. The R0 spike (`renderer/src/spike/`) settled the approach; R1 draws the land
and its plants from the state stream (`renderer/src/`, see "The land from the state
stream" below); R2 the creatures, R3 the camera, its captions and the animals in the
scene ("The camera and captions" below); R4 the atmosphere.

## Pixel art

Everything on screen is pixel art: flat colours from small palettes, stepped shading,
hard edges, no smoothing.

- **Art pixels are 2 screen pixels.** The scene is drawn into a canvas of 512×300 and
  stretched to the screen by CSS with `image-rendering: pixelated`. No antialiasing,
  nearest-neighbour textures, positions rounded to whole art pixels. The camera alone moves
  by less: the canvas is drawn an art pixel larger all round and slid by the camera's
  fraction of a pixel, in whole screen pixels (R3), so that a slow pan glides. Plants are
  laid out with their corners on whole art pixels, so that none flickers as it moves.
- **One palette.** Land and plant colours come from `tools/viz/pixelmap.py`, the same
  ramps the report maps use, so a forest is the same green in a report and on the desk.
  Since ADR 0014 it is the cosy palette, after Stardew Valley; the renderer reads a copy
  written by that module (`renderer/src/terrain/palette.json`).
- **World units are cells.** The world layer is positioned and scaled in cells of the
  simulation grid (256×150); the camera is one transform on it.

## Three views of one world

The world is a continent, and the screen shows it from three distances
([ADR 0007](../decisions/0007-three-views.md)):

| View | Art pixels to the cell | In sight | What it is for | An animal of mass 1 |
|---|---|---|---|---|
| **map** | 2 | all 256 × 150 cells | the continent | a dot |
| **middle** | 8 | 64 × 37½ | a region: its woods and shores, who is about | 4½ art pixels long |
| **local** | 32 | 16 × 9 | one animal, and what it walks through | 11 |

The land and its plants are not rescaled between the views: a grown tree is three cells
tall in the middle view and in the local one, drawn by the same rule, and the plants of
the middle view stand in the same places in the local view; the camera is closer, and
what it shows is drawn with the detail that distance has room for. Animals are the one
exception (see Creatures): true to the trees in the local view, larger than life in the
middle view, dots on the map.

### The ground: one painter

All three grounds come from `ground.ts`, one painter at three sizes, so each closer view
is the one before with what lies between its pixels worked out, not another picture. It
paints from the cells' heights, cover and biomass by the report maps' own rules: the sea
in bands of depth, relief as three tones by the slope toward the light, rock and snow on
bare heights, an outline on the shore.

Every value is interpolated between the four nearest cells, so nothing follows the cells:
the coast is where the height crosses the sea level, sea bands are depth contours, the
beach is wide where the land is flat, relief is shaded pixel by pixel, and what grows is
the kind that weighs most among the four cells. Where two kinds, two tones or two depths
meet they are dithered over a few pixels (the *blended* style; the map is *smooth*, cut
rather than dithered). The shore that animals respect (`habitat.ts`) is interpolated the
same way. The painter's other styles (`squares`, `warped`, `tiles`) are the ones that
were tried and passed over; `squares` is still what the first benchmark scenarios draw.

*Grain* is what the map does without: growth laid on the soil in patches that thin with
biomass and toward the edge of their kind, blades, pebbles, waves and foam. The patches
are the same on the land at every distance; from the local view on, their edges are
ragged a pixel at a time, blades are longer, sand the sea has just left is darker and the
foam is a band rather than a line.

**A close view is calm.** The world's cells differ one from the next (grass, then a cell
of scrub, then bare). At 8 pixels to the cell that is texture; at 32 it is a patchwork,
which is what the first local view was. So from 16 pixels to the cell on, the painter
reads what grows, how thickly, and how the land slopes over the cells around each cell
(a binomial kernel reaching `calm` cells: 2, chosen over 1 and 3, between which little
could be told) before it interpolates. A kind of ground then shows only where it holds several cells together;
growth thins in gaps a cell or two across instead of specks; the line where grass dries
wanders. The shore is not smoothed: it stays where the heights put it, the same in every
view and for the animals. Trees and bushes still stand on the cells that grow them.

**What a close view spends its pixels on** is what the ground is made of. On a grid of
places a few pixels apart, each a little off its place, it draws a small motif (a few
pixels, as text bitmaps in `ground.ts`) of the ground found there, and only onto that
kind of ground: blades and a bloom in grass, pebbles, grit and cracks in soil, ripples
in sand, leaf litter under broadleaves (whose floor is mixed toward brown), needles
under conifers, ash where it burnt. **Lichen** is not a colour of the ground from close
but rosettes on soil or rock, grey-green, mustard and chalk-white, more of them where it
grows thicker, and a few on any bare rock.

**Shadows are the ground's**, in the middle view and the local one. What stands on the
ground says how large a shadow it throws (`PlantLayer.shadows`), and the painter darkens
the land under it once, however many overlap, with a dithered rim. A shadow drawn with
each plant darkened the crowns behind it and every other shadow it crossed.

**The ground follows the seasons** (`season`; summer unless told): the tones of what
grows are the season's (`seasons.ts`), the turf blooms in spring and less in summer,
broadleaves drop gold and flame on a russet floor in autumn, and in winter low growth is
painted dried whatever its biomass, which is what the simulation's own winter does to it
by dieback. Snow lies on the land in patches cells across with a dithered edge,
thinner under trees, where the simulation's snow is (R1, ADR 0014: by season and
height, so the hills in autumn and the lowland only in a hard winter); the spike's `snow`
option, winter under snow everywhere, is what the look sheet still shows.

The map and the middle view are each one picture of the whole world (512×300 and
2048×1200), repainted when the plants change, once a sim-day. The local view would be
8192×4800, so its ground is painted in pieces of 8 × 8 cells as the camera comes over
them (`GroundPieces`) and forgotten when far behind. A piece is painted with a cell of
margin, which is cut off: calm, detail and shadows come out the same in a piece as in
the whole (a test holds this).

### Plants

In the map view plants are the ground's colour. From the middle view on, grass and lichen
are the ground's own texture and what stands on it is drawn by rule (`plantart.ts`), a
little off the middle of its cell. One rule draws a plant at any size, so the middle view
and the local view show the same tree, a quarter of the size in the first:

| | Middle view | Local view |
|---|---|---|
| Broadleaf, conifer | 24 art pixels tall full grown, in 4 cells of a wood out of 10 | the same trees, 96 tall |
| Bush | 10 tall, in 6 cells of scrub out of 10 | the same bushes, 40 tall |
| Grass | a tuft in one cell of grown grass out of three | tufts in every cell that grows it, more where it is thick |
| Small plants | none | by what covers the cell and by the season: see below |

**The rule** (T1, chosen from three; the other two, a rounded dome and forking limbs
with a clump per end, are in ADR 0007 and no longer in the code):

- A **broadleaf** is a crown of some thirty-five small bundles of leaves packed like a
  sunflower's seeds, after Slynyrd's Pixelblog 44 (one bundle of leaves, repeated and
  layered by the light). A bundle is a disc with a soft rim of three gentle bulges, lit
  on its own; its leaves are slanted dabs a couple of pixels long, which ruffle the line
  between two tones; it throws a thin line of shade on the bundles behind it. Five tones:
  the palette's three, a cooler one below and a warmer one above.
- A **conifer** is tiers of drooping boughs, the lowest drawn first, each shading the one
  below: lit on its upper left, in shade under its right hem, needles (two rows to a
  draw) ruffling the tones, the tips of its hem hanging to different lengths.
- A **bush** is a mound: rows of bundles from the ground up, each row narrower along the
  line of a dome, widest a little above the ground. (Bundles packed into an oval, as a
  crown is, came out lopsided and flat-sided.)
- A **trunk** stands under the middle of its crown and has bark from four pixels thick:
  a broadleaf's furrowed (strokes of shade down it, each column on its own rhythm, a knot
  on the stoutest, the crown's shade on the wood just under the leaves), a conifer's
  redder and scaly (short plates, staggered from one column to the next).
- Each kind comes in three drawings and three builds (as the scale has it, slender and
  tall, broad and low). Below three pixels of radius a clump is too small for a line of
  shade and is drawn a little lighter instead: that is what keeps the middle view's
  plants clear of the ground.

**Stages of growth** follow from the biomass of the cell (`growthOf`), four of them:

| Stage | Biomass (of 255) | A tree | A bush | Grass |
|---|---|---|---|---|
| sprout | 20–43 | a sapling: a stem and a few leaves, 0.42 of full height | first shoots (local view only: scrub that low has died back and is ground in the middle view) | a short tuft |
| young | 44–127 | 0.58 of full height | 0.6 | a middling tuft |
| grown | 128–215 | full height: three cells | full | a tall tuft |
| old | 216– | no taller, a ninth broader, a stouter trunk | a little larger | as grown |

In the fixture's two-year-old world half of the tree cells hold sprouts, a third young
trees and one in seven a grown or old one. Where it burnt stand charred stumps and
snags (a dead trunk, broken off, with the stubs of limbs).

**Seasons** (`seasons.ts`). The fixture carries the world's season; a layer can be
drawn in any:

| | Spring | Summer | Autumn | Winter |
|---|---|---|---|---|
| Broadleaf | lighter, yellower greens; one in three in blossom | the palette's greens | one in three gold, one flame, one half green | bare: the trunk, limbs that fork down to twigs |
| Conifer | light tips on the boughs | the palette's | unchanged | darker and bluer |
| Bush | two in three in blossom, white or pink | one in three in berry | rust; two in three in berry | bare twigs, a few berries left |
| Grass | short, fresh | tall | yellowed, in seed | dried, pressed flat |
| Small plants | daisies and bells; few mushrooms | all four flowers; reeds green | few flowers, ferns browned, mushrooms at their most | none but brown ferns, dry reeds |

A bare tree keeps trunk and branches in proportion: the trunk narrows over its lower
two thirds to seven tenths of its thickness; where it forks its leader carries on up a
little thinner and a bough leaves to each side, two lesser ones lower down on a large
tree; every limb then parts in two or three, each some three quarters or six tenths as
thick as what it grew from, down to twigs. A limb is as thick across whichever way it
runs, and stops at the edge of its drawing rather than run along it. (The first bare
trees had limbs under half the trunk's thickness leaving a trunk cut off square, and
drawn thinner still the more they leaned.)

With `snow` it lies on the crowns and limbs, on the shoulders of every tier of a
conifer, on stones and wood: in the scene on the plants of cells where the simulation
has snow, in any season (R1). Plants change from one season to the next over about four
weeks, one after another (R1, "The turn of the year" below).

**Small plants** (`drawSmall`) are placed by what covers each cell, by hashes of the
cell, so they are where they were on the next visit:

| Ground | What stands or lies on it |
|---|---|
| Grown grass | herbs; flowers of four kinds (daisy, bell, spike, umbel) in five colours, in drifts: one kind and colour over several cells, thick in places and rare between |
| Scrub | ferns, herbs, a flower now and then; the first shoots of a bush where it has died back |
| Under broadleaves and conifers | mushrooms (three caps), ferns, fallen logs |
| Bare ground, lichen | stones and boulders, some grown over with lichen or moss; herbs |
| Shore | reeds |
| Burnt | charred stumps, snags, logs |

Plants are kept in rows from the top of the map down (`plants.ts`), so that the nearer
cover the farther; each row has a place for the creatures on it, so an animal passes
behind the trees in front of it. The local view sorts four rows to the cell. Rows are
built a chunk at a time, when the view first comes near. In the local view a plant that
covers the animal the picture is about goes see-through. A layer's drawings are packed
into one texture in rows no wider than 1 024 pixels (`standingArts` lists them: 45 for
the middle view, 93 for the local one).

### Creatures

A creature is seen from above: a head that moves and a chain of joints that follows it
at fixed distances, which bends the body by itself. Legs are placed by two-bone inverse
kinematics: a foot stays planted until the body has left it behind. A body is a list of
parts riding the joints (`src/creatures/body.ts`): discs, wedges and bars, each with a size, a place
and a colour, all tinted sprites of one atlas, so a body costs no geometry, only
transforms. The derived values (mass, leg pairs, speeds) come from
`src/creatures/phenotype.ts`, a port of `fauna/phenotype.py` that a test holds to the
sim's own values for the fifteen specimens of `sim/tests/fixtures/phenotypes.json`. The
world sends genomes and the config keys the phenotype reads (`CONFIG_KEYS`), never
derived values, so a retuned sim is drawn as it runs.

The style is **body plans, outlined and lit**: a plan per kind of animal, so that the
silhouette says what it is, and a dark outline one art pixel wide around the whole
animal. Light comes from the upper left of the screen whichever way the animal faces.
Every mass of the body large enough (3 pixels across) is drawn twice: as it is, in a
darker and cooler tone, and on that the mass itself, a little smaller and toward the
light, so that the shade shows along its far edge only; round masses of 5 pixels and
more carry a lit patch, the largest a gleam. The masses are stacked layer by layer
(outline, shade, body, light), so that the shade of one does not show on its neighbour.
(The `circles` style, every animal the same chain, is the first look and what the first
benchmark scenarios draw.) The kind follows from the genes, leg pairs first:

| Leg pairs | Kinds, and what decides between them |
|---|---|
| 0 | `fish` or, slow, `eel` if it has fins (aquatic ≥ 0.3); else `snake` if fast (speed ≥ 0.5), else `worm` |
| 1 | `hopper` |
| 2 | `tortoise` under a shell (armour ≥ 0.55); else `newt` if half aquatic (≥ 0.5); else `lizard` if fast (speed ≥ 0.55), else `beast` |
| 3 | `beetle` under a shell, else `insect` |
| 4 | `crab` if finned or armoured (≥ 0.4), else `spider` |

Within a kind the genes still show: size as length (cube root of mass), speed as a
slimmer build and longer legs, armour short of a shell as plates along the back, sense
as eye size (ears on a beast), jaw as tusks, pincers or claws, diet as a hunter's
pointed snout and ivory instead of dark jaws. `BROOD` shows nowhere. Jaws of every kind
come out from under the head, so that the outline goes round them: drawn over the head
they left a fringe of stray pixels at the snout.

A **crab** is its carapace: wider than long, a small head in front with eyes on stalks,
and a pincer on each arm (a palm, and two fingers of different lengths that lean toward
each other, longer with the jaw gene). The last joint of its chain only steers it and
is not drawn, and its armour is the carapace itself, not plates laid on it.

**The aquatic gene turns legs into fins.** A body without legs grows fins at the
shoulders and a tail fin from 0.3. A body with legs grows none beside them: its feet
web from 0.3, wider with the gene (a fan at the end of each leg, in a colour that goes
toward the fins'), and at 0.6, where the animal lives in the water, its legs are
flippers: broad blades that row, swinging about where they join the body, each pair a
little after the one in front. With three or four pairs of legs only the last pair
turns, as a water beetle's, into flippers shorter than those of a body that swims with
all its legs. A webbed foot is an oval paddle set across the end of the leg, little
wider than the foot it replaces. A fin at the end of the tail comes only on kinds with a
tail to carry it (lizard, beast; a newt's and an eel's run along it), not under a
shell.

**Markings.** The pattern gene picks one of twelve by twelfths (plain, stripe, twin
stripes, bands, bars, spots, rings, saddle and mask, fade, chevrons, speckle, eyespots),
and how far into its twelfth the gene lies picks one of four colours for it: darker,
paler, a colour from across the wheel, or one a third of the way round. Markings go on
stations down the back: along the shell or carapace of a kind that has one, else on the
widest part at each joint.

A marking never leaves the mass it is on: each is fitted to that mass's oval, and drawn
smaller where the mass has less room for it (the ends of a shell). What each is made of,
so that it reads as what it is called: a stripe is ovals that run into each other down a
back, or one long oval that tapers with a shell; bands are narrow ovals across the back;
bars are one slanted bar to a place, all leaning the same way; a back fades in the
colours of its masses, joint by joint, and a shell in three ovals nested toward its
rear; a saddle brings a mask across the eyes. A marking too small to show (under most
of a pixel) is left out, which in the middle view is most of them. A marking of 3 pixels
and more is shaded as a mass is, on its own: its far edge in shade, and a sunlit patch
if it is round (no more than 2.2 times as long as wide: a patch would cut a band in
two). Stripes and fades are drawn flat, in their one colour.

**Under water** (`src/creatures/water.ts`). An animal that lives in the water (aquatic
≥ 0.6) must look as if it were in the water, not walking on it. The stage knows the water
at every place (`seaIn` in `habitat.ts`): the colour of the sea's depth bands, as the
ground paints them, blended between the bands' middles, and the depth as a share of the
deepest band's middle, in 12 steps; a swimmer is recoloured only when its water changes
step. How it is seen through the water is **murk** (`WATER_LOOK` in `proposal.ts`, ADR
0013), chosen from three looks the creature sheet shows side by side:

- **hue** (the first try): each colour turns toward the water's hue at its own lightness (45 %
  in the shallows to 75 % in the deep), then into a haze of the water (10 % to 45 %);
- **murk** (chosen): its own hues, darkened (15 % to 45 %), then some of the water's colour (15 % to
  50 %), as if the water showed through it;
- **glass**: its own hues, a little darkened (10 % to 30 %), and the whole body see-through
  as one (80 % opaque to 45 %, an `AlphaFilter` on the animal), so that the sea's own bands
  and waves show through it; each swimmer in sight is then drawn on its own every frame.

In every look a glint keeps more of itself, the shadow on the bottom fades with depth, and
the dot on the map keeps its own colour. A swimmer keeps its head 0.012 below the sea's
surface (a walker 0.004 above it), so that the body trailing behind it is in the water and
not lying on the beach. (Mixing every colour toward one blue, the first try, turned reds
purple and flattened every body alike.)

**Rare genes** (M7, `src/creatures/rare.ts`). The sim sends each creature's rare-gene
slots (bits) and, once, the signature each bit is drawn by (`rare.CREATURE_SIGNATURES`);
the renderer draws by signature, never by bit, and leaves out signatures it does not know.
A **giant** is drawn at the mass the sim gives it, the phenotype's mass times
`giant_mass_factor` (`rare.render_config`, beside `phenotype_config`); the other seven are
overlays on the body plan (`body.ts`), outlined and lit with it: **venom**, fangs in acid
green and a dark tip at the end of the body; **warning**, bold bands across the back,
black on a light body and yellow on a dark one, whatever the pattern gene; **elder**,
colours at 55 % of the saturation and pale flecks; **gills**, three frills either side
behind the head; **coat**, an outline 3.5 times as wide and 60 % of the way to the body's
colour, a soft fur; **leaves**, the hue turned 85 % of the way to leaf green and leaves
along the back; **glow**, pale spots in pairs along the back, which the night will light
(R4, M8). A **torpid** animal (a hibernator in winter or long darkness, `Fauna.torpid`)
lies curled up (`curl` in `chain.ts`: its chain round 0.85 of a circle from the head), does
not move, and breathes three times slower. The creature sheet shows every gene, and none,
on the sim's plain carrier and on four specimens.

**Between sim ticks** (`src/creatures/motion.ts`). The simulation moves a creature a
fraction of a cell every ten minutes, which watched in real time is stillness. A layer
whose creatures are `anchored` keeps each near the place the sim last gave it (its
anchor, `CreatureLayer.anchor`) and gives it life of its own there: a new anchor is
walked to (at up to twice its pace when more than three leashes behind; put there at
once when more than 12 cells away, a new arrival or a cut), and in between it pauses
1½–5 s looking about (its head turns up to 0.7 rad either side), then strolls, at a
little over half its pace, to a place within its leash (0.4 cells and 0.6 of its body
length) that its body can stand on. Its chest breathes: the masses at its widest joint
widen by up to 8 %, a breath taking 2.4 s at mass 1, slower with the fourth root of mass.
Where it is drawn is the renderer's; where it is, is the sim's. The benchmark has no sim
behind it and keeps the spike's free wandering (`wander`).

**By distance.** On the map a creature is a dot: its colour, edged dark, a little bigger
for the heavy. In the middle view it is its body, small, hurrying. In the local view the
same body gets what there is now room for: a glint in each eye, legs with an edge and
feet; and it ambles. Only creatures in sight are worked out.

How long an animal is drawn is the renderer's choice (the simulation knows mass, not
length): a number times 1.1 cells at mass 1. **The local view draws at 0.35**, chosen
against a line-up of full-grown trees and bushes: mass 1 is 11 art pixels long, an
eighth as long as a grown tree is tall, and the heaviest a genome allows (mass 16) two
thirds of a bush's height. **The middle view draws at 0.5**, larger than life: at 0.35
its animals would be 3 pixels long, dots with an outline, and it was found good at 4½.
So the views are in proportion for the land and its plants and not for the animals,
each view exaggerating them as much as it needs to show them: not at all from close,
by half in the middle view, to a dot a cell wide on the map. Seen from close enough
that mass 1 is some thirty pixels long, the same bodies are portraits, as a bestiary
will want them: the look sheet draws the markings that way. Kinds change at thresholds,
so two animals of one species either side of one will look like different kinds; whether
that needed softening was for R2, and is done: **one body plan per species**
(`src/creatures/species.ts`). Each species (M6; the fixture's `species` column, the
protocol's optional `species`) is drawn as the kind of its average member, and within that
plan each animal still shows its own genes. An animal takes its species' kind only where
it lives where its species does (in the water or on land), so that a fish is never drawn
on the shore; an animal of no species yet (0) is drawn as its own genes make it. In the
fixture's world (v7, day 520) 10 of the 186 members of species 1 would be hoppers on their
own genes (the leg gene rounding to one pair) and are drawn as beasts. A layer works the
plans out from its creatures; when the census changes them, the creatures are drawn again
with the new plans (R3, with the state stream).

**Creatures are drawn in `cosy`** ([ADR 0013](../decisions/0013-cosy-creature-style.md)),
after Stardew Valley's animals with the camera kept straight above: the plans and layers
above, more saturated; the outline in each animal's own colour taken nearly to black and
toward plum; shade toward violet and wider, light toward gold; eyes a size larger with a
glint from 2 pixels; and one soft see-through oval on the ground under the animal, down
and right of it. The tones it shares with the ground and plants are in
`src/palette.ts`. The creature sheet (`creatures.html`, `npm run creatures` →
`reports/R2-creature-sheet/`) draws the same animals walking the same paths in `lit`
(R0's) and `cosy` side by side, and checks the phenotype port against the sim.

## The look sheet

`renderer/look.html` shows the three views as they stand, drawn by the same code as the
benchmark with the settings of `proposal.ts`, and for what is still open the proposals
side by side: the map; the middle view on a shore and in a wood; for the local view its
ground alone and a sample of every kind of ground, the trees and bushes on sheets and in
a wood, the small plants, a meadow, a shore, and the four lights; then **the vegetation
in every variation**: the stages of growth, and for each time of year (the four seasons,
and winter under snow) a sheet of the plants, the same shore from close and the same
wood from the middle view; then the fifteen specimen genomes at the local view's size,
and every marking on two bodies and each gene swept on its own, as portraits. The sheets
are built from `standingArts`, the list a layer itself draws from, so they show what the
views show. Live, the creatures walk (`npm run dev`, then `/look.html`); `npm run look`
writes a self-contained copy to
[`reports/R0-look-sheet/`](../../reports/R0-look-sheet/README.md) that can be read
anywhere: creatures walk for a fixed, seeded 8 s, then every picture is saved inline,
those with animals in them as loops of 6 s (animated PNG, written by `apng.ts`: the first
frame whole, then only what changed), which play without a script. In the sheet the
local view's camera holds on the patch its animal is kept on, which is what keeps the
loops small; in the benchmark it follows the animal.

Before a sheet goes out, trees and creatures are looked at enlarged four times, pixel
by pixel: most of what was mended after the second sight of the local view (a trunk
beside its crown, tusks without an outline, a crab trailing a joint) cannot be seen at
the size the sheet shows them and was plain at that one.

Snow was settled since (ADR 0014: the simulation's); the R1 land sheet shows the
look chosen for the land and its plants.

## What it costs: an estimate for the board

Written before the board was on the desk; what it measured since is under "What the
board says" below. Until then, the three views were measured on the development PC and
scaled to the board's processor. An
Allwinner H618 scores about 150 in Geekbench 6 on one core and the PC (Core Ultra 9
275HX) about 3 150: some 21 times slower per core. It is another architecture and
another graphics stack, so the last column is an order of magnitude.

| | On the PC | At the board's speed | Against |
|---|---|---|---|
| Script per frame, map view, 216 animals as dots | 0.2 ms | 2 ms (up to 7) | 33 ms a frame at 30 fps |
| Script per frame, middle view, 50 animals | 0.2 ms | 3 ms (up to 9) | |
| Script per frame, middle view, 216 animals alive | 0.6 ms | 10 ms (up to 17) | |
| Script per frame, local view, following one animal | 0.2 ms | 1 ms (up to 9) | |
| The page's process, any view | 5–7 % of a core at 60 fps | about 0.6 of a core at 30 fps | 4 cores; the sim may use ¼ of one |
| Painting the map's and the middle view's ground, with the shadows of every plant | 0.6 s | 11 s | once a sim-day |
| Painting a piece of the local view's ground | 40 ms | 0.7 s | 2–3 pieces every 8 cells walked |
| Drawing the plants' pictures: 93 for the local view, 45 for the middle one | 15 ms and 2 ms | 0.3 s and 35 ms | when the season turns |
| Pixels to fill per frame | 512×300, two to three layers deep | | a Mali-G31 MP2, if Chromium is given it |
| WebGL drawn by the processor | 2–3 cores | out of reach | 4 cores, 21 times slower |
| Chromium's memory | about 0.6 GB | | 1–4 GB by model; sim and server get 0.3 |

"At the board's speed" is the same page with its processor throttled 21 times in
Chromium (`Emulation.setCPUThrottlingRate`); in brackets the slowest frame in a hundred.
The figures are those of the reworked local view: reading the ground over the cells
around, its detail and its shadows cost about a fifth more to paint per piece than the
ground before them (33 ms against 27), and the shading of the animals nothing that
shows, since they are drawn smaller. What follows:

- **Drawing the frames fits in all three views.** The local view is the cheapest per
  frame, few animals being in sight.
- **Painting ground does not fit in a frame.** On the board a piece of the local view's
  ground would stop the picture for half a second (measured as it is, the local view
  drops to 2 fps while a piece is painted), and the daily repaint of the other two for
  eleven. Both belong in a worker, ahead of the camera for the local view.
- **Everything still hangs on the graphics driver.** With the GPU the picture is small
  work; drawn by the processor nothing here is fast enough. Reports for this board show
  Panfrost loading while OpenGL still falls back to llvmpipe, so it is the first thing
  to try when the board is on the desk.
- **Memory fits on the board on the desk**, which is the 2 GB model: Chromium's 0.6 GB
  and the 0.3 GB budgeted for simulation and server leave room. On a 1 GB board they
  would not.

Sources for the scores: Geekbench 6 uploads for the Orange Pi Zero 3, which has the same
chip ([145/425](https://browser.geekbench.com/v6/cpu/16858950),
[155/452](https://browser.geekbench.com/v6/cpu/16288727)), and for the Core Ultra 9
275HX ([LaptopMedia](https://laptopmedia.com/nl/processor/intel-core-ultra-9-275hx/)).
On the driver: a [DietPi forum thread](https://dietpi.com/forum/t/cant-enable-gpu-acceleration-on-orangepi-zero2w/24060)
and the [Panfrost patches for the H616](https://lkml.rescloud.iu.edu/2503.1/06273.html).

## The R0 spike

R0 asks whether this approach is fast enough on the device before anything is built on
it: 50 animated creatures, a terrain bitmap, plant sprites and a full-screen tint at
≥ 30 fps median in Chromium kiosk on the Orange Pi. If not, an ADR picks a native
renderer that consumes the same protocol.

`renderer/spike.html` draws a real world (the save fixture `sim/tests/fixtures/saves/v7.lzma`,
exported by `tools/replay.py` into `renderer/public/spike/`) and benchmarks itself: it
runs each scenario for a fixed time, counts frames, and reports the median frame rate,
the 1 % low, the script time per frame and the graphics driver the browser gave it.

| Scenario | Drawn at | Plants | Creatures | Answers |
|---|---|---|---|---|
| `floor` | 1024×600 | none | 0 | what the browser costs before any scene |
| `spec-1x` | 1024×600 | 16 504 sprites | 50 | the R0 scene by the letter: measured, not judged (ADR 0010) |
| `spec-still` | 1024×600 | 16 504 sprites | 0 | the same with nothing moving: what the plants cost alone |
| `spec-apart` | 1024×600 | 16 504 sprites, a render group of their own | 50 | the same with the creatures over the plants, not among their rows |
| `spec-2x` | 512×300 | sprites | 50 | the same with art pixels of 2 screen pixels |
| `spec-4x` | 256×150 | sprites | 50 | the same with art pixels of 4 screen pixels |
| `map-1x` | 1024×600 | flat map | 50 | a wide shot as it would ship |
| `close-1x` | 1024×600 | sprites in view | 50 | a panning close-up at 4× zoom |
| `close-2x` | 512×300 | sprites in view | 50 | the same close-up with bigger art pixels |
| `crowd-1x` | 1024×600 | flat map | 216 | every creature the sim can hold |
| `map-view` | 512×300 | painted map | 216 dots | the map view |
| `mid-view` | 512×300 | painted ground, standing plants | 50 | the middle view |
| `mid-crowd` | 512×300 | painted ground, standing plants | 216 | the middle view with every creature alive |
| `local-view` | 512×300 | ground in pieces, the local view's plants | 50 | the local view, the camera on one creature |

The first ten draw the spike's first look (a flat square of ground per cell and a
drawing in every vegetated cell), which is what R0 was written against. `spec-1x` is
deliberately its worst case: a sprite for every cell of the island at once.
`spec-still` and `spec-apart` each change one thing in it, to tell where its time goes.
On the board (a first run on a virtual display) `spec-1x` spends 88 ms of script a frame
whatever the art scale, and waits several times longer on the GPU at 1024×600. The
creatures stand in the plants' rows, so one stepping into the next row changes the
scene's structure and PixiJS rebuilds the batches of all 16 504 plants; `spec-apart`
takes that away, `spec-still` takes away all change. Neither helps the frame rate: every
frame of the three ends with the kernel killing a GPU job after half a second, so 1.8 fps
is the timeout, not a speed ([ADR 0010](../decisions/0010-r0-judged-on-the-three-views.md)).
The last four draw the three views as chosen, and **R0 is judged on them**: `map-view`,
`mid-view`, `mid-crowd` and `local-view`, each at 30 fps median with the same browser
profile.

Page parameters: `?demo=<scenario>` shows one scenario indefinitely with the frame rate
in a corner; `only=a,b` picks scenarios; `seconds`, `warmup` set the timing;
`backend=canvas` makes PixiJS draw with the 2D canvas instead of WebGL.

### Measuring on the device

`tools/kiosk_bench.py` (standard library only, copied to the device as one file) serves
the built page, opens it in Chromium kiosk once per **browser profile**, and samples the
CPU time, memory and temperature of every Chromium process from `/proc` while the page
measures its frames. Profiles differ only in Chromium flags, because whether Chromium
draws with the board's GPU depends on them and on the OS image's driver:

| Profile | Flags | Question |
|---|---|---|
| `default` | none | what a plain kiosk gets |
| `gpu` | ignore the GPU blocklist, GPU rasterisation | does forcing the GPU help? |
| `gpu-gles` | the same through the OpenGL ES driver | or this route to the driver? |
| `software` | WebGL drawn by the CPU (SwiftShader) | the cost with no GPU at all |
| `canvas` | PixiJS on the 2D canvas | the fallback if WebGL is unusable |

Every run records what actually drew the page ("WebGL on <driver>", "…(software, on the
CPU)", or "2D canvas … (WebGL was not available)"): PixiJS silently falls back to the
canvas when the browser has no WebGL, and a frame rate without that line means nothing.

The procedure is in [`deploy/README.md`](../../deploy/README.md), and from a board in its
box in [`deploy/board-setup.md`](../../deploy/board-setup.md). The file it produces
becomes `reports/R0-renderer-spike/` through `tools.report R0`. The report passes R0 only
if the numbers were taken as specified (ARM board, kiosk on a display, the page 1024×600
or larger) and the best profile reaches 30 fps median in each of the four views (ADR
0010). A larger display may
stand in for the 7" screen, which is not bought yet
([ADR 0008](../decisions/0008-r0-on-a-stand-in-display.md)): the scene is drawn at the
same size and stretched further, which is at least as hard. The report names the display
and says so. Before any display is attached, the same run on a virtual one (the compositor
started with `WLR_BACKENDS=headless`, over SSH) says whether Chromium draws with the GPU
and about how fast; the report marks it as not the measurement.

### What the board says

Measured on the board with a 2560×1440 monitor standing in for the screen
([report](../../reports/R0-renderer-spike/README.md), ADR 0008 and 0010). Chromium draws
with the GPU (Panfrost) under every GPU profile; `gpu-gles` was best by a little CPU.

- **The three views pass.** map-view, mid-view and local-view sit at the refresh rate
  (about 60 fps). mid-crowd holds 30.0: its script takes 24 ms a frame, more than a
  60 Hz frame and less than two, so every frame waits for the second refresh. It passes
  with about 9 ms to spare; R2's bodies must not cost much more than the spike's.
- **A 1024×600 canvas stretched to 2K costs a refresh.** `floor`, which draws nearly
  nothing at 1024×600, holds 30 on the monitor and 62 on the virtual display; the views
  at 512×300 hold 60. On the 7" screen the stretch is six times smaller.
- **Pauses in local-view** (1% low under 1 fps) are ground painted on the frame: R1
  paints it off the frame (ADR 0007).
- **A sprite in every cell hangs the GPU** (ADR 0010): 1.8 fps is the kernel's timeout.
- **Heat:** the GPU profiles stay under 78 °C; the software and canvas profiles, run
  last, pass 80 °C and slow the board down. A heatsink belongs in the enclosure.
- Chromium's processes take about 530 MB (PSS) beside the system on the 2 GB board.

### What a PC already says (not the acceptance)

Trial runs on a development PC, headless, with WebGL drawn in software:

- **The page's own work is small.** Script time is 0.7 ms a frame for the spec scene and
  1.5 ms for 216 creatures (4 740 sprites); with the page's thread throttled tenfold
  both still hold 30 fps. Moving creatures in JavaScript is not the risk.
- **The 2D canvas cannot draw a sprite per cell.** 16 504 sprites take 70–80 ms a frame
  on a fast PC (10–12 fps); the flat map, close-ups and the crowd run at 60 fps there. A
  canvas fallback would have to live without wide-shot sprites, which the design
  already does.
- **Software WebGL is not a fallback for the device.** It holds 60 fps on the PC by
  spending nine of its cores. The board has four slower ones and the simulation needs
  part of one.

So R0 comes down to one thing a PC cannot answer: whether Chromium on the device's OS
image draws WebGL with the GPU.

## The land from the state stream (R1)

The scene (`renderer/index.html`, `src/main.ts`) draws the land and its plants from the
state stream in one of the three views; its animals and the camera's choices are R3's
(below). Page parameters:

| Parameter | What |
|---|---|
| `view=map\|middle\|local`, `x=…&y=…` | pin the camera to a view (no director), and where it looks (cells) |
| `recording=autumn\|winter` | R1's land recordings (August–September, or deep winter) instead of the creatures' (`life`, the default) |
| `speed=1800` | sim-seconds to a wall second (the default for `life`) |
| `every=1000` | instead, wall milliseconds between the recording's messages; 0: all at once, the last day (the default for `autumn` and `winter`, 1000) |
| `follow=…`, `idle=…`, `seed=…` | seconds on one animal and before the map comes back, and the camera's random draws (tests) |
| `quiet` | no captions of the stream's own entries |
| `source=ws://…` | the server's stream instead of a recording (S1; not tried yet: there is no server) |
| `still` | the sea does not move: for pictures that must not change |
| `painter=inline` | paint the ground on the page's thread, to compare with the worker |

For tests and measurements the page offers `window.__sceneSettled()` (the view shows the
latest day, fully painted), `window.__receive(message)`, `window.__textures()` (live
textures on the GPU), `window.__press()` (the view button), `window.__camera()` and
`window.__captions()` (what the camera and the scroll are doing).

**The stream.** One JSON message per frame, defined once in
`server/lineage_server/protocol/schema.json`; the TypeScript types (`src/protocol.ts`)
are generated from it by `npm run protocol` and a test fails when they are stale; the
server builds the messages with `lineage_server.protocol.encode`. Messages:

| Message | When | What |
|---|---|---|
| `clock` | on connect, then every server tick | date, season and how far into it, day of the year |
| `land` | on connect, once a sim-day and after terrain events | every cell: height, cover class, biomass, lying snow, the plant's `HEIGHT` and `EVERGREEN` genes and rare genes, as base64 grids |
| `fauna` | on connect | creature gene names, the phenotype's config keys, and the config drawing rare genes needs (`rare_config`: GIANT's mass factor) (R2, M7) |
| `creatures` | every fauna tick | ids, positions, species; genomes and rare-gene slots once per id; who is torpid (R2, M6, M7) |
| `species` | on connect, when one is born or dies out | id, name, parent (M6) |
| `rare` | on connect | the rare genes of both kingdoms: bit, name, visual signature, look in words (M7) |
| `chronicle` | when the chronicle writes | the entries since the last message (number, time, kind, importance, text, species, place) and the notable and major thresholds; not on connect (R3) |

The palette is not sent: the renderer has the report maps' own. `tools/stream.py`
records the stream from a save, and `src/stream.ts` decodes it. Two recordings are
committed in `renderer/public/stream/`, both from the v4 fixture:

- `recording.json`: 56 days from 3 August, a land every 28, ending on 28 September in
  the middle of the autumn turn;
- `winter.json`: 165 days on unrecorded, then 15 January to 5 February 2028, a land every
  10; snow lies on about 10 600 of the 38 400 cells (checking it is what the tool writes
  takes 186 sim-days, so that test is nightly).

**Painting off the frame.** Grounds are painted in a Web Worker (`terrain/painter.ts`,
`paint.worker.ts`) so that the page keeps drawing frames: the map's and the middle view's
whole world once a sim-day, the local view's pieces as the camera comes near them. The
page keeps its own queue and hands the worker one request at a time, nearest piece
first; a whole-world painting asked for again before it started is dropped, and so are
the pieces of an older land. A ring of pieces four cells beyond the view is painted ahead
of the camera. Where there is no worker the same code runs on the page's thread.

**A day at a time.** On a new land, or a new day of the year, `landscape.ts` lays the
plants out again for the day and repaints the grounds of the views that have been
shown; the new day fades in over the old for two seconds (`terrain/grounds.ts`), so that
growth, a fire's scar or the turn of the season comes over the land gently. The
drawings a plant layer is made of depend only on the view, the look, the seasons in play
and the snow, not on the land: they are drawn once and shared by the layers that want
the same ones, and destroyed with the last of them.

Measured on the development PC with the page's processor throttled 21 times (the board's
speed, as in the estimate below; the GPU is not throttled), a new day arriving while the
view is shown:

| | Laying out the plants | Longest gap between frames |
|---|---|---|
| middle view, ground painted on the page's thread | not measured | 19.5 s |
| middle view, painted in the worker, drawings drawn again each day | 181 ms | 0.50 s |
| middle view, worker, drawings shared | 7 ms | 0.32 s |
| local view, worker, drawings drawn again each day | 1 030 ms | 1.38 s |
| local view, worker, drawings shared | 24 ms | 0.22 s |

What is left once a day is the middle view's shadows for the whole island and the
upload of the new picture; still to be measured on the board.

**Nothing is kept from one day to the next.** `tests/e2e/leak.spec.ts` gives the local
view fifteen new days (pieces repainted, plant layers rebuilt, fades) and checks that as
many textures are alive on the GPU after them as after the first: 107 every day, over
forty days when first run. (PixiJS leaves a freed texture's slot empty in its list rather
than taking it out; counting the slots made a first count look like a leak of 52 a day.)

**The cosy look** (ADR 0014, `src/looks.ts`, `plants/cosyart.ts`): the colours are the
palette's; shade leans toward violet and light toward gold, as on the creatures
(`src/palette.ts`); every plant is outlined on its outside, wood in its own outline, so a
bare branch carrying snow keeps its edge on snow. Broadleaves are clouds of a few large
scalloped puffs lit as balls on stout trunks with roots; conifers a few bold tiers with
large teeth; bushes domes of puffs; grass tufts of broad blades. The R0 look (bundles,
the earlier palette) is kept as `R0` for the record.

In winter a cosy broadleaf keeps the size of its crown, as Stardew's bare trees do: the
trunk goes on up as a leader, limbs leave it one above another, the lowest nearly level
and the higher more upright, each thinner and each with a branch from its middle, all
outlined; fine twigs fill toward the rim a pixel across and not outlined, so the crown
stays open (the first cosy winters, every twig outlined or every limb from one fork,
closed into a tangle or a hand). A broadleaf with much `EVERGREEN` (from 77 of 255, below
the conifers' 128) keeps its leaves through winter, in a colder green. A bush still
standing in winter is one the simulation did not let die back, so it keeps its leaves,
darker and colder; one with little `EVERGREEN` (under 100) is a fan of fine twigs instead.
Where the land carries no genes (the R0 fixture) broadleaves go bare and bushes keep
their leaves. Winter grass is short stubble, not a tuft laid flat.

**The sea moves** (`terrain/sea.ts`), at almost no cost per frame. Where the surf moves
the painter leaves it on three layers of its own instead of on the ground: a dashed line
of lighter water far out, one nearer, and the foam at the shore. A crest comes in every
3.6 s: the far line shows, then the nearer, then the foam flares and slowly fades
(three opacities a frame). Glints, short white strokes, grow on the open water, drift a
little and go, forty slots to a view, each on its own clock and somewhere new each time
(a hash of the slot and the showing). Nothing is painted again for it; `?still` keeps
it at its first moment, which the snapshots use. The land sheet films it. `seaAt(land)`
gives the sea's colour and depth at a place, from the same bands, for creatures under
water to take its colour (R2).

**The turn of the year** (`plants/turning.ts`): around each change of season places turn
one after another over about four weeks, in fronts across the land; the hills first into
autumn and winter and last into spring; each plant on its own day near its place's, and
the more `EVERGREEN` it has the later into autumn and winter. The ground takes the
season of each place, dithered at the front; a plant layer draws each plant in the
season of its own turn.

**Snow** lies where the simulation says (`flora.snow_cover`: the temperature index by
season and height under `snow_below_temperature`), in any season: in patches on the
ground, thinner under trees and where it lies thin, and on the plants of cells under
enough of it.

**The plant genes** where the stream carries them: `HEIGHT` picks a tree's or bush's
build (broad and low, as the scale has it, or slender and tall); `EVERGREEN` how late it
turns and what it does in winter (above); the rare genes as below. The other six genes
show nothing yet. The R0 fixture has no genes, so the
spike and the land sheet's stills choose builds by chance.

**Rare plants** (M7's signatures, `plants/rareart.ts`), from the stream's `plant_rare`
mask and the gene names in `rare_genes`, as accents on a plant's usual drawing; each
carrier always stands (whatever the wood's or the scrub's share of standing plants), and
a plant with several rare genes carries each look:

| Gene | Look |
|---|---|
| FIRE_PINE | the wood a warm red-brown (the same drawing, coloured otherwise); after a fire it stands on the burnt ground, trunk charred, crown kept |
| NITROGEN_FIXER | small three-lobed leaves round the foot, pale flowers on some |
| MANGROVE | arched stilt roots; the only plants standing in shallow water (the simulation classes a mangrove in the sea by its form, a bush or a tree, so it is drawn as one) |
| POISONOUS | clusters of three violet berries on the leaves (not on grass) |
| FRUITING | three or four bright orange fruits on a woody plant; a seed head on grass |
| EMERGENT | a tree drawn half as tall again (1.45) |

Berries, fruit, clover and stilts are overlays the size of the drawing they lie on, with
its foot, scaled to its size (a pixel in the middle view). Nothing small (ferns, herbs,
flowers) grows on a cell below the sea, mangrove or not. The drawings are made only for
the looks some plant of the land has. A fire pine after a fire needs no scorch in the
stream: the simulation marks a scorched cell burnt, and a fire leaves biomass only on a
fire pine, so a burnt cell with biomass and the gene is one (drawn as a conifer if its
`EVERGREEN` makes it one, from 128, else a broadleaf).

**The land sheet** (`renderer/land.html`, `npm run land` →
[`reports/R1-land-sheet/`](../../reports/R1-land-sheet/README.md)) opens with films of the
scene itself (`sheets/films.ts`: the real `Landscape` fed from the recordings, on a clock
of its own, saved as animated PNGs): the sea from close and from the middle view, summer
into autumn day by day, and deep winter with the simulation's snow. Then stills from the
R0 fixture: the ground and the plants in the three views, every kind of ground and
plant, the turn of the year around three changes of season, and the four seasons.

**Snapshots** (`tests/e2e/scene.spec.ts`): seven fixed states of the scene, five from the
autumn recording and two on the winter recording's snow line, taken with `still`.

## The camera and captions (R3)

The camera is the owner's to steer ([ADR 0020](../decisions/0020-the-camera-view-button-and-captions.md)):
a **view button**, beside the god-power button, steps the screen map → middle → local →
map. The map is where it rests, and it goes back there fifteen minutes after the last
press. On the page the button is V, space or Enter, a tap on a phone, or
`window.__press()`. `src/director.ts` decides what is shown; it is pure and seeded.

| View | The camera |
|---|---|
| map | the whole continent, still; the animals as dots |
| middle | drifts at 1.2 cells a second to a place on land 20–70 cells away, lingers 8–20 s, goes on; on a critically damped spring, so it eases in and out |
| local | follows an animal of a species drawn at random (then one of its animals, awake if one is), for 4–6 minutes, then another; within a view's width it glides there, further it cuts |

- **Smooth pans**: the world is placed in whole art pixels in a canvas one art pixel larger
  all round, and the canvas is slid by the rest of the camera's position in whole device
  pixels (CSS), so the picture moves a screen pixel at a time, half an art pixel, at no cost
  to the GPU; the dip and the scroll are laid over it in the page and keep still. Before,
  a drift moved the picture on one frame in six; now on one in three, as fine as a
  1024-pixel screen goes without blurring. Plants' corners are put on whole art pixels:
  one at half a pixel was rounded either way as the world moved, and 3 % of the middle
  view flickered a pixel back and forth.
- **Changes of view dip to dark** (0.4 s), wait in the dark until the new view is
  painted (at most 3 s) and come back (0.6 s). The camera never zooms between views.
- **Following** (`src/camera.ts`): a spring a little under critical damping (period
  3 s, damping 0.9), so that the camera eases after an animal that turns and settles with
  hardly a swing; it aims 1 s ahead of the animal's walk (smoothed over 1.5 s) and lets it potter within
  a cell of where the camera is before it moves. Fixed sub-steps (1/240 s) make it the
  same at any frame rate. The view never looks off the world's edge.
- **The animals** (`src/herd.ts`): R2's creature layers fed from the stream. A roster
  gives each id a slot and frees the slots of the dead; the middle view's bodies (and the
  map's dots) and the local view's are two layers, each anchored to the sim's positions,
  and only the shown one moves. They stand among the plants of the view (the plant layer
  drawn opaque, the old one while a new day fades in); what grows in front of the animal
  followed is shown through.
- **Captions** (`src/captions.ts`): the notable entries (importance ≥ 3) on a parchment
  scroll at the foot of the screen, one at a time and above the dip. It unrolls from its
  middle, stays open 4 s plus 0.07 s a character, rolls up and waits 1.5 s for the next;
  at most four wait (the least important dropped). The date in words above the entry; at
  most four lines, cut with an ellipsis. The text is in the caption font
  (`src/pixelfont.ts`), drawn a pixel at a time so it keeps the hard edges and looks the
  same in every browser.
- **The creatures' recording** (`public/stream/life.json`): 28 days from the v9 fixture,
  creatures every two sim-hours, a land every 14 days, six notable entries; played by sim
  time (`Recording` with a speed, 1 800 sim-seconds a wall second: a day in 48 s).

**Tests**: unit tests of the spring and framing, of the director's rules on synthetic
worlds (the button's cycle, the dip waits for paint, idle return, drift stays on land and
in the world, following, the species drawn fairly, awake preferred, glide or cut, death
of the subject, seeded determinism), the caption queue (one at a time, never overlapping)
and the scroll's painting, the font, and the roster; in the page
(`tests/e2e/camera.spec.ts`) the button's cycle and a snapshot of the scroll. Its cost on
the board is R5's to measure.

## What the spike stands in for

- **The state stream.** The spike loads a fixture written by `tools/replay.py`
  (`lineage-spike-fixture/5`): the heights, cover and biomass of a save's world, the
  maps' rules for colouring them, its creatures (where each is, its genome to the bit,
  its species, its rare-gene slots and whether it lies torpid), the config keys of the
  phenotype and of the rare genes, the rare genes' signatures, and casts for the look
  sheets (the specimens, the gene sweeps, the rare genes). R1's scene draws from the
  protocol instead; the spike and the look sheets still read the fixture.
- **Creature bodies and motion.** Bodies are discs, wedges and bars; the wandering is
  cosmetic and seeded, not the simulation's. Walkers keep to land and swimmers to water
  only because the spike says so.
- **Plant and ground art.** Drawn by rule, at any size, stage and season. Which plants
  a cell carries is decided here from its cover, its biomass and hashes of its position;
  the simulation's plant genome does not yet reach the renderer. The season is the
  fixture's (`source.season`).
- **The camera.** The benchmark's local view follows the first creature of the save;
  choosing whom to follow, and moving between the views, is R3.

## Open

- **Snow**: settled in R1 (ADR 0014): it lies where the simulation's temperature says.
- **Turning from one season to the next**: done in R1, over about four weeks.
- **Plant genes in the drawing**: `HEIGHT` picks the build, `EVERGREEN` how late a
  tree turns and how it spends the winter, and the rare genes have their looks (R1, from
  M7's signatures). Which broadleaf flowers or turns gold, and the kinds of flower, are
  still the renderer's own variety.
- **Moving between the views**: settled in R3 (ADR 0020): a dip to dark and back, never a
  zoom.
- **Painting ground off the frame**: done in R1 (a worker); its effect on the local
  view's pauses is to be measured on the board in R5 (the owner moved every device
  benchmark there, once R1–R4 are in), and so is the GPU memory the middle view's surf
  takes (three more pictures of the whole world, about 30 MB).
- **Still on the page's thread**: the middle view's shadows for the whole island, once
  a day (0.3 s at the board's estimated speed), and drawing the plants again when the
  seasons in play change (entering or leaving a turn, eight times a year; about 1 s).
  Both could go to the worker if R5 shows a stutter on the board.
- **The server's stream** has not been tried: there is no server until S1.
- **Creature motion between sim ticks**: done in R2 (see Creatures, "Between sim ticks");
  whom the camera follows and when it cuts, R3 (ADR 0020).
- **Seasons**: done; a plant layer is laid out again once a sim-day, which carries the
  turn and the snow forward.
