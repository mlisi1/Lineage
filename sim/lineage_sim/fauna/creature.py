"""What one creature does in a tick: sense, move, burn energy, eat.

Functions take arrays with one row per creature and return arrays; they never loop over
creatures. `population.py` owns the arrays and decides who is born and who dies.
"""

from __future__ import annotations

import numpy as np
from numpy.typing import NDArray

from lineage_sim.config import FaunaConfig
from lineage_sim.fauna.brain import SENSE_COUNT, Sense, Senses
from lineage_sim.fauna.genome import Gene, Genes
from lineage_sim.fauna.phenotype import Phenotype

Values = NDArray[np.float32]
Positions = NDArray[np.float32]  # shape (creatures, 2): x, y in cells
Flags = NDArray[np.bool_]
Index = NDArray[np.intp]

# A hunter treats another creature as prey (and the other treats it as a threat) when
# its attack is at least this share of the other's defence.
_WORTH_ATTACKING = 0.6
# Offset, in cells, at which land is sampled to feel where the shore is.
_PROBE_CELLS = 2.0
# Food is smelled in eight directions at these shares of the sense range.
_SMELL_RINGS = (0.3, 1.0)
# Summed food differences are squashed by tanh(gain × sum) into a strength below 1.
_SMELL_GAIN = 1.0
_COMPASS = np.array(
    [[np.cos(a), np.sin(a)] for a in np.arange(8) * (np.pi / 4.0)], dtype=np.float32
)


def cells_of(positions: Positions, shape: tuple[int, int]) -> tuple[Index, Index]:
    """Grid cell (row, column) under each creature."""
    rows = np.clip(np.rint(positions[:, 1]), 0, shape[0] - 1).astype(np.intp)
    columns = np.clip(np.rint(positions[:, 0]), 0, shape[1] - 1).astype(np.intp)
    return rows, columns


def _gradient(field: NDArray[np.float32], positions: Positions) -> tuple[Values, Values]:
    """Difference of ``field`` a few cells east/west and south/north of each creature."""
    shape = (field.shape[0], field.shape[1])
    step = np.array([_PROBE_CELLS, 0.0], dtype=np.float32)
    east, west = cells_of(positions + step, shape), cells_of(positions - step, shape)
    south, north = cells_of(positions + step[::-1], shape), cells_of(positions - step[::-1], shape)
    along_x: Values = field[east[0], east[1]] - field[west[0], west[1]]
    along_y: Values = field[south[0], south[1]] - field[north[0], north[1]]
    return along_x, along_y


def smell_food(
    food: NDArray[np.float32], positions: Positions, here: Values, reach: Values
) -> tuple[Values, Values]:
    """Direction in which there is more food than underfoot, out to the sense range.

    Nearer food pulls harder; the result is 0 on uniform ground.
    """
    shape = (food.shape[0], food.shape[1])
    pull = np.zeros_like(positions)
    for ring in _SMELL_RINGS:
        for direction in _COMPASS:
            rows, columns = cells_of(positions + direction * (ring * reach)[:, None], shape)
            better = np.maximum(food[rows, columns] - here, 0.0) / np.float32(ring)
            pull += direction * better[:, None]
    # A direction with a strength in [0, 1): comparable to the other directional senses.
    strength = np.hypot(pull[:, 0], pull[:, 1])
    scale = np.tanh(strength * np.float32(_SMELL_GAIN)) / np.maximum(strength, 1e-6)
    return (pull[:, 0] * scale).astype(np.float32), (pull[:, 1] * scale).astype(np.float32)


def can_kill(genes: Genes, body: Phenotype, compatible: Flags, cfg: FaunaConfig) -> Flags:
    """Matrix [i, j]: creature i hunts and could kill creature j (never its own kind)."""
    hunts = genes[:, Gene.DIET] >= cfg.attack_min_diet
    strong = body.attack[:, None] >= _WORTH_ATTACKING * body.defence[None, :]
    kills = hunts[:, None] & strong & ~compatible
    np.fill_diagonal(kills, False)  # nobody hunts itself
    return kills


def _nearest(distance: NDArray[np.float32], allowed: Flags) -> tuple[Index, Flags]:
    """Per row: index of the nearest allowed column, and whether there is one."""
    masked = np.where(allowed, distance, np.inf)
    target = np.argmin(masked, axis=1)
    return target, np.isfinite(masked[np.arange(distance.shape[0]), target])


def _toward(
    offsets: NDArray[np.float32],
    distance: NDArray[np.float32],
    allowed: Flags,
    reach: Values,
) -> tuple[Values, Values]:
    """Direction to the nearest allowed creature, scaled by closeness (0 if none)."""
    target, found = _nearest(distance, allowed)
    rows = np.arange(int(distance.shape[0]))
    d = distance[rows, target]
    closeness = (np.where(found, 1.0 - d / reach, 0.0) / np.maximum(d, 1e-6)).astype(np.float32)
    return offsets[rows, target, 0] * closeness, offsets[rows, target, 1] * closeness


def separations(positions: Positions) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
    """Offsets [i, j] = vector from creature i to creature j, and their lengths."""
    offsets = positions[None, :, :] - positions[:, None, :]
    distance = np.hypot(offsets[..., 0], offsets[..., 1]).astype(np.float32)
    return offsets, distance


def sense(
    cfg: FaunaConfig,
    positions: Positions,
    energy: Values,
    body: Phenotype,
    adult: Flags,
    ready: Flags,
    hungry: Flags,
    compatible: Flags,
    kills: Flags,
    biomass: NDArray[np.float32],
    low: NDArray[np.float32],
    woody: NDArray[np.float32],
    land: NDArray[np.float32],
    offsets: NDArray[np.float32],
    distance: NDArray[np.float32],
) -> Senses:
    """Everything the brains perceive this tick. ``offsets`` and ``distance`` come from
    `separations` of the same positions; ``ready`` marks creatures able to breed now
    (only they look for a mate) and ``hungry`` those with room for a meal (only they
    look for prey). ``low`` and ``woody`` are ``biomass`` split by plant form: a
    creature sees which plants grow where, not how well they feed it."""
    n = positions.shape[0]
    senses = np.zeros((n, SENSE_COUNT), dtype=np.float32)
    rows, columns = cells_of(positions, (biomass.shape[0], biomass.shape[1]))
    senses[:, Sense.ENERGY] = energy / body.capacity
    senses[:, Sense.FOOD_HERE] = biomass[rows, columns]
    senses[:, Sense.FOOD_X], senses[:, Sense.FOOD_Y] = smell_food(
        biomass, positions, biomass[rows, columns], body.sense_range
    )
    for field, sense_x, sense_y in ((low, Sense.LOW_X, Sense.LOW_Y),
                                    (woody, Sense.WOODY_X, Sense.WOODY_Y)):  # fmt: skip
        senses[:, sense_x], senses[:, sense_y] = smell_food(
            field, positions, field[rows, columns], body.sense_range
        )
    senses[:, Sense.LAND_X], senses[:, Sense.LAND_Y] = _gradient(land, positions)
    senses[:, Sense.IN_WATER] = 1.0 - land[rows, columns]

    in_range = distance <= body.sense_range[:, None]
    np.fill_diagonal(in_range, False)
    reach = body.sense_range
    senses[:, Sense.PREY_X], senses[:, Sense.PREY_Y] = _toward(
        offsets, distance, in_range & kills & hungry[:, None], reach
    )
    senses[:, Sense.THREAT_X], senses[:, Sense.THREAT_Y] = _toward(
        offsets, distance, in_range & kills.T, reach
    )
    senses[:, Sense.MATE_X], senses[:, Sense.MATE_Y] = _toward(
        offsets, distance, in_range & compatible & adult[None, :] & ready[:, None], reach
    )
    senses[:, Sense.CROWD] = in_range.sum(axis=1) / cfg.population_cap
    senses[:, Sense.NEIGHBOUR_X], senses[:, Sense.NEIGHBOUR_Y] = _toward(
        offsets, distance, in_range & compatible, reach
    )
    return senses


def move(
    positions: Positions,
    steering: NDArray[np.float32],
    body: Phenotype,
    in_water: Flags,
    hours: float,
    shape: tuple[int, int],
) -> tuple[Positions, Values]:
    """New positions and the distance each creature travelled (cells)."""
    effort = np.hypot(steering[:, 0], steering[:, 1])
    # Never faster than top speed.
    limited = (steering / np.maximum(effort, 1.0)[:, None]).astype(np.float32)
    speed = np.where(in_water, body.swim_speed, body.land_speed)
    step = limited * (speed * np.float32(hours))[:, None]
    moved = positions + step
    moved[:, 0] = np.clip(moved[:, 0], 0.0, shape[1] - 1.0)
    moved[:, 1] = np.clip(moved[:, 1], 0.0, shape[0] - 1.0)
    travelled = np.hypot(moved[:, 0] - positions[:, 0], moved[:, 1] - positions[:, 1])
    return moved.astype(np.float32), travelled.astype(np.float32)


def upkeep(
    cfg: FaunaConfig,
    genes: Genes,
    body: Phenotype,
    travelled: Values,
    in_water: Flags,
    hours: float,
) -> Values:
    """Energy burnt this tick: resting metabolism, movement, and struggling in water."""
    drowning = cfg.water_stress * body.mass * (1.0 - genes[:, Gene.AQUATIC]) * in_water
    return ((body.basal_burn + drowning) * np.float32(hours) + body.move_cost * travelled).astype(
        np.float32
    )


def appetite(cfg: FaunaConfig, energy: Values, body: Phenotype, hours: float) -> Values:
    """Plant biomass each creature tries to graze this tick: its bite rate, less when it
    is nearly full, nothing when it cannot digest plants."""
    room = np.maximum(body.capacity - energy, 0.0)
    useful = room / np.maximum(cfg.plant_energy * body.plant_efficiency, 1e-6)
    bite = body.graze_rate * np.float32(hours)
    return np.where(body.plant_efficiency > 0.01, np.minimum(bite, useful), 0.0).astype(np.float32)


def kill_chance(cfg: FaunaConfig, body: Phenotype, hunter: Index, prey: Index) -> Values:
    """Probability that an attack by ``hunter`` kills ``prey`` (matching index arrays)."""
    edge = np.log(body.attack[hunter] / body.defence[prey]) / cfg.attack_softness
    power = 1.0 / (1.0 + np.exp(-np.clip(edge, -30.0, 30.0)))
    catch = np.minimum(1.0, body.land_speed[hunter] / np.maximum(body.land_speed[prey], 1e-6))
    return (power * catch).astype(np.float32)
