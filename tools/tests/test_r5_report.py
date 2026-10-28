"""The R5 report: the scene's benchmark on the device, read under the kiosk's 30 fps cap."""

from __future__ import annotations

import json
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import pytest

from tools.milestones import r5
from tools.report import build_report
from tools.runs import REPO_ROOT

R5_IDS = ("R5.1", "R5.2", "R5.3", "R5.4")
SCENARIOS = (*r5.ACCEPTANCE_SCENARIOS, *r5.ATMOSPHERE_SCENARIOS)
# Milliseconds between scenarios' starts in the fixture: 3 s measured, the rest loading.
SCENARIO_SPACING_MS = 12_000.0
FIRST_START_MS = 1_792_747_000_000.0


class _Page(HTMLParser):
    """Text, image sources and outside links of a report page; tags must balance."""

    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str] = []
        self.text: list[str] = []
        self.img_srcs: list[str] = []
        self.external: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "img":
            self.img_srcs.append(a.get("src") or "")
        for key in ("src", "href"):
            if (a.get(key) or "").startswith(("http:", "https:", "//")):
                self.external.append(a[key] or "")
        if tag not in {"meta", "img", "br", "link"}:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        assert self.stack, f"unexpected </{tag}>"
        assert self.stack[-1] == tag, f"unbalanced </{tag}> in {self.stack}"
        self.stack.pop()

    def handle_data(self, data: str) -> None:
        self.text.append(data)


def _page(path: Path) -> _Page:
    page = _Page()
    page.feed(path.read_text(encoding="utf-8"))
    page.close()
    assert page.stack == [], f"unclosed tags: {page.stack}"
    return page


def _scenario(
    name: str, index: int, fps: float, over: float, atmosphere: dict[str, Any]
) -> dict[str, Any]:
    """One scenario as the scene's page reports it (renderer/src/bench.ts)."""
    started = FIRST_START_MS + index * SCENARIO_SPACING_MS
    return {
        "name": name,
        "about": f"what {name} shows",
        "view": "map" if name in ("map", "apocalypse") else "middle",
        "internal": [514, 302],
        "frames": int(fps * 3),
        "fps_median": fps,
        "fps_1pct_low": fps - 1.0,
        "frame_ms_median": 1000.0 / fps,
        "frame_ms_p99": 36.0,
        "frame_ms_max": 40.0,
        "frame_budget_ms": 1000.0 / 30.0,
        "over_budget_pct": over,
        "headroom_ms_median": 25.0,
        "headroom_ms_p99": 12.5,
        "js_ms_median": 4.0,
        "js_ms_p99": 9.0,
        "js_heap_mb": 120.0,
        "draws_median": 8,
        "draws_max": 9,
        "sprites": 4271,
        "textures": 13,
        "creatures": 199,
        "animals_in_sight": 72,
        "atmosphere": {"light": 1, "tint": 16776434, "rain": "none", "act": None} | atmosphere,
        "started_epoch_ms": started,
        "ended_epoch_ms": started + 3000.0,
        "stalled": False,
        "probe": {
            "phases_ms_median": {"herd": 2.3, "render": 1.6},
            "phases_ms_p99": {"herd": 8.2, "render": 3.8},
            "late_by_phase": {"outside": 2, "herd": 5},
            "late_notes": {"creatures": 3},
            "worst": [],
        },
        "ground_made": {"gpu": 12, "cpu": 1},
    }


def _run(
    profile: str,
    fps: float | None,
    *,
    over: float = 1.5,
    cpu: float = 150.0,
    pss: float = 610.0,
    hangs: int | None = 0,
    driver: str = "ANGLE (Mesa, Mali-G31 (Panfrost), OpenGL ES 3.1)",
    build: str = "kiosk",
    page_size: tuple[int, int] = (1024, 600),
) -> dict[str, Any]:
    """One browser profile: ``fps`` and ``over`` in every scenario; None: no results."""
    run: dict[str, Any] = {
        "profile": profile,
        "about": f"about {profile}",
        "flags": ["--kiosk", "--no-first-run"],
        "url": "http://127.0.0.1:8137/index.html?bench=1&cap=30",
        "status": "ok",
        "detail": "",
        "duration_s": 140.0,
        "results": None,
        "usage": {},
        "peak": {},
        "gpu_timeouts": hangs,
    }
    if fps is None:
        return run | {"status": "timeout", "detail": "no results after 306 s"}
    counts = {"fire": {"flames": 454, "burning": 300, "lights": 1342}, "night": {"lights": 141}}
    run["results"] = {
        "tool": "lineage-renderer-bench",
        "version": 1,
        "page": "scene",
        "build_commit": "b4c37380bb44",
        "build_mode": build,
        "user_agent": "Mozilla/5.0 (X11; Linux aarch64) <Chromium>",
        "screen": {"width": page_size[0], "height": page_size[1], "device_pixel_ratio": 1},
        "viewport": {"width": page_size[0], "height": page_size[1]},
        "gpu": {
            "api": "webgl",
            "webgl_version": "WebGL 2.0",
            "unmasked_renderer": driver,
            "software": "SwiftShader" in driver,
        },
        "world": {"description": "256×150 cells, 200 animals, world seed 42"},
        "settings": {
            "backend": "webgl",
            "seed": 2026,
            "cap_fps": 30,
            "recording": "stream/life.json",
            "speed": 1800,
        },
        "scenarios": [
            _scenario(name, index, fps, over, counts.get(name, {}))
            for index, name in enumerate(SCENARIOS)
        ],
        "error": None,
    }
    run["usage"] = {
        name: {
            "samples": 4,
            "cpu_pct": cpu + index,
            "cpu_pct_by_kind": {"renderer": cpu * 0.3, "gpu": cpu * 0.7},
            "system_cpu_pct": cpu / 4.0,
            "pss_mb": pss - 20.0,
            "rss_sum_mb": pss * 2,
            "temperature_c": 60.0 + index,
        }
        for index, name in enumerate(SCENARIOS)
    }
    run["peak"] = {"pss_mb": pss, "rss_sum_mb": pss * 2, "temperature_c": 70.0, "processes": 9}
    return run


def _evidence(
    tmp_path: Path,
    runs: list[dict[str, Any]],
    *,
    machine: str = "aarch64",
    headless: bool = False,
    fps_cap: float | None = 30.0,
    page: str = "index.html",
) -> Path:
    """Write a small kiosk-bench.json, as tools/kiosk_bench.py writes it on the board."""
    evidence = {
        "tool": "lineage-kiosk-bench",
        "version": 1,
        "started_at": "2026-10-24T09:30:00+00:00",
        "host": {
            "hostname": "lineage",
            "model": "OrangePi Zero 2W",
            "os": "Armbian 25.11 trixie",
            "kernel": "6.18.57-current-sunxi64",
            "machine": machine,
            "cpu": "",
            "cpu_count": 4,
            "memory_mb": 1974,
            "session": "wayland",
            "display": "wayland-0",
            "browser": "/usr/bin/chromium",
            "browser_version": "Chromium 155.0.8059.79",
            "glxinfo": "",
        },
        "page": page,
        "settings": {
            "seconds": 3.0,
            "warmup": 1.0,
            "only": None,
            "fps_cap": fps_cap,
            "window": [1024, 600],
            "headless": headless,
            "virtual_display": False,
            "sandbox": True,
        },
        "runs": runs,
    }
    folder = tmp_path / "from-the-board"
    folder.mkdir(exist_ok=True)
    (folder / "kiosk-bench.json").write_text(json.dumps(evidence), encoding="utf-8")
    return folder


def _doc(out: Path) -> dict[str, Any]:
    return json.loads((out / "metrics.json").read_text(encoding="utf-8"))


def _statuses(doc: dict[str, Any]) -> dict[str, str]:
    return {a["id"]: a["status"] for a in doc["acceptance"]}


def test_r5_report_from_the_board(tmp_path: Path) -> None:
    runs = [
        _run("default", 29.97, over=0.8, cpu=170.0, hangs=2),
        _run("gpu-gles", 30.0, over=0.4, cpu=140.0, pss=640.0),
        _run("software", 12.0, driver="ANGLE (Google, SwiftShader driver)", hangs=None),
        _run("gpu", None),
    ]
    out = build_report("R5", _evidence(tmp_path, runs), tmp_path / "reports")
    assert out.name == "R5-device"
    assert {p.name for p in out.iterdir()} == {
        "report.html",
        "metrics.json",
        "README.md",
        "kiosk-bench.json",
    }
    doc = _doc(out)
    assert doc["milestone"] == "R5"
    assert doc["best_profile"] == "gpu-gles"
    assert doc["drawn_by"] == "WebGL on ANGLE (Mesa, Mali-G31 (Panfrost), OpenGL ES 3.1)"
    assert doc["renderer_build"] == "kiosk"
    assert doc["off_spec"] == []
    assert doc["gpu_timeouts"] == 0
    assert _statuses(doc) == dict.fromkeys(R5_IDS, "PASS")
    metrics = doc["metrics"]
    assert metrics["best.acceptance.fps_median_min"] == 30.0
    assert metrics["best.acceptance.over_budget_pct_max"] == 0.4
    assert metrics["best.peak.pss_mb"] == 640.0
    assert metrics["best.middle-crowd.cpu_pct"] == 142.0
    assert metrics["best.fire.headroom_ms_p99"] == 12.5
    assert metrics["best.drawn_by_gpu"] == 1.0
    assert metrics["default.gpu_timeouts"] == 2.0
    assert metrics["software.local.fps_median"] == 12.0
    assert "software.gpu_timeouts" not in metrics
    # A profile that timed out measured no frame; the hangs it caused still count.
    assert {name for name in metrics if name.startswith("gpu.")} == {"gpu.gpu_timeouts"}

    page = _page(out / "report.html")
    text = " ".join(page.text)
    for expected in (
        "OrangePi Zero 2W",
        "Mali-G31 (Panfrost)",
        "SwiftShader",
        "b4c37380bb44 (kiosk)",
        "timeout no results after 306 s",
        "not recorded (kernel log not readable)",
        "capped at 30 fps",
        "1342",  # the fire's glow halos, in the atmosphere's table
        "Where the frames go",
        "herd 5, outside 2",  # the late frames by phase, the most first
        "12 of 13",  # the ground's paintings on the GPU
    ):
        assert expected in text, expected
    assert "not the R5 measurement" not in text
    assert page.external == [], "report must be self-contained"
    # Frame rate (median, 1 % low), over budget, headroom, CPU and temperature.
    assert len(page.img_srcs) == 6
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "**PASS** R5.3" in readme
    assert "Best profile: `gpu-gles`" in readme


@pytest.mark.parametrize(
    ("change", "failed"),
    [
        ({"fps": 29.4}, "R5.1"),
        ({"over": 6.0}, "R5.2"),
        ({"pss": 820.0}, "R5.3"),
    ],
)
def test_r5_fails_each_criterion_on_its_own(
    tmp_path: Path, change: dict[str, float], failed: str
) -> None:
    settings: dict[str, Any] = {"fps": 30.0, "over": 1.0, "pss": 600.0} | change
    run = _run("gpu", settings.pop("fps"), **settings)
    doc = _doc(build_report("R5", _evidence(tmp_path, [run]), tmp_path / "reports"))
    assert _statuses(doc) == dict.fromkeys(R5_IDS, "PASS") | {failed: "FAIL"}


def test_r5_holding_the_cap_allows_the_displays_timing(tmp_path: Path) -> None:
    """Every other refresh of a 60 Hz screen reads 30 fps give or take a little."""
    doc = _doc(build_report("R5", _evidence(tmp_path, [_run("gpu", 29.6)]), tmp_path / "a"))
    assert _statuses(doc)["R5.1"] == "PASS"


def test_r5_is_measured_on_the_board_on_its_screen_capped(tmp_path: Path) -> None:
    desk = _evidence(
        tmp_path,
        [_run("default", 60.0, build="production", page_size=(1920, 1080))],
        machine="x86_64",
        headless=True,
        fps_cap=None,
    )
    out = build_report("R5", desk, tmp_path / "reports")
    doc = _doc(out)
    assert doc["off_spec"] == [
        "measured on x86_64, not on the ARM board",
        "Chromium ran headless, not as a kiosk on the display",
        "the page was 1920×1080, not the 7″ screen's 1024×600",
        "the page was not capped",
        "the page was the production build, not the desk's (npm run build:kiosk)",
    ]
    assert _statuses(doc) == dict.fromkeys(R5_IDS[:3], "PASS") | {"R5.4": "FAIL"}
    assert "**Not the R5 measurement:**" in (out / "README.md").read_text(encoding="utf-8")
    assert "This is not the R5 measurement" in " ".join(_page(out / "report.html").text)

    other_cap = _evidence(tmp_path, [_run("gpu", 30.0)], fps_cap=60.0)
    assert _doc(build_report("R5", other_cap, tmp_path / "b"))["off_spec"] == [
        "the page was capped at 60 fps, not 30"
    ]


def test_r5_best_profile_at_the_cap_has_fewest_late_frames(tmp_path: Path) -> None:
    runs = [
        _run("default", 30.0, over=3.0, cpu=90.0),
        _run("gpu", 29.9, over=0.5, cpu=200.0),
        _run("gpu-gles", 30.0, over=0.5, cpu=150.0),
        _run("software", 24.0, over=0.0, cpu=10.0),
    ]
    doc = _doc(build_report("R5", _evidence(tmp_path, runs), tmp_path / "reports"))
    assert doc["best_profile"] == "gpu-gles"


def test_r5_needs_every_judged_view_from_one_profile(tmp_path: Path) -> None:
    partial = _run("gpu", 30.0)
    partial["results"]["scenarios"] = [
        s for s in partial["results"]["scenarios"] if s["name"] != "local"
    ]
    doc = _doc(
        build_report(
            "R5", _evidence(tmp_path, [partial, _run("default", 30.0)]), tmp_path / "reports"
        )
    )
    assert doc["best_profile"] == "default"


def test_r5_without_a_finished_profile_has_no_verdict(tmp_path: Path) -> None:
    evidence = _evidence(tmp_path, [_run("default", None), _run("gpu", None)])
    out = build_report("R5", evidence, tmp_path / "reports")
    doc = _doc(out)
    assert _statuses(doc) == dict.fromkeys(R5_IDS[:3], "MISSING") | {"R5.4": "PASS"}
    assert doc["best_profile"] is None
    assert "No profile measured anything" in " ".join(_page(out / "report.html").text)


def test_r5_rebuilds_from_its_own_report_directory(tmp_path: Path) -> None:
    """The evidence is committed with the report, so the report can be regenerated."""
    out = build_report("R5", _evidence(tmp_path, [_run("gpu", 30.0)]), tmp_path / "reports")
    before = {p.name: p.read_bytes() for p in out.iterdir()}
    assert build_report("R5", out, tmp_path / "reports") == out
    assert {p.name: p.read_bytes() for p in out.iterdir()} == before


def test_r5_reads_only_the_scenes_benchmark(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"kiosk-bench\.json not found"):
        build_report("R5", tmp_path, tmp_path / "reports")
    spike = _evidence(tmp_path, [_run("gpu", 30.0)], page="spike.html")
    with pytest.raises(ValueError, match="measured the R0 spike"):
        build_report("R5", spike, tmp_path / "reports")
    assert not (tmp_path / "reports").exists()


def test_r5_judges_what_the_page_judges() -> None:
    """The scenario sets, target and slack are written down twice: here and in the page."""
    renderer = REPO_ROOT / "renderer" / "src"
    plan = (renderer / "benchplan.ts").read_text(encoding="utf-8")
    for name, expected in (
        ("ACCEPTANCE", r5.ACCEPTANCE_SCENARIOS),
        ("ATMOSPHERE", r5.ATMOSPHERE_SCENARIOS),
        ("EVENTS", r5.EVENT_SCENARIOS),
    ):
        listed = re.search(rf"export const {name}[^=]*= \[(.*?)\];", plan, re.DOTALL)
        assert listed is not None, name
        assert tuple(re.findall(r'"([^"]+)"', listed.group(1))) == expected
    bench = (renderer / "bench.ts").read_text(encoding="utf-8")
    assert f"TARGET_FPS = {r5.TARGET_FPS:g};" in bench
    assert f"TARGET_SLACK_FPS = {r5.TARGET_SLACK_FPS:g};" in bench
    assert r5.HEAVIEST_SCENARIO in r5.ACCEPTANCE_SCENARIOS


def test_r5_says_when_a_run_has_no_frame_probe(tmp_path: Path) -> None:
    run = _run("default", 30.0)
    for scenario in run["results"]["scenarios"]:
        del scenario["probe"]
        del scenario["ground_made"]
    out = build_report("R5", _evidence(tmp_path, [run]), tmp_path / "reports")
    text = " ".join(_page(out / "report.html").text)
    assert "Not recorded in this run" in text
