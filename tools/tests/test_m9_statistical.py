"""M9 acceptance on many seeds (nightly): the chronicle writes at a readable pace.

M9.1 (CLAUDE.md §8): 2–15 notable entries per sim-month, median of the seeds' median
months; M9.2: no event type above 30 % of all entries, every seed's pooled. Each seed
lives three years of the office schedule, as the report's run (reports/M9-chronicle/,
ADR 0017). Seeds run in parallel.
"""

import datetime as dt
from collections import Counter
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pytest
from lineage_sim.config import parse_config
from lineage_sim.events import PresenceChanged
from lineage_sim.world import World

from tools.fastforward import DAY_MS, epoch_unix_ms, live_day
from tools.milestones.m9 import DAYS_PER_MONTH, MONTHLY_BAND, TYPE_SHARE_MAX
from tools.runs import DEFAULT_CONFIG

START = dt.date(2026, 1, 1)
SEEDS = range(20)
WORKERS = 8
DAYS = 1096  # three years


def _chronicle(seed: int) -> tuple[float, list[str]]:
    """A seed's median month of notable entries, and the kinds of all its entries."""
    config = parse_config(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    world, _ = World.create(config, seed, epoch_unix_ms(START))
    world.apply(PresenceChanged(False))
    for _ in range(DAYS):
        live_day(world, "office")
    entries = world.chronicle.entries()
    months = int(DAYS // DAYS_PER_MONTH)
    month = [int(e.t_ms / DAY_MS // DAYS_PER_MONTH) for e in entries
             if e.importance >= config.chronicle.notable_importance]  # fmt: skip
    counts = np.bincount([m for m in month if m < months], minlength=months)
    return float(np.median(counts)), [e.kind for e in entries]


@pytest.mark.slow
def test_chronicle_pace_and_variety() -> None:
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(_chronicle, SEEDS))
    rates = [r[0] for r in results]
    kinds = Counter(k for r in results for k in r[1])
    top, count = kinds.most_common(1)[0]
    share = count / sum(kinds.values())
    assert MONTHLY_BAND[0] <= np.median(rates) <= MONTHLY_BAND[1], f"per seed {rates}"
    assert share <= TYPE_SHARE_MAX, f"{top} holds {share:.1%}: {kinds.most_common()}"
