"""Cover (M11): prey among plants taller than it is harder to kill."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest
from fauna_site import GRAZER, HUNTER, Site
from fauna_site import with_gene as _with
from lineage_sim.config import Config
from lineage_sim.fauna import creature
from lineage_sim.fauna.genome import Gene
from lineage_sim.flora import Gene as PlantGene

SMALL_PREY = _with(GRAZER, Gene.SIZE, 0.0)


def test_hidden_needs_plants_taller_than_the_prey_and_dense() -> None:
    height = np.array([0.2, 1.0, 1.0, 1.0], dtype=np.float32)
    density = np.array([1.0, 1.0, 0.5, 1.0], dtype=np.float32)
    reaches = np.array([0.3, 0.3, 0.3, 1.2], dtype=np.float32)
    hidden = creature.hidden(height, density, reaches)
    assert float(hidden[0]) == 0.0  # grass below it hides nothing
    assert float(hidden[1]) == pytest.approx(0.7)  # 70 % of the trees rise above it
    assert float(hidden[2]) == pytest.approx(0.35)  # half as dense
    assert float(hidden[3]) == 0.0  # a big body is seen over the trees


def _kills(config: Config, plant_height: float, protection: float) -> int:
    """Kills in 40 independent encounters: one hungry hunter beside one small grazer, for
    an hour each (a hunter that has eaten stops hunting, so one pair is one trial)."""
    fauna = replace(config.fauna, immigrant_groups_per_year=0.0, cover_protection=protection)
    kills = 0
    for seed in range(40):
        site = Site(config, biomass=0.9, fauna=fauna, seed=seed)
        state = site.flora.get_state()
        state["genome"][PlantGene.HEIGHT] = round(plant_height * 255)
        site.flora.set_state(state)
        site.add(SMALL_PREY, [(20.0, 20.0)])
        site.add(HUNTER, [(20.5, 20.0)], energy_share=0.3)
        site.run(1.0)
        kills += site.fauna.tally.killed
    return kills


def test_hunters_kill_fewer_small_prey_in_the_forest(config: Config) -> None:
    open_ground = _kills(config, 0.95, 0.0)
    forest = _kills(config, 0.95, 0.6)
    assert open_ground >= 10
    assert forest < 0.8 * open_ground
    # In low grass the small prey cannot hide: cover changes nothing.
    assert _kills(config, 0.1, 0.6) == _kills(config, 0.1, 0.0)
