"""R5 report: the real scene measured in Chromium kiosk on the device, capped at 30 fps.

Like R0's, the evidence is the file ``tools/kiosk_bench.py`` writes on the board
(``kiosk-bench.json``), here from the scene's own benchmark (``index.html?bench``,
``renderer/src/bench.ts``): per browser profile and scenario, the page's frame times,
the share of frames over the 30 fps budget and the headroom its script leaves, with the
CPU, memory (PSS) and temperature the runner sampled meanwhile. The file is kept in the
report directory, because a PC cannot regenerate it.

The kiosk is capped at 30 fps on the board (no fan, ADR 0022), so "≥ 30 fps median"
(ADR 0010) is read as holding the cap; the share of frames over budget and the headroom
tell a scene holding it with room to spare from one holding it barely.
"""

from __future__ import annotations

import html
import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from tools.kiosk_bench import PROFILES, SCENE_PAGE, TOOL, VERSION, drawn_by
from tools.milestones import r0
from tools.milestones.base import Criterion, Section, figure_html
from tools.viz import figures, style

EVIDENCE = "kiosk-bench.json"
# What the scene's page names its results (renderer/src/bench.ts, `BenchResults.tool`).
RESULTS_TOOL = "lineage-renderer-bench"
# The scenarios R5 is judged on (ADR 0010, ADR 0022; `ACCEPTANCE` in benchplan.ts): the
# three views and the crowded middle one.
ACCEPTANCE_SCENARIOS = ("map", "middle", "middle-crowd", "local")
# What the atmosphere costs (`ATMOSPHERE` in benchplan.ts): measured and reported, with
# no band.
ATMOSPHERE_SCENARIOS = ("night", "rain", "fire", "apocalypse", "shore")
# What else is measured beside them (`EVENTS` in benchplan.ts), with no band: a sim-day's
# turn. Every other scenario is measured with the day held, as on the desk, where it turns
# once a day (the owner, 2026-10-27); the benchmark plays its recording 1800 times as fast.
EVENT_SCENARIOS = ("day-turn", "switches")
# The costliest judged scenario, whose CPU the report breaks down by process.
HEAVIEST_SCENARIO = "middle-crowd"
# The kiosk's cap on the board (ADR 0022), which is also the target of ADR 0010.
TARGET_FPS = 30.0
# A scene holding the cap reads 30 fps give or take the display's timing (the page's
# `TARGET_SLACK_FPS`): frames every other refresh of a 60 Hz screen have a median of
# 30.0 ± a few hundredths.
TARGET_SLACK_FPS = 0.5
# Frames over budget allowed in any judged scenario, in percent: a frame over budget came
# more than 33.3 + 2 ms after the one before, so it missed its refresh and the one
# before stayed on screen twice. The owner's band (2026-10-23).
OVER_BUDGET_MAX_PCT = 5.0
# Memory Chromium may take on the board, in MB of PSS (shared pages counted once), at its
# peak over the run. The board has 2 GB (1974 MB usable); simulation and server have
# 300 MB of it (CLAUDE.md §4.8), and the system, its compositor and the page cache need
# several hundred more. R0's spike took about 540 MB. The owner's band (2026-10-23).
BROWSER_PSS_BUDGET_MB = 800.0
# The 7" screen the kiosk fills (ADR 0022: the board is measured on it, not a stand-in).
SCREEN = (1024, 600)
# The build the desk runs (`npm run build:kiosk`); the page reports it as its mode.
KIOSK_BUILD = "kiosk"
# The board slows itself down near this temperature (deploy/README.md), in °C.
THROTTLE_C = 80.0
# Sprite counts the atmosphere reports, in the order its table shows them; any other
# count it reports follows them.
ATMOSPHERE_COUNTS = (
    "lights",
    "weather",
    "ground",
    "flames",
    "burning",
    "ripples",
    "bolts",
    "snowfall",
    "sown",
)
# Atmosphere fields that are states, not counts.
ATMOSPHERE_STATES = ("light", "tint")
# What the page reports per scenario that metrics.json keeps, per profile and for the
# best one.
PAGE_KEYS = (
    "fps_median",
    "fps_1pct_low",
    "frame_ms_median",
    "frame_ms_p99",
    "frame_ms_max",
    "over_budget_pct",
    "headroom_ms_median",
    "headroom_ms_p99",
    "js_ms_median",
    "js_ms_p99",
    "js_heap_mb",
    "draws_median",
    "draws_max",
    "sprites",
    "textures",
    "creatures",
    "animals_in_sight",
)
# What the runner sampled per scenario that metrics.json keeps.
USAGE_KEYS = ("cpu_pct", "system_cpu_pct", "pss_mb", "temperature_c")
# Chromium's processes, in the order the tables show them.
PROCESS_KINDS = r0.PROCESS_KINDS

CRITERIA = [
    Criterion(
        "R5.1",
        "Lowest median frame rate among "
        + ", ".join(ACCEPTANCE_SCENARIOS)
        + f" with the best browser profile: the {TARGET_FPS:g} fps cap held "
        f"({TARGET_SLACK_FPS:g} fps of slack for the display's timing) (fps)",
        "best.acceptance.fps_median_min",
        low=TARGET_FPS - TARGET_SLACK_FPS,
    ),
    Criterion(
        "R5.2",
        "Most frames over the 33.3 ms budget in any of "
        + ", ".join(ACCEPTANCE_SCENARIOS)
        + f" with the best browser profile (%; band ≤ {OVER_BUDGET_MAX_PCT:g}, the owner's)",
        "best.acceptance.over_budget_pct_max",
        high=OVER_BUDGET_MAX_PCT,
    ),
    Criterion(
        "R5.3",
        "Peak memory of Chromium's processes (PSS) over the best profile's run, within the "
        f"board's budget (MB; band ≤ {BROWSER_PSS_BUDGET_MB:g}, the owner's, 2026-10-23)",
        "best.peak.pss_mb",
        high=BROWSER_PSS_BUDGET_MB,
    ),
    Criterion(
        "R5.4",
        "Measured as specified: on the ARM board, Chromium kiosk on the 7″ screen at "
        f"{SCREEN[0]}×{SCREEN[1]}, the desk's build capped at {TARGET_FPS:g} fps (1 = yes)",
        "evidence.as_specified",
        low=1.0,
    ),
]


def load(source: Path) -> dict[str, Any]:
    """Read the evidence: the file itself, or a directory holding ``kiosk-bench.json``."""
    path = source / EVIDENCE if source.is_dir() else source
    try:
        evidence = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise ValueError(
            f"{path} not found: R5 is built from the file tools/kiosk_bench.py writes"
        ) from None
    if evidence.get("tool") != TOOL or evidence.get("version") != VERSION:
        raise ValueError(f"{path}: not a {TOOL} version {VERSION} file")
    if Path(str(evidence.get("page", ""))).name != SCENE_PAGE:
        raise ValueError(
            f"{path}: measured the R0 spike, not the scene ({SCENE_PAGE}?bench); "
            "its report is tools.report R0"
        )
    return evidence


def _results(run: dict[str, Any]) -> dict[str, Any]:
    return run.get("results") or {}


def _scenarios(run: dict[str, Any]) -> list[dict[str, Any]]:
    return _results(run).get("scenarios", [])


def _scenario(run: dict[str, Any], name: str) -> dict[str, Any] | None:
    """A scenario the profile measured, None where it measured no frame of it."""
    found = next((s for s in _scenarios(run) if s["name"] == name), None)
    return found if found is not None and found.get("frames", 0) > 0 else None


def scenario_names(evidence: dict[str, Any]) -> list[str]:
    """Every scenario any profile measured, in the order the page runs them."""
    names: list[str] = []
    for run in evidence["runs"]:
        names += [s["name"] for s in _scenarios(run) if s["name"] not in names]
    return names


def best_run(evidence: dict[str, Any]) -> dict[str, Any] | None:
    """The profile the kiosk would run: the one that holds the judged views best.

    Frame rates within one frame a second count as equal (under the cap every profile
    that holds it reads 30); among those the fewest frames over budget win, then the
    least CPU over the judged scenarios, then the earlier, plainer profile. A profile
    that did not measure every judged scenario is not a candidate.
    """
    best: tuple[float, float, float] | None = None
    winner: dict[str, Any] | None = None
    for run in evidence["runs"]:
        if run["status"] != "ok":
            continue
        measured = [_scenario(run, name) for name in ACCEPTANCE_SCENARIOS]
        judged = [scenario for scenario in measured if scenario is not None]
        if len(judged) < len(ACCEPTANCE_SCENARIOS):
            continue
        slowest = min(float(scenario["fps_median"]) for scenario in judged)
        late = max(float(scenario.get("over_budget_pct") or 0.0) for scenario in judged)
        cpus = [run["usage"].get(name, {}).get("cpu_pct") for name in ACCEPTANCE_SCENARIOS]
        cpu = float("inf") if None in cpus else sum(c for c in cpus if c is not None)
        key = (-float(round(slowest)), late, cpu)
        if best is None or key < best:
            best, winner = key, run
    return winner


def _page_sizes(evidence: dict[str, Any]) -> set[tuple[int, int]]:
    """Every size the page had while it was measured."""
    return {
        (results["viewport"]["width"], results["viewport"]["height"])
        for run in evidence["runs"]
        if (results := run.get("results")) and results.get("viewport")
    }


def off_spec(evidence: dict[str, Any]) -> list[str]:
    """Why this evidence is not the measurement R5 asks for; empty when it is."""
    reasons: list[str] = []
    settings = evidence["settings"]
    machine = evidence["host"].get("machine", "")
    if machine not in r0.ARM_MACHINES:
        reasons.append(f"measured on {machine or 'an unknown machine'}, not on the ARM board")
    if settings.get("headless"):
        reasons.append("Chromium ran headless, not as a kiosk on the display")
    if settings.get("virtual_display"):
        reasons.append("the display was a virtual one: the GPU drew, no screen showed it")
    for width, height in sorted(_page_sizes(evidence)):
        if (width, height) != SCREEN:
            reasons.append(
                f"the page was {width}×{height}, not the 7″ screen's {SCREEN[0]}×{SCREEN[1]}"
            )
    cap = settings.get("fps_cap")
    if cap != TARGET_FPS:
        reasons.append(
            "the page was not capped"
            if not cap
            else f"the page was capped at {cap:g} fps, not {TARGET_FPS:g}"
        )
    modes = sorted(
        {str(_results(run).get("build_mode")) for run in evidence["runs"] if _results(run)}
    )
    for mode in modes:
        if mode != KIOSK_BUILD:
            reasons.append(f"the page was the {mode} build, not the desk's (npm run build:kiosk)")
    return reasons


def metrics(evidence: dict[str, Any]) -> dict[str, float]:
    out: dict[str, float] = {"evidence.as_specified": 0.0 if off_spec(evidence) else 1.0}
    memory = evidence["host"].get("memory_mb")
    if memory is not None:
        out["host.memory_mb"] = float(memory)

    def record(prefix: str, run: dict[str, Any], scenario: dict[str, Any]) -> None:
        for key in PAGE_KEYS:
            if scenario.get(key) is not None:
                out[f"{prefix}.{key}"] = float(scenario[key])
        usage = run["usage"].get(scenario["name"], {})
        for key in USAGE_KEYS:
            if usage.get(key) is not None:
                out[f"{prefix}.{key}"] = float(usage[key])

    def record_run(prefix: str, run: dict[str, Any]) -> None:
        peak = run.get("peak") or {}
        for key in ("pss_mb", "rss_sum_mb", "temperature_c"):
            if peak.get(key) is not None:
                out[f"{prefix}.peak.{key}"] = float(peak[key])
        if run.get("gpu_timeouts") is not None:
            out[f"{prefix}.gpu_timeouts"] = float(run["gpu_timeouts"])

    for run in evidence["runs"]:
        for scenario in _scenarios(run):
            if scenario.get("frames", 0) > 0:
                record(f"{run['profile']}.{scenario['name']}", run, scenario)
        record_run(run["profile"], run)
    best = best_run(evidence)
    if best is not None:
        for scenario in _scenarios(best):
            if scenario.get("frames", 0) > 0:
                record(f"best.{scenario['name']}", best, scenario)
        record_run("best", best)
        judged = [s for name in ACCEPTANCE_SCENARIOS if (s := _scenario(best, name))]
        out["best.acceptance.fps_median_min"] = min(float(s["fps_median"]) for s in judged)
        late = [float(s["over_budget_pct"]) for s in judged if s.get("over_budget_pct") is not None]
        if late:
            out["best.acceptance.over_budget_pct_max"] = max(late)
        gpu = _results(best).get("gpu") or {}
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


def _hangs(run: dict[str, Any] | None) -> str:
    if run is None:
        return "—"
    count = run.get("gpu_timeouts")
    return "not recorded (kernel log not readable)" if count is None else str(count)


def _cap(settings: dict[str, Any]) -> str:
    cap = settings.get("fps_cap")
    return f"capped at {cap:g} fps" if cap else "uncapped"


def header(evidence: dict[str, Any]) -> list[tuple[str, str]]:
    host, settings, results = evidence["host"], evidence["settings"], _first_results(evidence)
    window = "×".join(str(n) for n in settings.get("window", []))
    mode = "headless" if settings.get("headless") else "kiosk"
    page = results.get("settings") or {}
    best = best_run(evidence)
    return [
        (
            "Renderer build",
            f"{results.get('build_commit', 'unknown')} ({results.get('build_mode', 'unknown')})",
        ),
        ("Measured on", _where(evidence)),
        ("System", f"{host.get('os')}, Linux {host.get('kernel')}"),
        ("Browser", str(host.get("browser_version") or host.get("browser"))),
        ("Measured at", str(evidence.get("started_at"))),
        (
            "Settings",
            f"{settings.get('seconds'):g} s per scenario after {settings.get('warmup'):g} s "
            f"of warm-up, {mode} window {window}, {_cap(settings)}",
        ),
        ("Display", _display(results)),
        ("Profiles", ", ".join(run["profile"] for run in evidence["runs"])),
        (
            "World drawn",
            f"{(results.get('world') or {}).get('description', 'unknown')}; recording "
            f"{page.get('recording', 'unknown')} at {page.get('speed', '?')} sim-s a second, "
            f"seed {page.get('seed', '?')}",
        ),
        ("Best profile", "none finished" if best is None else best["profile"]),
        ("Drawn by", "—" if best is None else drawn_by(_results(best))),
        ("GPU hangs (best profile)", _hangs(best)),
    ]


def summary(evidence: dict[str, Any]) -> str:
    """One paragraph for the report's README."""
    settings, results = evidence["settings"], _first_results(evidence)
    text = (
        f"Measured on {_where(evidence)} with {evidence['host'].get('browser_version')}, "
        f"{evidence.get('started_at')}: {len(evidence['runs'])} browser profiles × "
        f"{len(scenario_names(evidence))} scenarios, {settings.get('seconds'):g} s each, "
        f"{_cap(settings)}, renderer build `{results.get('build_commit', 'unknown')}` "
        f"({results.get('build_mode', 'unknown')})."
    )
    best = best_run(evidence)
    if best is not None:
        text += f" Best profile: `{best['profile']}`, drawn by {drawn_by(_results(best))}"
        text += f"; GPU hangs: {_hangs(best)}."
    reasons = off_spec(evidence)
    if reasons:
        text += " **Not the R5 measurement:** " + "; ".join(reasons) + "."
    return text


def provenance(evidence: dict[str, Any]) -> dict[str, Any]:
    """What ``metrics.json`` records about where the numbers came from."""
    host, best, results = evidence["host"], best_run(evidence), _first_results(evidence)
    return {
        "evidence": EVIDENCE,
        "measured_at": evidence.get("started_at"),
        "renderer_commit": results.get("build_commit", "unknown"),
        "renderer_build": results.get("build_mode", "unknown"),
        "host": {
            key: host.get(key)
            for key in ("model", "machine", "os", "kernel", "cpu_count", "memory_mb")
        }
        | {"browser": host.get("browser_version")},
        "settings": evidence["settings"],
        "off_spec": off_spec(evidence),
        "best_profile": None if best is None else best["profile"],
        "drawn_by": None if best is None else drawn_by(_results(best)),
        "gpu_timeouts": None if best is None else best.get("gpu_timeouts"),
    }


# --- Report sections ----------------------------------------------------------------------


def _table(headers: list[str], rows: list[list[str]]) -> str:
    """An HTML table; cells are trusted markup, so callers escape what they did not write."""
    head = "".join(f"<th>{cell}</th>" for cell in headers)
    body = "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows)
    return f'<div class="wrap"><table><tr>{head}</tr>{body}</table></div>'


def _number(value: float | None, spec: str = ".1f", unit: str = "") -> str:
    return "—" if value is None else f"{value:{spec}}{unit}"


def _page_value(run: dict[str, Any], scenario: str, key: str) -> float | None:
    measured = _scenario(run, scenario)
    value = None if measured is None else measured.get(key)
    return None if value is None else float(value)


def _usage_value(run: dict[str, Any], scenario: str, key: str) -> float | None:
    if _scenario(run, scenario) is None:
        return None
    value = run["usage"].get(scenario, {}).get(key)
    return None if value is None else float(value)


Reader = Callable[[dict[str, Any], str, str], "float | None"]


def _per_profile(
    evidence: dict[str, Any], names: list[str], key: str, read: Reader = _page_value
) -> dict[str, list[float | None]]:
    """For each profile, one value per scenario in ``names``."""
    return {run["profile"]: [read(run, name, key) for name in names] for run in evidence["runs"]}


def _bars(
    evidence: dict[str, Any],
    key: str,
    *,
    title: str,
    ylabel: str,
    caption: str,
    reference: tuple[float, str] | None,
    read: Reader = _page_value,
) -> str:
    names = scenario_names(evidence)
    style.apply_style()
    figure = figures.grouped_bars(
        names,
        _per_profile(evidence, names, key, read),
        r0.profile_colours(evidence),
        title=title,
        ylabel=ylabel,
        reference=reference,
    )
    return figure_html(html.escape(caption), figures.to_data_uri(figure))


def _by_scenario_table(evidence: dict[str, Any], cell: Callable[[dict[str, Any], str], str]) -> str:
    """A table with a row per scenario and a column per profile."""
    e = html.escape
    heads = ["Scenario", *(e(run["profile"]) for run in evidence["runs"])]
    rows = [
        [e(name)] + [cell(run, name) for run in evidence["runs"]]
        for name in scenario_names(evidence)
    ]
    return _table(heads, rows)


def _judged_note() -> str:
    return (
        f"judged: {', '.join(ACCEPTANCE_SCENARIOS)}; "
        f"the atmosphere's, recorded without a band: {', '.join(ATMOSPHERE_SCENARIOS)}; "
        f"a day's turn and the views' switches, recorded without a band: "
        f"{', '.join(EVENT_SCENARIOS)} "
        "(the others measured with the sim-day held, as on the desk)"
    )


def _reading_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    reasons = off_spec(evidence)
    warning = (
        '<p class="FAIL">This is not the R5 measurement: '
        + e("; ".join(reasons))
        + ". It shows that the tooling works and nothing about the device.</p>"
        if reasons
        else ""
    )
    source = best_run(evidence) or next((run for run in evidence["runs"] if _scenarios(run)), None)
    rows: list[list[str]] = []
    for name in scenario_names(evidence):
        measured = next(
            (s for run in evidence["runs"] for s in _scenarios(run) if s["name"] == name), {}
        )
        if source is not None:
            measured = next((s for s in _scenarios(source) if s["name"] == name), measured)
        rows.append(
            [
                e(name),
                e(str(measured.get("about", ""))),
                e(str(measured.get("view", "—"))),
                "×".join(str(n) for n in measured.get("internal", [])),
                str(measured.get("sprites", "—")),
                str(measured.get("draws_median", "—")),
                str(measured.get("textures", "—")),
                f"{measured.get('animals_in_sight', '—')} / {measured.get('creatures', '—')}",
            ]
        )
    cap = evidence["settings"].get("fps_cap")
    note = (
        '<p class="note">Each browser profile starts Chromium afresh with different flags '
        "and runs every scenario, each on a fresh load of the scene playing the committed "
        "creatures' recording. The page counts the browser's own frames"
        + (
            f", capped at {cap:g} a second as the kiosk is (it draws every other refresh "
            "of a 60 Hz screen)"
            if cap
            else ""
        )
        + "; the runner samples Chromium's processes from /proc meanwhile. "
        f"Scenarios {e(_judged_note())}. “Drawn at” is the canvas before it is stretched "
        "to the screen; sprites, draw calls a frame (median), textures and animals (in "
        "sight / alive) are the best profile's at the end of each scenario.</p>"
    )
    return Section(
        "What was measured",
        warning
        + note
        + _table(
            [
                "Scenario",
                "What it is",
                "View",
                "Drawn at",
                "Sprites",
                "Draw calls",
                "Textures",
                "Animals",
            ],
            rows,
        ),
    )


def _profiles_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    rows: list[list[str]] = []
    for run in evidence["runs"]:
        profile = PROFILES.get(run["profile"])
        flags = " ".join(profile.flags) if profile is not None else " ".join(run["flags"])
        results = _results(run)
        rows.append(
            [
                e(run["profile"]),
                e(run["about"]),
                e(flags) or "—",
                e(f"{run['status']} {run['detail']}".strip()),
                e(drawn_by(results)) if results.get("scenarios") else "—",
                e(_hangs(run)),
            ]
        )
    return Section(
        "Browser profiles",
        '<p class="note">GPU hangs are the GPU jobs the kernel killed during the profile\'s '
        "run (“gpu sched timeout” in the kernel log, counted before and after; ADR 0010). A "
        "hang shows in the frame rate only as a slow frame.</p>"
        + _table(["Profile", "What it is", "Flags", "Outcome", "Drawn by", "GPU hangs"], rows),
    )


def _frame_rate_section(evidence: dict[str, Any]) -> Section:
    if not scenario_names(evidence):
        return Section("Frame rate", '<p class="empty">No profile measured anything.</p>')
    target = (TARGET_FPS, f"cap and target {TARGET_FPS:g} fps")
    median = _bars(
        evidence,
        "fps_median",
        title="Median frame rate by scenario and browser profile",
        ylabel="frame rate (fps)",
        caption="Median frame rate per scenario, one bar per browser profile; the dashed line "
        f"is the cap the kiosk runs at and the target R5.1 holds the judged views to "
        f"({_judged_note()})",
        reference=target,
    )
    low = _bars(
        evidence,
        "fps_1pct_low",
        title="1 % low frame rate by scenario and browser profile",
        ylabel="frame rate (fps)",
        caption="The rate of the slowest hundredth of frames, which is what stutter looks "
        "like; reported without a band",
        reference=target,
    )

    def cell(run: dict[str, Any], name: str) -> str:
        m, w = _page_value(run, name, "fps_median"), _page_value(run, name, "fps_1pct_low")
        return "—" if m is None else f"{m:.1f} <small>({_number(w)})</small>"

    return Section(
        "Frame rate",
        median
        + low
        + '<p class="note">Frames per second: median, and in brackets the 1 % low.</p>'
        + _by_scenario_table(evidence, cell),
    )


def _over_budget_section(evidence: dict[str, Any]) -> Section:
    if not scenario_names(evidence):
        return Section("Frames over budget", '<p class="empty">Nothing measured.</p>')
    figure = _bars(
        evidence,
        "over_budget_pct",
        title="Frames over budget by scenario and browser profile",
        ylabel="frames over budget (%)",
        caption="Share of frames that came more than 33.3 + 2 ms after the one before: a "
        f"refresh missed. The dashed line is R5.2's band for the judged views "
        f"(≤ {OVER_BUDGET_MAX_PCT:g} %, the owner's)",
        reference=(OVER_BUDGET_MAX_PCT, f"R5.2 band {OVER_BUDGET_MAX_PCT:g} %"),
    )

    def cell(run: dict[str, Any], name: str) -> str:
        return _number(_page_value(run, name, "over_budget_pct"), ".1f", " %")

    return Section("Frames over budget", figure + _by_scenario_table(evidence, cell))


def _headroom_section(evidence: dict[str, Any]) -> Section:
    if not scenario_names(evidence):
        return Section("Headroom", '<p class="empty">Nothing measured.</p>')
    figure = _bars(
        evidence,
        "headroom_ms_median",
        title="Frame-time headroom by scenario and browser profile",
        ylabel="headroom (ms of 33.3)",
        caption="What the page's script leaves of a frame's 33.3 ms at 30 fps, median; the "
        "GPU's time is not in it",
        reference=None,
    )

    def headroom(run: dict[str, Any], name: str) -> str:
        m = _page_value(run, name, "headroom_ms_median")
        p = _page_value(run, name, "headroom_ms_p99")
        return "—" if m is None else f"{m:.1f} <small>({_number(p)})</small>"

    def script(run: dict[str, Any], name: str) -> str:
        m, p = _page_value(run, name, "js_ms_median"), _page_value(run, name, "js_ms_p99")
        return "—" if m is None else f"{m:.2f} <small>({_number(p, '.2f')})</small>"

    def frames(run: dict[str, Any], name: str) -> str:
        p, w = _page_value(run, name, "frame_ms_p99"), _page_value(run, name, "frame_ms_max")
        return "—" if p is None else f"{p:.1f} <small>({_number(w)})</small>"

    return Section(
        "Headroom",
        figure + '<p class="note">Headroom in milliseconds: median, and in brackets the 99th '
        "percentile (the frames with the least room). A scene at the cap with little room "
        "is one the next cost pushes over.</p>"
        + _by_scenario_table(evidence, headroom)
        + '<p class="note">Script time a frame in milliseconds (moving the scene and handing '
        "it to the GPU): median, and in brackets the 99th percentile.</p>"
        + _by_scenario_table(evidence, script)
        + '<p class="note">Time between frames in milliseconds: 99th percentile, and in '
        "brackets the longest.</p>" + _by_scenario_table(evidence, frames),
    )


# The phases of a frame as the page's probe times them (`renderer/src/frameprobe.ts`).
PROBE_PHASES = ("messages", "director", "landscape", "herd", "atmosphere", "overlays", "render")


def _counts(counts: dict[str, Any]) -> str:
    """``{"herd": 5, "outside": 2}`` as "herd 5, outside 2", the most first."""
    ranked = sorted(counts.items(), key=lambda item: (-int(item[1]), item[0]))
    return ", ".join(f"{html.escape(str(name))} {int(count)}" for name, count in ranked) or "—"


def _late_frames_section(evidence: dict[str, Any]) -> Section:
    """Where the frames' time went, what the late ones held, and the ground's paintings."""
    title = "Where the frames go"
    run = best_run(evidence)
    scenarios = [] if run is None else _scenarios(run)
    probed = [scenario for scenario in scenarios if scenario.get("probe")]
    if not probed:
        return Section(
            title,
            '<p class="empty">Not recorded in this run: the page\'s frame probe and the count '
            "of the ground's paintings came after it.</p>",
        )
    e = html.escape

    def phase_cell(scenario: dict[str, Any], phase: str) -> str:
        probe = scenario["probe"]
        median = (probe.get("phases_ms_median") or {}).get(phase)
        p99 = (probe.get("phases_ms_p99") or {}).get(phase)
        return f"{_number(median, '.1f')} <small>({_number(p99, '.1f')})</small>"

    phase_rows = [
        [e(scenario["name"]), *(phase_cell(scenario, phase) for phase in PROBE_PHASES)]
        for scenario in probed
    ]
    late_rows = [
        [
            e(scenario["name"]),
            _counts(scenario["probe"].get("late_by_phase") or {}),
            _counts(scenario["probe"].get("late_notes") or {}),
            _ground_made(scenario.get("ground_made")),
        ]
        for scenario in probed
    ]
    profile = e(run["profile"]) if run is not None else ""
    return Section(
        title,
        f'<p class="note">The {profile} profile. Each frame\'s script by phase, in '
        "milliseconds: median, and in brackets the 99th percentile. Render is Pixi's draw "
        "(handing the frame to the GPU); messages is the stream's, received between "
        "frames.</p>"
        + _table(["Scenario", *(e(phase) for phase in PROBE_PHASES)], phase_rows)
        + '<p class="note">The frames over budget, each put down to the phase that took '
        'most of it, or "outside" when the script took less than half of it (garbage '
        "collection, the GPU, the compositor); what happened in them (a message's type, "
        "a ground piece placed, a lay-out, plants built, a portrait drawn); and of the "
        "ground's paintings made in the scenario's page, how many had their colour pass "
        "on the GPU.</p>"
        + _table(
            ["Scenario", "Late frames by phase", "What they held", "Ground on the GPU"], late_rows
        ),
    )


def _ground_made(made: Any) -> str:
    if not isinstance(made, dict):
        return "—"
    gpu = int(made.get("gpu", 0))
    total = gpu + int(made.get("cpu", 0))
    return "—" if total == 0 else f"{gpu} of {total}"


def _atmosphere_counts(scenarios: list[dict[str, Any]]) -> list[str]:
    """The atmosphere's sprite counts any of ``scenarios`` reported, known ones first."""
    found: list[str] = []
    for scenario in scenarios:
        for key, value in (scenario.get("atmosphere") or {}).items():
            numeric = isinstance(value, int | float) and not isinstance(value, bool)
            if numeric and key not in ATMOSPHERE_STATES and key not in found:
                found.append(key)
    known = [key for key in ATMOSPHERE_COUNTS if key in found]
    return known + [key for key in found if key not in ATMOSPHERE_COUNTS]


def _atmosphere_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    best = best_run(evidence)
    if best is None:
        return Section("The atmosphere", '<p class="empty">No profile finished.</p>')
    measured = [
        s
        for name in (*ATMOSPHERE_SCENARIOS, *EVENT_SCENARIOS)
        if (s := _scenario(best, name)) is not None
    ]
    if not measured:
        return Section("The atmosphere", '<p class="empty">Not measured in this run.</p>')
    reference = _scenario(best, HEAVIEST_SCENARIO)
    counts = _atmosphere_counts(measured)
    rows: list[list[str]] = []
    for scenario in ([reference] if reference is not None else []) + measured:
        name = scenario["name"]
        atmosphere = scenario.get("atmosphere") or {}
        rows.append(
            [
                e(name),
                _number(scenario.get("fps_median")),
                _number(scenario.get("fps_1pct_low")),
                _number(scenario.get("over_budget_pct"), ".1f", " %"),
                _number(scenario.get("headroom_ms_p99")),
                _number(_usage_value(best, name, "cpu_pct"), ".0f", " %"),
                str(scenario.get("draws_median", "—")),
            ]
            + [str(atmosphere.get(key, "—")) for key in counts]
        )
    return Section(
        "The atmosphere",
        f'<p class="note">What the atmosphere costs, with the best profile '
        f"({e(best['profile'])}), beside {e(HEAVIEST_SCENARIO)} with none: recorded without a "
        "band. The counts are the atmosphere's sprites at the end of each scenario (lights: "
        "glow halos; weather: rain, smoke and ash; ground: marks on the land; flames; burning "
        "cells; ripples; lightning bolts).</p>"
        + _table(
            [
                "Scenario",
                "fps median",
                "1 % low",
                "over budget",
                "headroom p99 (ms)",
                "CPU",
                "draw calls",
                *(e(key) for key in counts),
            ],
            rows,
        ),
    )


def _timeline(
    evidence: dict[str, Any], key: str
) -> tuple[dict[str, tuple[list[float], list[float | None]]], list[tuple[float, str]]]:
    """Per profile, ``key`` at the middle of each scenario, in minutes from its first.

    The marks name the best profile's scenarios at their places on the axis.
    """
    series: dict[str, tuple[list[float], list[float | None]]] = {}
    marks: list[tuple[float, str]] = []
    best = best_run(evidence)
    for run in evidence["runs"]:
        measured = [s for s in _scenarios(run) if "started_epoch_ms" in s]
        if not measured:
            continue
        origin = float(measured[0]["started_epoch_ms"])
        xs = [
            (float(s["started_epoch_ms"]) + float(s["ended_epoch_ms"])) / 2.0 - origin
            for s in measured
        ]
        minutes = [x / 60_000.0 for x in xs]
        values = [run["usage"].get(s["name"], {}).get(key) for s in measured]
        series[run["profile"]] = (minutes, values)
        if run is best or (best is None and not marks):
            marks = [(x, s["name"]) for x, s in zip(minutes, measured, strict=True)]
    return series, marks


def _cpu_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    cpu, marks = _timeline(evidence, "cpu_pct")
    if not any(v is not None for _, values in cpu.values() for v in values):
        return Section(
            "CPU and temperature", '<p class="empty">The runner recorded no CPU usage.</p>'
        )
    cores = evidence["host"].get("cpu_count")
    colours = r0.profile_colours(evidence)
    style.apply_style()
    cpu_figure = figures.lines_over_time(
        cpu,
        colours,
        title="Chromium CPU over the run",
        xlabel="minutes from the profile's first scenario",
        ylabel="CPU (% of one core)",
        marks=marks,
        reference=(100.0, "one core"),
    )
    body = figure_html(
        e(
            "CPU time of every Chromium process together during each scenario, in percent "
            f"of one core (this machine has {cores}), one line per browser profile; the "
            "simulation needs up to 25 % of one core beside it (CLAUDE.md §4.8)"
        ),
        figures.to_data_uri(cpu_figure),
    )
    temperature, _ = _timeline(evidence, "temperature_c")
    if any(v is not None for _, values in temperature.values() for v in values):
        style.apply_style()
        heat = figures.lines_over_time(
            temperature,
            colours,
            title="Temperature over the run",
            xlabel="minutes from the profile's first scenario",
            ylabel="temperature (°C)",
            marks=marks,
            reference=(THROTTLE_C, f"the board slows down near {THROTTLE_C:g} °C"),
        )
        body += figure_html(
            e(
                "The hottest thermal zone during each scenario; profiles run one after "
                "another, so a later one starts warmer. Reported without a band"
            ),
            figures.to_data_uri(heat),
        )

    def cell(run: dict[str, Any], name: str) -> str:
        own = _usage_value(run, name, "cpu_pct")
        machine = _usage_value(run, name, "system_cpu_pct")
        if own is None:
            return "—"
        return f"{own:.0f} % <small>({_number(machine, '.0f', ' %')})</small>"

    body += (
        '<p class="note">Chromium in percent of one core, and in brackets the whole machine '
        "in percent of all its cores.</p>" + _by_scenario_table(evidence, cell)
    )
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
            + [_number(other, ".0f", " %")]
        )
    body += (
        f'<p class="note">Where it goes in {e(HEAVIEST_SCENARIO)}, by Chromium process: the '
        "renderer process runs the page's script, the GPU process draws (on the CPU when "
        "rendering is in software).</p>" + _table(["Profile", *PROCESS_KINDS, "other"], kinds)
    )

    def heat_cell(run: dict[str, Any], name: str) -> str:
        return _number(_usage_value(run, name, "temperature_c"), ".0f", " °C")

    if temperature:
        body += '<p class="note">Temperature per scenario.</p>' + _by_scenario_table(
            evidence, heat_cell
        )
    return Section("CPU and temperature", body)


def _memory_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    rows: list[list[str]] = []
    for run in evidence["runs"]:
        peak = run.get("peak") or {}
        heaps = [float(s["js_heap_mb"]) for s in _scenarios(run) if s.get("js_heap_mb")]
        rows.append(
            [
                e(run["profile"]),
                _number(_usage_value(run, HEAVIEST_SCENARIO, "pss_mb"), ".0f"),
                _number(peak.get("pss_mb"), ".0f"),
                _number(peak.get("rss_sum_mb"), ".0f"),
                _number(max(heaps) if heaps else None, ".0f"),
                str(peak.get("processes", "—")),
            ]
        )
    total = evidence["host"].get("memory_mb")
    note = (
        '<p class="note">Memory of every Chromium process together, in MB. PSS counts pages '
        "shared between processes once and is the figure R5.3 budgets: its peak over the "
        f"profile's whole run, against ≤ {BROWSER_PSS_BUDGET_MB:g} MB. The sum of RSS counts "
        "shared pages once per process and is shown only because it is what top reports; "
        "the JS heap is the page's own, at the end of a scenario (0 where the browser hides "
        f"it). This machine has {_number(total, '.0f')} MB in all; on the board simulation "
        "and server get 300 MB of its 2 GB (CLAUDE.md §4.8), and R0's spike took about "
        "540 MB.</p>"
    )
    return Section(
        "Memory",
        note
        + _table(
            [
                "Profile",
                f"PSS in {e(HEAVIEST_SCENARIO)}",
                "Peak PSS",
                "Peak RSS sum",
                "Largest JS heap",
                "Processes",
            ],
            rows,
        ),
    )


def _host_section(evidence: dict[str, Any]) -> Section:
    e = html.escape
    host, results = evidence["host"], _first_results(evidence)
    screen = results.get("screen") or {}
    gpu = results.get("gpu") or {}
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
        ("WebGL", gpu.get("webgl_version")),
        ("GPU driver", gpu.get("unmasked_renderer") or gpu.get("renderer")),
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
        _over_budget_section(evidence),
        _headroom_section(evidence),
        _late_frames_section(evidence),
        _atmosphere_section(evidence),
        _cpu_section(evidence),
        _memory_section(evidence),
        _host_section(evidence),
    ]
