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
  nearest-neighbour textures, positions rounded to whole art pixels. (The spike can draw
  at 1 and 4 as well; 2 was settled with the painted ground, whose plants are drawn for
  it.)
- **One palette.** Land and plant colours come from `tools/viz/pixelmap.py`, the same
  ramps the report maps use, so a forest is the same green in a report and on the desk.
- **World units are cells.** The world layer is positioned and scaled in cells of the
  simulation grid (256×150); the camera is one transform on it.

## Two views, one painter

The screen shows one of two views:

- the **map view**: the whole island, 2 art pixels to the cell. No room for drawings;
  an animal is a dot.
- the **local view**: four times closer, 8 art pixels to the cell (64 × 37.5 cells in
  sight). This is where plants and animals are worth looking at.

Both grounds come from `ground.ts`, the same painter at two sizes, so the local view is
the map with what lies between its cells worked out, not another picture. It paints from
the cells' heights, cover and biomass by the report maps' own rules: the sea in bands of
depth, relief as three tones by the slope toward the light, rock and snow on bare
heights, an outline on the shore. With *grain* (the local view) what grows low is laid on
the soil in patches that thin with biomass, with blades, pebbles, waves and foam; without
it (the map) every pixel takes the flat colour of what covers it.

How a pixel reads the cells around it is the style, and the choice on offer:

| Style | A pixel takes | Looks like |
|---|---|---|
| `squares` | the cell it falls in | the report maps: one flat square per cell |
| `warped` | the cell it falls in after a gentle warp | squares with wandering borders |
| `tiles` | the nearest of the cells' centres, each nudged off its place | irregular tiles |
| `smooth` | every value interpolated between the four nearest cells | contours: the coast is where the height crosses the sea level |
| `blended` | the same, every transition dithered instead of cut | contours that blend into each other |

In `smooth` and `blended` nothing follows the cells: sea bands are depth contours, the
beach is wide where the land is flat, relief is shaded pixel by pixel, what grows is the
kind that weighs most among the four cells and thins toward the edge of its patch. The
shore that animals respect (`habitat.ts`) is interpolated the same way.

## Layers of the local view, back to front

1. **Ground**: one painted picture, 2048×1200 for the whole world. It changes when the
   plants do, once a sim-day (R1 cross-fades between days). On the board it must be
   painted off the frame (see the cost below).
2. **Plants that stand** (`plantart.ts`, `plants.ts`): grass and lichen are the ground's
   own texture; what stands on it is every tree, shrubs in leaf, and a tuft of grown
   grass in one cell of three. They are drawn by rule, with an outline and a shadow at
   the foot, a little off the middle of their cells. Three sizes are on offer:

   | Size | Grown tree | Bush | Cells of a wood that carry a tree |
   |---|---|---|---|
   | small | 12 art pixels tall | 6 | all |
   | medium | 18 | 8 | 6 in 10 |
   | large | 24 | 10 | 4 in 10 |

   Drawing by rule is what makes the sizes comparable; the chosen one can be redrawn by
   hand in R1. Plants are kept row by row from the top of the map down, so that the
   nearer cover the farther, and whole chunks of a row are skipped off screen.
3. **Creatures**, in the rows of the plants: an animal goes in the row of its lowest
   point, so what grows in front of it covers it. Only those in sight are worked out.
4. **Tint**: one full-screen colour multiplied over everything: day, dusk, night, dawn.
   R4 drives it from presence.

In the map view the layers are the ground at 2 pixels per cell, the creatures as dots
(their colour, edged dark, a little bigger for the heavy), and the tint.

## Creatures

A creature is seen from above: a head that moves and a chain of joints that follows it
at fixed distances, which bends the body by itself. Legs are placed by two-bone inverse
kinematics: a foot stays planted until the body has left it behind. A body is a list of
parts riding the joints (`body.ts`): discs, wedges and bars, each with a size, a place
and a colour, all tinted sprites of one atlas, so a body costs no geometry, only
transforms. The derived values (mass, leg pairs, speeds) come from `fauna/phenotype.py`
through the fixture; R2 ports that function and replaces these drawings.

Three styles are on offer:

- **circles**: the first look. Every animal is the same chain of circles; the genes add
  trimmings (a shell outline, mandibles, fins, bands or spots).
- **shapes**: a body plan per kind of animal, so that the silhouette says what it is.
- **lit**: the same plans with a dark outline around the whole animal, one art pixel
  wide, and a lighter back toward the light.

The kind follows from the genes, leg pairs first:

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
pointed snout and ivory instead of dark jaws, aquatic as fins, hue as colour, pattern as
plain, stripe, bands, spots or saddle. `BROOD` shows nowhere.

How long an animal is drawn is the renderer's choice (the simulation knows mass, not
length): 1.1 cells at mass 1 in the first look, with one and a half times and double on
offer. Kinds change at thresholds, so two animals of one species either side of one will
look like different kinds; whether that needs softening is for R2.

## The look sheet, and what is waiting for a choice

`renderer/look.html` shows the two views and, for each part of them, the proposals side
by side, drawn by the same code as the benchmark. Each section changes one thing and
holds the rest at what `proposal.ts` picks. Live, the creatures walk (`npm run dev`, then
`/look.html`); `npm run look` writes a still, self-contained copy to
[`reports/R0-look-sheet/`](../../reports/R0-look-sheet/README.md), where creatures walk
for a fixed, seeded 8 s and every picture is saved inline.

| To choose | Proposals | Held at |
|---|---|---|
| Map view | squares; interpolated; interpolated with animals as dots | the last |
| Ground of the local view | warped; tiles; smooth; blended | blended |
| Plants | small; medium; large | medium |
| Creature style | circles; shapes; lit | lit |
| Creature size | 1, 1.5 or 2 times the first look's | 1.5 |
| A closer local view | 16 art pixels to the cell instead of 8 | not taken |

The closer view doubles the detail of ground, plants and animals and shows a quarter of
the land. Its ground can no longer be one picture of the whole world (4096×2400), so it
would be painted in pieces around the camera.

## What it costs: an estimate for the board

The board is not on the desk, so R0's measurement is still to come. Until then, the two
views as picked above were measured on the development PC and scaled to the board's
processor. An Allwinner H618 scores about 150 in Geekbench 6 on one core and the PC
(Core Ultra 9 275HX) about 3 150: some 21 times slower per core. It is another
architecture and another graphics stack, so the last column is an order of magnitude.

| | On the PC | At the board's speed | Against |
|---|---|---|---|
| Script per frame, map view, 216 animals as dots | 0.3 ms | 3 ms (up to 8) | 33 ms a frame at 30 fps |
| Script per frame, local view, 50 animals | 0.3 ms | 4 ms (up to 13) | |
| Script per frame, local view, 216 animals alive | 0.7 ms | 12–15 ms (up to 26) | |
| The page's process, local view | 7 % of a core at 60 fps | about 0.7 of a core at 30 fps | 4 cores; the sim may use ¼ of one |
| Painting both grounds | 0.55 s | 8–10 s | once a sim-day; must not hold up frames |
| Pixels to fill per frame | 512×300, two to three layers deep | | a Mali-G31 MP2, if Chromium is given it |
| WebGL drawn by the processor | 2–3 cores | out of reach | 4 cores, 21 times slower |
| Chromium's memory | 0.5–0.6 GB, plus 10 MB of painted ground | | 1–4 GB by model; sim and server get 0.3 |

"At the board's speed" is the same page with its processor throttled 20 to 24 times in
Chromium (`Emulation.setCPUThrottlingRate`); in brackets the slowest frame in a hundred.
What follows:

- **The page's own work fits**, as long as only the animals in sight are worked out and
  the map shows dots, which is how the numbers were taken.
- **The ground cannot be repainted in one go on the board.** It has to be painted in a
  worker or a few cells per frame; it changes once a sim-day, so there is time.
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
| `map-view` | 512×300 | painted map | 216 dots | the map view as proposed |
| `local-view` | 512×300 | painted ground, standing plants | 50 | the local view as proposed |
| `local-crowd` | 512×300 | painted ground, standing plants | 216 | the local view with every creature alive |

The first eight draw the spike's first look (a flat square of ground per cell and a
drawing in every vegetated cell), which is what R0 was written against. `spec-1x` is
deliberately its worst case: a sprite for every cell of the island at once. The last
three draw the two views with the proposals picked in `proposal.ts`; once the look is
chosen the acceptance scenario should move to them, with a note in `docs/decisions/`.

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
- **Plant and ground art.** Drawn by rule, to be compared at several sizes and styles.

## Open

- **The proposals** of the look sheet, listed above.
- **Moving between the two views.** The painted pixels shimmer at zooms in between, so
  the camera would cut or cross-fade from one view to the other rather than glide.
- **Creature motion between sim ticks.** The simulation moves a creature a few cells per
  hour and ticks every ten minutes. Watched in real time that is stillness, so the
  renderer needs cosmetic life of its own (idling, breathing, small local wandering
  around the true position) without contradicting the simulation. Belongs to R2/R3.
- **Kinds at their thresholds**: see Creatures.
- **Seasons**: the standing plants have one drawing each; bare, flowering and snowed-on
  ones belong to R1.
