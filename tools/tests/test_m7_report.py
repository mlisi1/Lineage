"""M7 report: rare-gene metrics from daily tables, fixation and episodes, a full report."""

import json
from pathlib import Path

import numpy as np
import pytest

from tools.fastforward import DAYS_PER_YEAR, EXTRA_PREFIX, LIVES_COLUMNS, RARE_DAILY_COLUMNS
from tools.milestones import m7
from tools.report import build_report
from tools.runs import DEFAULT_CONFIG, TIME_KEY, Manifest, Run, config_hash, write_run

SEEDS = list(range(4))
YEARS = 1.0
_C = {name: i for i, name in enumerate(RARE_DAILY_COLUMNS)}


def _daily(seed: int, days: int) -> np.ndarray:
    table = np.zeros((days, len(RARE_DAILY_COLUMNS)), dtype=np.float32)
    table[:, _C["creatures"]] = 100
    table[:, _C["herbivores"]] = 90
    table[:, _C["predators"]] = 10
    table[:, _C["vegetated"]] = 1000
    table[50:80, _C["venom"]] = 5  # one 30-day episode, all predators
    table[50:80, _C["venom_predators"]] = 5
    table[100:105, _C["glow"]] = 1
    table[120:130, _C["glow"]] = 2  # two episodes
    table[:, _C["plant_mangrove"]] = 20
    if seed == 0:
        table[10:120, _C["giant"]] = 95  # 110 days above 90 %: a long fixation
        table[10:120, _C["giant_herbivores"]] = 90
    return table


def _lives() -> np.ndarray:
    rows = np.zeros((4, len(LIVES_COLUMNS)))
    col = {name: i for i, name in enumerate(LIVES_COLUMNS)}
    for r, (first, last, slots, arrived) in enumerate(
        [(10, 29, 0, 0), (10, 49, 8, 0), (5, 9, 1, 0), (0, 99, 0, 1)]
    ):
        rows[r, [col["first_day"], col["last_day"], col["slots"], col["arrived"]]] = (
            first, last, slots, arrived,
        )  # fmt: skip
    return rows


def _synthetic_run(tmp_path: Path) -> Path:
    days = round(YEARS * DAYS_PER_YEAR)
    weeks = np.arange(0, days + 1, 7)
    series = {
        seed: {
            TIME_KEY: weeks / DAYS_PER_YEAR,
            "population": np.full(weeks.size, 100.0),
            EXTRA_PREFIX + "rare_daily": _daily(seed, days),
            EXTRA_PREFIX + "lives": _lives(),
        }
        for seed in SEEDS
    }
    text = DEFAULT_CONFIG.read_text(encoding="utf-8")
    manifest = Manifest(
        run_id="m7-synthetic", seeds=SEEDS, sim_years=YEARS, config_hash=config_hash(text),
        git_commit="abc123", wall_time_s=1.0, created_utc="2026-10-18T00:00:00+00:00",
    )  # fmt: skip
    run_dir = tmp_path / "runs" / "m7"
    write_run(Run(manifest, text, series), run_dir)
    return run_dir


def test_runs_and_episodes() -> None:
    assert m7.longest_run(np.array([1, 1, 0, 1, 1, 1, 0], dtype=bool)) == 3
    assert m7.episodes(np.array([0, 1, 1, 0, 0, 1, 0, 1], dtype=bool)).tolist() == [2, 1, 1]
    assert m7.episodes(np.zeros(4, dtype=bool)).size == 0


def test_share_is_undefined_without_a_population() -> None:
    table = np.zeros((2, len(RARE_DAILY_COLUMNS)), dtype=np.float32)
    table[1, _C["creatures"]], table[1, _C["toxic"]] = 4, 1
    shares = m7.share(table, "toxic")
    assert np.isnan(shares[0])
    assert shares[1] == pytest.approx(0.25)


def test_m7_report(tmp_path: Path) -> None:
    out = build_report("M7", _synthetic_run(tmp_path), tmp_path / "reports")
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))["metrics"]
    # Venom, glow and mangroves appear everywhere; most genes never do.
    assert metrics["venom.appeared.share_of_seeds"] == 1.0
    assert metrics["toxic.appeared.share_of_seeds"] == 0.0
    assert metrics["appearance.share_of_seeds.min"] == 0.0
    assert metrics["glow.episodes.median"] == 2.0
    assert metrics["venom.episode_days.median"] == 30.0
    # One seed of four held giants above 90 % for 110 days.
    assert metrics["giant.fixation_days.max"] == 110.0
    assert metrics["fixation.share_of_seeds_without_long_fixation"] == 0.75
    key = "fixation.share_of_seeds_without_long_fixation.excluding_photosynthesis"
    assert metrics[key] == 0.75  # the giants are not excused
    assert metrics["venom.share_among_predators.median"] > 0.0
    assert metrics["venom.share_among_herbivores.median"] == 0.0
    # Born here: plain 20 days, longevity carrier 40 days; arrivals are left out.
    assert metrics["lifespan_days.none.median"] == 20.0
    assert metrics["lifespan_days.longevity.median"] == 40.0
    report = (out / "report.html").read_text(encoding="utf-8")
    for text in ("M7.1", "M7.2", "What the plots show"):
        assert text in report
