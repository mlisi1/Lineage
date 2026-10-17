"""Fauna: genome, phenotype, brain, a creature's tick, and the population in a world."""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import fields, replace
from pathlib import Path

import numpy as np
import pytest
from fauna_site import COLUMNS, GRAZER, HUNTER, ROWS, TICK_S, Array, Site
from fauna_site import genes_of as _genes
from fauna_site import with_gene as _with
from hypothesis import given, settings
from hypothesis import strategies as st
from lineage_sim.config import Config
from lineage_sim.events import CreaturesArrived, JuvenileGrown, PopulationExtinct
from lineage_sim.fauna import brain, creature
from lineage_sim.fauna import genome as gn
from lineage_sim.fauna.brain import Sense
from lineage_sim.fauna.genome import GENE_COUNT, Gene
from lineage_sim.fauna.phenotype import Phenotype, phenotype
from lineage_sim.flora import Gene as FloraGene
from lineage_sim.state import io
from lineage_sim.world import World
from numpy.random import PCG64, Generator

EPOCH_UNIX_MS = 1_772_323_200_000  # 2026-03-01 00:00 UTC
DAY_S = 86_400
# Fixture v6: the default world, seed 42, after 520 days, as saved by the code of its day.
GOLDEN_FAUNA_SEED_42 = "06d12249b04cde9c1816687ac0559cd455809eff28e835256a2f9d91ff037372"
# The fixture stepped three more days by today's code.
GOLDEN_AFTER_THREE_DAYS = "e270d329c099bcbd43ef3253ec4b00d6fd276ef9ccd767ab6a85a9002b2ba4a4"
# The default world, seed 42, after 520 days from bare rock with today's code. It equals
# the fixture only while fauna behaves as it did when the fixture was saved.
GOLDEN_BARE_ROCK_520_DAYS = "a84a94c15d792c7b41702df7c7b8a29af51ffc98d985f751acd69e593e8a709f"
SPECIMENS = Path(__file__).resolve().parent / "fixtures" / "phenotypes.json"


def _body(config: Config, *rows: tuple[float, ...]) -> Phenotype:
    return phenotype(config.fauna, _genes(*rows))


# --- Genome -----------------------------------------------------------------------------


def test_distance_is_the_mean_gene_difference() -> None:
    a, b = _genes(GRAZER), _genes(_with(GRAZER, Gene.SIZE, 0.30 + 0.22))
    assert float(gn.distance(a, b)[0]) == pytest.approx(0.22 / GENE_COUNT, abs=1e-6)
    matrix = gn.distance_matrix(_genes(GRAZER, HUNTER, GRAZER))
    assert matrix.shape == (3, 3)
    assert float(matrix[0, 2]) == 0.0
    assert float(matrix[0, 1]) == pytest.approx(float(matrix[1, 0]))
    assert float(matrix[0, 1]) == pytest.approx(
        float(gn.distance(_genes(GRAZER), _genes(HUNTER))[0])
    )


def test_children_take_each_gene_from_one_parent_then_mutate() -> None:
    rng = Generator(PCG64(3))
    a, b = np.zeros((200, GENE_COUNT), dtype=np.float32), np.ones((200, GENE_COUNT), np.float32)
    child = gn.crossover(rng, a, b)
    assert set(np.unique(child).tolist()) == {0.0, 1.0}
    assert 0.4 < float(child.mean()) < 0.6
    mutated = gn.mutate_genes(rng, child, 0.05)
    assert float(mutated.min()) >= 0.0
    assert float(mutated.max()) <= 1.0
    assert 0.0 < float(np.abs(mutated - child).mean()) < 0.05


def test_rare_slots_are_inherited_and_rarely_change(config: Config) -> None:
    cfg = replace(config.fauna, rare_gain_probability=0.0, rare_loss_probability=0.0)
    rng = Generator(PCG64(4))
    a = np.full(500, 0b0101, dtype=np.uint16)
    b = np.full(500, 0b0110, dtype=np.uint16)
    child = gn.inherit_slots(rng, cfg, a, b)
    assert (child & 0b0100 == 0b0100).all()  # both parents carry it
    assert (child & 0b1000 == 0).all()  # neither does
    assert 0.35 < float((child & 0b0001 > 0).mean()) < 0.65  # one of them does
    noisy = gn.inherit_slots(rng, replace(cfg, rare_gain_probability=0.5), a, a)
    assert int(noisy.max()) < 2**cfg.rare_slots
    assert (noisy != a).any()


# --- Phenotype --------------------------------------------------------------------------


def test_bigger_is_costlier(config: Config) -> None:
    small, large = _with(GRAZER, Gene.SIZE, 0.2), _with(GRAZER, Gene.SIZE, 0.8)
    body = _body(config, small, large)
    for name in ("mass", "basal_burn", "move_cost", "capacity", "graze_rate", "attack", "defence"):
        values = getattr(body, name)
        assert float(values[1]) > float(values[0]), name
    assert float(body.lifespan_h[1]) > float(body.lifespan_h[0])
    # Burn per unit of mass falls with size, as in real animals.
    assert float(body.basal_burn[1] / body.mass[1]) < float(body.basal_burn[0] / body.mass[0])


@pytest.mark.parametrize("gene", [Gene.SPEED, Gene.ARMOUR, Gene.SENSE, Gene.JAW, Gene.AQUATIC,
                                  Gene.LIMBS, Gene.LEARNING])  # fmt: skip
def test_every_ability_raises_the_resting_burn(config: Config, gene: Gene) -> None:
    body = _body(config, _with(GRAZER, gene, 0.1), _with(GRAZER, gene, 0.9))
    assert float(body.basal_burn[1]) > float(body.basal_burn[0])


def test_what_each_gene_buys(config: Config) -> None:
    def pair(gene: Gene) -> Phenotype:
        return _body(config, _with(GRAZER, gene, 0.1), _with(GRAZER, gene, 0.9))

    assert float(pair(Gene.SPEED).land_speed[1]) > float(pair(Gene.SPEED).land_speed[0])
    armour = pair(Gene.ARMOUR)
    assert float(armour.defence[1]) > float(armour.defence[0])
    assert float(armour.land_speed[1]) < float(armour.land_speed[0])
    assert float(pair(Gene.SENSE).sense_range[1]) > float(pair(Gene.SENSE).sense_range[0])
    jaw = pair(Gene.JAW)
    assert float(jaw.attack[1]) > float(jaw.attack[0])
    assert float(jaw.graze_rate[1]) > float(jaw.graze_rate[0])
    swim = pair(Gene.AQUATIC)
    assert float(swim.swim_speed[1]) > float(swim.swim_speed[0])
    assert float(swim.land_speed[1]) < float(swim.land_speed[0])
    brood = pair(Gene.BROOD)
    assert (float(brood.brood[0]), float(brood.brood[1])) == (1.0, float(config.fauna.brood_max))
    learning = pair(Gene.LEARNING)
    assert float(learning.learning_rate[1]) > float(learning.learning_rate[0])
    exploring = pair(Gene.EXPLORATION)
    assert float(exploring.exploration[1]) > float(exploring.exploration[0])


def test_without_learning_the_learning_genes_do_nothing(config: Config) -> None:
    off = replace(config.fauna, learning=False)
    keen = _with(_with(GRAZER, Gene.LEARNING, 1.0), Gene.EXPLORATION, 1.0)
    body, plain = phenotype(off, _genes(keen)), phenotype(off, _genes(GRAZER))
    assert float(body.learning_rate[0]) == float(body.exploration[0]) == 0.0
    assert float(body.basal_burn[0]) == float(plain.basal_burn[0])


def test_limbs(config: Config) -> None:
    cfg = config.fauna
    pairs = [0.0, 0.5, 1.0]
    body = _body(config, *[_with(GRAZER, Gene.LIMBS, p) for p in pairs])
    assert body.limb_pairs.tolist() == [0.0, 2.0, float(cfg.limb_pairs_max)]
    assert float(body.land_speed[0]) < float(body.land_speed[2]) < float(body.land_speed[1])
    assert float(body.swim_speed[0]) > float(body.swim_speed[2])  # legs drag in water
    # Extra legs carry armour better.
    plated = _body(config, *[_with(_with(GRAZER, Gene.ARMOUR, 1.0), Gene.LIMBS, p) for p in pairs])
    assert float(plated.land_speed[2] / body.land_speed[2]) > float(
        plated.land_speed[1] / body.land_speed[1]
    )


def test_diet_trades_plants_for_meat(config: Config) -> None:
    body = _body(config, *[_with(GRAZER, Gene.DIET, d) for d in (0.0, 0.5, 1.0)])
    assert body.plant_efficiency.tolist() == pytest.approx([1.0, 0.5, 0.0])
    assert body.meat_efficiency.tolist() == pytest.approx([0.0, 0.5, 1.0])


GENOMES = st.lists(st.floats(0.0, 1.0, width=32), min_size=GENE_COUNT, max_size=GENE_COUNT)


@given(genome=GENOMES)
def test_phenotype_is_finite_and_in_range(config: Config, genome: list[float]) -> None:
    cfg = config.fauna
    body = _body(config, tuple(genome))
    for field in fields(body):
        value = float(getattr(body, field.name)[0])
        assert np.isfinite(value), field.name
        assert value >= 0.0, field.name
    assert cfg.mass_min - 1e-5 <= float(body.mass[0]) <= cfg.mass_max + 1e-4
    assert float(body.land_speed[0]) > 0.0
    assert float(body.basal_burn[0]) > 0.0
    assert 0.0 <= float(body.plant_efficiency[0]) <= 1.0
    assert 1.0 <= float(body.brood[0]) <= cfg.brood_max
    assert float(body.maturity_h[0]) < float(body.lifespan_h[0])


def test_specimen_phenotypes_match_the_reference(config: Config) -> None:
    """The frozen specimens the renderer's port of the phenotype is checked against (R2)."""
    reference = json.loads(SPECIMENS.read_text(encoding="utf-8"))
    assert reference["genes"] == [gene.name for gene in Gene]
    assert len(reference["specimens"]) == 15
    for specimen in reference["specimens"]:
        body = _body(config, tuple(specimen["genome"]))
        for name, expected in specimen["phenotype"].items():
            assert float(getattr(body, name)[0]) == pytest.approx(expected, rel=1e-5), (
                specimen["name"],
                name,
            )


# --- Brain ------------------------------------------------------------------------------


def _founder_steer(config: Config, genome: tuple[float, ...], **senses: float) -> Array:
    genes = _genes(genome)
    quiet = replace(config.fauna, founder_brain_sigma=0.0)
    weights = brain.founder_weights(Generator(PCG64(1)), quiet, genes)
    inputs = np.zeros((1, brain.SENSE_COUNT), dtype=np.float32)
    for name, value in senses.items():
        inputs[0, Sense[name]] = value
    return brain.steer(weights, inputs)[0]


def test_steering_is_bounded(config: Config) -> None:
    rng = Generator(PCG64(2))
    weights = rng.normal(0.0, 3.0, (50, brain.WEIGHT_COUNT)).astype(np.float32)
    senses = rng.normal(0.0, 3.0, (50, brain.SENSE_COUNT)).astype(np.float32)
    out = brain.steer(weights, senses)
    assert out.shape == (50, 2)
    assert float(np.abs(out).max()) <= 1.0


def test_founder_instincts(config: Config) -> None:
    assert _founder_steer(config, GRAZER).tolist() == [0.0, 0.0]  # nothing sensed: no drive
    assert float(_founder_steer(config, GRAZER, FOOD_X=1.0)[0]) > 0.5  # toward food
    assert float(_founder_steer(config, GRAZER, THREAT_Y=1.0)[1]) < -0.5  # away from danger
    assert float(_founder_steer(config, GRAZER, MATE_X=-1.0)[0]) < -0.5
    assert float(_founder_steer(config, GRAZER, LAND_X=1.0)[0]) > 0.5  # land animals to land
    swimmer = _with(GRAZER, Gene.AQUATIC, 1.0)
    assert float(_founder_steer(config, swimmer, LAND_X=1.0)[0]) < -0.5  # swimmers to water
    assert float(_founder_steer(config, GRAZER, NEIGHBOUR_X=1.0)[0]) < -0.3  # keep its space
    # Hunters chase prey; grazers barely care.
    chase = float(_founder_steer(config, HUNTER, PREY_X=1.0)[0])
    assert chase > 0.5 > float(_founder_steer(config, GRAZER, PREY_X=1.0)[0])
    # A ready animal goes to its mate even though it is also its nearest neighbour.
    assert float(_founder_steer(config, GRAZER, MATE_X=1.0, NEIGHBOUR_X=1.0)[0]) > 0.5


# --- A creature's tick ------------------------------------------------------------------


def test_movement_respects_top_speed_and_the_map(config: Config) -> None:
    body = _body(config, GRAZER, GRAZER)
    positions = np.array([[30.0, 20.0], [0.2, 0.2]], dtype=np.float32)
    steering = np.array([[5.0, 0.0], [-1.0, -1.0]], dtype=np.float32)
    dry = np.zeros(2, dtype=np.bool_)
    moved, travelled = creature.move(positions, steering, body, dry, 1.0, (ROWS, COLUMNS))
    assert float(travelled[0]) == pytest.approx(float(body.land_speed[0]), rel=1e-5)
    assert moved[1].tolist() == [0.0, 0.0]  # stopped at the edge
    wet, _ = creature.move(positions, steering, body, ~dry, 1.0, (ROWS, COLUMNS))
    assert float(wet[0, 0] - 30.0) == pytest.approx(float(body.swim_speed[0]), rel=1e-5)


def test_upkeep_adds_rest_movement_and_water(config: Config) -> None:
    cfg, genes = config.fauna, _genes(GRAZER)
    body = phenotype(cfg, genes)
    still, dry = np.zeros(1, dtype=np.float32), np.zeros(1, dtype=np.bool_)
    rest = float(creature.upkeep(cfg, genes, body, still, dry, 2.0)[0])
    assert rest == pytest.approx(2.0 * float(body.basal_burn[0]))
    walked = float(creature.upkeep(cfg, genes, body, still + 3.0, dry, 2.0)[0])
    assert walked == pytest.approx(rest + 3.0 * float(body.move_cost[0]))
    assert float(creature.upkeep(cfg, genes, body, still, ~dry, 2.0)[0]) > 2 * rest
    swimmer = _genes(_with(GRAZER, Gene.AQUATIC, 1.0))
    at_home = creature.upkeep(cfg, swimmer, phenotype(cfg, swimmer), still, ~dry, 2.0)
    assert float(at_home[0]) < 1.3 * rest


def test_appetite(config: Config) -> None:
    cfg = config.fauna
    body = _body(config, GRAZER, GRAZER, _with(GRAZER, Gene.DIET, 1.0))
    energy = body.capacity * np.array([0.2, 1.0, 0.2], dtype=np.float32)
    wants = creature.appetite(cfg, energy, body, 1.0)
    assert float(wants[0]) == pytest.approx(float(body.graze_rate[0]))  # hungry: a full bite
    assert float(wants[1]) == 0.0  # full
    assert float(wants[2]) == 0.0  # cannot digest plants


def test_food_is_smelled_at_a_distance(config: Config) -> None:
    food = np.zeros((ROWS, COLUMNS), dtype=np.float32)
    food[:, 40:] = 0.8  # pasture to the east
    positions = np.array([[34.0, 20.0], [20.0, 20.0], [50.0, 20.0]], dtype=np.float32)
    reach = np.full(3, 8.0, dtype=np.float32)
    here = np.array([0.0, 0.0, 0.8], dtype=np.float32)
    x, y = creature.smell_food(food, positions, here, reach)
    assert float(x[0]) > 0.3  # within range: east
    assert abs(float(y[0])) < 0.05
    assert float(x[1]) == 0.0  # too far to smell
    assert float(x[2]) == 0.0  # standing in it: nothing better around


def test_who_can_kill_whom(config: Config) -> None:
    cfg = config.fauna
    big_grazer = _with(GRAZER, Gene.SIZE, 1.0)
    genes = _genes(HUNTER, HUNTER, GRAZER, big_grazer)
    body = phenotype(cfg, genes)
    compatible = gn.distance_matrix(genes) <= cfg.compat_distance
    np.fill_diagonal(compatible, False)
    kills = creature.can_kill(genes, body, compatible, cfg)
    assert kills[0, 2]  # hunter → grazer
    assert not kills[0, 0]  # never itself
    assert not kills[0, 1]  # never its own kind
    assert not kills[2].any()  # grazers do not hunt
    assert not kills[0, 3]  # too big to tackle
    easy = creature.kill_chance(cfg, body, np.array([0]), np.array([2]))
    hard = creature.kill_chance(cfg, body, np.array([0]), np.array([3]))
    assert float(easy[0]) > 0.8 > 0.2 > float(hard[0])


# --- Scenarios --------------------------------------------------------------------------


def test_grazer_on_pasture_keeps_its_energy_and_within_capacity(config: Config) -> None:
    site = Site(config)
    ids = site.add(GRAZER, [(20.0, 20.0)], energy_share=0.5)
    before = float(site.flora.biomass.sum(dtype=np.float64))
    for _ in range(48):
        site.run(1.0)
        assert float(site.energy_share(ids)[0]) <= 1.0 + 1e-6
    assert float(site.energy_share(ids)[0]) > 0.8
    assert float(site.flora.biomass.sum(dtype=np.float64)) < before  # it ate plants


def test_energy_balance_of_one_tick(config: Config) -> None:
    """Energy only changes by what was eaten minus what was burnt."""
    cfg = replace(config.fauna, wander_noise=0.0, immigrant_groups_per_year=0.0)
    site = Site(config, fauna=cfg)
    site.add(GRAZER, [(20.0, 20.0)], energy_share=0.5)
    fauna, body = site.fauna, site.fauna.body
    energy, biomass = float(fauna.energy[0]), float(site.flora.biomass.sum(dtype=np.float64))
    start = fauna.positions.copy()
    site.run(TICK_S / 3600)
    hours = TICK_S / 3600
    travelled = float(np.hypot(*(fauna.positions[0] - start[0])))
    eaten = biomass - float(site.flora.biomass.sum(dtype=np.float64))
    burnt = float(body.basal_burn[0]) * hours + float(body.move_cost[0]) * travelled
    defence = float(site.flora.genes()[FloraGene.DEFENCE, 20, 20])
    value = (
        cfg.plant_energy * float(body.plant_efficiency[0]) * (1 - cfg.defence_toxicity * defence)
    )
    gained = eaten * value
    assert eaten > 0
    assert float(fauna.energy[0]) - energy == pytest.approx(gained - burnt, abs=0.02)


def test_defended_plants_feed_less(config: Config) -> None:
    """Defence refuses part of each bite and poisons what is eaten: a day on defended
    pasture feeds a grazer far less than a day on undefended pasture."""

    def day_on(defence: int) -> float:
        site = Site(config)
        plants = site.flora.get_state()
        plants["genome"][FloraGene.DEFENCE] = defence
        site.flora.set_state(plants)
        site.add(GRAZER, [(20.0, 20.0)], energy_share=0.4)
        site.run(24.0)
        return float(site.energy_share(site.fauna.ids)[0])

    undefended, defended = day_on(0), day_on(200)
    assert undefended > 0.4  # it grew fat
    assert defended < undefended - 0.1


def test_starving_creature_dies(config: Config) -> None:
    site = Site(config, biomass=0.0)  # bare ground: nothing to eat
    ids = site.add(GRAZER, [(20.0, 20.0)], energy_share=0.9)
    site.run(24.0)
    assert site.alive(ids) == 1  # still living off its reserve
    assert float(site.energy_share(ids)[0]) < 0.9
    site.run(24.0 * 12)
    assert site.alive(ids) == 0
    assert site.fauna.tally.starved == 1
    assert site.fauna.count == 0


def test_last_death_is_an_extinction(config: Config) -> None:
    site = Site(config, biomass=0.0)
    site.add(GRAZER, [(20.0, 20.0)], energy_share=0.05)
    outputs = site.run(24.0 * 3)
    assert [type(o) for o in outputs] == [PopulationExtinct]
    assert site.fauna.tally.extinctions == 1


def test_old_age(config: Config) -> None:
    site = Site(config)
    lifespan_days = float(_body(config, GRAZER).lifespan_h[0]) / 24.0
    ids = site.add(GRAZER, [(20.0, 20.0)], age_days=lifespan_days - 0.5)
    site.run(36.0)
    assert site.alive(ids) == 0
    assert site.fauna.tally.old_age == 1


def test_land_animal_drowns_and_a_swimmer_does_not(config: Config) -> None:
    site = Site(config, water_from=0)  # all sea
    walker = site.add(GRAZER, [(20.0, 20.0)], energy_share=0.9)
    swimmer = site.add(_with(GRAZER, Gene.AQUATIC, 1.0), [(40.0, 20.0)], energy_share=0.9)
    site.run(12.0)
    assert float(site.energy_share(walker)[0]) < float(site.energy_share(swimmer)[0]) - 0.08
    while site.alive(walker):
        site.run(1.0)
    assert site.fauna.tally.drowned == 1
    assert site.alive(swimmer) == 1  # no food out here either, but it is in no hurry


def test_compatible_pair_breeds(config: Config) -> None:
    cfg = config.fauna
    site = Site(config)
    parents = site.add(GRAZER, [(20.0, 20.0), (20.4, 20.0)], idle_days=5.0)
    capacity = float(site.fauna.body.capacity[0])
    site.run(TICK_S / 3600)
    fauna = site.fauna
    assert fauna.tally.births == 1  # brood gene 0: one young
    assert fauna.tally.clones == 0
    assert fauna.count == 3
    young = ~np.isin(fauna.ids, parents)
    gift = 2 * cfg.repro_investment_share * capacity * cfg.birth_efficiency
    assert float(fauna.energy[young][0]) == pytest.approx(gift, rel=0.15)  # its capacity varies
    assert float(fauna.age_hours[young][0]) == 0.0
    assert float(np.hypot(*(fauna.positions[young][0] - (20.0, 20.0)))) < 4.0
    assert float(gn.distance(fauna.genes[young], _genes(GRAZER))[0]) < 0.06  # a mutated copy
    # Each parent paid its share and must wait before the next brood.
    assert (site.energy_share(parents) < 0.9 - 0.8 * cfg.repro_investment_share).all()
    site.run(12.0)
    assert fauna.tally.births == 1


def test_incompatible_pair_does_not_breed(config: Config) -> None:
    site = Site(config)
    other = _with(_with(GRAZER, Gene.HUE, 1.0), Gene.PATTERN, 1.0)  # too different
    assert float(gn.distance(_genes(GRAZER), _genes(other))[0]) > config.fauna.compat_distance
    site.add(GRAZER, [(20.0, 20.0)], idle_days=3.0)
    site.add(other, [(20.4, 20.0)], idle_days=3.0)
    site.run(24.0)
    assert site.fauna.tally.births == 0
    assert site.fauna.count == 2


def test_pair_must_be_adult_fed_and_close(config: Config) -> None:
    for kwargs, positions in (
        ({"age_days": 0.5}, [(20.0, 20.0), (20.4, 20.0)]),  # juveniles
        ({"energy_share": 0.3}, [(20.0, 20.0), (20.4, 20.0)]),  # hungry
        ({}, [(10.0, 20.0), (50.0, 20.0)]),  # far apart
    ):
        site = Site(config, biomass=0.0)
        site.add(GRAZER, positions, idle_days=3.0, **kwargs)
        site.run(TICK_S / 3600)
        assert site.fauna.tally.births == 0, kwargs


def test_lonely_adult_clones_itself(config: Config) -> None:
    cfg = config.fauna
    site = Site(config)
    ids = site.add(GRAZER, [(20.0, 20.0)], idle_days=cfg.asexual_after_days - 1.0)
    site.run(12.0)
    assert site.fauna.tally.births == 0  # not lonely for long enough yet
    site.run(24.0)
    assert site.fauna.tally.births == 1
    assert site.fauna.tally.clones == 1
    assert site.alive(ids) == 1


def test_population_caps_stop_births(config: Config) -> None:
    capped = replace(config.fauna, population_cap=3, founder_count=2, immigrant_groups_per_year=0.0)
    site = Site(config, fauna=capped)
    site.add(_with(GRAZER, Gene.BROOD, 1.0), [(20.0, 20.0), (20.4, 20.0)], idle_days=5.0)
    site.run(24.0 * 6)
    assert site.fauna.count <= 3
    assert site.fauna.tally.births <= 1 + site.fauna.tally.deaths


def test_hungry_hunter_kills_and_feeds(config: Config) -> None:
    cfg = config.fauna
    site = Site(config)
    prey = site.add(GRAZER, [(20.5, 20.0)])
    hunter = site.add(HUNTER, [(20.0, 20.0)], energy_share=0.3)
    site.run(6.0)
    assert site.alive(prey) == 0
    assert site.fauna.tally.killed == 1
    assert site.alive(hunter) == 1
    body = _body(config, GRAZER, HUNTER)
    meal = cfg.meat_energy * float(body.mass[0]) * float(body.meat_efficiency[1])
    assert float(site.energy_share(hunter)[0]) > 0.3 + 0.5 * meal / float(body.capacity[1])


def test_fed_hunter_leaves_prey_alone(config: Config) -> None:
    site = Site(config)
    prey = site.add(_with(GRAZER, Gene.SPEED, 0.0), [(20.5, 20.0)])
    site.add(HUNTER, [(20.0, 20.0)], energy_share=0.99)
    site.run(2.0)
    assert site.alive(prey) == 1
    assert site.fauna.tally.killed == 0


def test_hunters_do_not_eat_their_own_kind(config: Config) -> None:
    site = Site(config, biomass=0.0)
    pack = site.add(HUNTER, [(20.0, 20.0), (20.3, 20.0), (20.0, 20.3)], energy_share=0.3)
    site.run(12.0)
    assert site.fauna.tally.killed == 0
    assert site.alive(pack) == 3


# --- Arrivals ---------------------------------------------------------------------------


def test_founders_wait_for_plants_and_for_spring(config: Config) -> None:
    quick = replace(config.fauna, arrival_delay_days=1.0, immigrant_groups_per_year=0.0)
    bare = Site(config, biomass=0.0, fauna=quick)
    assert bare.run(24.0 * 4) == []
    assert bare.fauna.count == 0

    winter = Site(config, fauna=quick)
    assert winter.run(24.0 * 4, when=dt.date(2026, 12, 25)) == []

    green = Site(config, fauna=quick)
    outputs = green.run(24.0 * 4)
    # Founders arrive at random ages; the youngest grow up during these days.
    outputs = [o for o in outputs if not isinstance(o, JuvenileGrown)]
    assert [type(o) for o in outputs] == [CreaturesArrived]
    arrival = outputs[0]
    assert isinstance(arrival, CreaturesArrived)
    assert arrival.founders
    assert arrival.count == quick.founder_count == green.fauna.count
    genes = green.fauna.genes
    assert float(genes[:, Gene.DIET].max()) < quick.founder_diet_max + 0.2  # plant eaters
    assert float(gn.distance_matrix(genes).max()) < 3 * quick.founder_spread  # one species
    assert float(green.fauna.distance_from_ancestors().mean()) < quick.founder_spread
    assert green.fauna.tally.arrivals == quick.founder_count


def test_strangers_join_an_inhabited_world(config: Config) -> None:
    busy = replace(config.fauna, immigrant_groups_per_year=2000.0)
    site = Site(config, fauna=busy)
    site.add(GRAZER, [(20.0, 20.0)])
    outputs = site.run(24.0 * 2)
    arrivals = [o for o in outputs if isinstance(o, CreaturesArrived)]
    assert len(arrivals) >= 2
    assert not any(a.founders for a in arrivals)
    assert site.fauna.count <= busy.population_cap + busy.predator_cap
    hunters = site.fauna.genes[:, Gene.DIET] >= busy.predator_min_diet
    assert hunters.any()
    assert not hunters.all()


# --- The world as a whole ---------------------------------------------------------------


@pytest.mark.slow
def test_golden_hash_from_bare_rock(config: Config) -> None:
    """The whole history, 520 days from creation, is reproducible."""
    world, _ = World.create(config, 42, EPOCH_UNIX_MS)
    world.step(520 * DAY_S)
    assert world.state_hash() == GOLDEN_BARE_ROCK_520_DAYS


def test_golden_hash_of_an_inhabited_world(config: Config) -> None:
    fixture = Path(__file__).resolve().parent / "fixtures" / "saves" / "v6.lzma"
    hashes: list[str] = []
    for _ in range(2):
        world = World.restore(config, io.loads(fixture.read_bytes()))
        assert world.state_hash() == GOLDEN_FAUNA_SEED_42
        assert world.fauna.count > 50
        world.step(3 * DAY_S)
        hashes.append(world.state_hash())
    assert hashes[0] == hashes[1] == GOLDEN_AFTER_THREE_DAYS


def test_save_load_continue_with_creatures(config: Config) -> None:
    fixture = Path(__file__).resolve().parent / "fixtures" / "saves" / "v6.lzma"
    straight = World.restore(config, io.loads(fixture.read_bytes()))
    straight.step(3 * DAY_S)
    assert straight.state_hash() == GOLDEN_AFTER_THREE_DAYS

    first = World.restore(config, io.loads(fixture.read_bytes()))
    first.step(1.3 * DAY_S)
    resumed = World.restore(config, io.loads(io.dumps(first.snapshot())))
    for _ in range(4):
        resumed.step(0.31 * DAY_S)  # odd chunks across fauna, fire and daily ticks
    resumed.advance_to(straight.t_ms)
    assert resumed.state_hash() == straight.state_hash()
    assert resumed.fauna.tally == straight.fauna.tally


@settings(max_examples=5, deadline=None)
@given(seed=st.integers(0, 10_000))
def test_days_with_creatures_keep_every_invariant(config: Config, seed: int) -> None:
    cfg = config.fauna
    site = Site(config, seed=seed, fauna=replace(cfg, immigrant_groups_per_year=300.0))
    site.add(GRAZER, [(float(10 + 2 * k), 20.0) for k in range(12)], idle_days=3.0)
    for _ in range(8):
        site.run(12.0)
        fauna = site.fauna
        n = fauna.count
        assert n <= cfg.population_cap + cfg.predator_cap
        for name in ("energy", "age_hours", "slots", "ids"):
            assert getattr(fauna, name).shape == (n,), name
        assert fauna.positions.shape == (n, 2)
        assert fauna.genes.shape == (n, GENE_COUNT)
        assert fauna.weights.shape == (n, brain.WEIGHT_COUNT)
        assert np.isfinite(fauna.positions).all()
        assert np.isfinite(fauna.weights).all()
        if n:
            assert float(fauna.energy.min()) > 0.0  # the starved are gone
            assert (fauna.energy <= fauna.body.capacity * (1 + 1e-5)).all()
            assert float(fauna.genes.min()) >= 0.0
            assert float(fauna.genes.max()) <= 1.0
            assert float(fauna.positions[:, 0].min()) >= 0.0
            assert float(fauna.positions[:, 0].max()) <= COLUMNS - 1
            assert float(fauna.positions[:, 1].max()) <= ROWS - 1
            assert (fauna.age_hours < fauna.body.lifespan_h + 1.0).all()
        assert len(set(fauna.ids.tolist())) == n
        tally = fauna.tally
        assert n == 12 + tally.arrivals + tally.births - tally.deaths
        assert sum(fauna.diet_counts()) == n
