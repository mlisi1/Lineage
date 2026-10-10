# 0006 — Renderer spike: what it measures and how R0 is judged

- **Status**: accepted (the measurement on the device is pending)
- **Date**: 2026-10-10

## Context

R0 gates the renderer: a PixiJS scene with 50 animated chain-of-circles creatures, a
terrain bitmap, plant sprites and a full-screen tint must reach 30 fps median in Chromium
kiosk on the Orange Pi at 1024×600, or an ADR chooses a native renderer. The milestone
names what to measure (fps median and 1 % low, CPU, GPU driver in use, RAM) but not the
scene's details, and the project has since settled on pixel art.

## Decision

- **Draw a real world.** The scene is a saved world (the v4 save fixture, exported by
  `tools/replay.py`), not a synthetic one: 16 504 vegetated cells and the creatures'
  real sizes and limb counts. A stand-in fixture format carries it until R1's protocol.
- **Pixel art by internal resolution.** The scene is rendered at 1024/k × 600/k and
  stretched with hard edges. The spike measures k = 1, 2 and 4, because k decides the
  fill cost and is a look still to be chosen.
- **The acceptance scenario is the letter of R0 at its most expensive**: `spec-1x`, a
  sprite for every vegetated cell at full resolution, 50 creatures, tint. Shots that
  would ship (flat map in wide shots, sprites only in close-ups) are measured beside it
  and are cheaper, so passing `spec-1x` leaves headroom rather than none.
- **The frame rate that counts is the best browser profile's.** Whether Chromium uses
  the GPU on an ARM board depends on its flags; the kiosk will be started with whichever
  flags work. The runner tries five profiles and the report takes the best one, breaking
  ties (several can sit at the refresh rate) by lower CPU.
- **The page measures frames, the runner measures the machine.** Frame times come from
  `requestAnimationFrame` in the page; CPU, memory (PSS) and temperature come from
  `/proc` for every Chromium process, attributed to scenarios by wall-clock time. The
  runner uses only the standard library, so it is copied to the board as one file.
- **Say what drew the page.** PixiJS falls back to the 2D canvas without a word when
  WebGL is missing, and Chromium falls back to software WebGL the same way. Every result
  records the graphics path that actually ran.
- **A report from evidence, not from a run.** `tools.report R0` reads the runner's
  `kiosk-bench.json` and keeps it in the report directory in place of `config.toml`
  (CLAUDE.md §7): it cannot be regenerated on a PC. The report has two criteria: the
  numbers were taken as specified (ARM board, kiosk, 1024×600) and the frame rate. A
  trial on a PC therefore cannot read as a pass.
- **No new dependencies.** PixiJS was already the renderer's; the plant art is drawn in
  code and the benchmark needs nothing installed.

## Consequences

- R0 cannot be closed from a PC. Until the board has run the benchmark the milestone is
  "in progress" and no criterion is claimed.
- If `spec-1x` fails but the shots that would ship pass, that is a decision for the
  owner, not a pass: the criterion as written has failed and the ADR R0 asks for is due,
  even if its conclusion is to keep PixiJS with a cheaper scene.
- The spike's fixture, plant drawings and creature motion are placeholders. R1 and R2
  replace them; only the structure (layers, art scale, chunked sprites, flat map for
  wide shots) is meant to survive.
