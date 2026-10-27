"""M11's acceptance, nightly: the tuned island judged on every criterion at once.

CLAUDE.md §8 M11: a nightly 3-year × 20-seed run with every criterion from M2–M10, plus
M11.1 and the owner's D1–D3 (ADR 0019). Office schedule, nobody pressing the button, the
defaults in config/default.toml: the island as it ships. Step-time criteria (M4.4, M5.3)
read the machine's load and are left out; M8's schedules have their own statistical test
(test_m8_statistical.py). A failure here means a change has unbalanced the island:
investigate it, never re-run until green (CLAUDE.md §6).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest

from tools.fastforward import fastforward
from tools.tune.score import UNSWEPT, score

YEARS = 3.0
SEEDS = list(range(20))


@pytest.mark.slow
@pytest.mark.criteria
def test_the_tuned_island_passes_every_criterion(tmp_path: Path) -> None:
    jobs = min(len(SEEDS), os.cpu_count() or 1)
    run = fastforward(
        YEARS, SEEDS, tmp_path / "m11-nightly", save_days=30, snapshot_days=0, jobs=jobs,
        schedule="office",
    )  # fmt: skip
    card = score(run)
    judged = [j for j in card.judged if j.cid not in UNSWEPT]
    assert {"M2.1", "M3.5", "M4.3", "M6.1", "M9.2", "M11.1", "D1", "D3b"} <= {j.cid for j in judged}
    failing = [f"{j.cid}: {j.value} (band {j.band})" for j in judged if j.status != "PASS"]
    assert not failing, "criteria no longer met:\n" + "\n".join(failing)
