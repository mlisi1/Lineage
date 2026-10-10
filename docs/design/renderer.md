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
3. **Creatures**: a chain of circles. The head moves; every segment follows the one in
   front at a fixed distance, which gives the body its bend for free. Segment count and
   size follow body mass, legs follow the limb-pairs gene and are placed by two-bone
   inverse kinematics, colour follows the hue gene. R2 replaces this with the full
   phenotype shared with `fauna/phenotype.py`.
4. **Tint**: one full-screen colour multiplied over everything: day, dusk, night, dawn.
   R4 drives it from presence.

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

- **The page's own work is small.** Script time is 0.5 ms a frame for the spec scene and
  1.1 ms for 216 creatures; with the page's thread throttled tenfold both still hold
  30 fps. Moving creatures in JavaScript is not the risk.
- **The 2D canvas cannot draw a sprite per cell.** 16 504 sprites take 67 ms a frame on
  a fast PC (12 fps); the flat map, close-ups and the crowd run at 60 fps there. A canvas
  fallback would have to live without wide-shot sprites, which the design already does.
- **Software WebGL is not a fallback for the device.** It holds 60 fps on the PC by
  spending nine of its cores. The board has four slower ones and the simulation needs
  part of one.

So R0 comes down to one thing a PC cannot answer: whether Chromium on the device's OS
image draws WebGL with the GPU.

## What the spike stands in for

- **The state stream.** The spike loads a fixture written by `tools/replay.py`
  (`lineage-spike-fixture/1`). R1 replaces it with the protocol generated from the
  server's schema; nothing else should depend on the fixture's shape.
- **Creature bodies and motion.** Bodies are the simplest chain that exercises the
  drawing cost; the wandering is cosmetic and seeded, not the simulation's.

## Open

- **Size of an art pixel** (1, 2 or 4 screen pixels): a matter of taste once the device
  numbers say which are affordable. To be chosen by eye on the real screen.
- **Creature motion between sim ticks.** The simulation moves a creature a few cells per
  hour and ticks every ten minutes. Watched in real time that is stillness, so the
  renderer needs cosmetic life of its own (idling, breathing, small local wandering
  around the true position) without contradicting the simulation. Belongs to R2/R3.
- **Depth order** of plants and creatures in close-ups (a creature behind a tree).
- **Plant art**: the spike's drawings are placeholders for cost, not the final look.
