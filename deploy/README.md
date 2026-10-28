# Deployment

OS notes, `setup.sh` for a fresh SD card, systemd units, kiosk, display timings,
backups, Tailscale, log rotation and SD-wear settings. Built in S6.

## Measuring the renderer on the device (R5; R0 before it)

**Starting from a board in its box: [`board-setup.md`](board-setup.md)**, which goes from
flashing the card to the result on the PC, without a keyboard on the board. What follows
is the procedure itself, for a board that already has a session on its screen.

The runner measures the real scene by default (R5): `index.html?bench` plays the
committed recordings in the desk's own build and runs nine scenarios, the four views
judged (`map`, `middle`, `middle-crowd`, `local`; ADR 0010) and what the atmosphere costs
(`night`, `rain`, `fire`, `apocalypse`, `shore`; `renderer/src/benchplan.ts`). The R0
spike's page is still there for R0's history: `--page spike.html` with the full build
(`npm run build`).

What the board needs: a graphical session on the 7" screen at 1024×600 (or a larger
monitor standing in for it, ADR 0008), Chromium
(`chromium` or `chromium-browser`), and Python 3.9 or newer. Nothing is installed by the
benchmark and nothing of the project needs to be on the board.

1. **On the PC**, build the desk's page and copy it over with the runner:

   ```sh
   cd renderer && npm ci && npm run build:kiosk && cd ..
   ssh <user>@<board> mkdir -p lineage-r5
   scp -r renderer/dist-kiosk tools/kiosk_bench.py <user>@<board>:lineage-r5/
   ```

   (For the R0 spike, `npm run build` and copy `renderer/dist` instead.)

2. **On the board**, from a terminal in its desktop session:

   ```sh
   cd ~/lineage-r5 && python3 kiosk_bench.py --dist dist-kiosk --fps-cap 30
   ```

   `--fps-cap 30` holds the scene at 30 frames a second, as the kiosk runs on the board
   (no fan; ADR 0022). Chromium has no flag that caps a page below the display's refresh
   (its flags only take the limit off: `--disable-gpu-vsync`, `--disable-frame-rate-limit`),
   so the runner asks the page (`?cap=30`), which drives its drawing from every other
   refresh of the 60 Hz screen (`renderer/src/framecap.ts`). Without it the scene draws
   at the refresh rate, which shows how much headroom there is above the cap.

   Over SSH the display has to be named: prefix the command with `DISPLAY=:0` (X11), or
   with `WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u)` (Wayland).

   Where there is no desktop, `lineage-r5@.service` runs it full screen under `cage`,
   from SSH: `sudo systemctl start lineage-r5@<user>` (see the unit's own comments);
   `lineage-r0@.service` the same for the spike, from `~/lineage-r0/`.

   With no display attached at all, `WLR_BACKENDS=headless cage -- python3 kiosk_bench.py
   …` runs it on a virtual one, the GPU drawing and nothing shown: a first answer, which
   the report marks as not the R0 measurement.

   The screen belongs to the benchmark for about eight minutes: one browser profile,
   `default`, a plain Chromium as the kiosk runs it (on the board every GPU profile draws
   through the same path, ANGLE on OpenGL ES with Panfrost; `--profiles gpu,gpu-gles`
   runs the others, as after a Chromium or Mesa update; the CPU's `software` only when
   named, since the CPU cannot draw the scene; `canvas` is the spike's only), ten
   scenarios (the four judged, the atmosphere's five, and a sim-day's turn; every other
   scenario is measured with the day held, as on the desk where it turns once a day, the
   recording being played 1800 times as fast; the owner, 2026-10-27), each 2 s of
   warm-up and 20 s measured (the spike 8 s), plus a few seconds for each scenario's page
   to load and the view it measures to be painted (on the board the local view's ground
   takes several seconds; the day's turn waits up to a sim-day, 48 s, for the next day):
   the scene loads itself again for every scenario, so the screen flashes between them. It prints a table per profile and writes `kiosk-bench.json`
   (rewritten after every profile, so an interrupted run keeps what it had) and one
   `chromium-<profile>.log` per profile. (The spike, `--page spike.html --dist dist`:
   five profiles, fourteen scenarios, about twenty minutes.)

3. **Back on the PC**, fetch the evidence:

   ```sh
   mkdir -p runs/r5-device && scp <user>@<board>:lineage-r5/kiosk-bench.json runs/r5-device/
   ```

   The table already says whether the four views hold the cap. Then build the report:

   ```sh
   uv run python -m tools.report R5 --runs runs/r5-device
   ```

   writes `reports/R5-device/` (`report.html`, `metrics.json`, `README.md`, and the
   evidence file itself, committed in place of `config.toml` since a PC cannot
   regenerate it). It judges the best profile: the four views hold the cap (R5.1, 30 fps
   median with 0.5 of slack), few frames over budget in them (R5.2), Chromium's peak
   memory (PSS) within the board's budget (R5.3), and the run made as specified (R5.4:
   the ARM board, kiosk on the 7" screen at 1024×600, the desk's build, `--fps-cap 30`).
   The atmosphere's scenarios, headroom, CPU, temperature and GPU hangs are reported
   without a band. A file from a PC builds a report marked as not the measurement: build
   it into a scratch directory (`--out /tmp/r5`), never into `reports/`.

   For the spike's file,
   `uv run python -m tools.report R0 --runs runs/r0-device` writes
   `reports/R0-renderer-spike/`, evidence file included; it passes when the best profile
   holds 30 fps median in each of the three views and the crowded middle one (ADR 0010);
   the result of 2026-10-18 is there.

Reading the table on the board:

- **fps med and 1% low** under a 30 fps cap read 30.0 and a little under when the scene
  holds it. **over %** is the share of frames that came later than 30 fps allows (more
  than 33.3 ms after the one before, give or take 2 ms): a frame that missed its refresh.
  The page's own results (`kiosk-bench.json`, `runs[].results.scenarios[]`) add the
  frame-time headroom (what the page's script leaves of the 33.3 ms, median and 99th
  percentile; the GPU's time is not in it), draw calls and sprites a frame, the JS heap,
  the animals in sight and the atmosphere's sprite counts.

- **"drawn by"** is the line that matters first. `WebGL on <a Mali driver>` means
  Chromium is using the GPU. `(software, on the CPU)` or `2D canvas … (WebGL was not
  available)` means it is not, whatever the frame rate says. Then open `chrome://gpu` on
  the board: it lists why. Whether the GPU is usable depends on the OS image's driver
  for it, which is the first thing to change if no profile gets it.
- **A profile that ends in `timeout` or `browser-exited`** left its reason in
  `chromium-<profile>.log`. `No usable sandbox` there means the run needs `--no-sandbox`
  (always the case as root).
- **Trying other flags** needs no edit: `--flags='--use-gl=egl'` adds them as one more
  profile named `custom`. `--profiles gpu --only middle-crowd,fire --seconds 5` narrows a
  run down while experimenting; the scene also takes `--only acceptance` (the four
  views) and `--only atmosphere`.
- **The GPU hanging** shows in the frame rate only as slow frames: the kernel kills a
  GPU job after half a second. The runner counts the kernel's `gpu sched timeout` lines
  before and after each profile (`gpu_timeouts` in the file, a line under the profile's
  table). Debian lets only root read the kernel log, so it tries `dmesg`, then
  `sudo -n dmesg` (no password asked); where neither works the count is not recorded and
  `sudo dmesg | grep -c "gpu sched timeout"` before and after a run does it by hand. On this board the spec scenes (a sprite in every cell)
  hang on every frame; the three views do not (ADR 0010).

To run the scene's benchmark by hand, serve the build (`python3 -m http.server
--directory dist-kiosk 8137`) and open `http://127.0.0.1:8137/index.html?bench&cap=30` in
the board's browser (`&only=fire&seconds=5`, …): it ends on a table of its results. The
desk's build without `?bench` waits for the server's stream (`ws://<host>/stream`, S1),
so it shows nothing yet. To look at the spike instead, serve `dist` and open
`http://127.0.0.1:8137/spike.html?demo=close-2x`; any scenario name works. Where there is no desktop, the same under
`cage`, as a one-off unit with the benchmark unit's settings, from SSH:

```sh
sudo systemctl stop getty@tty1
sudo systemd-run --unit lineage-demo --uid=lineage \
  -p PAMName=login -p TTYPath=/dev/tty1 -p TTYReset=yes -p TTYVHangup=yes \
  -p StandardInput=tty-fail -p StandardOutput=journal -p StandardError=journal \
  -p WorkingDirectory=/home/lineage/lineage-r0 -E XDG_SESSION_TYPE=wayland \
  /usr/bin/cage -s -- /bin/sh -c "python3 -m http.server -d dist 8137 >/dev/null 2>&1 & \
    sleep 2; exec chromium --kiosk --no-first-run 'http://127.0.0.1:8137/spike.html?demo=mid-view'"
# and to end it:
sudo systemctl stop lineage-demo; sudo systemctl start getty@tty1
```

Left running, the board out of any enclosure creeps towards 80 °C, where it slows itself down
(`/sys/class/thermal/thermal_zone*/temp`, in thousandths of a degree): the enclosure
needs a heatsink at least.

## The showcase on the board (R6)

The showcase is a scripted tour of the scene, about three minutes in thirteen acts with a
caption each (`renderer/src/showcase/`), in the desk's own build: it loops without
reloading, with a frame counter in the top-right corner, so it shows how the board runs
the scene over time, the ground painted and kept in the browser's storage from one run to
the next (the browser's profile is kept in `~/.lineage-showcase`).

1. **On the PC**, build the desk's page and copy it over with the runner and its unit:

   ```sh
   cd renderer && npm run build:kiosk && cd ..
   scp -r renderer/dist-kiosk tools/kiosk_bench.py tools/showcase.py \
     deploy/lineage-showcase@.service deploy/showcase.sh <user>@<board>:lineage-r5/
   ```

2. **On the board**, once: `sudo cp ~/lineage-r5/lineage-showcase@.service
   /etc/systemd/system/ && sudo systemctl daemon-reload`. Then, from SSH:

   ```sh
   cd ~/lineage-r5 && ./showcase.sh
   ```

   It takes the screen and prints a line every 30 s (loop, act, frames a second, frames
   late, temperature). **Ctrl+C** stops it and prints the summary: frames a second
   (average, median, 1 % low), frames late overall, by act and by loop, the peak memory,
   the peak temperature and GPU hangs; it is also left in `showcase-summary.txt`, and the
   lines in `showcase.log`. From the board's own console, `cage -s -- python3 showcase.py
   --dist dist-kiosk` does the same in the foreground.

The first loop after a new build paints the ground of every place the tour visits (the
stamps of what is kept carry the build's commit); the tour waits in the dark at a cut
until its ground is painted, and paints the next place's ground while the current act
plays. Later loops, and later runs of the same build, take it from the storage.

## The island in real time on the board (S1)

The server (`lineage_server`, ADR 0023) on the board, with the desk's kiosk drawing from
it, measured against the device's budgets (CLAUDE.md §4.8). From the PC, at the
repository's root, with the board on the network:

1. An island to start from, a year old today (once; 1 minute):
   ```sh
   uv run python -m tools.fastforward --years 1 --seeds 1 --seed-base 3 \
     --start <today, a year ago> --schedule office --save-days 30 --snapshot-days 0 \
     --out runs/s1-board-island
   ```
2. Set the board up (environment, the desk's build, configs, the island, the units; sudo
   asks for the board's password):
   ```sh
   deploy/s1-board.sh setup lineage@<board>
   ```
   This needs `python3-venv` on the board (`sudo apt install python3-venv`) and the
   network: `uv` goes into `~/.lineage-uv` (from PyPI), and brings the project's Python
   3.11 (the board's own is Debian's 3.13), numpy and websockets.
3. Start the server, then the kiosk on the screen:
   ```sh
   deploy/s1-board.sh start lineage@<board>
   ```
   The server catches up from the island's save to now (its first status line gives the
   board's CPU per sim-day) and saves; the screen shows the map.
4. Watch it for a few hours, a UTC midnight in the window if possible (the daily save and
   the plants' day):
   ```sh
   uv run python -m tools.server_watch http://<board>:8080 --minutes 180 \
     --out runs/s1-board/status.jsonl
   ```
   It ends with each budget's verdict: the sim's share of one core (≤ 0.25), the longest
   save (≤ 2 s), the server's memory (≤ 300 MB); `runs/s1-board/status.summary.json` holds
   the numbers for ADR 0023.
5. Stop (a save):
   ```sh
   deploy/s1-board.sh stop lineage@<board>
   ```

To try the device by hand, `ssh -t lineage@<board>`, stop the unit, and run the server in
`~/lineage` from the shell as the unit's `ExecStart` does: keys typed there play the
device (`p`, `g`, `v`, `l`, `r`).
