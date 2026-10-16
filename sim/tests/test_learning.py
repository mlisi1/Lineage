"""Lifetime learning (M5): the update rule, the food-approach scenario, and how learning
fits in a creature's life (not inherited, off means the M4 brain, youth is recorded)."""

from dataclasses import replace

import numpy as np
from fauna_site import GRAZER, Site
from fauna_site import with_gene as _with
from hypothesis import given, settings
from hypothesis import strategies as st
from lineage_sim.config import Config
from lineage_sim.events import JuvenileGrown
from lineage_sim.fauna import brain
from lineage_sim.fauna.brain import Sense
from lineage_sim.fauna.genome import Gene
from numpy.random import PCG64, Generator
from numpy.typing import NDArray

Array = NDArray[np.float32]

# A grazer that learns and explores at the most its genes allow.
LEARNER = _with(_with(GRAZER, Gene.LEARNING, 1.0), Gene.EXPLORATION, 1.0)
# The learned gain on the food sense.
FOOD_GAIN = brain.FOLLOWED.index(Sense.FOOD_X)


# --- The update rule --------------------------------------------------------------------


def test_eligibility_is_the_derivative_of_the_drive_along_the_noise() -> None:
    """For each learned gain, the eligibility is how fast the drive's projection on this
    tick's noise grows with that gain (the drive is linear in every gain)."""
    rng = Generator(PCG64(3))
    n = 4
    weights = rng.normal(0.0, 0.5, (n, brain.WEIGHT_COUNT)).astype(np.float32)
    senses = rng.normal(0.0, 0.5, (n, brain.SENSE_COUNT)).astype(np.float32)
    noise = rng.normal(0.0, 1.0, (n, brain.OUTPUTS)).astype(np.float32)
    learned = rng.normal(0.0, 0.5, (n, brain.LEARNED_COUNT)).astype(np.float32)
    along = (brain.think(brain.with_learned(weights, learned), senses) * noise).sum(axis=1)
    expected = brain.eligibility(senses, noise)
    for k in range(brain.LEARNED_COUNT):
        nudged = learned.copy()
        nudged[:, k] += 1.0
        moved = (brain.think(brain.with_learned(weights, nudged), senses) * noise).sum(axis=1)
        np.testing.assert_allclose(moved - along, expected[:, k], rtol=1e-4, atol=1e-5)


def test_learned_gains_follow_their_senses() -> None:
    """A gain adds to the sense's own axis only: following food more steers toward food."""
    weights = np.zeros((1, brain.WEIGHT_COUNT), dtype=np.float32)
    senses = np.zeros((1, brain.SENSE_COUNT), dtype=np.float32)
    senses[0, Sense.FOOD_X], senses[0, Sense.FOOD_Y] = 0.3, -0.4
    learned = np.zeros((1, brain.LEARNED_COUNT), dtype=np.float32)
    learned[0, brain.FOLLOWED.index(Sense.FOOD_X)] = 2.0
    drive = brain.think(brain.with_learned(weights, learned), senses)
    np.testing.assert_allclose(drive[0], [0.6, -0.8], rtol=1e-6)


def test_learning_rule_solves_a_bandit() -> None:
    """Rewarded for steering wherever the food sense points, brains with no instinct for
    it learn to follow it; a sense that says nothing about the reward is left alone."""
    rng = Generator(PCG64(5))
    n, hours, sigma = 64, 1.0 / 6.0, 0.6
    food = brain.FOLLOWED.index(Sense.FOOD_X)
    weights = np.zeros((n, brain.WEIGHT_COUNT), dtype=np.float32)
    learned = np.zeros((n, brain.LEARNED_COUNT), dtype=np.float32)
    trace = np.zeros_like(learned)
    baseline = np.zeros(n, dtype=np.float32)
    rate = np.full(n, 0.5, dtype=np.float32)
    for _ in range(600):
        senses = np.zeros((n, brain.SENSE_COUNT), dtype=np.float32)
        for sense in (Sense.FOOD_X, Sense.MATE_X):  # two unrelated random directions
            angle = rng.uniform(0.0, 2.0 * np.pi, n)
            senses[:, sense], senses[:, sense + 1] = 0.5 * np.cos(angle), 0.5 * np.sin(angle)
        drive = brain.think(brain.with_learned(weights, learned), senses)
        noise = rng.normal(0.0, sigma, drive.shape).astype(np.float32)
        trace = np.float32(np.exp(-hours)) * trace + brain.eligibility(senses, noise)
        steering = np.tanh(drive + noise)
        reward = (steering * senses[:, [Sense.FOOD_X, Sense.FOOD_Y]]).sum(axis=1)
        advantage = (reward - baseline).astype(np.float32)
        learned = brain.learn(learned, trace, advantage, rate, hours, 3.0, 24.0)
        baseline = (baseline + 0.2 * advantage).astype(np.float32)
    assert float(learned[:, food].mean()) > 0.3
    assert (learned[:, food] > 0).mean() > 0.9
    mate = learned[:, brain.FOLLOWED.index(Sense.MATE_X)]
    assert float(np.abs(mate).mean()) < 0.25 * float(learned[:, food].mean())


@settings(max_examples=50, deadline=None)
@given(
    seed=st.integers(0, 2**32 - 1),
    scale=st.floats(0.0, 1e6),
    limit=st.floats(0.01, 10.0),
)
def test_learned_weights_stay_finite_and_bounded(seed: int, scale: float, limit: float) -> None:
    rng = Generator(PCG64(seed))
    learned = rng.uniform(-limit, limit, (8, brain.LEARNED_COUNT)).astype(np.float32)
    trace = (rng.normal(0.0, 1.0, learned.shape) * scale).astype(np.float32)
    advantage = (rng.normal(0.0, 1.0, 8) * scale).astype(np.float32)
    rate = rng.uniform(0.0, 100.0, 8).astype(np.float32)
    out = brain.learn(learned, trace, advantage, rate, 1.0 / 6.0, limit, 72.0)
    assert np.isfinite(out).all()
    assert float(np.abs(out).max()) <= np.float32(limit)


# --- Scenario: a creature learns to approach food ---------------------------------------

CENTRE = (30.0, 20.0)  # of the one patch of food
PATCH_RADIUS = 2.0
START_CELLS = 3.5  # from the centre: food is in sense range but not underfoot
EPISODES = 60
EPISODE_H = 4.0


def _food_trial(config: Config, seed: int, *, learning: bool) -> tuple[Array, float]:
    """One hungry grazer with no instinct for food, put down again and again at random
    near one patch of grass. Returns the hours it took to reach the food each time (the
    episode's length if it never did) and its learned food gain at the end."""
    cfg = replace(config.fauna, immigrant_groups_per_year=0.0, instinct_food=0.0,
                  learning=learning)  # fmt: skip
    site = Site(config, fauna=cfg, seed=seed)
    rows, columns = np.mgrid[0 : site.flora.biomass.shape[0], 0 : site.flora.biomass.shape[1]]
    patch = np.hypot(columns - CENTRE[0], rows - CENTRE[1]) <= PATCH_RADIUS
    site.add(LEARNER, [CENTRE])
    place = Generator(PCG64(1000 + seed))
    times: list[float] = []
    for _ in range(EPISODES):
        plants = site.flora.get_state()
        plants["biomass"][:] = np.where(patch, 0.8, 0.0)
        site.flora.set_state(plants)
        state = site.fauna.get_state()
        angle = place.uniform(0.0, 2.0 * np.pi)
        state["positions"][0] = (
            CENTRE[0] + START_CELLS * np.cos(angle),
            CENTRE[1] + START_CELLS * np.sin(angle),
        )
        state["energy"][0] = 0.5 * float(site.fauna.body.capacity[0])
        state["heading"][0] = place.uniform(0.0, 2.0 * np.pi)
        site.fauna.set_state(state)
        took = EPISODE_H
        for tick in range(round(EPISODE_H * 6)):
            site.run(1.0 / 6.0)
            x, y = site.fauna.positions[0]
            if np.hypot(x - CENTRE[0], y - CENTRE[1]) <= PATCH_RADIUS:
                took = (tick + 1) / 6.0
                site.run(1.0)  # an hour of grazing: the reward
                break
        times.append(took)
    return np.array(times, dtype=np.float32), float(site.fauna.learned[0, FOOD_GAIN])


def test_a_creature_learns_to_approach_food(config: Config) -> None:
    trials = range(12)
    on = [_food_trial(config, seed, learning=True) for seed in trials]
    off = [_food_trial(config, seed, learning=False) for seed in trials]
    gain_on = np.array([gain for _, gain in on])
    early_on = np.array([times[:10].mean() for times, _ in on])
    late_on = np.array([times[-10:].mean() for times, _ in on])
    late_off = np.array([times[-10:].mean() for times, _ in off])
    # It learns to follow the food sense it was born without an instinct for…
    assert np.mean(gain_on > 0) >= 0.9, gain_on.round(2)
    assert float(gain_on.mean()) > 1.0, gain_on.round(2)
    assert all(gain == 0.0 for _, gain in off)
    # …gets to the food faster as it learns…
    assert float(late_on.mean()) < float(early_on.mean()) - 0.3, (early_on, late_on)
    # …and much faster than a creature that cannot learn.
    assert float(late_on.mean()) < float(late_off.mean()) - 1.0, (late_on, late_off)


# --- Learning in a creature's life ------------------------------------------------------


def test_what_is_learned_is_not_inherited(config: Config) -> None:
    site = Site(config)
    parents = site.add(LEARNER, [(20.0, 20.0), (20.4, 20.0)], energy_share=0.5)
    site.run(6.0)  # hungry: they learn from what they find to eat
    fauna = site.fauna
    assert fauna.count == 2
    assert float(np.abs(fauna.learned).sum(axis=1).min()) > 0.0
    state = fauna.get_state()
    state["energy"][:] = 0.9 * fauna.body.capacity
    state["idle_h"][:] = 3 * 24.0
    state["positions"][:] = [(20.0, 20.0), (20.4, 20.0)]
    fauna.set_state(state)
    site.run(1.0 / 6.0)  # one tick: they breed
    young = ~np.isin(fauna.ids, parents)
    assert young.any()
    assert float(np.abs(fauna.learned[young]).max()) == 0.0  # born knowing nothing
    assert float(np.abs(fauna.learned[~young]).sum(axis=1).min()) > 0.0
    assert (fauna.generation[young] == 1).all()
    assert (fauna.generation[~young] == 0).all()


def test_without_learning_the_brain_is_the_innate_one(config: Config) -> None:
    """Learning off: nothing is learned, and the learning genes change nothing."""
    off = replace(config.fauna, learning=False, immigrant_groups_per_year=0.0)
    keen, plain = Site(config, fauna=off), Site(config, fauna=off)
    keen.add(LEARNER, [(20.0, 20.0), (24.0, 22.0)])
    plain.add(GRAZER, [(20.0, 20.0), (24.0, 22.0)])
    keen.run(12.0)
    plain.run(12.0)
    assert float(np.abs(keen.fauna.learned).max()) == 0.0
    np.testing.assert_array_equal(keen.fauna.positions, plain.fauna.positions)
    np.testing.assert_array_equal(keen.fauna.energy, plain.fauna.energy)


def test_a_youth_on_pasture_becomes_competent_and_is_reported(config: Config) -> None:
    site = Site(config)
    young = site.add(GRAZER, [(20.0, 20.0)], age_days=0.0, energy_share=0.5)
    maturity_h = float(site.fauna.body.maturity_h[0])
    outputs = site.run(maturity_h + 1.0)
    grown = [o for o in outputs if isinstance(o, JuvenileGrown)]
    assert len(grown) == 1
    youth = grown[0]
    assert youth.creature_id == int(young[0])
    assert not youth.died
    assert youth.generation == 0
    assert youth.age_h >= maturity_h
    assert youth.eaten > youth.burnt > 0.0  # grew fat on good grass
    assert 0.0 <= youth.competent_h < 24.0
    assert float(site.fauna.competent_hours[0]) == youth.competent_h


def test_a_youth_that_starves_is_reported(config: Config) -> None:
    site = Site(config, biomass=0.0)
    site.add(GRAZER, [(20.0, 20.0)], age_days=0.0, energy_share=0.05)
    outputs = site.run(24.0)
    grown = [o for o in outputs if isinstance(o, JuvenileGrown)]
    assert site.fauna.count == 0
    assert len(grown) == 1
    assert grown[0].died
    assert grown[0].eaten == 0.0
    assert grown[0].burnt > 0.0
    assert grown[0].competent_h == -1.0
