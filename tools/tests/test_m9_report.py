"""M9 report: notable entries per month, event-type shares, the sample chronicle."""

import json
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.chronicle import KINDS, Kind

from tools.fastforward import CHRONICLE_COLUMNS, DAYS_PER_YEAR, EXTRA_PREFIX
from tools.milestones import m9
from tools.report import build_report
from tools.runs import DEFAULT_CONFIG, TIME_KEY, Manifest, Run, config_hash, read_run, write_run

SEEDS = list(range(4))
YEARS = 1.0
DAYS_PER_MONTH = DAYS_PER_YEAR / 12


def _chronicle(seed: int) -> tuple[np.ndarray, np.ndarray]:
    """Per month: ``3 + seed`` notable entries (speciation, extinction, boom in turn) and
    one background season entry; the last month of seed 0 has none."""
    rows: list[list[float]] = []
    cycle = (Kind.SPECIATION, Kind.EXTINCTION, Kind.BOOM)
    for month in range(12):
        if seed == 0 and month == 11:
            continue
        start = month * DAYS_PER_MONTH
        for k in range(3 + seed):
            kind = KINDS.index(cycle[k % 3])
            rows.append([start + 1 + k, 3 if k else 4, kind, 0])
        rows.append([start + 20, 1, KINDS.index(Kind.SEASON), 0])
    texts = np.array([f"entry {i}" for i in range(len(rows))], dtype=np.str_)
    return np.array(rows, dtype=np.float64).reshape(-1, len(CHRONICLE_COLUMNS)), texts


def _run(tmp_path: Path) -> Path:
    weeks = np.arange(0, round(YEARS * DAYS_PER_YEAR) + 1, 7)
    series = {}
    for seed in SEEDS:
        table, texts = _chronicle(seed)
        series[seed] = {
            TIME_KEY: weeks / DAYS_PER_YEAR,
            EXTRA_PREFIX + "chronicle": table,
            EXTRA_PREFIX + "chronicle_text": texts,
        }
    text = DEFAULT_CONFIG.read_text(encoding="utf-8")
    manifest = Manifest(
        run_id="m9", seeds=SEEDS, sim_years=YEARS, config_hash=config_hash(text),
        git_commit="abc123", wall_time_s=1.0, created_utc="2026-10-19T00:00:00+00:00",
        notes="start 2026-01-01; 4 job(s); schedule office",
    )  # fmt: skip
    out = tmp_path / "run"
    write_run(Run(manifest, text, series), out)
    return out


def test_metrics(tmp_path: Path) -> None:
    run = read_run(_run(tmp_path))
    values = m9.metrics(run)
    # Seeds' median months: 3, 4, 5, 6 notable entries.
    assert values["notable.per_month.median"] == pytest.approx(4.5)
    assert values["major.per_month.mean.median"] == pytest.approx(1.0)
    # Speciation is the first of every month's cycle: the largest type.
    assert values["type_share.max.kind"] == KINDS.index(Kind.SPECIATION)
    total = 11 * 4 + 12 * 5 + 12 * 6 + 12 * 7
    speciations = 11 * 1 + 12 * 2 + 12 * 2 + 12 * 2
    assert values["type_share.max"] == pytest.approx(speciations / total)
    assert values["type_share.season"] == pytest.approx((11 + 36) / total)
    assert values["seeds_in_band"] == 4


def test_representative_seed(tmp_path: Path) -> None:
    run = read_run(_run(tmp_path))
    assert m9.representative_seed(run) in (1, 2)


def test_report_builds(tmp_path: Path) -> None:
    out = build_report("M9", _run(tmp_path), out_root=tmp_path / "reports")
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    status = {row["id"]: row["status"] for row in metrics["acceptance"]}
    assert status == {"M9.1": "PASS", "M9.2": "FAIL"}  # speciation holds 31.9 %
    page = (out / "report.html").read_text(encoding="utf-8")
    assert "A sample chronicle" in page
    assert "entry 0" in page
