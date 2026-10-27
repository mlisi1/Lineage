"""M8 report: schedules compared, night-trait selection, survival of absences."""

import json
from pathlib import Path

import numpy as np
import pytest

from tools.fastforward import (
    DAYS_PER_YEAR,
    EXTRA_PREFIX,
    LIVES_COLUMNS,
    PRESENCE_DAILY_COLUMNS,
    RARE_DAILY_COLUMNS,
)
from tools.milestones import m8
from tools.report import build_report
from tools.runs import DEFAULT_CONFIG, TIME_KEY, Manifest, Run, config_hash, read_run, write_run

SEEDS = list(range(4))
YEARS = 2.0
DAYS = round(YEARS * DAYS_PER_YEAR)
OCTOBER_2026 = 273  # 2026-10-01, days since 2026-01-01
_C = {name: i for i, name in enumerate(RARE_DAILY_COLUMNS)}


def _daily(schedule: str, seed: int) -> np.ndarray:
    table = np.zeros((DAYS, len(RARE_DAILY_COLUMNS)), dtype=np.float32)
    table[100:, _C["creatures"]] = 100
    table[100:, _C["herbivores"]] = 100
    glow = 2 + seed if schedule != "always" else seed * 0.2
    table[100:, _C["glow"]] = glow
    table[100:, _C["photosynthesis"]] = 1 if schedule != "always" else 30
    if schedule == "conference" and seed == 1:
        table[OCTOBER_2026 + 5 : OCTOBER_2026 + 40, _C["creatures"]] = 0  # dies while away
    return table


def _run(tmp_path: Path, schedule: str) -> Path:
    weeks = np.arange(0, DAYS + 1, 7)
    light = np.full((DAYS, len(PRESENCE_DAILY_COLUMNS)), 0.3, dtype=np.float32)
    series = {
        seed: {
            TIME_KEY: weeks / DAYS_PER_YEAR,
            "extinctions": np.zeros(weeks.size),
            "gene_sense": np.full(weeks.size, 0.5),
            EXTRA_PREFIX + "rare_daily": _daily(schedule, seed),
            EXTRA_PREFIX + "presence_daily": light,
            EXTRA_PREFIX + "lives": np.zeros((0, len(LIVES_COLUMNS))),
        }
        for seed in SEEDS
    }
    text = DEFAULT_CONFIG.read_text(encoding="utf-8")
    notes = "start 2026-01-01; 4 job(s)" + (
        f"; schedule {schedule}" if schedule != "always" else ""
    )
    manifest = Manifest(
        run_id=f"m8-{schedule}", seeds=SEEDS, sim_years=YEARS, config_hash=config_hash(text),
        git_commit="abc123", wall_time_s=1.0, created_utc="2026-10-19T00:00:00+00:00",
        notes=notes,
    )  # fmt: skip
    run_dir = tmp_path / "runs" / schedule
    write_run(Run(manifest, text, series), run_dir)
    return run_dir


def test_rank_test() -> None:
    high, low = np.array([5.0, 6.0, 7.0, 8.0]), np.array([1.0, 2.0, 3.0, 4.0])
    assert m8.rank_test(high, low) < 0.05
    assert m8.rank_test(low, high) > 0.9
    assert np.isnan(m8.rank_test(np.array([np.nan]), low))


def test_absence_days() -> None:
    start = m8.DEFAULT_START
    assert m8.absence_days("conference", start, DAYS) == [(273, 293), (638, 658)]
    assert m8.absence_days("office-august", start, DAYS) == [(212, 242), (577, 607)]
    assert m8.absence_days("office", start, DAYS) == []


def test_schedules_are_read_from_the_runs(tmp_path: Path) -> None:
    office, always = read_run(_run(tmp_path, "office")), read_run(_run(tmp_path, "always"))
    assert m8.schedule_of(office) == "office"
    assert m8.schedule_of(always) == "always"
    assert list(m8.by_schedule(office, always)) == ["always", "office"]
    with pytest.raises(ValueError, match="always-present"):
        m8.by_schedule(office)
    with pytest.raises(ValueError, match="two runs"):
        m8.by_schedule(office, always, always)


def test_metrics(tmp_path: Path) -> None:
    runs = [read_run(_run(tmp_path, s)) for s in ("office", "always", "conference")]
    values = m8.metrics(*runs)
    assert values["night_selection.p_value"] < 0.05
    assert values["photosynthesis_selection.p_value"] < 0.05
    # M8.1 judges the stronger of the two tests, Bonferroni-corrected.
    smaller = min(values["night_selection.p_value"], values["photosynthesis_selection.p_value"])
    assert values["light_selection.p_value"] == pytest.approx(min(1.0, 2 * smaller))
    assert values["conference.absence_survival.share_of_seeds"] == 0.75
    assert values["conference.absence_survival.seeds_judged"] == 4
    assert values["conference.absences_judged"] == 8
    assert "office-august.absence_survival.share_of_seeds" not in values
    assert values["office.fixation.share_of_seeds_without_long_fixation"] == 1.0


def test_report(tmp_path: Path) -> None:
    office = _run(tmp_path, "office")
    others = [_run(tmp_path, s) for s in ("always", "office-august", "conference")]
    out = build_report("M8", office, tmp_path / "reports", others)
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    status = {row["id"]: row["status"] for row in doc["acceptance"]}
    assert status == {"M8.1": "PASS", "M8.2": "FAIL", "M8.3": "PASS", "M7.2": "PASS"}
    page = (out / "report.html").read_text(encoding="utf-8")
    for title in ("Light", "Night traits", "Holidays", "M7.2"):
        assert title in page
    with pytest.raises(ValueError, match="--baseline"):
        build_report("M8", office, tmp_path / "reports")
