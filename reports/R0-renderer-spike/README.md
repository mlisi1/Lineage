# R0 — Renderer spike on the device

Measured on OrangePi Zero 2W (aarch64) with Chromium 155.0.8059.79 built on Debian GNU/Linux 13 (trixie), 2026-10-18T08:49:57+00:00: 5 browser profiles × 14 scenarios, 8 s each, renderer build `dad22097855f`. Best profile: `gpu-gles`, drawn by WebGL on ANGLE (Mesa, Mali-G31 (Panfrost), OpenGL ES 3.1). **On a stand-in display:** the page was 2560×1440, 6.0 times the pixels of the 1024×600 screen: at least as hard to draw.

- **PASS** R0.1: Measured as specified: on the ARM board, Chromium kiosk on a display, the page 1024×600 or larger (1 = yes) (measured 1, target ≥ 1)
- **PASS** R0.2: Median frame rate of map-view (the map view: the whole island, every creature a dot) with the best browser profile (fps) (measured 59.52, target ≥ 30)
- **PASS** R0.3: Median frame rate of mid-view (the middle view: a region, its plants, 50 creatures) with the best browser profile (fps) (measured 59.52, target ≥ 30)
- **PASS** R0.4: Median frame rate of mid-crowd (the middle view with every creature the sim can hold) with the best browser profile (fps) (measured 30.03, target ≥ 30)
- **PASS** R0.5: Median frame rate of local-view (the local view: the camera on one creature) with the best browser profile (fps) (measured 59.88, target ≥ 30)

See `report.html` for figures and `metrics.json` for every number.
