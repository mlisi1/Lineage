"""Seeds in guts (M11): grazers swallow the seeds of fruiting plants and drop them later."""

from __future__ import annotations

from dataclasses import replace

import numpy as np
from fauna_site import GRAZER, Site
from lineage_sim.config import Config
from lineage_sim.flora import Rare as PlantRare

HERD = [(10.0 + 2 * k, 20.0) for k in range(12)]


def _site(config: Config, *, fruiting: bool, rate: float = 50.0, biomass: float = 0.8) -> Site:
    fauna = replace(config.fauna, gut_seeds_per_hour=rate)
    site = Site(config, fauna=fauna, biomass=biomass)
    if fruiting:
        state = site.flora.get_state()
        state["rare"][site.terrain.land] = int(PlantRare.FRUITING)
        site.flora.set_state(state)
    return site


def test_grazers_swallow_the_seeds_of_fruit(config: Config) -> None:
    site = _site(config, fruiting=True)
    site.add(GRAZER, HERD, energy_share=0.3)
    site.run(2.0)
    state = site.fauna.get_state()
    carrying = state["gut_h"] >= 0
    assert carrying.mean() > 0.5
    assert (state["gut_rare"][carrying] == int(PlantRare.FRUITING)).all()
    assert (state["gut_genome"][carrying] == 60).all()  # the site's plant genome
    passage = config.fauna.gut_passage_hours
    assert float(state["gut_h"][carrying].max()) <= 1.5 * passage


def test_no_seeds_from_plants_without_fruit_or_with_gut_seeds_off(config: Config) -> None:
    for site in (_site(config, fruiting=False), _site(config, fruiting=True, rate=0.0)):
        site.add(GRAZER, HERD, energy_share=0.3)
        site.run(2.0)
        assert (site.fauna.get_state()["gut_h"] < 0).all()


def test_a_carried_seed_is_dropped_where_its_carrier_is(config: Config) -> None:
    site = _site(config, fruiting=False, rate=0.0, biomass=0.0)  # bare land
    site.add(GRAZER, HERD, energy_share=0.9)
    state = site.fauna.get_state()
    state["gut_genome"][:] = 60
    state["gut_rare"][:] = int(PlantRare.FRUITING)
    state["gut_h"][:] = 0.5
    site.fauna.set_state(state)
    assert float(site.flora.biomass.max()) == 0.0
    site.run(1.0)
    assert (site.fauna.get_state()["gut_h"] < 0).all()  # every gut is empty again
    sprouted = np.argwhere(site.flora.biomass > 0)
    assert sprouted.size > 0
    near = [min(abs(x - hx) + abs(y - hy) for hx, hy in HERD) for y, x in sprouted]
    assert max(near) <= 3  # where the herd stood
    rare = site.flora.rare[site.flora.biomass > 0]
    assert (rare & int(PlantRare.FRUITING)).any()


def test_guts_survive_a_save(config: Config) -> None:
    site = _site(config, fruiting=True)
    site.add(GRAZER, HERD, energy_share=0.3)
    site.run(2.0)
    state = site.fauna.get_state()
    again = Site(config, fauna=site.cfg)
    again.fauna.set_state(state)
    restored = again.fauna.get_state()
    for key in ("gut_genome", "gut_rare", "gut_h"):
        assert np.array_equal(restored[key], state[key]), key
