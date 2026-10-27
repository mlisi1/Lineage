"""M11 report: runs recognised by their manifests, every criterion judged on its run."""

from __future__ import annotations

import json
import shutil
from pathlib import Path

import pytest

from tools.fastforward import fastforward
from tools.milestones import m11
from tools.report import build_report
from tools.runs import read_run
from tools.tune.sweep import load_sweep, run_sweep

YEARS = 0.05


@pytest.fixture(scope="module")
def runs(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Path]:
    root = tmp_path_factory.mktemp("runs")
    made = {
        "main": ([0], (), "office"),
        "held-out": ([20], (), "office"),
        "off:cover": ([0], ("fauna.cover_protection=0.0",), "office"),
        "always": ([0], (), "always"),
    }
    out: dict[str, Path] = {}
    for name, (seeds, overrides, schedule) in made.items():
        path = root / name.replace(":", "-")
        fastforward(YEARS, seeds, path, snapshot_days=0, overrides=overrides, schedule=schedule)
        out[name] = path
    sweep_file = root / "s.toml"
    sweep_file.write_text(
        '[sweep]\nname = "t"\nseeds = 1\nyears = 0.05\nsamples = 2\n\n[levers]\n'
        '"fauna.meat_energy" = { low = 1000, high = 2000, integer = true }\n',
        encoding="utf-8",
    )
    run_sweep(load_sweep(sweep_file), root, jobs=1)
    out["sweep"] = root / "sweep-t"
    return out


def test_runs_are_recognised_by_their_manifests(runs: dict[str, Path]) -> None:
    main = read_run(runs["main"])
    for name in ("held-out", "off:cover", "always"):
        assert m11.role_of(read_run(runs[name]), main) == name
    with pytest.raises(ValueError, match="cannot tell"):
        m11.role_of(read_run(runs["main"]), main)  # a second office run on the same seeds
    with pytest.raises(ValueError, match="office"):
        m11.by_role(read_run(runs["always"]))


def test_the_dashboard_judges_each_criterion_on_its_run(
    runs: dict[str, Path], tmp_path: Path
) -> None:
    baselines = [runs["held-out"], runs["off:cover"], runs["always"]]
    out = build_report("M11", runs["main"], tmp_path, baselines, [runs["sweep"]])
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    status = {a["id"]: a["status"] for a in doc["acceptance"]}
    assert status["M2.1 (tuning seeds)"] != "MISSING"
    assert status["M2.1 (held-out seeds)"] != "MISSING"
    assert status["M3.1 (5 years)"] == "MISSING"  # no five-year run was given
    assert status["M5.3"] == "MISSING"  # nor the fork and learning-off runs
    assert {"D1 (tuning seeds)", "M11.1 (held-out seeds)", "M8.1"} <= set(status)
    assert any(k.startswith("off:cover/") for k in doc["metrics"])
    page = (out / "report.html").read_text(encoding="utf-8")
    for title in ("Diversity and balance", "Mechanisms on and off", "Sensitivity"):
        assert title in page
    shutil.rmtree(out)
