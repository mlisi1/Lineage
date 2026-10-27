"""Food at sea (M11): who smells algae, and swimmers living on them."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest
from fauna_site import COLUMNS, GRAZER, ROWS, SEA, Site
from fauna_site import with_gene as _with
from lineage_sim.config import Config
from lineage_sim.fauna import creature
from lineage_sim.fauna.genome import Gene

SWIMMER = _with(GRAZER, Gene.AQUATIC, 1.0)


def test_only_those_at_ease_in_water_smell_algae(config: Config) -> None:
    site = Site(config, water_from=30)
    ids = site.add(GRAZER, [(28.0, 20.0), (28.0, 21.0)])
    assert ids.size == 2
    food = np.zeros((ROWS, COLUMNS), dtype=np.float32)  # nothing on land
    sea = np.zeros((ROWS, COLUMNS), dtype=np.float32)
    sea[:, 32:] = 0.3  # algae to the east
    positions = np.array([[28.0, 20.0], [28.0, 21.0]], dtype=np.float32)
    ease = np.array([0.0, 1.0], dtype=np.float32)
    reach = np.full(2, 8.0, dtype=np.float32)
    here = np.zeros(2, dtype=np.float32)
    x, _ = creature.smell_food(food, positions, here, reach, None, sea, ease)
    assert float(x[0]) == 0.0  # a land animal does not smell the sea's food
    assert float(x[1]) > 0.1  # a swimmer smells it to the east


def _swim(config: Config, algae: float) -> float:
    site = Site(config, biomass=0.0, water_from=0)  # all sea
    state = site.flora.get_state()
    state["algae"][:] = algae
    site.flora.set_state(state)
    ids = site.add(SWIMMER, [(20.0 + i, 20.0) for i in range(4)], energy_share=0.5)
    site.run(24.0)
    return float(site.energy_share(ids).mean())


def test_swimmers_feed_on_algae(config: Config) -> None:
    fed, hungry = _swim(config, 0.4), _swim(config, 0.0)
    assert fed > hungry + 0.1
    assert fed > 0.5  # they gain on a day at sea


def _energy_lost_in(config: Config, depth: float, *, wading: float | None = None) -> float:
    """Share of its reserve a land grazer loses in six hours in water of ``depth``."""
    fauna = replace(config.fauna, immigrant_groups_per_year=0.0)
    if wading is not None:
        fauna = replace(fauna, wading_depth=wading)
    site = Site(config, water_from=30, fauna=fauna)
    state = site.terrain.get_state()
    state["height"][:, 30:] = SEA - depth
    site.terrain.set_state(state)
    ids = site.add(GRAZER, [(40.0, 20.0 + k) for k in range(3)], energy_share=0.8)
    site.run(6.0)
    return 0.8 - float(site.energy_share(ids).mean())


def test_land_animals_wade_the_shallows_without_struggling(config: Config) -> None:
    shallow, deep = _energy_lost_in(config, 0.01), _energy_lost_in(config, 0.2)
    assert deep > 2.0 * shallow  # deep water drains a land animal; the shelf hardly does
    no_wading = _energy_lost_in(config, 0.01, wading=0.0)
    assert no_wading == pytest.approx(deep, rel=0.05)  # without wading, shallow is as bad
