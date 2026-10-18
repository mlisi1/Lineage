"""M5 acceptance on many seeds (nightly): learning tracks the local environment.

M5.1 (CLAUDE.md §8): the final-year diet fit (learned plant preference against the local
plant defence) is positive in ≥ 80 % of seeds. See reports/M5-fauna-learning/ and
ADR 0009. Seeds run in parallel: three sim-years of an inhabited world take minutes each.
"""

from concurrent.futures import ProcessPoolExecutor

import numpy as np
import pytest
from lineage_sim.config import parse_config
from lineage_sim.world import World

from tools.fastforward import diet_fit
from tools.runs import DEFAULT_CONFIG

EPOCH_UNIX_MS = 1_767_225_600_000  # 2026-01-01 00:00 UTC
SEEDS = range(20)
YEARS = 3
WEEK_S = 7 * 86_400
WEEKS_PER_YEAR = 52
WORKERS = 8
MIN_SEEDS_FITTING = 0.8  # band from CLAUDE.md §8 M5.1


def _final_year_fit(seed: int) -> float:
    config = parse_config(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    world, _ = World.create(config, seed, EPOCH_UNIX_MS)
    fits: list[float] = []
    for year in range(YEARS):
        for _week in range(WEEKS_PER_YEAR):
            world.step(WEEK_S)
            if year == YEARS - 1:
                fits.append(diet_fit(world))
    measured = np.array(fits)
    return float(np.nanmean(measured)) if np.isfinite(measured).any() else np.nan


@pytest.mark.slow
def test_learning_tracks_the_local_plants() -> None:
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        fits = np.array(list(pool.map(_final_year_fit, SEEDS)))
    spread = f"final-year diet fit per seed: {np.round(fits, 2).tolist()}"
    assert np.mean(fits > 0) >= MIN_SEEDS_FITTING, spread
    assert float(np.nanmedian(fits)) > 0.1, spread
