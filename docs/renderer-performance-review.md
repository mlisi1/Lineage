# Renderer performance review — handoff notes for the implementing agent

Written 2026-10-27 on branch `r5-final` (HEAD `6f8cd4d`) as a review only: nothing in
`renderer/` was changed. These notes are for the agent that will implement the changes.
Read `CLAUDE.md` (§4.7–4.8, §5, §6, §8 R5/R6), `docs/design/renderer.md` ("What the frames
cost on the board", "Measuring the scene on the device") and ADR 0022 "The board" first.

**Status (2026-10-28).** Done, all [same pixels]: P1 (in part: slots kept, tints, no
garbage; not keyed per-cell sprites, which would reorder overlapping flames), P2, P3, P6,
P7 (in part: repaint per pixel of paper; the roll is not composed of separate elements),
P8 (direct upload; `PLACED_PER_FRAME` unchanged). Waiting for the board: P4, P10, §2.
Waiting for the owner: P5 and the other [changes pixels] items. ADR 0022, "The review of
the pipeline", records what was kept.

## 0. Ground rules for whoever implements this

- **The look is final** (the owner, 2026-10-25). Every change below is tagged
  **[same pixels]** (must leave every Playwright still and every film frame identical) or
  **[changes pixels — owner's call]** (needs the owner's sign-off, shown as before/after
  side by side, per the memory note "Visual proposals"). Do the [same pixels] ones first.
- Verify [same pixels] with `cd renderer && npx playwright test` (`tests/e2e/final.spec.ts`,
  `scene.spec.ts`, `atmosphere.spec.ts`, `camera.spec.ts`) and, for motion, a few
  `?film` frames compared byte for byte before and after (`window.__frame(1/30)`).
- One concern per commit, `renderer: …` / `creatures: …` / `plants: …` /
  `atmosphere: …` / `terrain: …`, tag `[R5]` (or `[R6]` if R5 has merged by then). No
  Co-Authored-By line (memory: "Commits"). Do not push.
- Ask before adding a dependency. Pixi 8.22.0 is installed; everything below uses it.
- Only the board decides: each change that claims a win is measured with the scene's
  benchmark on the board (`python3 kiosk_bench.py --dist dist-kiosk --fps-cap 30`, procedure
  in `deploy/README.md`) before it is kept, as ADR 0022 did. The PC profiles below say
  *where* the time goes, not how much the board will gain.

## 1. Where the time goes

### On the board (`reports/R5-device/kiosk-bench.json`, 2026-10-27, cap 30 fps)

| Scenario | fps median | 1 % low | frames late | JS ms median / p99 | draws | sprites | animals in sight | renderer CPU |
|---|---|---|---|---|---|---|---|---|
| map | 29.9 | 7.5 | 1.0 % | 6.6 / 16.8 | 8 | 411 | 200 dots | 64 % |
| middle | 29.9 | 7.8 | 2.1 % | 10.9 / 37.0 | 23 | 1 353 | 19 | 106 % |
| **middle-crowd** | 29.9 | 5.9 | **4.6 %** | **22.6 / 63.1** | 24 | 4 092 | 72 | 120 % |
| local | 29.9 | 9.7 | 1.0 % | 10.6 / 27.5 | 14 | 1 219 | 3 | 91 % |
| night | 29.9 | 5.3 | 6.0 % | 25.1 / 68.0 | 23 | 4 480 | 74 | 129 % |
| rain | 29.9 | 5.6 | 6.4 % | 25.0 / 74.2 | 24 | 4 430 | 74 | 135 % |
| **fire** | **20.0** | 4.3 | **84.6 %** | **45.6 / 76.9** | 26 | 5 239 | 39 | 139 % |
| apocalypse | 29.9 | 25.6 | 0.2 % | 6.0 / 11.8 | 11 | 127 | 0 | 55 % |
| shore | 29.9 | 8.5 | 1.0 % | 6.2 / 13.1 | 15 | 234 | 0 | 68 % |
| day-turn | 29.9 | 4.7 | 20.4 % | 26.3 / 72.8 | 21 | 3 974 | 67 | 250 % |

"JS ms" is the bench's script time from the ticker's first listener to after `app.render`
(`bench.ts` `measure`), so it includes Pixi's own CPU work. The GPU process sits at 25–40 %
of a core: **the page's main thread is the bottleneck, not the Mali-G31.** The budget is
33.3 ms; the crowd's p99 of 63 ms is what makes its late frames, and rain/night/fire are
the crowd plus effects. Memory peaked at 582 MB PSS (band 800).

### On the PC, profiled (relative shares)

Chromium (Playwright's, SwiftShader WebGL) on the dev server, CPU throttled 21× (the
board-equivalent rate `renderer.md` uses), V8 sampling profiler over 8 s per scenario. The
scripts are in the appendix. Percentages are of the page's busy JS time (idle and native
"(program)" excluded); absolute times on a PC are meaningless, the shares are not.

**middle-crowd** (pinned `view=middle&x=176&y=43`): `step` 52 %, Pixi `render` 41 %.

| Where | Share | What |
|---|---|---|
| `Herd.update` → `CreatureLayer.update` | 35 % | |
| … `pose` (via `eat`) | 20 % | 9 % self (trig, writes to 45 sprites), `walk` 6 %, Pixi `_onUpdate` 3 %, `breathe` 2 % |
| … `live` | 10 % | `drive` 2.5 %, `clear`→`PlantLayer.blocked` 2 %, `followChain` 1.6 % |
| … `doze` | 1.3 % | |
| `CreatureLayer.hostIn` → `PlantLayer.over` | 7 % | every animal in sight, every frame |
| `Landscape.update` | 6 % | `PlantLayer.blow` 3.6 % (`gustAt` 1.4 %), `cull` 1.7 %, sea 1 % |
| Pixi `updateRenderGroupTransforms` | 21 % | recomputing the transform of every sprite moved this frame |
| Pixi `collectRenderables` / batch `break` / `packQuadAttributes` | ~6 % | band draw lists rebuilt, quads repacked |
| Pixi `execute` (GL calls, buffer uploads, filters) | 11 % | of which filters 2.5 % |

Counted in the same page: **74 animals in sight × 45.5 sprites each = 3 368 of the 4 137
visible sprites (81 %)**, all from one 140×66 texture (the creature atlas). Plants are
static and cost almost nothing per frame once their band's draw list is built.

**fire** (bench `only=fire`, ~12 fps throttled): `step` 53 % (atmosphere `drawFires` 22 %:
`puffs` 7 %, `halo` 3 %, `placeCentred` 3 %, the night copy's `copyFrom` 2 %, pool `next`
2 %, `tint` 1 %; herd 22 %), Pixi `render` 41 % with child render groups rebuilt (validate,
collect, repack) about 14 %.

**local**: herd 24 % (`live` 9 %, `pose` 5 %), `Landscape.update` 11 % (`blow` 6 %, `cull` 3 %),
`PlantLayer.fade` 2.7 % (a feature that is switched off, see P5), captions 3.8 %
(`paintScroll` + `putImageData` while the scroll rolls), `Herd.subjects` 1.2 %.

**map**: herd 45 %: **all 200 animals run the whole walk and chain every frame** (`live`
37 %: `followChain` 10 %, `drive` 9 %, `doze` 6 %) although each is drawn as a dot.

**night / rain**: the crowd's profile plus `Herd.glowing` 2.8 % and `drawGlow` 1.9 % (night),
`drawRain` 1.8 % (rain).

**day-turn**: the main thread's frame is the crowd's; the turn's cost on the board is
elsewhere (§3 P10).

Render groups rebuilt (instrumented `RenderGroupSystem._buildInstructions`, 300 frames):
crowd: plant bands 73 times (an animal changing row), the eating flecks' group 94, others
small; map: sea glints 52, world 2; local: bands 6. So band rebuilds are real but no longer
the main cost; per-sprite transform and repack work is.

## 2. The one big lever: creatures are 45 Pixi sprites each

Everything else in this file is worth a few percent. This one is worth a third to a half of
the crowd's frame.

**What happens now.** `CreatureLayer.pose` (`renderer/src/creatures/layer.ts:2176`) sets
`position`, `rotation` and `scale` on every part sprite of every animal posed (outline,
under, shade, body, light, marks, face per mass; upper, lower, two or three edges and a
sole per leg). Each write goes through Pixi's `ObservablePoint._onUpdate` and queues the
sprite in its render group; at render Pixi recomputes each one's local and group transform
(`updateRenderGroupTransforms`, 21 % of the crowd's JS) and repacks its four vertices into
the batch buffer (`updateRenderable`, `packQuadAttributes`). The animal's own maths
(`pose` self 9 %) is small beside what the scene graph does with its results.

**Fix, in two possible depths** — **[same pixels]** if done right; prove it with the stills.

1. *ParticleContainer per animal* (quickest to try). Pixi 8's `ParticleContainer` with
   `Particle`s (x, y, scaleX, scaleY, anchorX, anchorY, rotation, tint, alpha) draws all its
   particles from one texture source, which the atlas is. Each creature's `container` would
   become one `ParticleContainer` (`dynamicProperties: { position, rotation, vertex, color }`)
   and each part a `Particle`; `pose`, `walk`, `stretch`, `breathe` write plain numbers,
   with no observers and no per-sprite transform pass. Things to keep: the order of parts
   (particle order is draw order), parts hidden by `remains.ts` (alpha 0 or removed), the
   eyes' `scale.y` that sleep narrows (`sleep.ts` `shutEyes`) and the glints' `visible`, the
   portrait renderer (`creatures/portrait.ts` renders a layer into a texture), roundPixels
   (`ParticleContainer` has its own `roundPixels` option; check the stills), `boundsArea`
   (particle containers do not measure bounds). Cost to watch: each `ParticleContainer` is
   its own draw call and breaks the plant batch it sits in, so the crowd would go from ~24
   draws to ~150. Measure on the board: if the GPU process (now 39 % of a core) does not
   become the limit, this is the simple route.
2. *A custom batchable element* (the best end state). Write one renderable per creature
   that packs all its quads straight into Pixi's default batcher (a `BatchableElement`
   whose `packAttributes` writes 4 vertices × N parts with per-vertex colour from a
   `Float32Array` the creature fills in `pose`), registered through a small `RenderPipe`
   extension. Creatures then still batch with the plants around them (no extra draws), and
   the per-part cost is a few float writes. More work and more Pixi internals to learn;
   start from Pixi's own `BatchableSprite` / `SpritePipe`.

Either way keep `CreatureLayer`'s public interface, so `herd.ts`, `remains.ts`,
`portrait.ts`, the showcase and the tests do not change. `Creature.sprites`/`legs` become
indices into the creature's quad list. The map's dots (`markers.ts`, two sprites per animal)
can move onto the same mechanism afterwards.

**A cheaper first step, [changes pixels — owner's call] or [same pixels] part by part:** in
the middle view an animal of mass 1 is 4½ art pixels long, yet it carries the local view's
45 parts. Build middle-view bodies with only the parts that change a pixel at that scale
(leg edges and soles a fraction of a pixel wide, light patches already gated at 5 px, etc.:
`body.ts` already drops markings under `MARK_FROM_PX`). Count, per part, whether removing
it changes any pixel of the creature sheet's middle-view renders and of the crowd's stills;
drop those that do not ([same pixels]); list the rest for the owner.

## 3. Everything else, ranked

Expected gains are shares of the crowd's (or the named scenario's) busy JS on the PC.

### P1. Fire: place what does not move once, not every frame — fire scenario, ~20 %

`Atmosphere.drawFires` (`renderer/src/atmosphere/atmosphere.ts:790`) re-places, per burning
cell per frame: a halo, an ember bed, one or two flames plus one in the crown, a lit
(added) copy of each at night or under cloud, up to three small flames and two to three
`puffs`, each through `SpritePool.next`/`RowPool.next` (`particles.ts:84`, `:137`) and
`placeCentred` (`particles.ts:207`). With 300 cells that is ~2 000 sprites written every
frame and a new `Plume` object per cell per frame (`:834`, `:923`, `:969`).

- Most of it is static per cell: positions come from `cellHash(index, …)`, sizes from the
  view; only the frame (5–7 Hz), the flicker (6 Hz), the ember frame (4 Hz) and `share`
  (only while catching or dying) change. Keep a sprite set per burning cell (a `Map` keyed
  by cell index, created when it catches, released when it is out) and write a property
  only when its value changes. **[same pixels]**
- Pool slots shift: when one item is skipped (a halo under alpha 0.01 returns early,
  `halo` `:725`), every later sprite in the pool takes the next one's texture, position and,
  for `RowPool`, row, which rebuilds band draw lists. Keyed slots fix this too. **[same
  pixels]**
- No objects per cell per frame: reuse one `Plume` scratch object; replace
  `inSight.forEach`/`reduce` closures with loops; cache the `inSight` list until the
  camera's `cells` or `flameLife` change.
- `puffs` (7 %) recomputes particle positions from time each frame by design (they move);
  keep, but avoid per-call allocation (check `puffs` `:985`).
- Do not cap the number of flames: ADR 0022 records that capping would change how a big
  fire looks (the owner's call).

### P2. `hostIn` / `PlantLayer.over`: per animal per frame — crowd ~7 %

`CreatureLayer.hostIn` (`layer.ts:1486`) asks `PlantLayer.over` (`plants.ts:506`) for every
animal in sight every frame which tree or bush overlaps it, scanning the rows round it and
reading each plant's texture size, scale and anchor; `box()` (`layer.ts:1410`) allocates an
object and a closure per call.

- Cache the answer per creature with the key it depends on: the box quantised to the
  layer's texel (or to 1/16 cell) and the row range, plus the plant layer's identity and a
  "built" counter (bumped when `cull` builds chunks or a new layer is shown). Recompute
  only when the key changes. Grazing, sleeping and paused animals (half the herd) then cost
  nothing. **[same pixels]**
- Precompute each leafy sprite's box (left, top, wide, high) once when the chunk is built
  (`leafy` already lists them per chunk) instead of from `texture`/`scale`/`anchor` each
  call; the `joints.some(...)` closure for bush pieces (`:531`) becomes a loop.
- `box()` writes into a per-creature scratch rect.

### P3. Plants in the wind and culling — crowd ~5 %, local ~10 %

- `PlantFade.tick` (`renderer/src/landscape.ts:133`) and `Landscape.update` (`:383`) run
  `cull` and `blow` for **both** the middle and the local plant layers every frame
  whichever view is shown (the hidden one with the other view's `cells` and `null` wind).
  Tick only the shown view's layers (the other is not drawn: check its container is
  invisible, and that `cull` is run once when it comes back). **[same pixels]**
- `PlantLayer.cull` (`plants.ts:415`) walks every row of the island each frame (600 in the
  local view), allocating `bandsShown` and two closures per row. Run it only when the view's
  integer cell rect changes (the camera moves by less than a cell most frames) or chunks
  were added; when it does run, touch only rows between the old and new ranges.
  **[same pixels]**
- `PlantLayer.blow` (`plants.ts:459`) computes `gustAt` for every swaying plant in view each
  frame. A plant whose `reach × strongest wind × max gust` rounds to 0 can never lean:
  skip it (most of the middle view's plants: "the middle view's plants move little").
  Precompute `last`. The wind strength is the same for all: when it is 0 skip the loop
  after one pass that straightens. **[same pixels]** Updating leans on alternate frames
  (half the rows each frame) is **[changes pixels — owner's call]**.
- `PlantLayer.fade` (`plants.ts:556`) runs every frame for the followed animal, scanning
  rows and allocating a `Map` and a `Set` spread, although the fade is switched off
  (`FADED = FADED_SMALL = 1`, `plants.ts:87`, the owner, 2026-10-24). Return at once when
  both are 1 and `faded` is empty; keep the code for when it is switched on. **[same pixels]**

### P4. Band rebuilds when animals change rows — crowd a few %, p99 spikes

Bands are 4 cells of rows (`BAND_CELLS`, `plants.ts:185`): in the middle view
(`rowsPerCell` 1, eager layer: every chunk of the island built) a band holds 4 rows across
the whole island; in the local view (`rowsPerCell` 4) 16 rows. An animal moving to another
row rebuilds its band's draw list (73 times in 300 frames in the crowd). Try 2 cells per
band in the middle view and measure; with P2's cache an animal changes row only when its
row really changes. Look at the p99 of the crowd, not the median: rebuilds are spiky.
**[same pixels]** (order drawn is unchanged).

### P5. The map view moves 200 full bodies to draw 200 dots — map ~35 %

`Herd.update` calls `layer.update(dtS, undefined, false)` on the map (`herd.ts:743`), and
with no view every animal walks, follows its chain, pivots and dozes each frame
(`layer.ts:1554`); `OUT_OF_SIGHT_EVERY` never applies. The map is 2 art pixels to the cell.

- Live every animal one frame in three on the map, with the time of all three, as the out
  of sight do (`OUT_OF_SIGHT_EVERY`). A dot then moves in steps of three frames' walk
  (well under a pixel at map scale for most animals): **[changes pixels — owner's call]**,
  but the owner already accepted the same for animals out of sight (ADR 0022). Show a film.
- The map's 6.6 ms is within budget; do this after P1–P4, mainly to free the CPU (heat,
  no fan).

### P6. Allocations and small per-frame writes — 1–3 % each, all **[same pixels]**

- `Herd.subjects()` (`herd.ts:677`) builds 200 objects every frame for the director
  (`director.ts` `track` reads `scene.subjects` via the getter in `main.ts:547`). Keep one
  array of reused objects, refreshed once per frame; the director only needs to look one up
  by id (give it `subjectOf(id)`).
- `Herd.glowing` (`herd.ts:699`) allocates a `Spot` per joint per glowing animal per frame
  and uses a `forEach` closure; fill a reused array.
- `Atmosphere.setGrade` (`atmosphere.ts:691`) builds a new matrix from spread arrays every
  frame from `paintTint`; skip when `overcast` has not changed (ADR 0022 item 17 says
  "the grade matrix rebuilt every frame" was fixed; the call is still unconditional).
- `Sea.tick` (`terrain/sea.ts:337`) re-parses the shallow colour string and allocates two
  arrays every frame for the shore uniforms; do it when the land changes.
- `main.ts:714–715` writes `canvas.style.transform` and `dim.style.opacity` every frame;
  write them only when the string changes (each write invalidates style).
- `CreatureLayer.refresh` (`layer.ts:1681`) and `centre`/`spine` return fresh objects; fine
  outside the frame, check callers per frame.
- Search for `forEach(`, `.filter(`, `.map(`, `[...`, `new Set(`, `new Map(` and object
  literals inside anything called from `main.ts` `step`; ADR 0022 did this for the herd
  (`71895f0`); `atmosphere.ts` `update` (`effects.filter` at `:604`) and `drawFires` are
  next.

### P7. Captions and the name card repaint on the CPU while they roll — local ~4 %

`Captions.update` (`renderer/src/captions.ts:591`) repaints the whole scroll
(`paintScroll`, `lightPicture`, `putImageData` into its canvas) on every frame of its
unroll and roll-up, and at every lantern step. Paint the open scroll once per entry and
lantern step, and roll it with a CSS `clip-path`/two rolled ends as separate elements, or
cache the frames of the roll the first time (the roll lasts well under a second). Check
`card.ts` for the same pattern while it slides (it slides by CSS, it seems: verify).
**[same pixels]** if the composed result equals the painted one; compare screenshots.

### P8. The ground's textures: uploads and memory

`rgbaSprite` (`renderer/src/terrain/grounds.ts:80`) makes a `<canvas>`, `putImageData`s the
worker's pixels into it and wraps it in a `CanvasSource`; the canvas lives as long as the
piece. That is two CPU copies and a canvas backing store per piece (plus the shore data's)
on top of the GPU texture.

- Upload from the worker's buffer directly (`BufferImageSource` with the transferred
  `Uint8Array`, `format: "rgba8unorm"`), or have the worker hand an `ImageBitmap`
  (`OffscreenCanvas.transferToImageBitmap`) and use `ImageSource`. Drop the CPU copy after
  upload if Pixi allows (check context-loss handling first; Chromium kiosk on Panfrost has
  not lost context in any run). Saves main-thread time per piece (four a frame while the
  ground comes in, `PLACED_PER_FRAME`) and memory (R5.3 is at 582 of 800 MB).
  **[same pixels]**
- While pieces arrive, `PLACED_PER_FRAME = 4` (`grounds.ts:44`) uploads up to four
  256×256 (middle) textures in one frame. If the day's turn shows upload spikes on the
  board, try 2 and let the 2 s fade absorb it.

### P9. GPU-side passes (not the bottleneck today; do not make them worse)

- The shore shader is a `Filter` on the surf layer (`sea.ts`): an offscreen pass per frame
  in every view with a coast. The grey under cloud is another full-screen filter on the
  world (`main.ts:699–702`). Filter push/pop showed 2.5 % of JS in the crowd. If the GPU
  process becomes the limit after §2 (ParticleContainers add draws), the shore filter is
  the first candidate: draw it as a `Mesh` with the shader over the shore texture instead
  of a filter (no render-to-texture and copy). **[same pixels]** if the shader is unchanged.
- The tint is one multiplied sprite over the scene; fine.

### P10. The day's turn — 20 % frames late for ~12 s once a sim-day

On a new day the view on screen is laid out again (`Landscape.layOut`, `landscape.ts:447`):
a new plant layer built (eager in the middle view: every chunk of the island; the crowd's
page holds 20 867 sprites of which 4 137 are visible), shadows computed on the main thread
(`PlantLayer.shadows`), pieces repainted in the workers and put on the screen four a frame
(`rgbaSprite`, P8), and both plant layers cross-faded for 2 s (`PlantFade`).

**Measured:** on the PC (60 s profile throttled 6×, spanning a turn, `?ground=fresh`) the
main thread's share of the turn is tiny: `layOut` 0.2 %, `shadows` 0.2 %, `rgbaSprite`
0.1 % of the minute's JS; the frame is the crowd's as usual. On the board the turn's JS
median is 26.3 ms against the crowd's 22.6 (p99 72.8 against 63.1), but **the renderer
process uses 250 % CPU against the crowd's 120 %**: the two paint workers (`makePainter`,
`terrain/painter.ts:295`, cores less two) repaint every piece in view and write them to
IndexedDB on the SD card, on four A53 cores already busy with the main thread, the GPU
process and the compositor. So the turn's late frames are most likely contention, not the
main thread's own work. Check this on the board first, then try, one at a time:

- One paint worker while frames are late (or always, if the ready-time after loading
  stays acceptable), or pause new day repaints of pieces out of view until those in view
  are done. **[same pixels]** (only when pieces arrive changes).
- Defer IndexedDB writes of a new day's pieces until the frames have been on time for a
  few seconds (as prepaint already waits, `PieceGround.prepaint`).
- `PLACED_PER_FRAME` 2 instead of 4 (P8).
- Build the middle view's new plant layer lazily (as the local one is) instead of the
  whole island at once: helps memory more than time.
- On the desk the day turns once a real day; the bench plays 1 800× fast. The owner chose
  to report the turn, not judge it. Do not spend effort here before P1–P4.

### P11. What the desk does differently from the bench (keep in mind, do not "fix")

- The bench plays the recording 1 800× fast: a creatures message every ~4 s, a day every
  48 s. On the desk (1×) anchors change every 10 sim-minutes, so far more animals are posed
  "as before" (`posedAsBefore`, `layer.ts:2264`) and the real crowd is cheaper than the
  benchmark's. The bench is still what is judged.
- `?bench` sessions paint ahead and use IndexedDB as the desk does; profile with
  `?ground=fresh` only when looking at painting.

## 4. Suggested order and measuring

1. P6, P3, P2 (same pixels, small, safe): expect the crowd's JS down by ~15 %.
2. §2 creatures (ParticleContainer trial on a branch; measure draws and the GPU process on
   the board; then the custom batch element if draws hurt): expect the largest single gain.
3. P1 fire (keyed per-cell sprites): the only scenario under 30 fps.
4. P4 band size, P7 captions, P8 uploads.
5. Owner's calls, presented together with films: P5 (map cadence), the middle-view body LOD,
   P10 fade.

After each: `npm run typecheck && npm run lint && npm test && npx playwright test`; then the
board run; keep the new `kiosk-bench.json` only when it is a full run of the final build
(R5's last step in `docs/milestones.md`). Update `docs/design/renderer.md` "What the frames
cost on the board" and ADR 0022 "The board" with what was kept, as before.

## Appendix: the profiling scripts used

Run with the dev server up (`cd renderer && npx vite --port 5391 --strictPort`), from any
directory, with Node 22; they load Playwright from `renderer/node_modules`. Not committed
as tools; if they are worth keeping, put them under `renderer/scripts/` and list them in
`CLAUDE.md` §5.

`prof.mjs` — load a page, wait until `__sceneSettled()`, throttle the CPU, record a V8
profile, print self and inclusive time:

```js
// node prof.mjs "<query>" <label> [throttle=21] [seconds=8] [settleS=25]
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/home/elechim/Lineage-r5/renderer/package.json");
const { chromium } = require("@playwright/test");
const [, , query, label, throttle = "21", seconds = "8", settleS = "25"] = process.argv;
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1024, height: 600 } });
await page.goto(`http://localhost:5391/index.html?${query}`);
// For `bench&only=<scenario>&seconds=200&warmup=1` add: await page.waitForTimeout(45000);
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  if (await page.evaluate(() => window.__sceneSettled?.() ?? false).catch(() => false)) break;
  await page.waitForTimeout(500);
}
await page.waitForTimeout(Number(settleS) * 1000);
const cdp = await page.context().newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });
await page.waitForTimeout(2000);
await cdp.send("Profiler.enable");
await cdp.send("Profiler.setSamplingInterval", { interval: 200 });
await cdp.send("Profiler.start");
await page.waitForTimeout(Number(seconds) * 1000);
const { profile } = await cdp.send("Profiler.stop");
fs.writeFileSync(`${label}.cpuprofile`, JSON.stringify(profile));
await browser.close();
```

`tree.mjs` — the call tree under a function (merged by name), as shares of busy time:

```js
// node tree.mjs <file.cpuprofile> [root=step] [depth=4] [minPercent=0.4]
import fs from "node:fs";
const [, , file, rootName = "step", depth = "4", min = "0.4"] = process.argv;
const p = JSON.parse(fs.readFileSync(file, "utf8"));
const nodes = new Map(p.nodes.map((n) => [n.id, n]));
const hits = new Map();
p.samples.forEach((id, i) => hits.set(id, (hits.get(id) ?? 0) + (p.timeDeltas[i] ?? 0)));
const incl = new Map();
const walk = (id) => { let t = hits.get(id) ?? 0; for (const c of nodes.get(id).children ?? []) t += walk(c); incl.set(id, t); return t; };
walk(p.nodes[0].id);
let busy = 0;
for (const [id, t] of hits) if (!["(idle)", "(program)"].includes(nodes.get(id).callFrame.functionName)) busy += t;
const name = (n) => `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").slice(-2).join("/").replace(/\?.*/, "")}:${n.callFrame.lineNumber + 1}`;
const merge = (ids) => { const by = new Map(); for (const id of ids) { const n = nodes.get(id); const e = by.get(name(n)) ?? { t: 0, self: 0, kids: [] }; e.t += incl.get(id); e.self += hits.get(id) ?? 0; e.kids.push(...(n.children ?? [])); by.set(name(n), e); } return [...by].sort((a, b) => b[1].t - a[1].t); };
const print = (ids, d) => { for (const [k, e] of merge(ids)) { const pc = (100 * e.t) / busy; if (pc < Number(min)) continue; console.log(`${"  ".repeat(d)}${pc.toFixed(1)}% (self ${((100 * e.self) / busy).toFixed(1)}) ${k}`); if (d < Number(depth)) print(e.kids, d + 1); } };
print(p.nodes.filter((n) => n.callFrame.functionName === rootName).map((n) => n.id), 0);
```

(Line numbers in the profiles are those of Vite's transpiled modules, a little off the
sources'; the function names are right.)

`rebuilds.mjs` — which render groups rebuild their draw list, and how often: in the page,
import Pixi from the URL the page loaded it from
(`performance.getEntriesByType("resource")`, the entry containing `pixi__js.js`), wrap
`PIXI.RenderGroupSystem.prototype._buildInstructions`, and count by a description of
`renderGroup.root` (constructor name, child count, up five parents) over 300 frames. The
same trick (wrapping `RenderGroupSystem.prototype.render` once to catch the stage) counts
sprites per creature container.
