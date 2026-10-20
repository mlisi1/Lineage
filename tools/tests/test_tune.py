"""M11 tuning tools: sampling, scoring, a tiny sweep end to end, sensitivity."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pytest

from tools.milestones.base import Criterion
from tools.tune import sensitivity
from tools.tune.score import shortfall
from tools.tune.sweep import Lever, latin_hypercube, load_sweep, ranked, run_sweep, toml_value


def test_latin_hypercube_has_one_point_per_stratum() -> None:
    points = latin_hypercube(8, 3, np.random.default_rng(0))
    assert points.shape == (8, 3)
    for axis in range(3):
        assert sorted((points[:, axis] * 8).astype(int).tolist()) == list(range(8))


def test_lever_values() -> None:
    assert Lever("a.b", 10, 20, integer=True).at(0.5) == 15
    assert Lever("a.b", 1, 100, log=True).at(0.5) == pytest.approx(10.0)
    assert Lever("a.b", values=(1, 2, 3)).at(0.99) == 3
    assert toml_value(True) == "true"
    assert toml_value(0.5) == "0.5"


def test_shortfall_is_relative_to_the_missed_bound() -> None:
    share = Criterion("X", "share", "x", low=0.8)
    assert shortfall(share, 0.9) == 0.0
    assert shortfall(share, 0.4) == pytest.approx(0.5)
    count = Criterion("Y", "count", "y", high=0)
    assert shortfall(count, 2.0) == 2.0
    assert shortfall(count, None) == 1.0


def test_sweep_file(tmp_path: Path) -> None:
    path = tmp_path / "s.toml"
    path.write_text(
        """
[sweep]
name = "t"
seeds = 3
seed_base = 20
years = 1
samples = 4
rng_seed = 2

[levers]
"fauna.meat_energy" = { low = 900, high = 2400, integer = true }
"fauna.predator_cap" = { values = [12, 16] }

[[points]]
set = ["fauna.learning=false"]
""",
        encoding="utf-8",
    )
    sweep = load_sweep(path)
    assert sweep.seeds == [20, 21, 22]
    assert sweep.points[0] == {}  # the defaults come first
    assert len(sweep.points) == 1 + 4 + 1
    assert sweep.points[-1] == {"fauna.learning": False}
    assert all(900 <= p["fauna.meat_energy"] <= 2400 for p in sweep.points[1:5])
    assert load_sweep(path).points == sweep.points  # seeded


def test_a_tiny_sweep_runs_scores_and_resumes(tmp_path: Path) -> None:
    path = tmp_path / "tiny.toml"
    path.write_text(
        """
[sweep]
name = "tiny"
seeds = 1
years = 0.05
samples = 2
rng_seed = 0

[levers]
"fauna.meat_energy" = { low = 1000, high = 2000, integer = true }
""",
        encoding="utf-8",
    )
    sweep = load_sweep(path)
    results = run_sweep(sweep, tmp_path, jobs=1)
    assert [r["point"] for r in results] == ["p000", "p001", "p002"]
    document = json.loads((tmp_path / "sweep-tiny" / "points.json").read_text())
    assert len(document["points"]) == 3
    first = document["points"][0]
    assert {j["cid"] for j in first["judged"]} >= {"M2.1", "M4.1", "M6.1", "M9.1", "M11.1"}
    assert ranked(results)[0]["fails"] <= ranked(results)[-1]["fails"]
    # Resuming reads the finished points instead of running them again.
    manifest = tmp_path / "sweep-tiny" / "p001" / "manifest.json"
    stamp = manifest.stat().st_mtime_ns
    run_sweep(sweep, tmp_path, jobs=1)
    assert manifest.stat().st_mtime_ns == stamp
    levers, names, rho = sensitivity.table(document)
    assert levers == ["fauna.meat_energy"]
    assert rho.shape == (len(names), 1)


def test_spearman() -> None:
    x = np.arange(10.0)
    assert sensitivity.spearman(x, x**3) == pytest.approx(1.0)
    assert sensitivity.spearman(x, -x) == pytest.approx(-1.0)
    assert math.isnan(sensitivity.spearman(x[:2], x[:2]))
