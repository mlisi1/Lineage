"""The creature brain: a small neural net that steers.

Senses in, a steering vector out::

    steer = tanh(direct · senses + out · tanh(hidden · senses + hidden_bias) + out_bias)

The direct connections carry the instincts a founder arrives with (go to food, flee
threats, stay on land…); the hidden layer lets evolution make behaviour depend on state,
for example hunt only when hungry. All weights are inherited and mutate.

Lifetime learning (M5) tunes how strongly a creature follows each of its directional
senses (`FOLLOWED`: food, prey, threat, mate, land, its own kind). A learned gain adds
to both of a sense's direct weights (x from x, y from y): every sense is a direction on
the map, so a gain is the only thing about it worth learning on an island with no
preferred compass direction. Learning is node perturbation, a form of REINFORCE: noise
is added to the steering drive, an eligibility trace accumulates noise · sensed
direction for every gain, and the update moves each gain along its trace in proportion
to how much better than usual the creature is doing (its reward minus a running
baseline). Learned gains are kept apart from the innate weights and are not inherited.
"""

from __future__ import annotations

from enum import IntEnum

import numpy as np
from numpy.random import Generator
from numpy.typing import NDArray

from lineage_sim.config import FaunaConfig
from lineage_sim.fauna.genome import Gene, Genes, Weights


class Sense(IntEnum):
    """Brain inputs. Directions are (x, y) pairs scaled by closeness, 0 when nothing is
    in range."""

    ENERGY = 0  # reserve as a share of capacity
    FOOD_HERE = 1  # plant biomass under the creature
    FOOD_X = 2  # where plant biomass increases
    FOOD_Y = 3
    PREY_X = 4  # nearest creature it could kill, sensed only when hungry
    PREY_Y = 5
    THREAT_X = 6  # nearest creature that could kill it
    THREAT_Y = 7
    MATE_X = 8  # nearest compatible adult, sensed only when ready to breed
    MATE_Y = 9
    LAND_X = 10  # where there is more land
    LAND_Y = 11
    IN_WATER = 12
    CROWD = 13  # share of the population cap within sense range
    NEIGHBOUR_X = 14  # nearest creature of its own kind
    NEIGHBOUR_Y = 15


SENSE_COUNT = len(Sense)
HIDDEN = 8
OUTPUTS = 2  # steering x, y

_DIRECT = SENSE_COUNT * OUTPUTS
_HIDDEN_W = SENSE_COUNT * HIDDEN
_OUT_W = HIDDEN * OUTPUTS
WEIGHT_COUNT = _DIRECT + _HIDDEN_W + HIDDEN + _OUT_W + OUTPUTS
# Directional senses whose gains are learned during life, by their x component (the y
# component is the next sense).
FOLLOWED = (Sense.FOOD_X, Sense.PREY_X, Sense.THREAT_X, Sense.MATE_X, Sense.LAND_X,
            Sense.NEIGHBOUR_X)  # fmt: skip
LEARNED_COUNT = len(FOLLOWED)
_FOLLOW_X = np.array(FOLLOWED, dtype=np.intp)
_FOLLOW_Y = _FOLLOW_X + 1
# Positions of the matching direct weights: steering x from sense x, y from sense y.
_GAIN_X = _FOLLOW_X
_GAIN_Y = SENSE_COUNT + _FOLLOW_Y

Senses = NDArray[np.float32]  # shape (creatures, SENSE_COUNT)
Learned = NDArray[np.float32]  # shape (creatures, LEARNED_COUNT)


def steer(weights: Weights, senses: Senses) -> NDArray[np.float32]:
    """Steering vectors in [-1, 1]², shape (creatures, 2)."""
    return np.tanh(think(weights, senses)).astype(np.float32)


def think(weights: Weights, senses: Senses) -> NDArray[np.float32]:
    """The steering drive before squashing, shape (creatures, 2)."""
    n = weights.shape[0]
    cuts = np.cumsum([_DIRECT, _HIDDEN_W, HIDDEN, _OUT_W])
    direct = weights[:, : cuts[0]].reshape(n, OUTPUTS, SENSE_COUNT)
    hidden_w = weights[:, cuts[0] : cuts[1]].reshape(n, HIDDEN, SENSE_COUNT)
    hidden_b = weights[:, cuts[1] : cuts[2]]
    out_w = weights[:, cuts[2] : cuts[3]].reshape(n, OUTPUTS, HIDDEN)
    out_b = weights[:, cuts[3] :]
    hidden = np.tanh(np.einsum("nhs,ns->nh", hidden_w, senses) + hidden_b)
    drive = np.einsum("nos,ns->no", direct, senses) + np.einsum("noh,nh->no", out_w, hidden)
    return (drive + out_b).astype(np.float32)


def with_learned(weights: Weights, learned: Learned) -> Weights:
    """The weights a creature steers by: innate plus its learned gains."""
    effective = weights.copy()
    effective[:, _GAIN_X] += learned
    effective[:, _GAIN_Y] += learned
    return effective


def eligibility(senses: Senses, noise: NDArray[np.float32]) -> Learned:
    """Noise · sensed direction for every learned gain: the derivative, with respect to
    the gain, of how far the drive moved along this tick's noise."""
    return (noise[:, 0:1] * senses[:, _FOLLOW_X] + noise[:, 1:2] * senses[:, _FOLLOW_Y]).astype(
        np.float32
    )


def learn(
    learned: Learned,
    trace: Learned,
    advantage: NDArray[np.float32],
    rate: NDArray[np.float32],
    hours: float,
    limit: float,
    forget_hours: float,
) -> Learned:
    """One learning step: each learned gain fades toward 0 with time constant
    ``forget_hours`` (so gains nothing rewards do not wander off), then moves along its
    trace by rate × advantage, within ±``limit``. ``advantage`` is reward minus
    baseline, one value per creature."""
    keep = np.float32(np.exp(-hours / forget_hours))
    step = (rate * advantage * np.float32(hours))[:, None] * trace
    return np.clip(keep * learned + step, -limit, limit).astype(np.float32)


def founder_weights(rng: Generator, cfg: FaunaConfig, genes: Genes) -> Weights:
    """Brains of creatures arriving from elsewhere: instincts that fit their body, plus
    small random weights everywhere else."""
    n = genes.shape[0]
    weights = rng.normal(0.0, cfg.founder_brain_sigma, (n, WEIGHT_COUNT)).astype(np.float32)
    direct = weights[:, :_DIRECT].reshape(n, OUTPUTS, SENSE_COUNT).copy()
    diet, aquatic = genes[:, Gene.DIET], genes[:, Gene.AQUATIC]
    instincts = (
        (Sense.FOOD_X, Sense.FOOD_Y, cfg.instinct_food * (1.0 - diet)),
        (Sense.PREY_X, Sense.PREY_Y, cfg.instinct_prey * diet),
        (Sense.THREAT_X, Sense.THREAT_Y, np.full(n, -cfg.instinct_flee)),
        (Sense.MATE_X, Sense.MATE_Y, np.full(n, cfg.instinct_mate)),
        # Land animals head for land, swimmers for water.
        (Sense.LAND_X, Sense.LAND_Y, cfg.instinct_land * (1.0 - 2.0 * aquatic)),
        # Keep some distance from the nearest of its kind, so a group spreads over its food.
        (Sense.NEIGHBOUR_X, Sense.NEIGHBOUR_Y, np.full(n, -cfg.instinct_space)),
    )
    for sense_x, sense_y, strength in instincts:
        direct[:, 0, sense_x] += strength
        direct[:, 1, sense_y] += strength
    weights[:, :_DIRECT] = direct.reshape(n, _DIRECT)
    return weights
