"""M2 acceptance on many seeds and sim-years (nightly). See reports/M2-terrain/."""

import numpy as np
import pytest
from lineage_sim.config import Config
from lineage_sim.events import LandmassesRejoined, LandmassSplit
from lineage_sim.world import World

EPOCH_UNIX_MS = 1_767_225_600_000  # 2026-01-01 00:00 UTC
SEEDS = range(20)
YEARS = 10
WEEK_S = 7 * 86_400
# Acceptance bands from CLAUDE.md §8 M2.
LAND_FRACTION_BAND = (0.25, 0.6)
MIN_CHANGES_PER_3_YEARS = 1.0
MIN_SHARE_OF_SEEDS = 0.5


@pytest.mark.slow
def test_terrain_acceptance_over_ten_years(config: Config) -> None:
    lowest: list[float] = []
    highest: list[float] = []
    changes: list[int] = []
    for seed in SEEDS:
        world, _ = World.create(config, seed, EPOCH_UNIX_MS)
        fractions = [world.terrain.land_fraction]
        count = 0
        for _ in range(round(YEARS * 365.25 / 7)):
            outputs = world.step(WEEK_S)
            count += sum(isinstance(o, LandmassSplit | LandmassesRejoined) for o in outputs)
            fractions.append(world.terrain.land_fraction)
            assert np.isfinite(world.terrain.height).all()
        lowest.append(min(fractions))
        highest.append(max(fractions))
        changes.append(count)

    spread = f"min per seed {np.round(lowest, 3)}, max per seed {np.round(highest, 3)}"
    assert min(lowest) > 0.0, f"a seed lost all its land: {spread}"
    assert min(lowest) >= LAND_FRACTION_BAND[0], spread
    assert max(highest) <= LAND_FRACTION_BAND[1], spread
    per_3_years = np.array(changes) / (YEARS / 3)
    share = float(np.mean(per_3_years >= MIN_CHANGES_PER_3_YEARS))
    assert share >= MIN_SHARE_OF_SEEDS, f"splits+rejoins per seed over {YEARS} years: {changes}"
