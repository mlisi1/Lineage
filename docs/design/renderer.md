# Renderer

One renderer draws the scene for the desk screen and for the phone (CLAUDE.md §4.7):
TypeScript and PixiJS in a browser, which on the device is Chromium in kiosk mode at
1024×600. Only the R0 spike exists so far (`renderer/src/spike/`). It is throwaway in its
details and deliberate in its structure: R1–R4 build the real scene on what it settles.

## Pixel art

Everything on screen is pixel art: flat colours from small palettes, stepped shading,
hard edges, no smoothing.

- **Art pixels are 2 screen pixels.** The scene is drawn into a canvas of 512×300 and
  stretched to the screen by CSS with `image-rendering: pixelated`. No antialiasing,
  nearest-neighbour textures, positions rounded to whole art pixels.
- **One palette.** Land and plant colours come from `tools/viz/pixelmap.py`, the same
  ramps the report maps use, so a forest is the same green in a report and on the desk.
- **World units are cells.** The world layer is positioned and scaled in cells of the
  simulation grid (256×150); the camera is one transform on it.

## Three views of one world

The world is a continent, and the screen shows it from three distances
([ADR 0007](../decisions/0007-three-views.md)):

| View | Art pixels to the cell | In sight | What it is for | An animal of mass 1 |
|---|---|---|---|---|
| **map** | 2 | all 256 × 150 cells | the continent | a dot |
| **middle** | 8 | 64 × 37½ | a region: its woods and shores, who is about | 4½ art pixels long |
| **local** | 32 | 16 × 9 | one animal, and what it walks through | 18 |

Nothing is rescaled between the views. An animal is the same 0.55 of a cell long (at
mass 1) and a grown tree the same three cells tall in the middle view and in the local
one; the camera is closer, and what it shows is drawn with the detail that distance has
room for. The plants of the middle view stand in the same places in the local view.

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
(a binomial kernel reaching `calm` cells: 2, with 1 and 3 on offer) before it
interpolates. A kind of ground then shows only where it holds several cells together;
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

**Shadows are the ground's.** What stands on the ground says how large a shadow it
throws (`PlantLayer.shadows`), and the painter darkens the land under it once, however
many overlap, with a dithered rim. A shadow drawn with each plant darkened the crowns
behind it and every other shadow it crossed.

The map and the middle view are each one picture of the whole world (512×300 and
2048×1200), repainted when the plants change, once a sim-day. The local view would be
8192×4800, so its ground is painted in pieces of 8 × 8 cells as the camera comes over
them (`GroundPieces`) and forgotten when far behind. A piece is painted with a cell of
margin, which is cut off: calm, detail and shadows come out the same in a piece as in
the whole (a test holds this).

### Plants

In the map view plants are the ground's colour. From the middle view on, grass and lichen
are the ground's own texture and what stands on it is drawn by rule (`plantart.ts`), a
little off the middle of its cell:

| | Middle view | Local view |
|---|---|---|
| Broadleaf, conifer | 24 art pixels tall, in 4 cells of a wood out of 10 | the same trees, 96 tall, in a style still to be chosen |
| Bush | 10 tall, in 6 cells of scrub out of 10 | the same bushes, 40 tall; one in three in berry |
| Grass | a tuft in one cell of grown grass out of three | tufts in every cell that grows it, more where it is thick; dry tufts where it has dried |
| Small plants | none | by what covers the cell: see below |

Drawing by rule is what lets one plant be drawn at two distances and several styles be
compared; what is kept can be redrawn by hand in R1. The middle view's trees are the
first rule (`first`: four lobes on a trunk, a conifer in tiers, its shadow drawn with
it). For the local view there are three more, written after how pixel-art trees are
usually built, to choose from:

| Style | Broadleaf | Conifer | Bush | After |
|---|---|---|---|---|
| `bundles` (T1, proposed) | a crown of many small bundles of leaves packed like a sunflower's seeds, each lit on its own and shading the ones behind it | drooping boughs: tiers with a hem of hanging tips, each shading the one below | a mound of bundles | Slynyrd's Pixelblog 44: one bundle of leaves, repeated and layered by the light |
| `dome` (T2) | one rounded mass with a bumpy rim, shaded as a whole in five stepped tones whose edges follow a pattern of small bricks | clean tiers, cut straight | a dome | the usual top-down game tree: crown over a short trunk, shadow apart |
| `limbs` (T3) | a trunk that parts into limbs and twigs, a clump of leaves at each fork and end, air between | whorls of boughs on a trunk that shows | clumps on stems that fan from the foot | Gentree: branches grown by forking, a clump of leaves per end |

Each style draws every kind in three builds (as the scale has it, slender and tall,
broad and low) with a different arrangement per drawing, in five tones (the palette's
three, a cooler one below and a warmer one above), outlined, and adapts to the middle
view's size, so that once one is chosen the middle view's trees can follow it.

**Small plants** (`drawSmall`) are placed by what covers each cell, by hashes of the
cell, so they are where they were on the next visit:

| Ground | What stands or lies on it |
|---|---|
| Grown grass | herbs; flowers of four kinds (daisy, bell, spike, umbel) in five colours, in drifts: one kind and colour over several cells, thick in places and rare between |
| Scrub | ferns, herbs, a flower now and then |
| Under broadleaves and conifers | mushrooms (three caps), ferns, fallen logs |
| Bare ground, lichen | stones and boulders, some grown over with lichen or moss; herbs |
| Shore | reeds |
| Burnt | charred stumps, logs |

Plants are kept in rows from the top of the map down (`plants.ts`), so that the nearer
cover the farther; each row has a place for the creatures on it, so an animal passes
behind the trees in front of it. The local view sorts four rows to the cell. Rows are
built a chunk at a time, when the view first comes near. In the local view a plant that
covers the animal the picture is about goes see-through.

### Creatures

A creature is seen from above: a head that moves and a chain of joints that follows it
at fixed distances, which bends the body by itself. Legs are placed by two-bone inverse
kinematics: a foot stays planted until the body has left it behind. A body is a list of
parts riding the joints (`body.ts`): discs, wedges and bars, each with a size, a place
and a colour, all tinted sprites of one atlas, so a body costs no geometry, only
transforms. The derived values (mass, leg pairs, speeds) come from `fauna/phenotype.py`
through the fixture; R2 ports that function and replaces these drawings.

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
pointed snout and ivory instead of dark jaws. `BROOD` shows nowhere.

**The aquatic gene turns legs into fins.** A body without legs grows fins at the
shoulders and a tail fin from 0.3. A body with legs grows none beside them: its feet
web from 0.3, wider with the gene (a fan at the end of each leg, in a colour that goes
toward the fins'), and at 0.6, where the animal lives in the water, its legs are
flippers: broad blades that row, swinging about where they join the body, each pair a
little after the one in front. With three or four pairs of legs only the last pair
turns, as a water beetle's. A flat tail fin comes as before.

**Markings.** The pattern gene picks one of twelve by twelfths (plain, stripe, twin
stripes, bands, bars, spots, rings, saddle and mask, fade, chevrons, speckle, eyespots),
and how far into its twelfth the gene lies picks one of four colours for it: darker,
paler, a colour from across the wheel, or one a third of the way round. Markings go on
stations down the back: along the shell or carapace of a kind that has one, else on the
widest part at each joint.

A marking never leaves the mass it is on: each is fitted to that mass's oval, and drawn
smaller where the mass has less room for it (the ends of a shell). On a shell a stripe
is one long oval that tapers with it. A back that fades does it in the colours of its
masses, joint by joint; a shell fades in ovals laid on it. A marking too small to show
(under most of a pixel) is left out, which in the middle view is most of them. A marking
of 3 pixels and more is shaded as a mass is, on its own: its far edge in shade, and a
sunlit patch if it is round and large enough.

**By distance.** On the map a creature is a dot: its colour, edged dark, a little bigger
for the heavy. In the middle view it is its body, small, hurrying. In the local view the
same body gets what there is now room for: a glint in each eye, legs with an edge and
feet; and it ambles. Only creatures in sight are worked out.

How long an animal is drawn is the renderer's choice (the simulation knows mass, not
length): 0.5 × 1.1 cells at mass 1, one number for all views (0.4 and 0.62 are on
offer). At 0.5 an animal of mass 1 is a fifth as long as a grown tree is tall, and the
heaviest a genome allows (mass 16) comes to a tree's knee; at the 0.85 before it the
heaviest was as long as a grown tree is wide. Seen twice as close as the local view (64
pixels to the cell), the same bodies are portraits, as a bestiary will want them: the
look sheet draws the markings that way. Kinds change at thresholds, so two animals of
one species either side of one will look like different kinds; whether that needs
softening is for R2.

## The look sheet

`renderer/look.html` shows the three views as they stand, drawn by the same code as the
benchmark with the settings of `proposal.ts`, and for what is still open the proposals
side by side with one marked as the pick: the map; the middle view on a shore and in a
wood; for the local view the ground alone read over one, two and three cells, a sample
of every kind of ground, the trees and bushes of each style on a sheet and in a wood,
the small plants, a meadow with the animals at three sizes, a shore, and the four
lights; then the fifteen specimen genomes at the local view's size, and every marking on
two bodies and each gene swept on its own, twice as close. Live, the creatures walk
(`npm run dev`, then `/look.html`); `npm run look` writes a self-contained copy to
[`reports/R0-look-sheet/`](../../reports/R0-look-sheet/README.md) that can be read
anywhere: creatures walk for a fixed, seeded 8 s, then every picture is saved inline,
those with animals in them as loops of 6 s (animated PNG, written by `apng.ts`: the first
frame whole, then only what changed), which play without a script. In the sheet the
local view's camera holds on the patch its animal is kept on, which is what keeps the
loops small; in the benchmark it follows the animal.

Still to be chosen there: the style of the local view's trees and bushes (T1 to T3), how
far around its ground is read (K1 to K3), and the size of the animals (A1 to A3).

## What it costs: an estimate for the board

The board is not on the desk, so R0's measurement is still to come. Until then, the
three views were measured on the development PC and scaled to the board's processor. An
Allwinner H618 scores about 150 in Geekbench 6 on one core and the PC (Core Ultra 9
275HX) about 3 150: some 21 times slower per core. It is another architecture and
another graphics stack, so the last column is an order of magnitude.

| | On the PC | At the board's speed | Against |
|---|---|---|---|
| Script per frame, map view, 216 animals as dots | 0.2 ms | 3 ms (up to 8) | 33 ms a frame at 30 fps |
| Script per frame, middle view, 50 animals | 0.2 ms | 3 ms (up to 8) | |
| Script per frame, middle view, 216 animals alive | 0.5 ms | 8 ms (up to 15) | |
| Script per frame, local view, following one animal | 0.2 ms | 1 ms (up to 8) | |
| The page's process, any view | 5–7 % of a core at 60 fps | about 0.6 of a core at 30 fps | 4 cores; the sim may use ¼ of one |
| Painting the map's and the middle view's ground | 0.5 s | 10 s | once a sim-day |
| Painting a piece of the local view's ground | 35 ms | 0.6 s | 2–3 pieces every 8 cells walked |
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
  ten. Both belong in a worker, ahead of the camera for the local view.
- **Everything still hangs on the graphics driver.** With the GPU the picture is small
  work; drawn by the processor nothing here is fast enough. Reports for this board show
  Panfrost loading while OpenGL still falls back to llvmpipe, so it is the first thing
  to try when the board is on the desk.
- **A 1 GB board is tight** next to the simulation; 2 GB or more is safer.

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

`renderer/spike.html` draws a real world (the save fixture `sim/tests/fixtures/saves/v4.lzma`,
exported by `tools/replay.py` into `renderer/public/spike/`) and benchmarks itself: it
runs each scenario for a fixed time, counts frames, and reports the median frame rate,
the 1 % low, the script time per frame and the graphics driver the browser gave it.

| Scenario | Drawn at | Plants | Creatures | Answers |
|---|---|---|---|---|
| `floor` | 1024×600 | none | 0 | what the browser costs before any scene |
| `spec-1x` | 1024×600 | 16 504 sprites | 50 | **the R0 scene by the letter: the acceptance** |
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

The first eight draw the spike's first look (a flat square of ground per cell and a
drawing in every vegetated cell), which is what R0 was written against. `spec-1x` is
deliberately its worst case: a sprite for every cell of the island at once. The last
four draw the three views as chosen. The acceptance scenario should move to them once
the local view is settled, with a note in `docs/decisions/`.

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

The procedure is in [`deploy/README.md`](../../deploy/README.md). The file it produces
becomes `reports/R0-renderer-spike/` through `tools.report R0`. The report passes R0 only
if the numbers were taken as specified (ARM board, kiosk on the display, 1024×600) and
the best profile reaches 30 fps median in `spec-1x`.

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

## What the spike stands in for

- **The state stream.** The spike loads a fixture written by `tools/replay.py`
  (`lineage-spike-fixture/3`): the heights, cover and biomass of a save's world, the
  maps' rules for colouring them, its creatures, and casts for the look sheet (the
  specimens and the gene sweeps). R1 replaces it with the protocol generated from the
  server's schema; nothing else should depend on the fixture's shape.
- **Creature bodies and motion.** Bodies are discs, wedges and bars; the wandering is
  cosmetic and seeded, not the simulation's. Walkers keep to land and swimmers to water
  only because the spike says so.
- **Plant and ground art.** Drawn by rule, to be compared at several sizes, distances
  and styles. Which plants a cell carries is decided here from its cover and hashes of
  its position; the simulation's plant genome does not yet reach the renderer.
- **The camera.** The benchmark's local view follows the first creature of the save;
  choosing whom to follow, and moving between the views, is R3.

## Open

- **The local view's trees, ground and animal size**: the proposals on the look sheet.
  Once a style of tree is chosen, the middle view's trees are redrawn in it.
- **Plant genes in the drawing.** A style's three builds and the kinds of flower are the
  renderer's own variety. The 8-gene plant genome could choose them (R1).
- **Moving between the views.** The painted pixels shimmer at zooms in between, so the
  camera would cut or cross-fade from one view to the next rather than glide.
- **Painting ground off the frame**: see the cost above.
- **Creature motion between sim ticks.** The simulation moves a creature a few cells per
  hour and ticks every ten minutes. Watched in real time that is stillness, most of all
  in the local view, so the renderer needs cosmetic life of its own (idling, breathing,
  small wandering around the true position) without contradicting the simulation.
  Belongs to R2/R3.
- **Kinds at their thresholds**: see Creatures.
- **Seasons**: the standing plants have one drawing each; bare, flowering and snowed-on
  ones belong to R1.
