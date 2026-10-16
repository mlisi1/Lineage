"""The M5 report on synthetic runs: two runs (learning on, and the baseline with it off)
whose youths and forks are built by hand, so every measure has a known answer."""

import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pytest

from tools.fastforward import FORK_COLUMNS, YOUTH_COLUMNS
from tools.milestones import m5
from tools.report import build_report
from tools.runs import TIME_KEY, Manifest, Run, config_hash, read_run, write_run

SEEDS = [0, 1, 2, 3]
GENERATIONS = 12
YOUTHS_PER_GENERATION = 30
INTAKE_GAIN = 0.3  # youths that learn eat this much more per hour, in every fork
SLOPE_ON = -0.3  # hours to competence per generation, learning on


def _youths(rng: np.random.Generator, slope: float) -> np.ndarray:
    """Youth rows whose competence time changes by ``slope`` hours per generation; one in
    ten never becomes competent."""
    rows = []
    for generation in range(1, GENERATIONS + 1):
        for k in range(YOUTHS_PER_GENERATION):
            competent = -1.0 if k % 10 == 0 else 30.0 + slope * generation + rng.normal(0, 0.5)
            rows.append([generation * 7.0, generation, 150.0, 600.0, 500.0, competent, 0.0])
    return np.array(rows)


def _forks() -> np.ndarray:
    """Two forks; in each, every youth with learning on eats (1 + INTAKE_GAIN) times as
    much per hour as one with it off, and burns as much more."""
    rows = []
    for fork_day in (60.0, 120.0):
        for learning, factor in ((1.0, 1.0 + INTAKE_GAIN), (0.0, 1.0)):
            for k in range(25):
                died = float(k % 5 == 0)
                rows.append([fork_day, learning, 1.0, 100.0, 400.0 * factor, 350.0 * factor,
                             12.0, died])  # fmt: skip
    return np.array(rows)


def _write(tmp_path: Path, name: str, *, learning: bool) -> Path:
    rng = np.random.Generator(np.random.PCG64(7))
    times = np.linspace(0.0, 2.0, 105)
    flat = np.ones_like(times)
    series = {}
    for seed in SEEDS:
        values = {
            TIME_KEY: times,
            "population": 100.0 * flat + (20.0 if learning else 0.0),
            "energy_share": 0.6 * flat,
            "predators": 5.0 * flat,
            "step_ms": (180.0 if learning else 160.0) * flat,
            "generation": np.linspace(0.0, GENERATIONS, times.size),
            "extinctions": np.zeros_like(times),
            "gene_learning": np.linspace(0.5, 0.7 if learning else 0.5, times.size),
            "gene_exploration": 0.5 * flat,
            "_youth": _youths(rng, SLOPE_ON if learning else 0.0),
            "_fork": _forks() if learning else np.zeros((0, len(FORK_COLUMNS))),
        }
        for gain in m5.FOLLOWED_NAMES:
            values[f"learned_{gain}"] = 0.1 * flat
        series[seed] = values
    text = "[meta]\nconfig_version = 1\n"
    manifest = Manifest(
        run_id=name,
        seeds=SEEDS,
        sim_years=2.0,
        config_hash=config_hash(text),
        git_commit="abc123",
        wall_time_s=1.0,
        created_utc="2026-10-16T00:00:00+00:00",
        notes="synthetic",
    )
    run_dir = tmp_path / "runs" / name
    write_run(Run(manifest, text, series), run_dir)
    return run_dir


def test_youth_outcomes() -> None:
    columns = {name: i for i, name in enumerate(YOUTH_COLUMNS)}
    rows = np.zeros((4, len(YOUTH_COLUMNS)))
    rows[:, columns["age_h"]] = [10.0, 10.0, 20.0, 40.0]
    rows[:, columns["eaten"]] = [20.0, 0.0, 60.0, 80.0]
    rows[:, columns["burnt"]] = [10.0, 10.0, 20.0, 40.0]
    rows[:, columns["competent_h"]] = [3.0, -1.0, 5.0, 8.0]
    rows[:, columns["died"]] = [0.0, 1.0, 0.0, 0.0]
    outcomes = m5.youth_outcomes(rows)
    assert outcomes["intake_rate"] == pytest.approx(160.0 / 80.0)
    assert outcomes["eaten_per_burnt"] == pytest.approx(160.0 / 80.0)
    assert outcomes["survival"] == pytest.approx(0.75)
    assert outcomes["competent"] == pytest.approx(0.75)


def test_competence_slope_counts_never_as_late() -> None:
    rng = np.random.Generator(np.random.PCG64(1))
    assert m5.competence_slope(_youths(rng, -0.5)) == pytest.approx(-0.5, abs=0.05)
    assert abs(m5.competence_slope(_youths(rng, 0.0))) < 0.05
    # Too few generations for a trend.
    assert np.isnan(m5.competence_slope(_youths(rng, -0.5)[: 3 * YOUTHS_PER_GENERATION]))


def test_m5_metrics_have_the_known_answers(tmp_path: Path) -> None:
    on = read_run(_write(tmp_path, "on", learning=True))
    off = read_run(_write(tmp_path, "off", learning=False))
    metrics = m5.metrics(on, off)
    assert metrics["fork.intake_rate.gain.median"] == pytest.approx(INTAKE_GAIN)
    assert metrics["fork.eaten_per_burnt.gain.median"] == pytest.approx(0.0, abs=1e-9)
    assert metrics["fork.intake_rate.gain.share_of_seeds_positive"] == 1.0
    assert metrics["competence.share_of_seeds_falling"] == 1.0
    assert metrics["competence.slope.median_h_per_generation"] == pytest.approx(SLOPE_ON, abs=0.05)
    assert metrics["competence_off.share_of_seeds_falling"] <= 0.75
    assert metrics["step_ms.median"] == pytest.approx(180.0)
    assert metrics["population.end.median"] == pytest.approx(120.0)
    assert metrics["off.population.end.median"] == pytest.approx(100.0)


def test_m5_report_passes_and_names_the_baseline(tmp_path: Path) -> None:
    on = _write(tmp_path, "on", learning=True)
    off = _write(tmp_path, "off", learning=False)
    out = build_report("M5", on, tmp_path / "reports", off)
    assert out.name == "M5-fauna-learning"
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert [a["status"] for a in doc["acceptance"]] == ["PASS", "PASS", "PASS"]
    page = (out / "report.html").read_text(encoding="utf-8")
    assert "Baseline run" in page
    assert "off, config" in page
    assert page.count("<figure") >= 8
    assert "Baseline `off`" in (out / "README.md").read_text(encoding="utf-8")


def test_m5_report_needs_a_baseline_with_the_same_seeds(tmp_path: Path) -> None:
    on = _write(tmp_path, "on", learning=True)
    with pytest.raises(ValueError, match="--baseline"):
        build_report("M5", on, tmp_path / "reports")
    other = read_run(_write(tmp_path, "other", learning=False))
    renumbered = replace(other.manifest, seeds=[5, 6, 7, 8])
    series = dict(zip(renumbered.seeds, other.series.values(), strict=True))
    write_run(Run(renumbered, other.config_text, series), tmp_path / "runs" / "other")
    with pytest.raises(ValueError, match="same seeds"):
        build_report("M5", on, tmp_path / "reports", tmp_path / "runs" / "other")
