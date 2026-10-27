"""Nutrients return to the soil (M11): dung where grazers eat, carcasses where they rot."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
import pytest
from fauna_site import GRAZER, Site
from lineage_sim.config import Config


def _site(config: Config, **keys: float) -> Site:
    fauna = replace(config.fauna, immigrant_groups_per_year=0.0, **keys)
    return Site(config, fauna=fauna)


def test_grazers_return_dung_to_the_soil_where_they_eat(config: Config) -> None:
    def fertility_after(dung: float) -> np.ndarray:
        site = _site(config, dung_fertility=dung, carrion_fertility=0.0)
        site.add(GRAZER, [(15.0 + k, 20.0) for k in range(6)], energy_share=0.3)
        site.run(24.0)
        return site.terrain.fertility.copy()

    with_dung, without = fertility_after(config.fauna.dung_fertility), fertility_after(0.0)
    gained = with_dung - without
    assert float(gained.max()) > 0.0  # where the herd grazed
    assert float(gained.min()) >= 0.0
    assert float(without.max()) == pytest.approx(0.5)  # no other source in a day of fauna


def test_rotting_carrion_enriches_its_cell(config: Config) -> None:
    site = _site(config, dung_fertility=0.0)
    site.add(GRAZER, [(2.0, 2.0)])  # someone alive, so the island ticks
    state = site.fauna.get_state()
    state["carrion"][20, 30] = 2.0
    site.fauna.set_state(state)
    site.run(72.0)  # one decay time: about 63 % of it rots
    rotted = 2.0 * (1.0 - np.exp(-72.0 / config.fauna.carrion_decay_hours))
    expected = 0.5 + config.fauna.carrion_fertility * rotted
    assert float(site.terrain.fertility[20, 30]) == pytest.approx(expected, rel=0.02)
    assert float(site.terrain.fertility[20, 40]) == pytest.approx(0.5)
