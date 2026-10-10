# Renderer

One renderer draws the scene for the desk screen and for the phone (CLAUDE.md §4.7):
TypeScript and PixiJS in a browser, which on the device is Chromium in kiosk mode at
1024×600. Only the R0 spike exists so far (`renderer/src/spike/`). It is throwaway in its
details and deliberate in its structure: R1–R4 build the real scene on what it settles.

## Pixel art

Everything on screen is pixel art: flat colours from small palettes, stepped shading,
hard edges, no smoothing.

- **Art pixels.** The scene is drawn into a canvas of 1024/k × 600/k and stretched to the
  screen by CSS with `image-rendering: pixelated`. The art scale *k* (1, 2 or 4 screen
  pixels per art pixel) sets both the look and the work: at k = 2 the GPU fills a quarter
  of the pixels. No antialiasing, nearest-neighbour textures, positions rounded to whole
  art pixels.
- **One palette.** Land and plant colours come from `tools/viz/pixelmap.py`, the same
  ramps the report maps use, so a forest is the same green in a report and on the desk.
- **World units are cells.** The world layer is positioned and scaled in cells of the
  simulation grid (256×150); the camera is one transform on it.

## Layers, back to front

1. **Terrain**: a bitmap with one pixel per cell, the ground without its plants. It
   changes once a sim-day (R1 cross-fades between days).
2. **Plants**, drawn one of two ways:
   - *Sprites*: one per vegetated cell, hand-drawn at 8×8 art pixels (8×12 for grown
     trees), per form (lichen, grass, shrub, broadleaf, conifer) and stage (young, mature;
     biomass decides), two variants picked by a hash of the cell so a meadow is not a
     wallpaper. The drawings are letter maps coloured at start-up from the form's ramp
     into one texture atlas; low plants with little biomass (died back, as in winter)
     take the dormant ramp instead. Cells are grouped in chunks of 16×16; chunks outside
     the view are skipped.
   - *Flat map*: one coloured pixel per cell, the picture the reports show. In a wide shot
     a cell is 4 screen pixels across and an 8-pixel sprite has nowhere to go, so wide
     shots use the map and sprites are for close-ups.
3. **Creatures**: a chain of circles seen from above. The head moves; every segment
   follows the one in front at a fixed distance, which gives the body its bend for free.
   Legs are placed by two-bone inverse kinematics: a foot stays planted until the body
   has left it behind. What the genes add to the chain is listed below.
4. **Tint**: one full-screen colour multiplied over everything: day, dusk, night, dawn.
   R4 drives it from presence.

## Plants on the ground: three styles, not yet chosen

The spike's first close-ups put plants badly on the map. The ground under them keeps the
colour of bare soil while the wide shot shows the same land green; every cell carries one
drawing dead in its middle; and a square of ground is eight times the size of a plant's
pixel. The look sheet draws the same places three ways:

- **A. As first built**: bare ground, one flat square per cell, a drawing in every
  vegetated cell (16 504 in the fixture world).
- **B. Green ground**: the same drawings on the wide shot's colours. Free, and close-up
  and wide shot agree on what is green; the grid and the squares stay.
- **C. Painted ground** (`ground.ts`): the ground is painted at the plants' pixel size,
  eight art pixels per cell. Each pixel looks up its cell through a gentle warp, so
  borders wander instead of running straight. Grass, lichen and the floor of a wood are
  patches on the soil, thicker with biomass. The shore keeps the map's dark outline, one
  pixel wide, with foam beyond it. Only trees, shrubs in leaf and a tuft of grown grass
  in one cell of three stand as drawings (6 605), off the middle of their cells, each
  with a shadow.

What C costs and implies:

- The ground is one picture of 2048×1200, repainted when the plants change (once a
  sim-day): 0.2 s on a PC, 1.7 s with the processor throttled tenfold. It needs no
  sprites, so the plant sprites of a full view drop by more than half.
- It is coherent only where a plant's drawing is shown at its own size: a close-up of 8
  art pixels per cell, which on this screen means **art pixels of 2 screen pixels**.
- Wide shots keep the flat map. Between the two, the camera would have to move in whole
  steps of zoom, or the painted pixels shimmer.
- Should it be chosen, the benchmark's scenarios change with it, and R0's worst case
  (a sprite in every cell) is no longer a shot the renderer would ever draw.

## How the genes show on a creature

A first pass, in `renderer/src/spike/body.ts`, made so the range of bodies can be judged.
The derived values (mass, leg pairs, speeds) come from `fauna/phenotype.py` through the
fixture; R2 ports that function and replaces these drawings.

| Gene | Shows as |
|---|---|
| `SIZE` | length, by the cube root of mass (0.7 to 2.8 cells); 5 to 9 segments |
| `LIMBS` | 0 to 4 leg pairs, spread from chest to hips |
| `SPEED` | build: slimmer body and longer legs; a quicker walk |
| `ARMOUR` | from 0.15, a dark shell around the whole outline, thicker with the gene |
| `SENSE` | eye size |
| `AQUATIC` | from 0.3, side fins and a tail fluke; from 0.6 the animal lives in the water |
| `JAW` | from 0.2, mandibles, longer with the gene |
| `DIET` | colour of the mandibles: dark on a grazer, ivory on a hunter |
| `HUE` | body colour, at one saturation and lightness |
| `PATTERN` | plain below ⅓, banded below ⅔, spotted above |
| `BROOD` | nothing |

Every part is a tinted disc or a stretched square of one atlas, so a body costs no
geometry, only transforms: 7 to about 50 sprites each.

## The look sheet

`renderer/look.html` shows all of the above in one page, drawn by the same code as the
benchmark: the island from afar, the plant drawings and two habitats, the fifteen
specimen genomes of `phenotypes.json` each followed by its own camera, every gene with a
look swept from 0 to 1 on an otherwise plain animal, one staged shot of a shore at
art scales 1, 2 and 4 and in the four lights, and two places in each of the three plant
styles above. Live, the creatures walk
(`npm run dev`, then `/look.html`). `npm run look` writes a still, self-contained copy
to [`reports/R0-look-sheet/`](../../reports/R0-look-sheet/README.md): creatures walk
for a fixed, seeded 8 s and every picture is saved inline. It is a view of the look, not
a measurement.

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

`spec-1x` is deliberately the worst case: no shot that ships would draw a sprite for
every cell of the island at once. The other scenarios say what the design can afford if
that one is tight.

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
  (`lineage-spike-fixture/2`): the world of a save, plus casts for the look sheet (the
  specimens and the gene sweeps). R1 replaces it with the protocol generated from the
  server's schema; nothing else should depend on the fixture's shape.
- **Creature bodies and motion.** Bodies are circles and stretched squares; the
  wandering is cosmetic and seeded, not the simulation's. Walkers keep to land and
  swimmers to water only because the spike says so.

## Open

- **How plants sit on the ground**: style A, B or C above.
- **Size of an art pixel** (1, 2 or 4 screen pixels): a matter of taste once the device
  numbers say which are affordable. To be chosen by eye on the real screen. Style C
  settles it at 2.
- **Creature motion between sim ticks.** The simulation moves a creature a few cells per
  hour and ticks every ten minutes. Watched in real time that is stillness, so the
  renderer needs cosmetic life of its own (idling, breathing, small local wandering
  around the true position) without contradicting the simulation. Belongs to R2/R3.
- **How close the camera gets.** At the spike's close-up (16 screen pixels per cell) a
  mid-sized animal is about 20 pixels long and the smallest about 11. The look sheet's
  portraits are that picture enlarged three times; a camera that close is R3's call.
- **The ground in close-ups** is one flat square per cell in styles A and B; style C is
  the answer to that.
- **Reading a creature against the ground.** A green animal on grass nearly disappears,
  and diet shows only in the colour of small jaws. Camouflage may be right; an outline
  or a stronger cue for hunters may be needed.
- **Depth order** of plants and creatures in close-ups (a creature behind a tree).
- **Plant art**: the spike's drawings are placeholders for cost, not the final look.
