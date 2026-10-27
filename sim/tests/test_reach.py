"""Reach (M11): tall plants feed tall bodies; small ones get only the low leaves."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest
from fauna_site import COLUMNS, GRAZER, ROWS, Site
from fauna_site import with_gene as _with
from lineage_sim.config import Config
from lineage_sim.fauna import creature
from lineage_sim.fauna.genome import Gene
from lineage_sim.flora import Gene as PlantGene

SMALL = _with(GRAZER, Gene.SIZE, 0.0)  # mass 0.25: reaches about 0.31
BIG = _with(GRAZER, Gene.SIZE, 1.0)  # mass 16: reaches about 1.26


def test_reach_grows_with_mass(config: Config) -> None:
    cfg = config.fauna
    reach = creature.reach(cfg, np.array([0.25, 1.0, 8.0], dtype=np.float32))
    assert float(reach[1]) == pytest.approx(cfg.reach_at_unit_mass)
    assert float(reach[2]) == pytest.approx(2.0 * cfg.reach_at_unit_mass)
    assert float(reach[0]) < float(reach[1])


def test_out_of_reach_plants_give_only_the_floor_and_a_share(config: Config) -> None:
    cfg = config.fauna
    height = np.array([[0.2, 1.0]], dtype=np.float32)
    browse = creature.Browse(height, np.array([0.5], dtype=np.float32), cfg.browse_floor)
    rows, columns = np.array([0]), np.array([0])
    assert float(browse.share(rows, columns)[0]) == pytest.approx(1.0)  # grass: all of it
    tree = float(browse.share(rows, columns + 1)[0])
    assert tree == pytest.approx(cfg.browse_floor + (1 - cfg.browse_floor) * 0.5)
    everything = creature.Browse(height, np.array([0.5], dtype=np.float32), 1.0)
    assert float(everything.share(rows, columns + 1)[0]) == pytest.approx(1.0)  # off


def _forest(config: Config, genome: tuple[float, ...], *, floor: float | None = None) -> float:
    fauna = replace(config.fauna, immigrant_groups_per_year=0.0)
    if floor is not None:
        fauna = replace(fauna, browse_floor=floor)
    site = Site(config, biomass=0.9, fauna=fauna)
    state = site.flora.get_state()
    state["genome"][PlantGene.HEIGHT] = round(0.95 * 255)  # tall trees everywhere
    site.flora.set_state(state)
    ids = site.add(genome, [(10.0 + 3 * k, 20.0) for k in range(6)], energy_share=0.3)
    site.run(24.0)
    return float(site.energy_share(ids).mean())


def test_tall_trees_feed_big_bodies_better_than_small_ones(config: Config) -> None:
    small, small_off = _forest(config, SMALL), _forest(config, SMALL, floor=1.0)
    assert small < small_off - 0.02  # out of reach, the small eat less
    big, big_off = _forest(config, BIG), _forest(config, BIG, floor=1.0)
    assert big == pytest.approx(big_off, abs=1e-6)  # the big reach the tops


def test_a_small_grazer_smells_the_grass_it_can_reach_not_the_forest(config: Config) -> None:
    cfg = config.fauna
    food = np.zeros((ROWS, COLUMNS), dtype=np.float32)
    height = np.zeros((ROWS, COLUMNS), dtype=np.float32)
    food[:, :20], height[:, :20] = 0.3, 0.2  # grass to the west
    food[:, 40:], height[:, 40:] = 0.5, 1.0  # more food in tall forest to the east
    positions = np.array([[30.0, 20.0]], dtype=np.float32)
    reach_range = np.full(1, 15.0, dtype=np.float32)
    here = np.zeros(1, dtype=np.float32)
    x, _ = creature.smell_food(food, positions, here, reach_range, None)
    assert float(x[0]) > 0.0  # without reach, everyone heads for the forest
    small = creature.Browse(
        height, creature.reach(cfg, np.array([0.25], np.float32)), cfg.browse_floor
    )
    x, _ = creature.smell_food(food, positions, here, reach_range, None, browse=small)
    assert float(x[0]) < 0.0  # west, to the grass
    big = creature.Browse(
        height, creature.reach(cfg, np.array([16.0], np.float32)), cfg.browse_floor
    )
    x, _ = creature.smell_food(food, positions, here, reach_range, None, browse=big)
    assert float(x[0]) > 0.0  # east, to the forest
