"""M4 acceptance on many seeds (nightly). See reports/M4-fauna-evolution/.

Seeds run in parallel processes: three sim-years of an inhabited world take minutes each.
"""

from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.config import parse_config
from lineage_sim.events import PopulationExtinct
from lineage_sim.world import World

CONFIG = Path(__file__).resolve().parents[1] / "config" / "default.toml"
EPOCH_UNIX_MS = 1_767_225_600_000  # 2026-01-01 00:00 UTC
SEEDS = range(20)
YEARS = 3
WEEK_S = 7 * 86_400
WEEKS_PER_YEAR = 52
WORKERS = 8
# Acceptance bands from CLAUDE.md §8 M4.
MAX_EXTINCT_SEED_YEARS = 0.2
MIN_SEEDS_WITH_BOTH = 0.6
PRESENT = 3  # creatures of a diet class for it to count as present
MIN_SEEDS_DRIFTING = 0.8


def _run(seed: int) -> tuple[list[bool], float, list[float]]:
    """Per seed: extinction in each year, the share of the final year's weeks with both
    diets present, distance from ancestors at the end of each year."""
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    world, _ = World.create(config, seed, EPOCH_UNIX_MS)
    extinct: list[bool] = []
    distance: list[float] = []
    weeks_with_both = 0
    for year in range(YEARS):
        died_out = False
        for _week in range(WEEKS_PER_YEAR):
            outputs = world.step(WEEK_S)
            died_out |= any(isinstance(o, PopulationExtinct) for o in outputs)
            if year == YEARS - 1:
                herbivores, _, predators = world.fauna.diet_counts()
                weeks_with_both += herbivores >= PRESENT and predators >= PRESENT
        extinct.append(died_out)
        fauna = world.fauna
        distance.append(float(fauna.distance_from_ancestors().mean()) if fauna.count else 0.0)
    return extinct, weeks_with_both / WEEKS_PER_YEAR, distance


@pytest.mark.slow
def test_fauna_acceptance_over_three_years() -> None:
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(_run, SEEDS))
    extinct = np.array([r[0] for r in results])
    both = np.array([r[1] for r in results])
    distance = np.array([r[2] for r in results])

    assert extinct.mean() < MAX_EXTINCT_SEED_YEARS, f"extinctions by seed and year: {extinct}"
    # Mean over the final year, not one day: predator packs boom and bust within months.
    spread = f"share of year 3 with both diets, per seed: {both.round(2).tolist()}"
    assert both.mean() >= MIN_SEEDS_WITH_BOTH, spread
    # Drift from the ancestors: further away at year 3 than at year 2.
    rising = distance[:, 2] > distance[:, 1]
    spread = f"mean distance per seed, years 2 and 3: {distance[:, 1:].round(3).tolist()}"
    assert rising.mean() >= MIN_SEEDS_DRIFTING, spread
    assert float(np.median(distance[:, 2])) > 0.05, spread
