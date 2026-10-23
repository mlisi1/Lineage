# Setting up the Orange Pi Zero 2W for the R0 measurement

From a board in its box to `kiosk-bench.json` on the PC. About an hour, most of it
waiting.

**This has not been run on the board yet.** It is put together from Armbian's
documentation and from forum reports, as of 2026-10-11. Every step says what you should
see; where you see something else, stop there and note what it was. The first real run
corrects this page, and S6 turns it into `setup.sh`.

## What needs what

| | Steps 1–7: install, check, a first answer | Steps 8–10: measure |
|---|---|---|
| microSD card (8 GB or more), reader, the PC | yes | |
| USB-C supply, 5 V 3 A | yes | yes |
| Wi-Fi the board and the PC are both on | yes | yes |
| **A display on the board's mini-HDMI port** | no | **yes** |
| USB keyboard on the board | no | no |

A display is not needed to set the board up, nor for a first answer: step 7 runs the
benchmark over SSH on a display that is not there, with the board's GPU doing the
drawing. It is needed for the measurement that closes R0: frames shown on a screen.

**Which display.** The 7" screen, or until it is bought any HDMI monitor at its own
resolution. The scene is drawn at the same size and stretched to the page, so a larger
display is at least as hard on the board as the screen will be; the report counts such a
run and says what it was made on ([ADR 0008](../docs/decisions/0008-r0-on-a-stand-in-display.md)).
A result under 30 frames a second on a monitor does not settle it, the screen being less
work.

**How it connects.** Mini HDMI is the board's only output for a display. Its two USB-C
ports are USB 2.0 and carry no video, so one of these is needed, whatever the display: a
mini-HDMI to HDMI adapter, or a mini-HDMI to HDMI cable. **Power it from the USB-C port
next to the mini HDMI.** Powered from the other one, the board does not boot from the
card (see "If it does not work").

## 1. Flash Armbian

Image: **Armbian, Debian 13 "trixie", Minimal (CLI)** for the Orange Pi Zero 2W, from
<https://www.armbian.com/boards/orangepizero2w> (kernel 6.18 at the time of writing).

Why this one:

- **Debian, not the Ubuntu desktop image.** On Debian Chromium is an ordinary package. On
  Ubuntu it is a snap, which keeps its files and its access to the GPU in a sandbox of its
  own that the benchmark runner has never been tried against.
- **Minimal.** Nothing runs but what is added here, as on the finished gadget.
- **A recent kernel.** The open driver for this board's GPU (Panfrost, for the Mali-G31)
  is reported fixed for it from 6.12 on. That report is a maintainer's and nobody
  confirmed it in the thread, so step 5 checks it.

The board is community-maintained in Armbian, not officially supported. If this image
does not boot or shows no picture, see "If it does not work" at the end.

Take a stable build, not a "trunk" one: the Imager offers both, and trunk builds are
nightly. Flash it with Armbian Imager (<https://imager.armbian.com>), or by hand:

```sh
lsblk                                   # find the card: its size gives it away, e.g. /dev/sdb
xz -dc Armbian_*_Orangepizero2w_trixie_current_*_minimal.img.xz \
  | sudo dd of=/dev/sdX bs=4M conv=fsync status=progress
```

Writing to the wrong `/dev/sdX` destroys that disk. Check twice.

If the Imager offers to set up the network, choose DHCP, not a static address. A static
address left empty there is written to the board as `- /0`: the Wi-Fi never comes up and
the first boot never finishes.

## 2. Give it the Wi-Fi before it first boots

The board has no Ethernet, so without a screen it has to know the Wi-Fi from its first
boot. Armbian reads presets from a file on the card. Take the card out and put it back in
so the PC mounts it, then:

```sh
lsblk -o NAME,SIZE,MOUNTPOINT            # the card's partition, e.g. /dev/sdb1
sudo mount /dev/sdX1 /mnt                # skip if the desktop mounted it; use that path
sudo tee /mnt/root/.not_logged_in_yet >/dev/null <<'EOF'
PRESET_NET_CHANGE_DEFAULTS="1"
PRESET_NET_WIFI_ENABLED="1"
PRESET_NET_WIFI_SSID="your network's name"
PRESET_NET_WIFI_KEY="its password"
PRESET_NET_WIFI_COUNTRYCODE="GB"
PRESET_LOCALE="en_US.UTF-8"
PRESET_TIMEZONE="Etc/UTC"
PRESET_ROOT_PASSWORD="a root password"
PRESET_USER_NAME="lineage"
PRESET_USER_PASSWORD="a password"
PRESET_DEFAULT_REALNAME="Lineage"
PRESET_USER_SHELL="bash"
EOF
sudo umount /mnt
```

Set the country code (two letters, for the Wi-Fi's channels) and the timezone (as in
`timedatectl list-timezones`) to yours; leave the locale as it is (a guide for these
boards reports that changing it breaks the creation of the user). The passwords
sit on the card in plain text until the first boot has used them.

Put the card in the board and power it from the USB-C port next to the mini HDMI. The
first boot grows the filesystem and takes two
or three minutes. Find the board's address in the router's list of devices (it calls
itself `orangepizero2w`), then:

```sh
ssh lineage@<address>
```

**You should see** a login banner naming Armbian and the board.

If it never appears on the network (one forum report has the presets ignored on another
board): connect the screen and a keyboard, log in as `root` with password `1234`, and
answer the questions; it asks for the Wi-Fi among them.

## 3. Update and install

```sh
sudo apt update && sudo apt full-upgrade -y
sudo apt install -y --no-install-recommends \
  chromium cage python3 kmscube mesa-utils fonts-dejavu-core
sudo reboot
```

- `chromium`: the browser the kiosk will run.
- `cage`: a Wayland compositor that shows one application full screen and nothing else,
  which is what a kiosk is.
- `kmscube`, `mesa-utils`: to see what draws, in step 8.

The benchmark needs Python 3.9 or newer and nothing else. (Trixie has 3.13. The project's
own 3.11 comes with `uv` when the server goes on the board, in S6.)

## 4. Note what the board is

```sh
tr -d '\0' </proc/device-tree/model; echo
free -h | sed -n 2p
uname -r
cat /sys/class/thermal/thermal_zone*/temp
```

**You should see** `OrangePi Zero 2W`, the memory (about 0.9, 1.9 or 3.8 GB), a kernel
6.12 or newer, and temperatures in thousandths of a degree (`45000` is 45 °C).

The memory matters: Chromium takes about 0.6 GB, and the simulation and server are
budgeted 0.3 GB beside it. On the 1 GB board that leaves nothing; on the 2 GB one it
fits.

## 5. Is the GPU driver there?

No screen needed.

```sh
sudo dmesg | grep -i -E 'panfrost|mali'
ls /dev/dri
```

**You should see** lines like `panfrost 1800000.gpu: mali-g31 id 0x7093` and
`Initialized panfrost`, and `renderD128` among the files.

If `dmesg` shows nothing, this kernel has the GPU switched off for the board. Stop and
send the output of those two commands and of `uname -r`: the cure is a device-tree
overlay and depends on the exact image.

A loaded driver is half of it. One forum report has Panfrost loaded and OpenGL still
drawn by the processor (`llvmpipe`); the benchmark tells, in step 7.

## 6. Copy the benchmark over

(This guide is R0's, the spike's page. The scene's benchmark, R5, goes the same way with
the desk's build, `--fps-cap 30` and `lineage-r5@.service`: see [`README.md`](README.md).)

On the PC, in the repository:

```sh
cd renderer && npm ci && npm run build && cd ..
ssh lineage@<address> mkdir -p lineage-r0
scp -r renderer/dist tools/kiosk_bench.py deploy/lineage-r0@.service lineage@<address>:lineage-r0/
```

## 7. A first answer without a display

The board can be tried before it has a display. `cage` is started with a display that is
not there: the GPU draws every frame as it would for a screen, and nothing shows it. It
answers what everything hangs on, whether Chromium draws with the GPU on this board and
about how fast. The report does not take it for the R0 measurement, and says why.

On the board, over SSH:

```sh
groups | grep -qw render || sudo usermod -aG render,video "$USER"   # then log out and in
cd ~/lineage-r0
WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 \
  cage -- python3 kiosk_bench.py --dist dist --page spike.html --out kiosk-bench-virtual.json \
  --profiles default,gpu,gpu-gles --only spec-1x,mid-view,mid-crowd,local-view
```

**You should see**, after half a minute, a table per browser profile in the terminal;
the whole takes about three minutes. Under each table the line **"drawn by"** is the
answer:

- `WebGL on … Mali-G31 (Panfrost)`: Chromium is using the GPU. This is the case R0 can
  pass in, and the frame rates beside it are close to what a screen will get.
- `(software, on the CPU)`, or a renderer named `llvmpipe` or `SwiftShader`: it is not,
  whatever the frame rate says.
- `2D canvas … (WebGL was not available)`: no WebGL at all.

The display that is not there is 1280×720. To see the result as a report, on the PC:

```sh
mkdir -p runs/r0-virtual
scp 'lineage@<address>:lineage-r0/kiosk-bench-virtual.json' 'lineage@<address>:lineage-r0/chromium-*.log' runs/r0-virtual/
uv run python -m tools.report R0 --runs runs/r0-virtual/kiosk-bench-virtual.json --out runs/r0-virtual
```

It lands in `runs/`, which is not committed, and its first line says it is not the R0
measurement.

If `cage` stops with an error naming EGL, GLES or the renderer, the compositor itself
could not use the GPU: keep the lines. Adding `WLR_RENDERER=pixman` in front makes it
draw with the processor, which shows whether the rest works.

**Why not `ssh -X`.** Forwarding the browser's window to the PC makes the PC the
display, and with it goes what is being measured. The board's GPU can only draw for a
display of its own; for a window on another machine Chromium draws with the processor
and sends the pictures down the network. The numbers would be those of the processor
and of the Wi-Fi.

## 8. Connect the display and look

Power the board off (`sudo poweroff`), connect the display to its mini-HDMI port, power
both.

```sh
cat /sys/class/drm/card*-HDMI-A-1/status
head -3 /sys/class/drm/card*-HDMI-A-1/modes
```

**You should see** `connected`, the display's own resolution as the first mode
(`1920x1080` on a monitor set to that, `1024x600` on the 7" screen), and the console's
text on the display. On a monitor, leave the mode as it is.

If the 7" screen is dark or its first mode is another one, force it: in
`/boot/armbianEnv.txt` add the line `extraargs=video=HDMI-A-1:1024x600@60`, reboot, and
look again. (The usual remedy for small HDMI panels; not tried with this one.)

Then what draws:

```sh
sudo timeout 8 kmscube 2>&1 | grep -E 'vendor|renderer'
```

**You should see** a spinning cube on the display for eight seconds, and a line
`renderer: "Mali-G31 (Panfrost)"`. `llvmpipe` in its place means the processor is
drawing: note it and go on, the benchmark will say the same with numbers.

## 9. Run it

On the board:

```sh
sudo cp ~/lineage-r0/lineage-r0@.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl start lineage-r0@lineage
sudo journalctl -fu lineage-r0@lineage
```

The unit gives `cage` a session on the board's console and runs the benchmark in it, so
it works from SSH with no keyboard on the board. (With a keyboard, logged in on the
board's own console, `cd ~/lineage-r0 && cage -s -- python3 kiosk_bench.py --dist dist --page spike.html`
does the same.)

**You should see** the scene on the screen within half a minute, changing every ten
seconds, and in the journal a table per browser profile. It takes about twenty minutes:
five profiles, fourteen scenarios each, 2 s of warm-up and 8 s measured per scenario.
Leave the board alone meanwhile. `Ctrl-C` leaves the journal; the run goes on.

When it has finished, the screen goes dark. `sudo systemctl start getty@tty1` brings the
console back.

While it runs, the first thing to read is the line **"drawn by"** under each profile, as
in step 7.

If the unit stops at once: `sudo journalctl -u lineage-r0@lineage -n 40` says why. The likely
ones are no screen connected (`cage` has no output to show on), and `No usable sandbox`
in `chromium-<profile>.log` (add `--no-sandbox` to the unit's `ExecStart` line).

The board gets hot. If the temperature column in the tables passes 80 °C the processor is
slowing itself down and the numbers are a hot board's: put a heatsink on it and run again.

## 10. Bring the result back

On the PC:

```sh
mkdir -p runs/r0-device
scp 'lineage@<address>:lineage-r0/kiosk-bench.json' 'lineage@<address>:lineage-r0/chromium-*.log' runs/r0-device/
uv run python -m tools.report R0 --runs runs/r0-device
```

This writes `reports/R0-renderer-spike/`, with the evidence file in it. The report
passes only if the run was on the board, on a display, with the page 1024×600 or larger,
and the best profile reaches 30 frames a second in each of the three views and the
crowded middle one (ADR 0010). On a monitor
it says so, and how many times the screen's pixels it had to fill.

## If it does not work

In the order they are likely:

- **The board boots, but not from the card**: on a serial console or screen, lines such
  as `RootDevice is /dev/mtdblock4`, `Try to load Nor` and a failed mount. It started
  from its SPI flash, which happens when it is powered from the wrong USB-C port. Power
  it from the one next to the mini HDMI, then check the supply and the card before
  suspecting the image.
- **The first boot never finishes** (no `lineage` user, the preset file still on the
  card, tty1 saying "First login setup is already running on another console"): a
  network preset it could not apply, such as the Imager's static address left empty.
  Logs live in RAM and are gone after a power cut, so look on the console while it runs.

- **No profile uses the GPU, though step 5 found the driver.** Try other flags without
  editing anything: end the command of step 7 (or the unit's `ExecStart` line) with
  `--profiles gpu --only mid-view --seconds 5 --flags='--use-gl=egl'` (or
  `--use-angle=gles`), which takes a minute a try. Keep the `chromium-*.log` files:
  the lines with `GPU` or `EGL` in them say what Chromium refused.
- **No picture on the screen at all.** HDMI on this chip is not in the mainline kernel;
  Armbian carries it as patches. If the Armbian image shows nothing on a monitor that
  works with another computer, the image is at fault, not the screen.
- **The image does not boot** (no Wi-Fi after ten minutes, nothing on a screen). An
  Armbian thread from April 2025 has a newer kernel failing to boot on this board where
  the image for the Orange Pi Zero 3 did.
- **For the last two, the vendor's image is the other road**: Orange Pi's own Debian for
  the board (from orangepi.org; named like `Orangepizero2w_1.0.x_debian_bookworm_…`),
  where a forum user reports the GPU can be switched on in `orangepi-config` and works
  well, and an article from 2024 says the open driver does not load. Steps 3 to 10 are
  the same there; the vendor's images come with a user `orangepi` already made.
- **The GPU is used and it is under 30 frames a second**, or nothing gets it used: that
  is R0's answer, and the next thing is the decision note on a native renderer.

## What to send back

`kiosk-bench.json` (or `kiosk-bench-virtual.json` from step 7), the `chromium-*.log`
files, and what steps 4, 5 and 8 printed.

## Sources

- Images and support status: <https://www.armbian.com/boards/orangepizero2w>
- First-boot presets: <https://docs.armbian.com/user-guide/autoconfig/>
- GPU on this board, kernels 6.6 to 6.13: <https://forum.armbian.com/topic/50904-orange-pi-zero2w-allwinner-h618-no-gpusound-support/>
- Panfrost loaded but OpenGL in software: <https://dietpi.com/forum/t/cant-enable-gpu-acceleration-on-orangepi-zero2w/24060>
- The same chip with Panfrost on kernel 6.18, and HDMI as Armbian patches: <https://github.com/giltal/Retro-OrangePI-Zero-3>
- The vendor's images in 2024: <https://plati.ma/orange-pi-zero-2w/>
