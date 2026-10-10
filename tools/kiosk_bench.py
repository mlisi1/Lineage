#!/usr/bin/env python3
"""Run a renderer benchmark page in Chromium on the device and measure what it costs.

Standard library only, so it runs on the device as a single copied file::

    python3 kiosk_bench.py --dist dist                 # on the Orange Pi, in its desktop session
    uv run python -m tools.kiosk_bench --dist renderer/dist --headless   # on a PC, to try it

For each browser-flag profile it serves ``dist`` on localhost, opens the page in Chromium
(kiosk mode, 1024×600), waits for the page to POST its results, and meanwhile samples the
CPU time and memory of every Chromium process from ``/proc``. Everything goes into one
JSON file: the page's own numbers (frame rate per scenario, GPU driver in use) plus CPU,
RAM and temperature per scenario.

Profiles differ only in Chromium flags (and, for ``canvas``, the page's drawing backend),
because whether Chromium uses the GPU on an ARM board depends on them:

- ``default``   what a plain kiosk gets
- ``gpu``       ignore the GPU blocklist, rasterise on the GPU
- ``gpu-gles``  the same, talking to the driver through OpenGL ES
- ``software``  WebGL drawn by the CPU (SwiftShader): the fallback if no GPU path works
- ``canvas``    PixiJS drawing with the 2D canvas instead of WebGL
"""

from __future__ import annotations

import argparse
import contextlib
import json
import os
import queue
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

TOOL = "lineage-kiosk-bench"
VERSION = 1
DEFAULT_PORT = 8137
BROWSERS = ("chromium-browser", "chromium", "google-chrome", "google-chrome-stable")
# Seconds between samples of /proc. Memory with shared pages counted once (PSS) is
# costlier to read than the rest, so it is sampled only every PSS_EVERY samples.
SAMPLE_PERIOD_S = 1.0
PSS_EVERY = 5
# Seconds allowed for the browser to start and the page to load, on top of the benchmark.
STARTUP_ALLOWANCE_S = 90.0
PER_SCENARIO_ALLOWANCE_S = 5.0
SCENARIO_COUNT_ESTIMATE = 8

# Flags every profile gets: a quiet, full-screen window that is never throttled.
BASE_FLAGS = (
    "--no-first-run",
    "--no-default-browser-check",
    "--noerrdialogs",
    "--disable-infobars",
    "--disable-session-crashed-bubble",
    "--disable-component-update",
    "--disable-background-networking",
    "--disable-features=Translate,MediaRouter",
    "--password-store=basic",
    "--autoplay-policy=no-user-gesture-required",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--enable-precise-memory-info",
    "--ozone-platform-hint=auto",
)
# Flags the runner adds for itself, by prefix: they say nothing about a profile.
HOUSEKEEPING_FLAGS = (
    "--user-data-dir=",
    "--window-size=",
    "--window-position=",
    "--kiosk",
    "--headless",
    "--hide-scrollbars",
    "--no-sandbox",
)
_GPU_FLAGS = ("--ignore-gpu-blocklist", "--enable-gpu-rasterization", "--enable-zero-copy")


@dataclass(frozen=True)
class Profile:
    name: str
    about: str
    flags: tuple[str, ...] = ()
    # Extra query parameters for the page.
    query: tuple[tuple[str, str], ...] = ()


PROFILES: dict[str, Profile] = {
    p.name: p
    for p in (
        Profile("default", "Chromium as a plain kiosk starts it"),
        Profile("gpu", "GPU blocklist ignored, GPU rasterisation", _GPU_FLAGS),
        Profile(
            "gpu-gles",
            "as gpu, through the OpenGL ES driver",
            (*_GPU_FLAGS, "--use-angle=gles"),
        ),
        Profile(
            "software",
            "WebGL drawn by the CPU (SwiftShader)",
            ("--use-angle=swiftshader", "--enable-unsafe-swiftshader"),
        ),
        Profile("canvas", "PixiJS on the 2D canvas, no WebGL", (), (("backend", "canvas"),)),
    )
}


def chosen_profiles(names: str, extra_flags: str | None) -> list[Profile]:
    """The profiles to run: named ones, plus ``custom`` for flags given on the command line."""
    unknown = [name for name in names.split(",") if name not in PROFILES]
    if unknown:
        raise ValueError(f"unknown profile: {', '.join(unknown)}")
    profiles = [PROFILES[name] for name in names.split(",")]
    if extra_flags:
        profiles.append(
            Profile("custom", "flags given on the command line", tuple(extra_flags.split()))
        )
    return profiles


# --- /proc sampling ---------------------------------------------------------------------


@dataclass(frozen=True)
class Process:
    pid: int
    parent: int
    cpu_ticks: int  # user + system time, in clock ticks
    rss_pages: int


def parse_stat(text: str) -> Process | None:
    """Parse one ``/proc/<pid>/stat``. The command name may contain spaces and brackets."""
    opening, closing = text.find("("), text.rfind(")")
    if opening < 0 or closing < 0:
        return None
    fields = text[closing + 1 :].split()
    try:
        # After the name: state, ppid, …; utime and stime are the 12th and 13th, rss the 22nd.
        return Process(
            pid=int(text[:opening]),
            parent=int(fields[1]),
            cpu_ticks=int(fields[11]) + int(fields[12]),
            rss_pages=int(fields[21]),
        )
    except (IndexError, ValueError):
        return None


def read_processes(proc: Path) -> dict[int, Process]:
    processes: dict[int, Process] = {}
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        try:
            parsed = parse_stat((entry / "stat").read_text(encoding="utf-8", errors="replace"))
        except OSError:
            continue  # it exited while we were looking
        if parsed is not None:
            processes[parsed.pid] = parsed
    return processes


def descendants(processes: dict[int, Process], root: int) -> set[int]:
    """``root`` and every process below it."""
    children: dict[int, list[int]] = {}
    for process in processes.values():
        children.setdefault(process.parent, []).append(process.pid)
    found: set[int] = set()
    pending = [root]
    while pending:
        pid = pending.pop()
        if pid in found or pid not in processes:
            continue
        found.add(pid)
        pending.extend(children.get(pid, ()))
    return found


def process_kind(cmdline: str) -> str:
    """Chromium's role for a process, from its command line: browser, gpu, renderer…

    Chromium rewrites the command line of its child processes into one string with
    spaces, so arguments are separated by spaces there and by NUL elsewhere.
    """
    for argument in cmdline.replace("\0", " ").split():
        if argument.startswith("--type="):
            kind = argument.removeprefix("--type=")
            return "gpu" if kind == "gpu-process" else kind
    return "browser"


def read_kind(proc: Path, pid: int) -> str:
    try:
        return process_kind((proc / str(pid) / "cmdline").read_text(errors="replace"))
    except OSError:
        return "gone"


def read_pss_kb(proc: Path, pid: int) -> int | None:
    """Memory of a process with shared pages divided among their users, in kB."""
    try:
        for line in (proc / str(pid) / "smaps_rollup").read_text().splitlines():
            if line.startswith("Pss:"):
                return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return None


def read_system_cpu(proc: Path) -> tuple[int, int]:
    """(busy, total) clock ticks of the whole machine since boot."""
    try:
        values = [int(v) for v in (proc / "stat").read_text().splitlines()[0].split()[1:]]
    except (OSError, ValueError, IndexError):
        return 0, 0
    idle = values[3] + (values[4] if len(values) > 4 else 0)  # idle + iowait
    return sum(values) - idle, sum(values)


def read_meminfo_kb(proc: Path, key: str) -> int | None:
    try:
        for line in (proc / "meminfo").read_text().splitlines():
            if line.startswith(key + ":"):
                return int(line.split()[1])
    except (OSError, ValueError, IndexError):
        pass
    return None


def read_temperature_c(sys_root: Path) -> float | None:
    """The hottest thermal zone, in °C."""
    readings: list[float] = []
    for zone in sorted((sys_root / "class" / "thermal").glob("thermal_zone*/temp")):
        with contextlib.suppress(OSError, ValueError):
            readings.append(int(zone.read_text().strip()) / 1000.0)
    return max(readings) if readings else None


@dataclass
class Sample:
    epoch_ms: float
    # Per process of the browser: cumulative CPU ticks, and its kind.
    ticks: dict[int, int]
    kinds: dict[int, str]
    rss_kb: int
    pss_kb: int | None
    system_busy: int
    system_total: int
    mem_available_kb: int | None
    temperature_c: float | None


class Sampler:
    """Samples the browser's process tree from /proc."""

    def __init__(self, root_pid: int, proc: Path = Path("/proc"), sys_root: Path = Path("/sys")):
        self.root_pid = root_pid
        self.proc = proc
        self.sys_root = sys_root
        self.page_kb = os.sysconf("SC_PAGE_SIZE") // 1024
        self.samples: list[Sample] = []
        self._kinds: dict[int, str] = {}

    def sample(self) -> Sample:
        processes = read_processes(self.proc)
        pids = descendants(processes, self.root_pid)
        for pid in pids:
            # A process changes role once, when it execs: re-read while it looks generic.
            if self._kinds.get(pid, "browser") in ("browser", "zygote"):
                self._kinds[pid] = read_kind(self.proc, pid)
        with_pss = len(self.samples) % PSS_EVERY == 0
        pss = [read_pss_kb(self.proc, pid) for pid in pids] if with_pss else []
        busy, total = read_system_cpu(self.proc)
        sample = Sample(
            epoch_ms=time.time() * 1000.0,
            ticks={pid: processes[pid].cpu_ticks for pid in pids},
            kinds={pid: self._kinds.get(pid, "browser") for pid in pids},
            rss_kb=sum(processes[pid].rss_pages for pid in pids) * self.page_kb,
            pss_kb=sum(p for p in pss if p is not None)
            if any(p is not None for p in pss)
            else None,
            system_busy=busy,
            system_total=total,
            mem_available_kb=read_meminfo_kb(self.proc, "MemAvailable"),
            temperature_c=read_temperature_c(self.sys_root),
        )
        self.samples.append(sample)
        return sample


def cpu_between(before: Sample, after: Sample, ticks_per_s: int) -> dict[str, float]:
    """CPU use between two samples, in percent of one core, by process kind."""
    seconds = (after.epoch_ms - before.epoch_ms) / 1000.0
    if seconds <= 0:
        return {}
    used: dict[str, float] = {}
    for pid, ticks in after.ticks.items():
        # A process that appeared in between has spent all its ticks in between.
        delta = ticks - before.ticks.get(pid, 0)
        kind = after.kinds.get(pid, "browser")
        used[kind] = used.get(kind, 0.0) + delta / ticks_per_s / seconds * 100.0
    return used


def usage_in_window(
    samples: list[Sample], start_ms: float, end_ms: float, ticks_per_s: int
) -> dict[str, Any] | None:
    """Average CPU and memory of the browser between two wall-clock times.

    Uses the samples inside the window plus the one just before it, so even a window
    shorter than the sampling period gets an estimate when a sample pair spans it.
    """
    inside = [i for i, s in enumerate(samples) if start_ms <= s.epoch_ms <= end_ms]
    if not inside:
        # No sample fell inside: take the pair around the window, if there is one.
        after = next((i for i, s in enumerate(samples) if s.epoch_ms > end_ms), None)
        if after is None or after == 0:
            return None
        first, last = after - 1, after
    else:
        first, last = max(inside[0] - 1, 0), inside[-1]
    if first == last:
        return None
    before, end = samples[first], samples[last]
    by_kind = cpu_between(before, end, ticks_per_s)
    span = samples[first : last + 1]
    system_total = end.system_total - before.system_total
    pss = [s.pss_kb for s in span if s.pss_kb is not None]
    if not pss:
        # Memory moves slowly: without a reading in the window, the nearest one in time.
        middle = (start_ms + end_ms) / 2.0
        readings = [s for s in samples if s.pss_kb is not None]
        nearest = min(readings, key=lambda s: abs(s.epoch_ms - middle), default=None)
        pss = [nearest.pss_kb] if nearest is not None and nearest.pss_kb is not None else []
    temperatures = [s.temperature_c for s in span if s.temperature_c is not None]
    return {
        "samples": len(span),
        "cpu_pct": round(sum(by_kind.values()), 1),
        "cpu_pct_by_kind": {kind: round(value, 1) for kind, value in sorted(by_kind.items())},
        "system_cpu_pct": (
            round((end.system_busy - before.system_busy) / system_total * 100.0, 1)
            if system_total > 0
            else None
        ),
        # PSS counts memory shared between Chromium's processes once: the honest figure.
        # RSS summed over processes counts it once per process, so it reads far too high.
        "pss_mb": round(max(pss) / 1024.0, 1) if pss else None,
        "rss_sum_mb": round(max(s.rss_kb for s in span) / 1024.0, 1),
        "temperature_c": round(max(temperatures), 1) if temperatures else None,
    }


# --- The page's side: a tiny web server ---------------------------------------------------


class _Handler(SimpleHTTPRequestHandler):
    """Serves the built renderer and accepts the page's results on POST /results."""

    inbox: queue.Queue[dict[str, Any]]

    def do_POST(self) -> None:
        if self.path != "/results":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            document = json.loads(self.rfile.read(length))
        except (ValueError, json.JSONDecodeError):
            self.send_error(400, "expected a JSON body")
            return
        self.inbox.put(document)
        self.send_response(204)
        self.end_headers()

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        pass  # keep the terminal for the benchmark's own output


def serve(dist: Path, port: int) -> tuple[ThreadingHTTPServer, queue.Queue[dict[str, Any]]]:
    """Serve ``dist`` on localhost in a background thread. Port 0 picks a free one."""
    inbox: queue.Queue[dict[str, Any]] = queue.Queue()
    handler = type("Handler", (_Handler,), {"inbox": inbox})
    server = ThreadingHTTPServer(("127.0.0.1", port), partial(handler, directory=str(dist)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server, inbox


# --- The browser ------------------------------------------------------------------------


def find_browser(explicit: str | None) -> str | None:
    if explicit:
        return explicit if Path(explicit).exists() else shutil.which(explicit)
    return next((path for name in BROWSERS if (path := shutil.which(name))), None)


def browser_command(
    browser: str,
    profile: Profile,
    url: str,
    user_data: Path,
    *,
    headless: bool,
    window: tuple[int, int],
    sandbox: bool,
) -> list[str]:
    command = [browser, *BASE_FLAGS, *profile.flags]
    command += [f"--user-data-dir={user_data}", f"--window-size={window[0]},{window[1]}"]
    # A PC has no kiosk display to take over: draw off screen instead.
    command += (
        ["--headless=new", "--hide-scrollbars"]
        if headless
        else ["--kiosk", "--window-position=0,0"]
    )
    if not sandbox:
        command.append("--no-sandbox")
    return [*command, url]


def page_url(
    port: int, page: str, profile: Profile, seconds: float, warmup: float, only: str | None
) -> str:
    query: dict[str, str] = {
        "seconds": f"{seconds:g}",
        "warmup": f"{warmup:g}",
        "post": "/results",
        "label": profile.name,
        **dict(profile.query),
    }
    if only:
        query["only"] = only
    return f"http://127.0.0.1:{port}/{page}?{urlencode(query)}"


def stop(process: subprocess.Popen[bytes]) -> None:
    """Stop the browser and everything it started."""
    for signal_number in (signal.SIGTERM, signal.SIGKILL):
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(process.pid, signal_number)
        try:
            process.wait(timeout=5)
            return
        except subprocess.TimeoutExpired:
            continue


@dataclass
class Run:
    profile: str
    about: str
    flags: list[str]
    url: str
    status: str = "ok"  # ok | timeout | browser-exited | launch-failed
    detail: str = ""
    duration_s: float = 0.0
    results: dict[str, Any] | None = None
    usage: dict[str, Any] = field(default_factory=dict)
    peak: dict[str, Any] = field(default_factory=dict)


def run_profile(
    browser: str,
    profile: Profile,
    url: str,
    inbox: queue.Queue[dict[str, Any]],
    *,
    headless: bool,
    window: tuple[int, int],
    sandbox: bool,
    timeout_s: float,
    log_dir: Path,
) -> Run:
    user_data = Path(tempfile.mkdtemp(prefix="lineage-kiosk-"))
    command = browser_command(
        browser, profile, url, user_data, headless=headless, window=window, sandbox=sandbox
    )
    run = Run(profile.name, profile.about, command[1:-1], url)
    while not inbox.empty():
        inbox.get_nowait()  # nothing left over from a previous profile
    started = time.monotonic()
    log_path = log_dir / f"chromium-{profile.name}.log"
    try:
        with log_path.open("wb") as log:
            process = subprocess.Popen(
                command, stdout=log, stderr=subprocess.STDOUT, start_new_session=True
            )
    except OSError as error:
        run.status, run.detail = "launch-failed", str(error)
        shutil.rmtree(user_data, ignore_errors=True)
        return run

    sampler = Sampler(process.pid)
    try:
        while True:
            sampler.sample()
            try:
                run.results = inbox.get(timeout=SAMPLE_PERIOD_S)
                sampler.sample()
                break
            except queue.Empty:
                pass
            if process.poll() is not None:
                run.status = "browser-exited"
                run.detail = f"exit code {process.returncode}; see {log_path.name}"
                break
            if time.monotonic() - started > timeout_s:
                run.status = "timeout"
                run.detail = f"no results after {timeout_s:.0f} s; see {log_path.name}"
                break
    finally:
        stop(process)
        shutil.rmtree(user_data, ignore_errors=True)
    run.duration_s = round(time.monotonic() - started, 1)

    ticks_per_s = os.sysconf("SC_CLK_TCK")
    samples = sampler.samples
    if run.results is not None:
        if run.results.get("error"):
            run.status, run.detail = "page-error", str(run.results["error"])
        for scenario in run.results.get("scenarios", []):
            usage = usage_in_window(
                samples, scenario["started_epoch_ms"], scenario["ended_epoch_ms"], ticks_per_s
            )
            if usage is not None:
                run.usage[scenario["name"]] = usage
    pss = [s.pss_kb for s in samples if s.pss_kb is not None]
    temperatures = [s.temperature_c for s in samples if s.temperature_c is not None]
    run.peak = {
        "pss_mb": round(max(pss) / 1024.0, 1) if pss else None,
        "rss_sum_mb": round(max((s.rss_kb for s in samples), default=0) / 1024.0, 1),
        "temperature_c": round(max(temperatures), 1) if temperatures else None,
        "processes": max((len(s.ticks) for s in samples), default=0),
    }
    return run


# --- The machine ------------------------------------------------------------------------


def _text(path: str) -> str:
    try:
        return Path(path).read_text(errors="replace").replace("\0", "").strip()
    except OSError:
        return ""


def _output(command: list[str]) -> str:
    try:
        done = subprocess.run(command, capture_output=True, text=True, timeout=10, check=False)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return (done.stdout or done.stderr).strip()


def describe_host(browser: str) -> dict[str, Any]:
    os_release = dict(
        line.split("=", 1) for line in _text("/etc/os-release").splitlines() if "=" in line
    )
    cpu = _text("/proc/cpuinfo")
    model_names = [
        line.split(":", 1)[1].strip()
        for line in cpu.splitlines()
        if line.lower().startswith(("model name", "hardware"))
    ]
    total_kb = read_meminfo_kb(Path("/proc"), "MemTotal")
    return {
        "hostname": os.uname().nodename,
        "model": _text("/proc/device-tree/model") or _text("/sys/class/dmi/id/product_name"),
        "os": os_release.get("PRETTY_NAME", "").strip('"'),
        "kernel": os.uname().release,
        "machine": os.uname().machine,
        "cpu": model_names[0] if model_names else "",
        "cpu_count": os.cpu_count(),
        "memory_mb": round(total_kb / 1024) if total_kb else None,
        "session": os.environ.get("XDG_SESSION_TYPE", ""),
        "display": os.environ.get("WAYLAND_DISPLAY") or os.environ.get("DISPLAY", ""),
        "browser": browser,
        "browser_version": _output([browser, "--version"]),
        # Only where the tool is installed: which OpenGL driver the desktop itself reports.
        "glxinfo": _output(["glxinfo", "-B"]) if shutil.which("glxinfo") else "",
        "python": sys.version.split()[0],
    }


# --- Command line -----------------------------------------------------------------------


def drawn_by(results: dict[str, Any]) -> str:
    """One line saying what actually drew the page: the fact R0 most needs from a device."""
    gpu = results.get("gpu") or {}
    asked = (results.get("settings") or {}).get("backend", "webgl")
    if gpu.get("api") == "canvas":
        fallback = " (WebGL was not available)" if asked != "canvas" else ""
        return f"2D canvas, on the CPU{fallback}"
    driver = gpu.get("unmasked_renderer") or gpu.get("renderer") or "unknown driver"
    return f"WebGL on {driver}" + (" (software, on the CPU)" if gpu.get("software") else "")


def summary_lines(document: dict[str, Any]) -> list[str]:
    """A table a person can read in the terminal."""
    lines: list[str] = []
    for run in document["runs"]:
        results = run["results"] or {}
        lines.append(f"\n[{run['profile']}] {run['status']} {run['detail']}".rstrip())
        if results.get("scenarios"):
            lines.append(f"  drawn by: {drawn_by(results)}")
            lines.append(
                f"  {'scenario':<11}{'fps med':>8}{'1% low':>8}{'script ms':>10}"
                f"{'CPU %':>7}{'RAM MB':>8}"
            )
        for scenario in results.get("scenarios", []):
            usage = run["usage"].get(scenario["name"], {})
            memory = usage.get("pss_mb")
            lines.append(
                f"  {scenario['name']:<11}{scenario['fps_median']:>8.1f}"
                f"{scenario['fps_1pct_low']:>8.1f}{scenario['js_ms_median']:>10.2f}"
                f"{usage.get('cpu_pct', float('nan')):>7.0f}"
                f"{memory if memory is not None else float('nan'):>8.0f}"
            )
        acceptance = results.get("acceptance") or {}
        if acceptance.get("pass") is not None:
            verdict = "PASS" if acceptance["pass"] else "FAIL"
            lines.append(
                f"  {acceptance['scenario']}: {acceptance['fps_median']:.1f} fps median, "
                f"target {acceptance['target_fps']}: {verdict}"
            )
    return lines


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Benchmark a renderer page in Chromium kiosk mode and sample its CPU and RAM."
    )
    parser.add_argument(
        "--dist", type=Path, required=True, help="the built renderer (npm run build)"
    )
    parser.add_argument("--page", default="spike.html")
    parser.add_argument(
        "--profiles",
        default=",".join(PROFILES),
        help=f"comma-separated, from: {', '.join(PROFILES)} (default: all)",
    )
    parser.add_argument(
        "--flags",
        help="more Chromium flags to try, as one more profile named 'custom' "
        "(quote them: --flags='--use-gl=egl')",
    )
    parser.add_argument("--seconds", type=float, default=8.0, help="measured per scenario")
    parser.add_argument("--warmup", type=float, default=2.0, help="discarded before each scenario")
    parser.add_argument("--only", help="comma-separated scenario names (default: all)")
    parser.add_argument("--browser", help="Chromium binary (default: first found on PATH)")
    parser.add_argument("--out", type=Path, default=Path("kiosk-bench.json"))
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--window", default="1024x600", help="window size, WIDTHxHEIGHT")
    parser.add_argument("--headless", action="store_true", help="no kiosk window (for a PC)")
    parser.add_argument(
        "--no-sandbox",
        action="store_true",
        help="start Chromium without its sandbox (needed as root, or where the log says "
        "'No usable sandbox')",
    )
    parser.add_argument("--timeout", type=float, help="seconds to wait per profile")
    args = parser.parse_args(argv)

    if not (args.dist / args.page).is_file():
        parser.error(f"{args.dist / args.page} not found: build the renderer first")
    try:
        profiles = chosen_profiles(args.profiles, args.flags)
    except ValueError as error:
        parser.error(str(error))
    browser = find_browser(args.browser)
    if browser is None:
        parser.error("no Chromium found; install it or pass --browser")
    if not args.headless and not (os.environ.get("DISPLAY") or os.environ.get("WAYLAND_DISPLAY")):
        parser.error("no display: run inside the desktop session, or set DISPLAY=:0 (X11)")
    # Chromium refuses to start as root with its sandbox on.
    sandbox = not (args.no_sandbox or (hasattr(os, "geteuid") and os.geteuid() == 0))
    width, _, height = args.window.partition("x")
    window = (int(width), int(height))
    timeout_s = args.timeout or (
        STARTUP_ALLOWANCE_S
        + SCENARIO_COUNT_ESTIMATE * (args.seconds + args.warmup + PER_SCENARIO_ALLOWANCE_S)
    )

    server, inbox = serve(args.dist, args.port)
    port = server.server_address[1]
    args.out.parent.mkdir(parents=True, exist_ok=True)
    document: dict[str, Any] = {
        "tool": TOOL,
        "version": VERSION,
        "started_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),  # noqa: UP017
        "host": describe_host(browser),
        "page": args.page,
        "settings": {
            "seconds": args.seconds,
            "warmup": args.warmup,
            "only": args.only,
            "window": list(window),
            "headless": args.headless,
            "sandbox": sandbox,
        },
        "runs": [],
    }
    print(
        f"{len(profiles)} profile(s), up to {timeout_s:.0f} s each. "
        "The screen belongs to the benchmark until it finishes.",
        flush=True,
    )
    try:
        for profile in profiles:
            url = page_url(port, args.page, profile, args.seconds, args.warmup, args.only)
            print(f"[{profile.name}] {profile.about} …", flush=True)
            run = run_profile(
                browser,
                profile,
                url,
                inbox,
                headless=args.headless,
                window=window,
                sandbox=sandbox,
                timeout_s=timeout_s,
                log_dir=args.out.parent,
            )
            document["runs"].append(
                {**vars(run), "drawn_by": drawn_by(run.results) if run.results else ""}
            )
            # Written after every profile, so a later hang loses nothing.
            args.out.write_text(json.dumps(document, indent=1) + "\n", encoding="utf-8")
    finally:
        server.shutdown()
        server.server_close()
    print("\n".join(summary_lines(document)))
    print(f"\nwrote {args.out}")
    return 0 if any(run["status"] == "ok" for run in document["runs"]) else 1


if __name__ == "__main__":
    raise SystemExit(main())
