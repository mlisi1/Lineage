"""M8 acceptance on many seeds (nightly): life survives the owner's holidays.

M8.2 (CLAUDE.md §8): a 3-week absence leaves creatures alive in ≥ 80 % of seeds; M8.3
(asked by the owner, ADR 0016): so does the August holiday. Each seed lives the
``office-august`` schedule into its second October and then is away three weeks more, so
one run sees both: August 2026 finds founders young (often none yet), so the holidays
judged are those of 2027. See reports/M8-presence/. Seeds run in parallel.
"""

import datetime as dt
from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pytest
from lineage_sim.config import parse_config
from lineage_sim.events import PresenceChanged
from lineage_sim.world import World

from tools.fastforward import epoch_unix_ms, live_day
from tools.runs import DEFAULT_CONFIG

START = dt.date(2026, 1, 1)
SEEDS = range(20)
WORKERS = 8
MIN_SEEDS_SURVIVING = 0.8  # band from CLAUDE.md §8 M8
AUGUST = ((dt.date(2027, 8, 1) - START).days, (dt.date(2027, 8, 31) - START).days)
OCTOBER = ((dt.date(2027, 10, 1) - START).days, (dt.date(2027, 10, 21) - START).days)


def _survivals(seed: int) -> tuple[bool | None, bool | None]:
    """For each holiday: None if no creatures lived when it began, else whether some
    were alive on every day of it."""
    config = parse_config(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    world, _ = World.create(config, seed, epoch_unix_ms(START))
    world.apply(PresenceChanged(False))
    counts: list[int] = []
    while len(counts) <= OCTOBER[1]:
        october = OCTOBER[0] <= len(counts) <= OCTOBER[1]
        live_day(world, "conference" if october else "office-august")
        counts.append(world.fauna.count)
    out: list[bool | None] = []
    for first, last in (AUGUST, OCTOBER):
        start = counts[first - 1]
        out.append(None if start == 0 else min(counts[first : last + 1]) > 0)
    return out[0], out[1]


@pytest.mark.slow
def test_life_survives_the_holidays() -> None:
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(_survivals, SEEDS))
    for k, name in enumerate(("August", "3-week absence")):
        judged = [bool(r[k]) for r in results if r[k] is not None]
        spread = f"{name}: survived per seed {[r[k] for r in results]}"
        assert len(judged) >= 15, spread
        assert np.mean(judged) >= MIN_SEEDS_SURVIVING, spread
