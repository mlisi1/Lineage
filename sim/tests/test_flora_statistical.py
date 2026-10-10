"""M3 acceptance on many seeds from bare rock (nightly). See reports/M3-flora/."""

import numpy as np
import pytest
from lineage_sim.config import Config
from lineage_sim.flora import PLANT_FORMS, Cover, Flora, Wildfire
from lineage_sim.subsystem import Subsystem
from lineage_sim.terrain import Terrain
from lineage_sim.world import World

EPOCH_UNIX_MS = 1_767_225_600_000  # 2026-01-01 00:00 UTC


def _plants_only(config: Config) -> list[Subsystem]:
    """Terrain, flora and fire without animals: these criteria are about plants."""
    terrain = Terrain(config.terrain)
    flora = Flora(config.flora, terrain)
    return [terrain, flora, Wildfire(config.flora, flora, terrain)]


SEEDS = range(20)
WEEK_S = 7 * 86_400
WEEKS = 157  # three sim-years
MONTHS_PER_WEEK = 12 * 7 / 365.25
# Acceptance bands from CLAUDE.md §8 M3.
GRASS_SHARE = 0.5
GRASS_MONTHS = (3.0, 9.0)
FOREST_SHARE = 0.02  # "first closed forest": closed canopy on this share of the land
FOREST_MONTHS = (12.0, 24.0)
FORM_SHARE = 0.01  # a form coexists if it holds this share of the land
MIN_FORMS = 4
MIN_SHARE_OF_SEEDS = 0.8


@pytest.mark.slow
def test_succession_from_bare_rock(config: Config) -> None:
    grass_months: list[float] = []
    forest_months: list[float] = []
    forms: list[int] = []
    for seed in SEEDS:
        world, _ = World.create(config, seed, EPOCH_UNIX_MS, _plants_only(config))
        first_grass = first_forest = float("nan")
        for week in range(1, WEEKS + 1):
            world.step(WEEK_S)
            shares = world.flora.cover_shares()
            if np.isnan(first_grass) and shares[Cover.GRASS] >= GRASS_SHARE:
                first_grass = week * MONTHS_PER_WEEK
            if np.isnan(first_forest) and world.flora.closed_forest_share() >= FOREST_SHARE:
                first_forest = week * MONTHS_PER_WEEK
        grass_months.append(first_grass)
        forest_months.append(first_forest)
        shares = world.flora.cover_shares()
        forms.append(sum(shares[form] >= FORM_SHARE for form in PLANT_FORMS))
        assert max(shares.values()) < 1.0, f"seed {seed} ended as a single class"

    grass, forest = np.array(grass_months), np.array(forest_months)
    assert not np.isnan(grass).any(), f"grass never reached half the land: {grass.round(1)}"
    assert not np.isnan(forest).any(), f"no closed forest in three years: {forest.round(1)}"
    assert GRASS_MONTHS[0] <= np.median(grass) <= GRASS_MONTHS[1], grass.round(1)
    assert FOREST_MONTHS[0] <= np.median(forest) <= FOREST_MONTHS[1], forest.round(1)
    share = float(np.mean(np.array(forms) >= MIN_FORMS))
    assert share >= MIN_SHARE_OF_SEEDS, f"forms per seed at year 3: {forms}"
