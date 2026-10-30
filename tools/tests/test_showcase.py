"""The showcase's runner (R5): what it makes of the page's frame reports."""

from __future__ import annotations

import re

import pytest

from tools import kiosk_bench as kb
from tools import showcase
from tools.runs import REPO_ROOT


def report(loop: int, frames: list[tuple[int, float]], t: float = 5.0) -> dict[str, object]:
    return {"tool": showcase.REPORT_TOOL, "t": t, "loop": loop, "frames": frames, "heap_mb": 41.0}


def test_the_acts_are_the_scripts() -> None:
    script = (REPO_ROOT / "renderer" / "src" / "showcase" / "script.ts").read_text("utf-8")
    acts = script[script.index("export const ACTS") :]
    assert tuple(re.findall(r'name: "([a-z]+)"', acts)) == showcase.ACTS


def test_frames_a_second_and_the_share_late() -> None:
    steady = [1000 / 30] * 99 + [50.0]
    fps = showcase.fps_of(steady)
    assert fps["median"] == pytest.approx(30.0)
    assert fps["late_pct"] == pytest.approx(1.0)
    assert fps["average"] == pytest.approx(100 / (99 / 30 + 0.05))
    assert fps["low"] == pytest.approx(30.0)
    assert showcase.fps_of([]) == {"average": 0.0, "median": 0.0, "low": 0.0, "late_pct": 0.0}


def test_reports_are_kept_by_act_and_loop() -> None:
    frames = showcase.Frames()
    frames.take(report(0, [(0, 33.3), (1, 33.4), (1, 50.0)]))
    frames.take(report(1, [(0, 33.3)], t=170.0))
    assert len(frames.all) == 4
    assert frames.by_act == {0: [33.3, 33.3], 1: [33.4, 50.0]}
    assert sorted(frames.by_loop) == [0, 1]
    assert (frames.last_loop, frames.last_act, frames.last_t, frames.heap_mb) == (1, 0, 170.0, 41.0)


def test_the_summary_says_how_it_ran() -> None:
    frames = showcase.Frames()
    frames.take(report(0, [(7, 33.3)] * 98 + [(7, 60.0), (7, 70.0)]))
    sample = kb.Sample(
        epoch_ms=0.0,
        ticks={},
        kinds={},
        rss_kb=900 * 1024,
        pss_kb=580 * 1024,
        system_busy=0,
        system_total=1,
        mem_available_kb=None,
        temperature_c=73.5,
    )
    lines = showcase.summary(frames, 125.0, [sample, sample], 0)
    text = "\n".join(lines)
    assert lines[0] == "showcase: 2 min 05 s, 1 loop(s), 100 frames"
    assert "late frames (> 40 ms) 2.0 %" in text
    assert "weather 2.0 %" in text
    assert "memory 580 MB peak (PSS)" in text
    assert "heap 41 MB" in text
    assert "74 °C peak" in text
    assert "GPU hangs 0" in text
    # Nothing come from the page yet: it says so, without dividing by nothing.
    assert "0 frames" in showcase.summary(showcase.Frames(), 3.0, [], None)[0]


def test_the_status_line_and_the_page_asked_for() -> None:
    frames = showcase.Frames()
    frames.take(report(2, [(9, 33.3)] * 10))
    assert showcase.status_line(frames, 71.2).startswith("loop 3, powers: 30.0 fps, 0.0 % late")
    url = showcase.page_url(8140, 30)
    for part in ("showcase=1", "quiet=1", "fps=1", "post=%2Fresults", "cap=30", "speed=120"):
        assert part in url
    assert "cap=" not in showcase.page_url(8140, None)
