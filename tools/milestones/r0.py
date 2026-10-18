"""R0 report: the renderer spike measured in Chromium kiosk on the device.

Unlike the simulation milestones, the evidence is not a fast-forward run but the file
``tools/kiosk_bench.py`` writes on the device (``kiosk-bench.json``): frame rate per
scenario and browser profile as the page measured it, with the CPU, memory and
temperature the runner sampled meanwhile. The evidence file is kept in the report
directory, because it cannot be regenerated on a PC.
"""

from __future__ import annotations

import html
import json
from pathlib import Path
from typing import Any

from tools.kiosk_bench import BASE_FLAGS, HOUSEKEEPING_FLAGS, PROFILES, TOOL, VERSION, drawn_by
from tools.milestones.base import Criterion, Section, figure_html
from tools.viz import figures, style

EVIDENCE = "kiosk-bench.json"
# The scenarios R0 is judged on, each against the target (ADR 0010): the three views,
# the middle one also with every creature alive. The scene R0 was first written against
# is still measured and recorded, not judged: on the board it hangs the GPU.
ACCEPTANCE_SCENARIOS = ("map-view", "mid-view", "mid-crowd", "local-view")
FIRST_LOOK_SCENARIO = "spec-1x"
# The costliest of them, whose CPU and memory the report breaks down.
HEAVIEST_SCENARIO = "mid-crowd"
TARGET_FPS = 30.0
SPEC_VIEWPORT = (1024, 600)
ARM_MACHINES = ("aarch64", "arm64", "armv7l", "armv8l")
# Chromium's processes, in the order the tables show them.
PROCESS_KINDS = ("renderer", "gpu", "browser", "utility", "zygote")

CRITERIA = [
    Criterion(
        "R0.1",
        "Measured as specified: on the ARM board, Chromium kiosk on a display, the page "
        "1024×600 or larger (1 = yes)",
        "evidence.as_specified",
        low=1.0,
    ),
    *(
        Criterion(
            f"R0.{index}",
            f"Median frame rate of {name} ({about}) with the best browser profile (fps)",
            f"best.{name}.fps_median",
            low=TARGET_FPS,
        )
        for index, (name, about) in enumerate(
            [
                ("map-view", "the map view: the whole island, every creature a dot"),
                ("mid-view", "the middle view: a region, its plants, 50 creatures"),
                ("mid-crowd", "the middle view with every creature the sim can hold"),
                ("local-view", "the local view: the camera on one creature"),
            ],
            start=2,
        )
    ),
]


def load(source: Path) -> dict[str, Any]:
    """Read the evidence: the file itself, or a directory holding ``kiosk-bench.json``."""
    path = source / EVIDENCE if source.is_dir() else source
    try:
        evidence = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(
            f"{path} not found: R0 is built from the file tools/kiosk_bench.py writes"
        ) from None
    if evidence.get("tool") != TOOL or evidence.get("version") != VERSION:
        raise ValueError(f"{path}: not a {TOOL} version {VERSION} file")
    return evidence


def _scenarios(run: dict[str, Any]) -> list[dict[str, Any]]:
    return (run.get("results") or {}).get("scenarios", [])


def _scenario(run: dict[str, Any], name: str) -> dict[str, Any] | None:
    return next((s for s in _scenarios(run) if s["name"] == name), None)


def scenario_names(evidence: dict[str, Any]) -> list[str]:
    """Every scenario any profile measured, in the order the page runs them."""
    names: list[str] = []
    for run in evidence["runs"]:
        names += [s["name"] for s in _scenarios(run) if s["name"] not in names]
    return names


def best_run(evidence: dict[str, Any]) -> dict[str, Any] | None:
    """The profile whose slowest acceptance scenario is fastest: the kiosk runs one.

    Frame rates within one frame per second count as equal (several profiles sit at the
    display's refresh rate); among those the one using the least CPU over the acceptance
    scenarios wins, then the earlier, plainer profile. A profile that did not measure
    every acceptance scenario is not a candidate.
    """
    best: tuple[float, float] | None = None
    winner: dict[str, Any] | None = None
    for run in evidence["runs"]:
        if run["status"] != "ok":
            continue
        measured = [_scenario(run, name) for name in ACCEPTANCE_SCENARIOS]
        if any(scenario is None or scenario["frames"] == 0 for scenario in measured):
            continue
        slowest = min(float(scenario["fps_median"]) for scenario in measured if scenario)
        cpus = [run["usage"].get(name, {}).get("cpu_pct") for name in ACCEPTANCE_SCENARIOS]
        cpu = float("inf") if None in cpus else sum(c for c in cpus if c is not None)
        key = (-float(round(slowest)), cpu)
        if best is None or key < best:
            best, winner = key, run
    return winner


def off_spec(evidence: dict[str, Any]) -> list[str]:
    """Why this evidence is not the measurement R0 asks for; empty when it is."""
    reasons: list[str] = []
    machine = evidence["host"].get("machine", "")
    if machine not in ARM_MACHINES:
        reasons.append(f"measured on {machine or 'an unknown machine'}, not on the ARM board")
    if evidence["settings"].get("headless"):
        reasons.append("Chromium ran headless, not as a kiosk on the display")
    if evidence["settings"].get("virtual_display"):
        reasons.append("the display was a virtual one: the GPU drew, no screen showed it")
    for width, height in sorted(_page_sizes(evidence)):
        if width < SPEC_VIEWPORT[0] or height < SPEC_VIEWPORT[1]:
            reasons.append(f"the page was {width}×{height}, smaller than 1024×600")
    return reasons


def _page_sizes(evidence: dict[str, Any]) -> set[tuple[int, int]]:
    """Every size the page had while it was measured."""
    return {
        (results["viewport"]["width"], results["viewport"]["height"])
        for run in evidence["runs"]
        if (results := run.get("results")) and results.get("viewport")
    }


def stand_in(evidence: dict[str, Any]) -> list[str]:
    """Where a larger display stood in for the 7" screen (ADR 0008).

    The scene is drawn at the same size and stretched to the page, so a larger page is
    the same work and more pixels to fill: at least as hard. Such a run counts as the
    measurement, and the report says what it was made on.
    """
    spec_pixels = SPEC_VIEWPORT[0] * SPEC_VIEWPORT[1]
    return [
        f"the page was {width}×{height}, {width * height / spec_pixels:.1f} times the "
        "pixels of the 1024×600 screen: at least as hard to draw"
        for width, height in sorted(_page_sizes(evidence))
        if (width, height) != SPEC_VIEWPORT
        and width >= SPEC_VIEWPORT[0]
        and height >= SPEC_VIEWPORT[1]
    ]


def metrics(evidence: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {"evidence.as_specified": 0.0 if off_spec(evidence) else 1.0}
    memory = evidence["host"].get("memory_mb")
    if memory is not None:
        out["host.memory_mb"] = float(memory)

    def record(prefix: str, run: dict[str, Any], scenario: dict[str, Any]) -> None:
        out[f"{prefix}.fps_median"] = float(scenario["fps_median"])
        out[f"{prefix}.fps_1pct_low"] = float(scenario["fps_1pct_low"])
        out[f"{prefix}.script_ms_median"] = float(scenario["js_ms_median"])
        usage = run["usage"].get(scenario["name"], {})
        for key in ("cpu_pct", "pss_mb", "temperature_c"):
            if usage.get(key) is not None:
                out[f"{prefix}.{key}"] = float(usage[key])

    for run in evidence["runs"]:
        for scenario in _scenarios(run):
            if scenario["frames"] > 0:
                record(f"{run['profile']}.{scenario['name']}", run, scenario)
    best = best_run(evidence)
    if best is not None:
        for name in (*ACCEPTANCE_SCENARIOS, FIRST_LOOK_SCENARIO):
            scenario = _scenario(best, name)
            if scenario is not None and scenario["frames"] > 0:
                record(f"best.{name}", best, scenario)
        gpu = (best["results"] or {}).get("gpu") or {}
        out["best.drawn_by_gpu"] = 0.0 if gpu.get("software", True) else 1.0
    return out


def _first_results(evidence: dict[str, Any]) -> dict[str, Any]:
    return next((run["results"] for run in evidence["runs"] if run.get("results")), {})


def _where(evidence: dict[str, Any]) -> str:
    host = evidence["host"]
    return f"{host.get('model') or host.get('hostname') or 'unknown'} ({host.get('machine')})"


def _display(results: dict[str, Any]) -> str:
    """The screen the browser saw and the page on it, as the page reported them."""
    screen, page = results.get("screen") or {}, results.get("viewport") or {}
    if not screen or not page:
        return "unknown"
    return (
        f"{screen.get('width')}×{screen.get('height')}, "
        f"page {page.get('width')}×{page.get('height')}"
    )


def header(evidence: dict[str, Any]) -> list[tuple[str, str]]:
    host, settings, results = evidence["host"], evidence["settings"], _first_results(evidence)
    window = "×".join(str(n) for n in settings.get("window", []))
    mode = "headless" if settings.get("headless") else "kiosk"
    best = best_run(evidence)
    return [
        ("Renderer build", str(results.get("build_commit", "unknown"))),
        ("Measured on", _where(evidence)),
        ("System", f"{host.get('os')}, Linux {host.get('kernel')}"),
        ("Browser", str(host.get("browser_version") or host.get("browser"))),
        ("Measured at", str(evidence.get("started_at"))),
        (
            "Settings",
            f"{settings.get('seconds'):g} s per scenario after {settings.get('warmup'):g} s "
            f"of warm-up, {mode} window {window}",
        ),
        ("Display", _display(results)),
        ("Profiles", ", ".join(run["profile"] for run in evidence["runs"])),
        ("World drawn", str((results.get("world") or {}).get("description", "unknown"))),
        ("Best profile", "none finished" if best is None else best["profile"]),
        ("Drawn by", "—" if best is None else drawn_by(best["results"])),
    ]


def summary(evidence: dict[str, Any]) -> str:
    """One paragraph for the report's README."""
    settings, results = evidence["settings"], _first_results(evidence)
    text = (
        f"Measured on {_where(evidence)} with {evidence['host'].get('browser_version')}, "
        f"{evidence.get('started_at')}: {len(evidence['runs'])} browser profiles × "
        f"{len(scenario_names(evidence))} scenarios, {settings.get('seconds'):g} s each, "
        f"renderer build `{results.get('build_commit', 'unknown')}`."
    )
    best = best_run(evidence)
    if best is not None:
        text += f" Best profile: `{best['profile']}`, drawn by {drawn_by(best['results'])}."
    reasons = off_spec(evidence)
    if reasons:
        text += " **Not the R0 measurement:** " + "; ".join(reasons) + "."
    larger = stand_in(evidence)
    if larger:
        text += " **On a stand-in display:** " + "; ".join(larger) + "."
    return text


def provenance(evidence: dict[str, Any]) -> dict[str, Any]:
    """What ``metrics.json`` records about where the numbers came from."""
    host, best = evidence["host"], best_run(evidence)
    return {
        "evidence": EVIDENCE,
        "measured_at": evidence.get("started_at"),
        "renderer_commit": _first_results(evidence).get("build_commit", "unknown"),
        "host": {
            key: host.get(key)
            for key in ("model", "machine", "os", "kernel", "cpu_count", "memory_mb")
        }
        | {"browser": host.get("browser_version")},
        "settings": evidence["settings"],
        "off_spec": off_spec(evidence),
        "stand_in": stand_in(evidence),
        "best_profile": None if best is None else best["profile"],
        "drawn_by": None if best is None else drawn_by(best["results"]),
    }


# --- Report sections ----------------------------------------------------------------------


def profile_colours(evidence: dict[str, Any]) -> dict[str, str]:
    """A fixed colour per browser profile, the same in every chart."""
    known = list(PROFILES)
    extra = [run["profile"] for run in evidence["runs"] if run["profile"] not in known]
    return {name: style.categorical(slot) for slot, name in enumerate(known + extra)}


def _table(headers: list[str], rows: list[list[str]]) -> str:
    """An HTML table; cells are trusted markup, so callers escape what they did not write."""
    head = "".join(f"<th>{cell}</th>" for cell in headers)
    body = "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows)
    return f'<div class="wrap"><table><tr>{head}</tr>{body}</table></div>'


def _number(value: float | None, spec: str = ".1f", unit: str = "") -> str:
    return "—" if value is None else f"{value:{spec}}{unit}"


def _per_profile(
    evidence: dict[str, Any], scenario: str, key: str, *, usage: bool = False
) -> list[float | None]:
    """One value per profile for a scenario: from the page, or from the runner's usage."""
    values: list[float | None] = []
    for run in evidence["runs"]:
        measured = _scenario(run, scenario)
        if measured is None or measured["frames"] == 0:
            values.append(None)
        elif usage:
            values.append(run["usage"].get(scenario, {}).get(key))
        else:
            values.append(measured[key])
    return values


def _reading_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    reasons = off_spec(evidence)
    warning = (
        '<p class="FAIL">This is not the R0 measurement: '
        + e("; ".join(reasons))
        + ". It shows that the tooling works and nothing about the device.</p>"
        if reasons
        else ""
    )
    larger = stand_in(evidence)
    if larger:
        warning += (
            '<p class="note">Measured on a display standing in for the 7″ screen: '
            + e("; ".join(larger))
            + ". The scene is drawn at the same size and stretched further.</p>"
        )
    rows: list[list[str]] = []
    for name in scenario_names(evidence):
        measured = next(s for run in evidence["runs"] if (s := _scenario(run, name)) is not None)
        rows.append(
            [
                e(name),
                e(measured["about"]),
                "×".join(str(n) for n in measured["internal"]),
                str(measured["plant_sprites"] + measured["creature_sprites"]),
            ]
        )
    note = (
        '<p class="note">Each browser profile starts Chromium afresh with different flags '
        "and runs every scenario. The page counts frames itself; the runner samples "
        "Chromium's processes from /proc meanwhile. Frame rate cannot exceed the "
        "display's refresh rate. “Drawn at” is the size the scene is rendered at before "
        "being stretched to the screen with hard pixel edges: smaller means bigger art "
        "pixels and less work.</p>"
    )
    return Section(
        "What was measured",
        warning + note + _table(["Scenario", "What it is", "Drawn at", "Sprites"], rows),
    )


def _profile_flags(run: dict[str, Any]) -> list[str]:
    """The flags that make this profile what it is: those a plain kiosk does not get."""
    profile = PROFILES.get(run["profile"])
    if profile is not None:
        return [*profile.flags, *(f"page: {key}={value}" for key, value in profile.query)]
    return [
        flag
        for flag in run["flags"]
        if flag not in BASE_FLAGS and not flag.startswith(HOUSEKEEPING_FLAGS)
    ]


def _profiles_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    rows: list[list[str]] = []
    for run in evidence["runs"]:
        results = run.get("results") or {}
        rows.append(
            [
                e(run["profile"]),
                e(run["about"]),
                e(" ".join(_profile_flags(run))) or "—",
                e(f"{run['status']} {run['detail']}".strip()),
                e(drawn_by(results)) if results.get("scenarios") else "—",
            ]
        )
    return Section(
        "Browser profiles",
        _table(["Profile", "What it is", "Flags", "Outcome", "Drawn by"], rows),
    )


def _frame_rate_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    names = scenario_names(evidence)
    profiles = [run["profile"] for run in evidence["runs"]]
    if not names:
        return Section("Frame rate", '<p class="empty">No profile measured anything.</p>')
    median = {n: _per_profile(evidence, n, "fps_median") for n in names}
    low = {n: _per_profile(evidence, n, "fps_1pct_low") for n in names}
    script = {n: _per_profile(evidence, n, "js_ms_median") for n in names}
    style.apply_style()
    figure = figures.grouped_bars(
        names,
        {profile: [median[n][i] for n in names] for i, profile in enumerate(profiles)},
        profile_colours(evidence),
        title="Median frame rate by scenario and browser profile",
        ylabel="frame rate (fps)",
        reference=(TARGET_FPS, f"target {TARGET_FPS:g} fps"),
    )
    caption = (
        "Median frame rate per scenario, one bar per browser profile; the dashed line is "
        f"the R0 target, which applies to {', '.join(ACCEPTANCE_SCENARIOS)}; "
        f"{FIRST_LOOK_SCENARIO} is recorded, not judged (ADR 0010)"
    )
    rate_rows = [
        [e(n)]
        + [
            "—" if m is None else f"{m:.1f} <small>({_number(w)})</small>"
            for m, w in zip(median[n], low[n], strict=True)
        ]
        for n in names
    ]
    script_rows = [[e(n)] + [_number(v, ".2f") for v in script[n]] for n in names]
    heads = ["Scenario", *(e(profile) for profile in profiles)]
    return Section(
        "Frame rate",
        figure_html(e(caption), figures.to_data_uri(figure))
        + '<p class="note">Frames per second: median, and in brackets the 1% low (the '
        "rate of the slowest hundredth of frames, which is what stutter looks like).</p>"
        + _table(heads, rate_rows)
        + '<p class="note">Script time per frame in milliseconds (median): what the page '
        "itself spends moving creatures and handing the scene to the browser. At 30 fps a "
        "frame has 33 ms in all.</p>" + _table(heads, script_rows),
    )


def _cpu_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    names = scenario_names(evidence)
    profiles = [run["profile"] for run in evidence["runs"]]
    cpu = {n: _per_profile(evidence, n, "cpu_pct", usage=True) for n in names}
    if not any(value is not None for values in cpu.values() for value in values):
        return Section("CPU", '<p class="empty">The runner recorded no CPU usage.</p>')
    cores = evidence["host"].get("cpu_count")
    style.apply_style()
    figure = figures.grouped_bars(
        names,
        {profile: [cpu[n][i] for n in names] for i, profile in enumerate(profiles)},
        profile_colours(evidence),
        title="Chromium CPU by scenario and browser profile",
        ylabel="CPU (% of one core)",
        reference=(100.0, "one core"),
    )
    caption = (
        "CPU time of every Chromium process together, in percent of one core "
        f"(this machine has {cores}); the simulation needs its share of one core too"
    )
    rows = [[e(n)] + [_number(v, ".0f", " %") for v in cpu[n]] for n in names]
    kinds: list[list[str]] = []
    for run in evidence["runs"]:
        usage = run["usage"].get(HEAVIEST_SCENARIO)
        if usage is None:
            continue
        split = usage.get("cpu_pct_by_kind", {})
        other = sum(value for kind, value in split.items() if kind not in PROCESS_KINDS)
        kinds.append(
            [e(run["profile"])]
            + [_number(split.get(kind, 0.0), ".0f", " %") for kind in PROCESS_KINDS]
            + [_number(other, ".0f", " %"), _number(usage.get("system_cpu_pct"), ".0f", " %")]
        )
    return Section(
        "CPU",
        figure_html(e(caption), figures.to_data_uri(figure))
        + _table(["Scenario", *(e(profile) for profile in profiles)], rows)
        + f'<p class="note">Where it goes in {e(HEAVIEST_SCENARIO)}, by Chromium process: '
        "the renderer process runs the script of the page, the GPU process draws (on the CPU "
        "when rendering is in software). The last column is the whole machine, in percent "
        "of all its cores.</p>"
        + _table(["Profile", *(kind for kind in PROCESS_KINDS), "other", "whole machine"], kinds),
    )


def _memory_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    rows: list[list[str]] = []
    for run in evidence["runs"]:
        usage, peak = run["usage"].get(HEAVIEST_SCENARIO, {}), run.get("peak") or {}
        rows.append(
            [
                e(run["profile"]),
                _number(usage.get("pss_mb"), ".0f"),
                _number(peak.get("pss_mb"), ".0f"),
                _number(peak.get("rss_sum_mb"), ".0f"),
                _number(peak.get("temperature_c"), ".0f", " °C"),
                str(peak.get("processes", "—")),
            ]
        )
    total = evidence["host"].get("memory_mb")
    note = (
        '<p class="note">Memory of every Chromium process together, in MB. PSS counts '
        "pages shared between processes once and is the figure to budget with; the sum of "
        "RSS counts them once per process and is shown only because it is what top "
        f"reports. The machine has {_number(total, '.0f')} MB in all; simulation and "
        "server get 300 MB of it (CLAUDE.md §4.8).</p>"
    )
    return Section(
        "Memory and temperature",
        note
        + _table(
            [
                "Profile",
                f"PSS in {e(HEAVIEST_SCENARIO)}",
                "Peak PSS",
                "Peak RSS sum",
                "Peak temperature",
                "Processes",
            ],
            rows,
        ),
    )


def _host_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    host, results = evidence["host"], _first_results(evidence)
    screen = results.get("screen") or {}
    facts = [
        ("Model", host.get("model")),
        ("CPU", f"{host.get('cpu') or 'unnamed'} × {host.get('cpu_count')}"),
        ("Memory", f"{host.get('memory_mb')} MB"),
        ("System", f"{host.get('os')}, Linux {host.get('kernel')} ({host.get('machine')})"),
        ("Session", f"{host.get('session') or 'unknown'}, display {host.get('display')}"),
        (
            "Screen",
            f"{screen.get('width')}×{screen.get('height')} at device pixel ratio "
            f"{screen.get('device_pixel_ratio')}",
        ),
        ("Browser", host.get("browser_version") or host.get("browser")),
        ("User agent", results.get("user_agent")),
    ]
    body = _table(["", ""], [[e(key), e(str(value))] for key, value in facts])
    if host.get("glxinfo"):
        body += (
            '<p class="note">What the desktop itself reports as its OpenGL driver '
            f"(glxinfo -B):</p><pre>{e(host['glxinfo'])}</pre>"
        )
    return Section("The machine", body)


def sections(evidence: dict[str, Any]) -> list[Section]:
    return [
        _reading_section(evidence),
        _profiles_section(evidence),
        _frame_rate_section(evidence),
        _cpu_section(evidence),
        _memory_section(evidence),
        _host_section(evidence),
    ]
