"""Run the showcase on the board and say how it ran (R5).

The showcase (``renderer/src/showcase/``) is a scripted tour of the scene in the desk's own
build, looping without reloading, with a frame counter in the top-right corner. This
serves the build, opens it full screen in Chromium with a profile that is kept between
runs (so the ground painted and kept in the browser's storage is there the next time, as
on the desk), and gathers what the page reports of its frames and what /proc says of
the browser. Every 30 s it prints a line; on Ctrl+C (or when its service is stopped) it
prints the summary: frames a second, frames late, by act and by loop, memory and
temperature, and writes it to ``showcase-summary.txt`` beside itself.

Standard library only, beside ``kiosk_bench.py``, whose server, browser and sampling it
uses: copy both to the board. Run it in the board's desktop session, or under ``cage``
(``deploy/lineage-showcase@.service``; ``deploy/showcase.sh`` starts it from SSH and
prints the summary on Ctrl+C).
"""

from __future__ import annotations

import argparse
import math
import os
import queue
import signal
import statistics
import subprocess
import sys
import tempfile
import time
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

try:
    from tools import kiosk_bench as kb
except ImportError:  # on the board, the two files side by side
    import kiosk_bench as kb  # type: ignore[no-redef]

# The acts of the showcase's script, by index (renderer/src/showcase/script.ts, `ACTS`).
ACTS = (
    "title",
    "world",
    "creatures",
    "life",
    "family",
    "rare",
    "seasons",
    "weather",
    "night",
    "powers",
    "chronicle",
    "end",
    "card",
)
# A frame later than this (ms) came late: at the 30 fps cap frames come every 33.3 ms.
LATE_MS = 40.0
# Sim-seconds to a wall second the recording plays at (animals living at a gentle pace).
SPEED = 120
# Seconds between two status lines, and between two samples of /proc.
STATUS_EVERY_S = 30.0
SAMPLE_EVERY_S = 2.0
# The page's report name (renderer/src/showcase/meter.ts, `FrameReport.tool`).
REPORT_TOOL = "lineage-showcase"
# Where the browser's profile is kept between runs (the cache with it).
PROFILE_DIR = Path.home() / ".lineage-showcase"


@dataclass
class Frames:
    """Frame intervals (ms), all of them and by act and loop."""

    all: list[float] = field(default_factory=list[float])
    by_act: dict[int, list[float]] = field(default_factory=dict[int, list[float]])
    by_loop: dict[int, list[float]] = field(default_factory=dict[int, list[float]])
    heap_mb: float | None = None
    last_t: float = 0.0
    last_act: int = 0
    last_loop: int = 0

    def take(self, report: dict[str, Any]) -> None:
        """Add a report of the page's (`FrameReport`)."""
        loop = int(report.get("loop", 0))
        for act, interval in report.get("frames", []):
            self.all.append(float(interval))
            self.by_act.setdefault(int(act), []).append(float(interval))
            self.by_loop.setdefault(loop, []).append(float(interval))
            self.last_act = int(act)
        self.last_loop = loop
        self.last_t = float(report.get("t", self.last_t))
        if report.get("heap_mb") is not None:
            self.heap_mb = float(report["heap_mb"])


def fps_of(intervals: Sequence[float]) -> dict[str, float]:
    """Frames a second over `intervals` (ms): average, median, 1 % low; and the share late."""
    if not intervals:
        return {"average": 0.0, "median": 0.0, "low": 0.0, "late_pct": 0.0}
    total = sum(intervals)
    ordered = sorted(intervals)
    p99 = ordered[min(len(ordered) - 1, math.ceil(0.99 * len(ordered)) - 1)]
    late = sum(1 for interval in intervals if interval > LATE_MS)
    return {
        "average": 1000.0 * len(intervals) / total if total > 0 else 0.0,
        "median": 1000.0 / statistics.median(intervals),
        "low": 1000.0 / p99 if p99 > 0 else 0.0,
        "late_pct": 100.0 * late / len(intervals),
    }


def status_line(frames: Frames, temperature_c: float | None) -> str:
    """One line on how it runs now: the last loop and act, and the frames so far."""
    recent = frames.all[-300:]
    now = fps_of(recent)
    act = ACTS[frames.last_act] if 0 <= frames.last_act < len(ACTS) else "?"
    heat = "" if temperature_c is None else f", {temperature_c:.0f} °C"
    return (
        f"loop {frames.last_loop + 1}, {act}: {now['average']:.1f} fps, "
        f"{now['late_pct']:.1f} % late (last {len(recent)} frames){heat}"
    )


def summary(
    frames: Frames,
    wall_s: float,
    samples: Sequence[kb.Sample],
    gpu_hangs: int | None,
) -> list[str]:
    """The lines printed when the showcase stops."""
    minutes, seconds = divmod(int(wall_s), 60)
    loops = (frames.last_loop + 1) if frames.all else 0
    lines = [f"showcase: {minutes} min {seconds:02d} s, {loops} loop(s), {len(frames.all)} frames"]
    overall = fps_of(frames.all)
    lines.append(
        f"fps: {overall['average']:.1f} average, {overall['median']:.1f} median, "
        f"{overall['low']:.1f} 1%-low; late frames (> {LATE_MS:.0f} ms) {overall['late_pct']:.1f} %"
    )
    by_act = [
        f"{ACTS[act] if act < len(ACTS) else act} {fps_of(intervals)['late_pct']:.1f} %"
        for act, intervals in sorted(frames.by_act.items())
    ]
    if by_act:
        lines.append("late by act: " + " · ".join(by_act))
    by_loop = [
        f"{loop + 1}: {fps_of(intervals)['average']:.1f} fps, {fps_of(intervals)['late_pct']:.1f} %"
        for loop, intervals in sorted(frames.by_loop.items())
    ]
    if by_loop:
        lines.append("by loop: " + " · ".join(by_loop))
    pss = [s.pss_kb / 1024 for s in samples if s.pss_kb is not None]
    rss = [s.rss_kb / 1024 for s in samples]
    heat = [s.temperature_c for s in samples if s.temperature_c is not None]
    memory = (
        f"memory {max(pss):.0f} MB peak (PSS)"
        if pss
        else (f"memory {max(rss):.0f} MB peak (RSS)" if rss else "memory not sampled")
    )
    if pss and len(pss) >= 2:
        memory += f", first {pss[0]:.0f} MB, last {pss[-1]:.0f} MB"
    if frames.heap_mb is not None:
        memory += f"; the page's heap {frames.heap_mb:.0f} MB"
    lines.append(memory)
    extra = [f"{max(heat):.0f} °C peak" if heat else "temperature not read"]
    extra.append("GPU hangs: not read" if gpu_hangs is None else f"GPU hangs {gpu_hangs}")
    lines.append(" · ".join(extra))
    return lines


def page_url(port: int, fps_cap: float | None) -> str:
    query = {"showcase": "1", "quiet": "1", "speed": str(SPEED), "fps": "1", "post": "/results"}
    if fps_cap:
        query["cap"] = f"{fps_cap:g}"
    return f"http://127.0.0.1:{port}/index.html?{urlencode(query)}"


def drain(inbox: queue.Queue[dict[str, Any]], frames: Frames) -> None:
    while True:
        try:
            report = inbox.get_nowait()
        except queue.Empty:
            return
        if report.get("tool") == REPORT_TOOL:
            frames.take(report)


def write_lines(lines: Iterable[str], path: Path | None) -> None:
    text = "\n".join(lines)
    print(text, flush=True)
    if path is not None:
        path.write_text(text + "\n", encoding="utf-8")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=(__doc__ or "").split("\n\n")[0])
    parser.add_argument("--dist", required=True, help="the desk's build (npm run build:kiosk)")
    parser.add_argument("--fps-cap", type=float, default=30.0, help="as the kiosk (0: none)")
    parser.add_argument("--browser", help="Chromium binary (default: first found on PATH)")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--profile", type=Path, default=PROFILE_DIR, help="kept between runs")
    parser.add_argument("--fresh", action="store_true", help="a new profile: nothing kept")
    parser.add_argument("--summary", type=Path, default=Path("showcase-summary.txt"))
    parser.add_argument("--no-sandbox", action="store_true")
    args = parser.parse_args(argv)
    browser = kb.find_browser(args.browser)
    if browser is None:
        parser.error("no Chromium found; install it or pass --browser")
    if not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        parser.error("no display: run inside the desktop session or under cage")
    dist = Path(args.dist)
    if not (dist / "index.html").exists():
        parser.error(f"{dist} holds no index.html (npm run build:kiosk)")
    profile_dir = Path(tempfile.mkdtemp(prefix="lineage-showcase-")) if args.fresh else args.profile
    profile_dir.mkdir(parents=True, exist_ok=True)

    server, inbox = kb.serve(dist, args.port)
    port = server.server_address[1]
    plain = kb.Profile("default", "Chromium as a plain kiosk starts it")
    sandbox = not (args.no_sandbox or (hasattr(os, "geteuid") and os.geteuid() == 0))
    command = kb.browser_command(
        browser,
        plain,
        page_url(port, args.fps_cap or None),
        profile_dir,
        headless=False,
        window=(1024, 600),
        sandbox=sandbox,
    )
    hangs_before = kb.count_gpu_timeouts(kb.kernel_log())
    started = time.monotonic()
    process = subprocess.Popen(
        command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True
    )
    sampler = kb.Sampler(process.pid)
    frames = Frames()
    stopping = False

    def stop_now(signum: int, _frame: Any) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGINT, stop_now)
    signal.signal(signal.SIGTERM, stop_now)
    print(f"showcase: {dist} on Chromium, profile {profile_dir}; Ctrl+C to stop", flush=True)
    next_sample = next_status = time.monotonic()
    try:
        while not stopping and process.poll() is None:
            drain(inbox, frames)
            now = time.monotonic()
            if now >= next_sample:
                sampler.sample()
                next_sample = now + SAMPLE_EVERY_S
            if now >= next_status and now - started > 5:
                temperature = sampler.samples[-1].temperature_c if sampler.samples else None
                print(status_line(frames, temperature), flush=True)
                next_status = now + STATUS_EVERY_S
            time.sleep(0.2)
    finally:
        drain(inbox, frames)
        kb.stop(process)
        server.shutdown()
    hangs_after = kb.count_gpu_timeouts(kb.kernel_log())
    hangs = (
        max(hangs_after - hangs_before, 0)
        if hangs_before is not None and hangs_after is not None
        else None
    )
    write_lines(summary(frames, time.monotonic() - started, sampler.samples, hangs), args.summary)
    return 0


if __name__ == "__main__":
    sys.exit(main())
