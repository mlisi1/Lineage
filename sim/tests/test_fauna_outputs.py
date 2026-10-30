"""What fauna tells the scene (R5): who died of what and by which hunter, who was born to
whom, how grown each is and what each ate. Outputs and read-only views only: reading them
must not change the world."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace

import numpy as np
import pytest
from fauna_site import GRAZER, HUNTER, TICK_S, Site
from fauna_site import with_gene as _with
from lineage_sim import clock
from lineage_sim.config import Config
from lineage_sim.events import (
    CraterFormed,
    CreaturesArrived,
    CreaturesBorn,
    CreaturesDied,
    OutputEvent,
    VolcanoErupted,
)
from lineage_sim.fauna.genome import Gene
from lineage_sim.subsystem import Context

ONE_TICK_H = TICK_S / 3600


def _deaths(outputs: list[OutputEvent]) -> list[CreaturesDied]:
    return [output for output in outputs if isinstance(output, CreaturesDied)]


def _births(outputs: list[OutputEvent]) -> list[CreaturesBorn]:
    return [output for output in outputs if isinstance(output, CreaturesBorn)]


def _one_death(outputs: list[OutputEvent]) -> tuple[int, str, int]:
    deaths = _deaths(outputs)
    assert len(deaths) == 1
    death = deaths[0]
    assert len(death.ids) == len(death.causes) == len(death.killers) == 1
    return death.ids[0], death.causes[0], death.killers[0]


def _ctx(site: Site, config: Config) -> Context:
    instant = clock.instant(clock.date_to_unix_ms(dt.date(2026, 6, 1)), 0, config.calendar)
    return Context(site.t_ms, 0.0, instant, site.rng)


# --- Deaths -------------------------------------------------------------------------------


def test_a_kill_names_the_hunter(config: Config) -> None:
    site = Site(config)
    prey = site.add(GRAZER, [(20.5, 20.0)])
    hunter = site.add(HUNTER, [(20.0, 20.0)], energy_share=0.3)
    outputs = site.run(6.0)
    assert site.alive(prey) == 0
    assert _one_death(outputs) == (int(prey[0]), "killed", int(hunter[0]))
    assert _deaths(outputs)[0].t_ms > 0


def test_the_starved_die_of_hunger_by_no_one(config: Config) -> None:
    site = Site(config, biomass=0.0)
    ids = site.add(GRAZER, [(20.0, 20.0)], energy_share=0.01)
    outputs = site.run(3.0)
    assert _one_death(outputs) == (int(ids[0]), "starved", -1)


def test_the_drowned_die_in_water_by_no_one(config: Config) -> None:
    site = Site(config, water_from=0)
    ids = site.add(GRAZER, [(20.0, 20.0)], energy_share=0.01)
    outputs = site.run(3.0)
    assert _one_death(outputs) == (int(ids[0]), "drowned", -1)


def test_the_old_and_the_burnt_by_no_one(config: Config) -> None:
    site = Site(config)
    old = site.add(GRAZER, [(20.0, 20.0)])
    lifespan_h = float(site.fauna.body.lifespan_h[0])
    state = site.fauna.get_state()
    state["age_h"][:] = lifespan_h - 1.0
    site.fauna.set_state(state)
    outputs = site.run(2.0)
    assert _one_death(outputs) == (int(old[0]), "old_age", -1)

    burning = Site(config, fire=True)
    assert burning.fire is not None
    for y in range(40):
        for x in range(0, 30):
            burning.fire.ignite(y, x, burning.t_ms)
    caught = burning.add(GRAZER, [(15.0, 20.0)])
    burning.add(GRAZER, [(50.0, 20.0)])
    outputs = burning.run(1.0)
    assert _one_death(outputs) == (int(caught[0]), "burnt", -1)


def test_deaths_of_one_tick_come_in_one_output_in_id_order(config: Config) -> None:
    site = Site(config, biomass=0.0)
    ids = site.add(GRAZER, [(10.0, 10.0), (30.0, 20.0), (50.0, 30.0)], energy_share=0.001)
    outputs = site.run(ONE_TICK_H)
    deaths = _deaths(outputs)
    assert len(deaths) == 1
    assert deaths[0].ids == tuple(int(ident) for ident in ids)
    assert deaths[0].causes == ("starved",) * 3
    assert deaths[0].killers == (-1, -1, -1)


def test_a_blast_is_told_as_such(config: Config) -> None:
    """A cone rising or a crater striking: the dead die of ``blast``, by no hunter (the
    tally still counts them as killed)."""
    site = Site(config)
    on_cone = site.add(GRAZER, [(30.0, 20.0), (30.5, 20.0)])
    far = site.add(GRAZER, [(10.0, 30.0)])
    on_crater = site.add(GRAZER, [(10.0, 10.0)])
    ctx = _ctx(site, config)
    outputs = site.fauna.observe([VolcanoErupted(0, 30.0, 20.0, 4.0, 0.1)], ctx)
    deaths = _deaths(outputs)
    assert len(deaths) == 1
    assert deaths[0].ids == tuple(int(ident) for ident in on_cone)
    assert deaths[0].causes == ("blast", "blast")
    assert all(killer < 0 for killer in deaths[0].killers)
    outputs = site.fauna.observe([CraterFormed(0, 10.0, 10.0, 3.0, 0.05)], ctx)
    assert [(d.ids, d.causes) for d in _deaths(outputs)] == [((int(on_crater[0]),), ("blast",))]
    assert site.alive(far) == 1
    assert site.fauna.tally.killed == 3


def test_every_death_and_birth_is_told_once(config: Config) -> None:
    """Over busy days the outputs account for the tally: each death and birth once, each
    newborn among the living or the dead, each named killer a creature that lived."""
    busy = replace(config.fauna, immigrant_groups_per_year=300.0)
    site = Site(config, seed=5, fauna=busy)
    site.add(GRAZER, [(float(10 + 2 * k), 20.0) for k in range(12)], idle_days=3.0)
    site.add(HUNTER, [(20.0, 21.0), (30.0, 21.0)], energy_share=0.3)
    seen: set[int] = set(int(ident) for ident in site.fauna.ids)
    died: list[int] = []
    born: list[int] = []
    for _ in range(8):
        outputs = site.run(12.0)
        for output in outputs:
            if isinstance(output, CreaturesBorn):
                assert len(output.ids) == len(output.parents)
                assert set(output.parents) <= seen  # a mother that lived
                born += output.ids
                seen.update(output.ids)
            elif isinstance(output, CreaturesDied):
                assert len(output.ids) == len(output.causes) == len(output.killers)
                died += output.ids
                for cause, killer in zip(output.causes, output.killers, strict=True):
                    assert (killer >= 0) == (cause == "killed")
                    if killer >= 0:
                        assert killer in seen
            elif isinstance(output, CreaturesArrived):
                seen.update(range(output.first_id, output.first_id + output.count))
        assert not set(int(ident) for ident in site.fauna.ids) & set(died)
    tally = site.fauna.tally
    assert len(died) == len(set(died)) == tally.deaths
    assert len(born) == len(set(born)) == tally.births
    assert tally.births > 0
    assert tally.deaths > 0


# --- Births -------------------------------------------------------------------------------


def test_a_pair_s_young_is_born_to_one_of_them(config: Config) -> None:
    site = Site(config)
    parents = site.add(GRAZER, [(20.0, 20.0), (20.4, 20.0)], idle_days=5.0)
    outputs = site.run(ONE_TICK_H)
    births = _births(outputs)
    assert len(births) == 1
    (young,) = births[0].ids
    assert young not in parents
    assert young in site.fauna.ids
    assert births[0].parents in {(int(parents[0]),), (int(parents[1]),)}
    # The newborn stands by the parent it is told to be born to.
    fauna = site.fauna
    mother = fauna.positions[fauna.ids == births[0].parents[0]][0]
    child = fauna.positions[fauna.ids == young][0]
    assert float(np.hypot(*(child - mother))) < 4.0


def test_a_brood_shares_its_mother(config: Config) -> None:
    site = Site(config)
    broody = _with(GRAZER, Gene.BROOD, 1.0)
    parents = site.add(broody, [(20.0, 20.0), (20.4, 20.0)], idle_days=5.0)
    outputs = site.run(ONE_TICK_H)
    births = _births(outputs)
    assert len(births) == 1
    assert len(births[0].ids) == config.fauna.brood_max > 1
    assert len(set(births[0].parents)) == 1
    assert births[0].parents[0] in parents
    assert len(births[0].ids) == site.fauna.tally.births


def test_a_clone_is_born_to_its_only_parent(config: Config) -> None:
    cfg = config.fauna
    site = Site(config)
    ids = site.add(GRAZER, [(20.0, 20.0)], idle_days=cfg.asexual_after_days + 1.0)
    outputs = site.run(ONE_TICK_H)
    births = _births(outputs)
    assert len(births) == 1
    assert births[0].parents == (int(ids[0]),)
    assert site.fauna.tally.clones == 1


def test_no_birth_no_output(config: Config) -> None:
    site = Site(config)
    site.add(GRAZER, [(10.0, 20.0), (50.0, 20.0)], idle_days=3.0)  # far apart
    assert _births(site.run(2.0)) == []


# --- Maturity and meals -------------------------------------------------------------------


def test_maturity_is_age_over_coming_of_age_in_zero_to_one(config: Config) -> None:
    site = Site(config)
    site.add(GRAZER, [(10.0, 20.0), (20.0, 20.0), (30.0, 20.0)])
    fauna = site.fauna
    of_age = float(fauna.body.maturity_h[0])
    state = fauna.get_state()
    state["age_h"][:] = np.array([0.0, 0.25 * of_age, 3.0 * of_age], dtype=np.float32)
    fauna.set_state(state)
    grown = fauna.maturity
    assert grown.dtype == np.float32
    assert grown.shape == (3,)
    np.testing.assert_allclose(grown, [0.0, 0.25, 1.0], rtol=1e-5)
    # Grown exactly when adult: at the age of coming of age and beyond, never above one.
    np.testing.assert_array_equal(grown >= 1.0, fauna.adult)
    state["age_h"][:] = of_age
    fauna.set_state(state)
    assert (fauna.maturity == 1.0).all()
    assert fauna.adult.all()
    # Nothing of it is saved: it follows from age and body.
    assert "maturity" not in fauna.get_state()


def test_a_newborn_is_not_grown_and_grows(config: Config) -> None:
    site = Site(config)
    parents = site.add(GRAZER, [(20.0, 20.0), (20.4, 20.0)], idle_days=5.0)
    site.run(ONE_TICK_H)
    fauna = site.fauna
    young = ~np.isin(fauna.ids, parents)
    assert float(fauna.maturity[young][0]) == 0.0
    assert (fauna.maturity[~young] == 1.0).all()
    site.run(12.0)
    young = ~np.isin(fauna.ids, parents)
    expected = 12.0 / float(fauna.body.maturity_h[young][0])
    assert float(fauna.maturity[young][0]) == pytest.approx(expected, rel=0.02)


def test_with_nobody_maturity_and_eating_are_empty(config: Config) -> None:
    site = Site(config)
    assert site.fauna.maturity.shape == (0,)
    assert site.fauna.eating.shape == (0,)


def test_eating_tells_plants_from_meat(config: Config) -> None:
    pasture = Site(config)
    pasture.add(GRAZER, [(20.0, 20.0)], energy_share=0.5)
    pasture.run(ONE_TICK_H)
    assert pasture.fauna.eating.tolist() == [1]  # it grazed

    bare = Site(config, biomass=0.0)
    bare.add(GRAZER, [(20.0, 20.0)], energy_share=0.5)
    bare.run(ONE_TICK_H)
    assert bare.fauna.eating.tolist() == [0]  # nothing to eat

    site = Site(config, biomass=0.0)
    prey = site.add(GRAZER, [(20.5, 20.0)])
    hunter = site.add(HUNTER, [(20.0, 20.0)], energy_share=0.3)
    for _ in range(36):
        site.run(ONE_TICK_H)
        if not site.alive(prey):
            break
    assert site.alive(prey) == 0
    # The kill's tick: the hunter's meal is meat, read after the victim is buried.
    assert site.fauna.ids.tolist() == [int(hunter[0])]
    assert site.fauna.eating.tolist() == [2]


# --- Determinism ----------------------------------------------------------------------------


def test_reading_what_the_scene_reads_changes_nothing(config: Config) -> None:
    """Two sites from the same seed, one read each tick (maturity, eating, the outputs
    kept), the other not: the same state, bit for bit."""
    busy = replace(config.fauna, immigrant_groups_per_year=300.0)

    def run(read: bool) -> dict[str, np.ndarray]:
        site = Site(config, seed=11, fauna=busy)
        site.add(GRAZER, [(float(10 + 2 * k), 20.0) for k in range(10)], idle_days=3.0)
        site.add(HUNTER, [(20.0, 21.0)], energy_share=0.3)
        kept: list[OutputEvent] = []
        for _ in range(4 * 24):
            outputs = site.run(0.5)
            if read:
                kept += outputs
                _ = site.fauna.maturity, site.fauna.eating
        if read:
            assert _deaths(kept)
            assert _births(kept)
        return {key: np.asarray(value) for key, value in site.fauna.get_state().items()}

    read, ignored = run(True), run(False)
    assert read.keys() == ignored.keys()
    for key in read:
        np.testing.assert_array_equal(read[key], ignored[key], err_msg=key)
