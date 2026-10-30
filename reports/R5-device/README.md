# R5 — Final rendering pass: the scene measured on the device

Measured on OrangePi Zero 2W (aarch64) with Chromium 155.0.8059.79 built on Debian GNU/Linux 13 (trixie), 2026-10-30T12:53:50+00:00: 1 browser profiles × 11 scenarios, 20 s each, capped at 30 fps, renderer build `7d9c34cdced5` (kiosk). Best profile: `default`, drawn by WebGL on ANGLE (Mesa, Mali-G31 (Panfrost), OpenGL ES 3.1); GPU hangs: 0.

- **PASS** R5.1: Lowest median frame rate among map, middle, middle-crowd, local with the best browser profile: the 30 fps cap held (0.5 fps of slack for the display's timing) (fps) (measured 29.94, target ≥ 29.5)
- **FAIL** R5.2: Most frames over the 33.3 ms budget in any of map, middle, middle-crowd, local with the best browser profile (%; band ≤ 5, the owner's) (measured 5.106, target ≤ 5)
- **PASS** R5.3: Peak memory of Chromium's processes (PSS) over the best profile's run, within the board's budget (MB; band ≤ 800, the owner's, 2026-10-23) (measured 735.3, target ≤ 800)
- **PASS** R5.4: Measured as specified: on the ARM board, Chromium kiosk on the 7″ screen at 1024×600, the desk's build capped at 30 fps (1 = yes) (measured 1, target ≥ 1)

See `report.html` for figures and `metrics.json` for every number.
