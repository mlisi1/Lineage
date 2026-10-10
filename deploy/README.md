# Deployment

OS notes, `setup.sh` for a fresh SD card, systemd units, kiosk, display timings,
backups, Tailscale, log rotation and SD-wear settings. Built in S6.

## Measuring the renderer spike on the device (R0)

What the board needs: its desktop session running on the 7" screen at 1024×600,
Chromium (`chromium` or `chromium-browser`), and Python 3.9 or newer. Nothing is
installed by the benchmark and nothing of the project needs to be on the board.

1. **On the PC**, build the page and copy it over with the runner:

   ```sh
   cd renderer && npm ci && npm run build && cd ..
   scp -r renderer/dist tools/kiosk_bench.py <user>@<board>:lineage-r0/
   ```

2. **On the board**, from a terminal in its desktop session:

   ```sh
   cd ~/lineage-r0 && python3 kiosk_bench.py --dist dist
   ```

   Over SSH the display has to be named: prefix the command with `DISPLAY=:0` (X11), or
   with `WAYLAND_DISPLAY=wayland-0 XDG_RUNTIME_DIR=/run/user/$(id -u)` (Wayland).

   The screen belongs to the benchmark for about eight minutes: five browser profiles,
   eight scenarios each, 2 s of warm-up and 8 s measured per scenario. It prints a table
   per profile and writes `kiosk-bench.json` (rewritten after every profile, so an
   interrupted run keeps what it had) and one `chromium-<profile>.log` per profile.

3. **Back on the PC**, build the report:

   ```sh
   mkdir -p runs/r0-device && scp <user>@<board>:lineage-r0/kiosk-bench.json runs/r0-device/
   uv run python -m tools.report R0 --runs runs/r0-device
   ```

   This writes `reports/R0-renderer-spike/`, evidence file included.

Reading the table on the board:

- **"drawn by"** is the line that matters first. `WebGL on <a Mali driver>` means
  Chromium is using the GPU. `(software, on the CPU)` or `2D canvas … (WebGL was not
  available)` means it is not, whatever the frame rate says. Then open `chrome://gpu` on
  the board: it lists why. Whether the GPU is usable depends on the OS image's driver
  for it, which is the first thing to change if no profile gets it.
- **A profile that ends in `timeout` or `browser-exited`** left its reason in
  `chromium-<profile>.log`. `No usable sandbox` there means the run needs `--no-sandbox`
  (always the case as root).
- **Trying other flags** needs no edit: `--flags='--use-gl=egl'` adds them as one more
  profile named `custom`. `--profiles gpu --only spec-1x,map-1x --seconds 5` narrows a
  run down while experimenting.

To look at the scene instead of measuring it, serve `dist` (`python3 -m http.server
--directory dist 8137`) and open `http://127.0.0.1:8137/spike.html?demo=close-2x` in the
board's browser; any scenario name works.
