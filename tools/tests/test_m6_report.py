"""M6 report: metrics from species tables, the phylogeny drawing, a full report."""

import json
from pathlib import Path

import numpy as np
import pytest

from tools.fastforward import DAYS_PER_YEAR, EXTRA_PREFIX, PHYLOGENY_COLUMNS
from tools.milestones import m6
from tools.report import build_report
from tools.runs import DEFAULT_CONFIG, TIME_KEY, Manifest, Run, config_hash, write_run

SEEDS = list(range(4))
YEARS = 1.0


def _table(rows: list[tuple[float, ...]]) -> np.ndarray:
    """Phylogeny rows: (id, parent, born_day, extinct_day, peak, diet)."""
    out = np.zeros((len(rows), len(PHYLOGENY_COLUMNS)))
    col = {name: i for i, name in enumerate(PHYLOGENY_COLUMNS)}
    for r, (sid, parent, born, extinct, peak, diet) in enumerate(rows):
        out[r, [col["id"], col["parent"], col["born_day"], col["extinct_day"]]] = (
            sid, parent, born, extinct,
        )  # fmt: skip
        out[r, col["peak"]], out[r, col["diet"]] = peak, diet
    return out


def _synthetic_run(tmp_path: Path) -> Path:
    days = round(YEARS * DAYS_PER_YEAR)
    weeks = np.arange(0, days + 1, 7)
    series: dict[int, dict[str, np.ndarray]] = {}
    for seed in SEEDS:
        alive = np.zeros(days, dtype=np.int16)
        alive[100:] = 4 + seed % 2  # inhabited from day 100, in the band
        alive[300:310] = 0  # a total extinction (seed-independent)
        table = _table(
            [
                (1, 0, 100, -1, 150, 0.1),
                (2, 1, 160, 250, 20, 0.12),
                (3, 0, 200, 230, 8, 0.8),
                (4, 2, 220, -1, 12, 0.1),
            ]
        )
        cumulative = lambda born: np.searchsorted(np.sort(born), weeks, side="right")  # noqa: E731
        series[seed] = {
            TIME_KEY: weeks / DAYS_PER_YEAR,
            "species_alive": alive[np.minimum(weeks, days - 1)].astype(float),
            "species_splits": cumulative(np.array([160, 220])).astype(float),
            "species_arrivals": cumulative(np.array([100, 200])).astype(float),
            "species_extinctions": cumulative(np.array([230, 250])).astype(float),
            EXTRA_PREFIX + "species_daily": alive,
            EXTRA_PREFIX + "phylogeny": table,
            EXTRA_PREFIX + "species_names": np.array(["Malesha", "Maleku", "Tovida", "Malekuba"]),
        }
    text = DEFAULT_CONFIG.read_text(encoding="utf-8")
    manifest = Manifest(
        run_id="m6-synthetic", seeds=SEEDS, sim_years=YEARS, config_hash=config_hash(text),
        git_commit="abc123", wall_time_s=1.0, created_utc="2026-10-18T00:00:00+00:00",
    )  # fmt: skip
    run_dir = tmp_path / "runs" / "m6"
    write_run(Run(manifest, text, series), run_dir)
    return run_dir


def test_in_band_share_counts_inhabited_days_only() -> None:
    alive = np.array([0, 0, 0, 3, 4, 12, 13, 0, 2, 5])
    assert m6.in_band_share(alive) == pytest.approx(4 / 7)
    assert np.isnan(m6.in_band_share(np.zeros(5, dtype=np.int64)))


def test_tree_order_puts_daughters_under_their_parents() -> None:
    table = _table([(1, 0, 0, -1, 1, 0), (2, 0, 5, -1, 1, 0), (3, 1, 9, -1, 1, 0),
                    (4, 3, 12, -1, 1, 0)])  # fmt: skip
    assert m6._tree_order(table) == [0, 2, 3, 1]  # pyright: ignore[reportPrivateUsage]


def test_m6_report(tmp_path: Path) -> None:
    out = build_report("M6", _synthetic_run(tmp_path), tmp_path / "reports")
    assert out.name == "M6-species"
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in doc["acceptance"]] == ["M6.1", "M6.2"]
    metrics = doc["metrics"]
    inhabited = round(YEARS * DAYS_PER_YEAR) - 100
    assert metrics["species_alive.in_band.share_of_time.median"] == pytest.approx(
        (inhabited - 10) / inhabited
    )
    months = inhabited / (DAYS_PER_YEAR / 12)
    assert metrics["speciation.per_month.median"] == pytest.approx(2 / months)
    assert metrics["arrivals.per_month.median"] == pytest.approx(2 / months)
    assert metrics["lifespan_days.split.count"] == 4 * 2
    page = (out / "report.html").read_text(encoding="utf-8")
    assert "What the plots show" in page
    assert "Phylogeny of seed" in page
    assert "Maleku" in page


def test_largest_burst_counts_daughters_close_in_time() -> None:
    table = _table([(1, 0, 0, -1, 9, 0), (2, 1, 5, -1, 9, 0), (3, 1, 5, -1, 9, 0),
                    (4, 1, 9, -1, 9, 0), (5, 2, 9, -1, 9, 0)])  # fmt: skip
    assert m6.largest_burst(table, days=1.0) == 2  # ids 2 and 3, on day 5
    assert m6.largest_burst(table, days=30.0) == 3  # and id 4, four days later
    assert m6.largest_burst(table[:1]) == 0
