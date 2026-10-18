# 0010 — R0 is judged on the three views, not on a sprite in every cell

- **Status**: accepted; R0 passed on these criteria on 2026-10-18
  ([report](../../reports/R0-renderer-spike/README.md))
- **Date**: 2026-10-18

## Context

ADR 0006 made `spec-1x` R0's acceptance scenario: the spike's first look at its most
expensive, a plant sprite in each of the 16 504 vegetated cells, 50 creatures and the
tint, drawn at 1024×600. Passing it was meant to leave headroom for the shots that would
ship. ADR 0007 then chose the look that ships, three views (map, middle, local) of
painted ground with only the plants that stand, and said the acceptance scenario should
move to them once the local view was settled. It has been settled since its third
amendment.

The board was then tried on a virtual display (ADR 0008: the GPU draws every frame and
nothing shows it), over four runs on 2026-10-17/18. Armbian trixie, kernel
6.18.57-current-sunxi64, Mesa 25.0.7, Chromium 155:

- **Chromium draws WebGL with the GPU** (ANGLE on Mali-G31, Panfrost) in every profile,
  with no flags needed.
- **The three views run.** mid-view at 62 fps (the display's refresh), mid-crowd (216
  creatures) at about 50, local-view at 62 with pauses where ground is painted on the
  frame, which R1 moves off it (ADR 0007).
- **`spec-1x` hangs the GPU.** It runs at 1.8 fps, and every frame ends with the kernel
  killing a fragment job after its half-second limit (`panfrost … gpu sched timeout,
  js=0, status=0x8`): 19 timeouts in 10 s of `spec-still`, none in mid-view. The rate is
  the timeout, not a speed, and those frames are probably not drawn whole.
- **It is the driver, not the scene's build or the browser.** `spec-still` (no
  creatures, nothing changes from frame to frame) hangs the same way; so does
  `spec-apart` (plants in a render group of their own). Mesa's `noafbc`, `nocrc` and
  `linear` options change nothing. The same sprites at 256×150 (`spec-4x`) do not hang.
  Outside Chromium, glmark2-es2 scores 130 and draws its `build` scene at 19 fps, about a
  fifth of what other Mali-G31 boards report, while its fill tests run at 650–700 fps.
- **A cost found on the way:** with the creatures standing in the plants' rows, a
  creature stepping into another row made PixiJS rebuild all 16 504 plants every frame:
  87 ms of script, against 12 ms with the plants apart.
- The GPU's clock is fixed at 432 MHz (no devfreq); the H618's is rated up to 650 MHz.

ADR 0006 says that a failed `spec-1x` is the owner's decision, not a pass. A native
renderer, the fallback R0 names, would go through the same Mesa driver and meet the
same hang.

## Decision

- **R0 is judged on the views that ship**: `map-view`, `mid-view`, `mid-crowd` and
  `local-view`, each at 30 fps median or more with the same browser profile (the kiosk
  runs one). `mid-crowd` is kept as the honest worst case of what ships, every creature
  the sim can hold in the costliest view. The criteria are R0.2–R0.5 in the report;
  R0.1 (measured as specified, ADR 0008) is unchanged.
- **`spec-1x` is measured and recorded, not judged.** It stays in the page and its
  numbers go into `metrics.json` (`best.spec-1x.*`), so a later driver can be checked
  against it.
- **PixiJS in Chromium stays the renderer.** No native fallback.
- The page judges the same scenarios (`ACCEPTANCE_SCENARIOS` in `scenarios.ts`) and a
  test keeps the two lists equal.

## Consequences

- R0 can close on a run with a real display (ADR 0008: the 7" screen or a larger
  monitor), if the four views hold 30 fps there. The virtual runs do not count.
- **The hang is a standing risk for R1–R4.** No view may draw as many sprites at full
  resolution as `spec-1x` does; R4's benchmark should count GPU timeouts beside the
  frame rate. Worth a Mesa bug report with `spike.html?demo=spec-still` as the test case,
  and a look again on a newer kernel or Mesa.
- **For R1:** what does not move goes in a render group of its own, so that moving
  creatures do not make PixiJS rebuild it.
- **For S6:** the GPU's clock. Without an OPP table it stays at 432 MHz; one in the
  device tree would give up to 1.5× on the GPU's work.
- The 1% low of local-view (pauses while ground is painted) is not a criterion here;
  painting off the frame is R1's (ADR 0007).

## References

- Kernel log and benchmark files of the virtual runs: on the board in `~/lineage-r0/`
  (`kiosk-bench-virtual*.json`, `chromium-*.log`), not committed (ADR 0008).
- glmark2-es2 on a Mali-G31 (S905X3, Mesa 20.3), `build` about 96 fps:
  <https://forum.manjaro.org/t/panfrost-for-bifrost-gpus-big-improvements/35807?page=5>
- glmark2-es2-wayland on a Mali-G31 (ODROID-C4), score around 300:
  <https://forum.odroid.com/viewtopic.php?t=36675&start=150>
- The H618's Mali-G31 MP2 at up to 650 MHz:
  <https://hwpure.com/hardware/videocards/mali-g31-mp2>
