# 0008 — R0 may be measured on a larger display standing in for the 7" screen

- **Status**: accepted
- **Date**: 2026-10-11

## Context

R0 asks for the renderer spike at 30 frames a second "in Chromium kiosk on the Orange Pi
at 1024×600", and ADR 0006 has the report refuse a run that was not made that way. The
board is on the desk (the 2 GB model). The 7" screen is not bought yet. The owner will
measure on an HDMI monitor at 1920×1080 and take a good result there as good for the
screen.

That is a sound reading of what R0 is for. The scene is drawn at a fixed internal size
(512×300 for the three views, 1024×600 for the first look's `spec-1x`) and stretched to
the page. On a larger page the drawing is the same work and the stretch fills more
pixels, so a larger display is at least as hard on the board as the screen will be.

## Decision

- **A run whose page is 1024×600 or larger in both directions counts as the R0
  measurement.** The report passes its first criterion for it, names the display in its
  header, and says in its summary how many times the screen's pixels the page had.
- **A smaller page does not count**: it is less work than the screen.
- **A virtual display does not count either.** The board can be tried over SSH with no
  display attached, by starting the kiosk's compositor without a screen
  (`WLR_BACKENDS=headless`): its GPU draws every frame and nothing is shown. The runner
  records it and the report says it is not the measurement. It is a first answer to
  whether Chromium draws with the GPU and about how fast, not the proof.
- **Forwarding the window to the PC (`ssh -X`) is not a way to measure**: the PC becomes
  the display, Chromium on the board draws with the processor, and the pictures go down
  the network.
- Nothing else about the criterion changes: on the ARM board, Chromium as a kiosk on a
  real display (not headless), 30 frames a second median with the best browser profile.

## Consequences

- R0 can be closed before the screen arrives.
- **A result below 30 on the monitor does not settle it**: the screen is less work. Then
  the run is repeated at the screen's own size (the scene unstretched in the middle of
  the monitor, which needs a small option in the page), or waits for the screen.
- What belongs to the panel itself is not measured here: whether the board's HDMI output
  holds the screen's 1024×600 mode, and its backlight. S6 sets the display's timings and
  S7 soaks on the real screen; R4 benchmarks on the device again.
- The 2 GB board settles the estimate's worry about memory: Chromium's 0.6 GB and the
  0.3 GB budgeted for simulation and server fit beside the system.
