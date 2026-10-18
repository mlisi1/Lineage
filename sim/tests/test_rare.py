"""Rare genes (M7): each creature gene's bonus and cost in a controlled scenario, the
body adjustments, the dark, and the signature table. Plant rare genes are in
test_flora.py."""

from __future__ import annotations

import datetime as dt
from dataclasses import fields, replace

import numpy as np
import pytest
from fauna_site import GRAZER, HUNTER, Site
from fauna_site import genes_of as _genes
from fauna_site import with_gene as _with
from lineage_sim import rare
from lineage_sim.config import Config
from lineage_sim.fauna import creature
from lineage_sim.fauna.brain import Sense
from lineage_sim.fauna.genome import Gene
from lineage_sim.fauna.phenotype import Phenotype, phenotype
from lineage_sim.flora import Rare as PlantRare
from lineage_sim.rare import CreatureRare

WINTER = dt.date(2027, 1, 10)
SUMMER = dt.date(2026, 6, 1)
# A big, lightly armoured grazer: too strong for a plain hunter.
BULL = _with(_with(GRAZER, Gene.SIZE, 0.80), Gene.ARMOUR, 0.30)


def _slots(gene: int, count: int = 1) -> np.ndarray:
    return np.full(count, gene, dtype=np.uint16)


def _body(config: Config, genome: tuple[float, ...], gene: int = 0) -> Phenotype:
    return rare.body_of(config.fauna, _genes(genome), _slots(gene))


# --- Tables -----------------------------------------------------------------------------


def test_every_creature_gene_has_a_slot(config: Config) -> None:
    assert len(rare.CREATURE_GENES) <= config.fauna.rare_slots
    assert int(max(rare.CREATURE_GENES)) < 2**config.fauna.rare_slots
    assert len(rare.rare_costs(config.fauna)) == len(rare.CREATURE_GENES)


def test_signature_table_covers_every_gene_once() -> None:
    table = rare.signature_table()
    assert len(table) == len(rare.CREATURE_GENES) + len(rare.PLANT_GENES)
    keys = [(row["kingdom"], row["bit"]) for row in table]
    assert len(set(keys)) == len(keys)
    assert len({row["signature"] for row in table}) == len(table)
    assert {row["name"] for row in table} >= {"venom", "glow", "poisonous", "mangrove"}


# --- Body -------------------------------------------------------------------------------


def test_no_rare_genes_no_change(config: Config) -> None:
    genes = _genes(GRAZER, HUNTER)
    plain = phenotype(config.fauna, genes)
    adjusted = rare.adjust(config.fauna, genes, _slots(0, 2), plain)
    for field in fields(plain):
        assert np.array_equal(getattr(plain, field.name), getattr(adjusted, field.name))


@pytest.mark.parametrize("gene", list(CreatureRare))
def test_every_rare_gene_costs_resting_burn(config: Config, gene: CreatureRare) -> None:
    plain, carrier = _body(config, GRAZER), _body(config, GRAZER, gene)
    assert float(carrier.basal_burn[0]) > float(plain.basal_burn[0])


def test_giant_is_twice_the_mass_and_matures_later(config: Config) -> None:
    cfg = config.fauna
    plain, giant = _body(config, GRAZER), _body(config, GRAZER, CreatureRare.GIANT)
    k = cfg.giant_mass_factor
    for name in ("mass", "capacity", "attack", "defence"):
        ratio = float(getattr(giant, name)[0]) / float(getattr(plain, name)[0])
        assert ratio == pytest.approx(k, rel=1e-5)
    assert float(giant.basal_burn[0]) > k**cfg.metabolic_exponent * float(plain.basal_burn[0])
    assert float(giant.lifespan_h[0]) > float(plain.lifespan_h[0])
    assert float(giant.maturity_h[0]) / float(giant.lifespan_h[0]) == pytest.approx(
        cfg.giant_maturity_factor * cfg.maturity_share, rel=1e-5
    )


def test_longevity_doubles_life_and_halves_broods(config: Config) -> None:
    many = _with(GRAZER, Gene.BROOD, 1.0)
    plain, elder = _body(config, many), _body(config, many, CreatureRare.LONGEVITY)
    factor = config.fauna.longevity_factor
    assert float(elder.lifespan_h[0]) == pytest.approx(factor * float(plain.lifespan_h[0]))
    assert float(elder.maturity_h[0]) == float(plain.maturity_h[0])
    assert float(elder.brood[0]) < float(plain.brood[0])
    single = _body(config, GRAZER, CreatureRare.LONGEVITY)
    assert float(single.brood[0]) == 1.0  # never fewer than one young


def test_long_lived_creatures_breed_slowly(config: Config) -> None:
    days = config.fauna.repro_cooldown_days * 1.5  # past the usual wait, short of twice it
    site = Site(config)
    site.add(GRAZER, [(20.0, 20.0)], idle_days=days)
    site.add(GRAZER, [(40.0, 20.0)], idle_days=days, slots=CreatureRare.LONGEVITY)
    assert site.fauna.ready.tolist() == [True, False]
    factor = rare.cooldown_factor(config.fauna, _slots(CreatureRare.LONGEVITY))
    assert float(factor[0]) == config.fauna.longevity_cooldown_factor


def test_amphibians_walk_and_swim(config: Config) -> None:
    walker, swimmer = _body(config, GRAZER), _body(config, _with(GRAZER, Gene.AQUATIC, 1.0))
    amphibian = _body(config, _with(GRAZER, Gene.AQUATIC, 0.5), CreatureRare.AMPHIBIOUS)
    assert float(amphibian.land_speed[0]) == pytest.approx(float(walker.land_speed[0]))
    assert float(amphibian.swim_speed[0]) == pytest.approx(float(swimmer.swim_speed[0]))


def test_photosynthesisers_are_slow_on_land(config: Config) -> None:
    plain, green = _body(config, GRAZER), _body(config, GRAZER, CreatureRare.PHOTOSYNTHESIS)
    ratio = float(green.land_speed[0]) / float(plain.land_speed[0])
    assert ratio == pytest.approx(config.fauna.photosynthesis_land_speed)


# --- Venom and warning colours ----------------------------------------------------------


def test_venom_kills_larger_prey(config: Config) -> None:
    """A plain hunter cannot take the bull; a venomous one can."""
    plain_hunter = Site(config)
    plain_hunter.add(BULL, [(20.5, 20.0)])
    plain_hunter.add(HUNTER, [(20.0, 20.0)], energy_share=0.3)
    assert not plain_hunter.fauna._kills[1, 0]  # pyright: ignore[reportPrivateUsage]
    plain_hunter.run(12.0)
    assert plain_hunter.fauna.tally.killed == 0

    venomous = Site(config)
    venomous.add(BULL, [(20.5, 20.0)])
    venomous.add(HUNTER, [(20.0, 20.0)], energy_share=0.3, slots=CreatureRare.VENOM)
    assert venomous.fauna._kills[1, 0]  # pyright: ignore[reportPrivateUsage]
    venomous.run(12.0)
    assert venomous.fauna.tally.killed == 1


def test_hunters_seldom_kill_toxic_prey(config: Config) -> None:
    kills = {0: 0, int(CreatureRare.TOXIC): 0}
    for gene in kills:
        for seed in range(8):
            site = Site(config, seed=seed)
            site.add(GRAZER, [(20.5, 20.0)], slots=gene)
            site.add(HUNTER, [(20.0, 20.0)], energy_share=0.3)
            site.run(2.0)
            kills[gene] += site.fauna.tally.killed
    assert kills[0] >= 6
    assert kills[int(CreatureRare.TOXIC)] <= kills[0] // 2
    factor = rare.kill_factor(config.fauna, _slots(CreatureRare.TOXIC))
    assert float(factor[0]) == pytest.approx(config.fauna.toxic_kill_factor)


# --- Amphibious -------------------------------------------------------------------------


def test_amphibians_do_not_struggle_in_water(config: Config) -> None:
    site = Site(config, water_from=0)  # all sea
    walker = site.add(GRAZER, [(20.0, 20.0)])
    amphibian = site.add(GRAZER, [(40.0, 20.0)], slots=CreatureRare.AMPHIBIOUS)
    site.run(12.0)
    assert float(site.energy_share(amphibian)[0]) > float(site.energy_share(walker)[0]) + 0.08
    while site.alive(walker):
        site.run(1.0)
    assert site.alive(amphibian) == 1


# --- Hibernation ------------------------------------------------------------------------


def _twins(
    config: Config, gene: int, *, biomass: float = 0.0
) -> tuple[Site, np.ndarray, np.ndarray]:
    site = Site(config, biomass=biomass)
    plain = site.add(GRAZER, [(20.0, 20.0)])
    carrier = site.add(GRAZER, [(40.0, 20.0)], slots=gene)
    return site, plain, carrier


def test_hibernators_sleep_through_winter(config: Config) -> None:
    site, plain, sleeper = _twins(config, CreatureRare.HIBERNATION)
    start = site.fauna.positions.copy()
    age = site.fauna.age_hours.copy()
    site.run(24.0, when=WINTER)
    assert site.fauna.torpid.tolist() == [False, True]
    assert np.array_equal(site.fauna.positions[1], start[1])  # lies still
    assert float(site.fauna.positions[0, 0]) != float(start[0, 0])
    aged = site.fauna.age_hours - age
    assert float(aged[1]) == pytest.approx(24.0 * config.fauna.hibernation_ageing_share, rel=1e-3)
    assert float(aged[0]) == pytest.approx(24.0, rel=1e-3)
    # On bare ground in winter it outlasts its twin.
    assert float(site.energy_share(sleeper)[0]) > float(site.energy_share(plain)[0])


def test_hibernators_wake_when_hungry_and_in_summer(config: Config) -> None:
    site, _, _ = _twins(config, CreatureRare.HIBERNATION)
    site.run(1.0, when=SUMMER)
    assert not site.fauna.torpid.any()
    hungry = Site(config, biomass=0.0)
    hungry.add(GRAZER, [(20.0, 20.0)], slots=CreatureRare.HIBERNATION, energy_share=0.2)
    hungry.run(1.0, when=WINTER)
    assert not hungry.fauna.torpid.any()


def test_hibernators_sleep_in_long_darkness(config: Config) -> None:
    site, _, _ = _twins(config, CreatureRare.HIBERNATION)
    site.fauna.set_daylight(0.1)
    site.run(1.0, when=SUMMER)
    assert site.fauna.torpid.tolist() == [False, True]


def test_torpid_prey_cannot_flee(config: Config) -> None:
    slow = _with(HUNTER, Gene.SPEED, 0.0)
    body = phenotype(config.fauna, _genes(slow, _with(GRAZER, Gene.SPEED, 1.0)))
    hunter, prey = np.array([0]), np.array([1])
    awake = creature.kill_chance(config.fauna, body, hunter, prey)
    asleep = creature.kill_chance(config.fauna, body, hunter, prey, np.array([False, True]))
    assert float(asleep[0]) > float(awake[0])


# --- Photosynthesis ---------------------------------------------------------------------


def test_photosynthesisers_live_on_sunlight(config: Config) -> None:
    site, plain, green = _twins(config, CreatureRare.PHOTOSYNTHESIS)  # bare ground
    site.run(24.0)
    assert float(site.energy_share(green)[0]) > float(site.energy_share(plain)[0]) + 0.05


def test_photosynthesisers_starve_in_the_dark(config: Config) -> None:
    site, plain, green = _twins(config, CreatureRare.PHOTOSYNTHESIS)
    site.fauna.set_daylight(0.0)
    site.run(24.0)
    assert float(site.energy_share(green)[0]) < float(site.energy_share(plain)[0])


def test_shade_and_water_take_the_sun_away(config: Config) -> None:
    cfg = config.fauna
    slots = _slots(CreatureRare.PHOTOSYNTHESIS, 3)
    mass = np.ones(3, dtype=np.float32)
    shade = np.array([0.0, 0.8, 0.0], dtype=np.float32)
    on_land = np.array([True, True, False])
    gained = rare.sunlight(cfg, slots, mass, 1.0, shade, on_land, 1.0)
    assert float(gained[0]) == pytest.approx(cfg.photosynthesis_rate)
    assert float(gained[1]) == pytest.approx(0.2 * cfg.photosynthesis_rate)
    assert float(gained[2]) == 0.0
    plain = rare.sunlight(cfg, _slots(0, 3), mass, 1.0, shade, on_land, 1.0)
    assert not plain.any()


# --- Glow and the dark ------------------------------------------------------------------


def test_in_daylight_everyone_sees_to_its_range(config: Config) -> None:
    ranges = np.array([5.0, 8.0], dtype=np.float32)
    assert rare.sight(config.fauna, _slots(CreatureRare.GLOW, 2), ranges, 1.0) is None


def test_glow_sees_and_is_seen_in_the_dark(config: Config) -> None:
    cfg = config.fauna
    ranges = np.array([10.0, 10.0, 10.0], dtype=np.float32)
    slots = np.array([0, 0, CreatureRare.GLOW], dtype=np.uint16)
    sight = rare.sight(cfg, slots, ranges, 0.0)
    assert sight is not None
    assert float(sight[0, 1]) == pytest.approx(10.0 * cfg.night_sight)  # plain sees plain dimly
    assert float(sight[0, 2]) == 10.0  # everyone sees a glowing one
    assert float(sight[2, 0]) == 10.0  # a glowing one sees everyone


def test_a_hunter_finds_glowing_prey_in_the_dark(config: Config) -> None:
    """Prey five cells away: in the dark a hunter senses it only if it glows."""
    found: dict[int, float] = {}
    for gene in (0, int(CreatureRare.GLOW)):
        site = Site(config, biomass=0.0)
        site.add(HUNTER, [(20.0, 20.0)], energy_share=0.3)
        site.add(GRAZER, [(25.0, 20.0)], slots=gene)
        fauna = site.fauna
        offsets, distance = creature.separations(fauna.positions)
        land = site.terrain.land.astype(np.float32)
        zero = np.zeros_like(site.flora.biomass)
        sight = rare.sight(fauna.config, fauna.slots, fauna.body.sense_range, 0.0)
        senses = creature.sense(
            fauna.config, fauna.positions, fauna.energy, fauna.body, fauna.adult,
            fauna.ready, fauna.hungry, np.zeros((2, 2), bool),
            fauna._kills,  # pyright: ignore[reportPrivateUsage]
            zero, zero, zero, zero, land, offsets, distance, sight,
        )  # fmt: skip
        found[gene] = float(senses[0, Sense.PREY_X])
    assert found[0] == 0.0
    assert found[int(CreatureRare.GLOW)] > 0.0


# --- Inheritance ------------------------------------------------------------------------


def test_newborns_inherit_rare_bodies(config: Config) -> None:
    cfg = replace(
        config.fauna, immigrant_groups_per_year=0.0, rare_gain_probability=0.0,
        rare_loss_probability=0.0,
    )  # fmt: skip
    site = Site(config, fauna=cfg)
    site.add(GRAZER, [(20.0, 20.0)], slots=CreatureRare.GIANT, idle_days=10.0)
    site.add(GRAZER, [(20.3, 20.0)], slots=CreatureRare.GIANT, idle_days=10.0)
    site.run(1.0)
    fauna = site.fauna
    assert fauna.count > 2
    assert (fauna.slots == CreatureRare.GIANT).all()
    expected = rare.body_of(cfg, fauna.genes, fauna.slots)
    assert np.array_equal(fauna.body.mass, expected.mass)
    assert fauna.rare_counts()[CreatureRare.GIANT] == fauna.count


def test_plant_rare_table_has_room() -> None:
    assert int(max(PlantRare)) < 256  # one byte per cell
