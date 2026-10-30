"""tools.server_watch: a running server's numbers judged against the device's budgets."""

from __future__ import annotations

from typing import Any

from tools import server_watch


def _sample(wall_s: float, cpu_s: float, **more: Any) -> dict[str, Any]:
    base: dict[str, Any] = {
        "ready": True,
        "world": 1,
        "date": "2026-10-28",
        "wall_s": wall_s,
        "sim_cpu_s": cpu_s,
        "sim_core_share": cpu_s / wall_s if wall_s else 0.0,
        "saves": 2,
        "longest_save_s": 1.1,
        "rss_mb": 120.0,
        "caught_up_days": 0.8,
        "catch_up_s_per_day": 3.5,
    }
    return {**base, **more}


def test_the_window_is_judged_from_its_own_cpu_and_wall_time() -> None:
    samples = [
        {"ready": False},
        _sample(100, 50),  # the start's work is left out of the window
        _sample(3700, 140),
        _sample(7300, 230, rss_mb=150.0),
    ]
    result = server_watch.summary(samples)
    assert result["window_h"] == 2.0
    assert result["sim_core_share"] == round(180 / 7200, 5)
    assert result["peak_rss_mb"] == 150.0
    assert result["pass"] == {"sim_core_share": True, "longest_save_s": True, "rss_mb": True}
    assert "PASS" in server_watch.report(result)


def test_budgets_broken_fail_and_a_restart_starts_the_window_again() -> None:
    samples = [
        _sample(100, 10),
        _sample(5000, 20),
        _sample(50, 40),  # restarted
        _sample(3650, 1000, longest_save_s=2.5, rss_mb=320.0),
    ]
    result = server_watch.summary(samples)
    assert result["samples"] == 2
    assert result["pass"] == {"sim_core_share": False, "longest_save_s": False, "rss_mb": False}
    assert "FAIL" in server_watch.report(result)


def test_too_few_samples_say_so() -> None:
    result = server_watch.summary([_sample(10, 1)])
    assert result["enough"] is False
    assert "not enough" in server_watch.report(result)
