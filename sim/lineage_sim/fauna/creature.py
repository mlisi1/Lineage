"""What one creature does in a tick: sense, move, burn energy, eat.

Functions take arrays with one row per creature and return arrays; they never loop over
creatures. `population.py` owns the arrays and decides who is born and who dies.
"""

from __future__ import annotations

from dataclasses import dataclass

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


SmellPoints = list[tuple[float, NDArray[np.float32], Index, Index]]


@dataclass(frozen=True)
class Browse:
    """What each creature can bite of the plants (M11): the plants' height per cell, how
    high each creature reaches, and the share of an out-of-reach plant it still gets."""

    plant_height: NDArray[np.float32]
    reaches: Values
    floor: float

    def share(self, rows: Index, columns: Index) -> Values:
        reached = np.minimum(self.reaches / np.maximum(self.plant_height[rows, columns], 1e-6), 1.0)
        floor = np.float32(self.floor)
        return (floor + (np.float32(1.0) - floor) * reached).astype(np.float32)


def smell_points(positions: Positions, reach: Values, shape: tuple[int, int]) -> SmellPoints:
    """The cells each creature smells, as (ring, direction, rows, columns) per sample.
    They depend only on where creatures are and how far they sense, so one set serves
    every field smelled in a tick."""
    points: SmellPoints = []
    for ring in _SMELL_RINGS:
        for direction in _COMPASS:
            rows, columns = cells_of(positions + direction * (ring * reach)[:, None], shape)
            points.append((ring, direction, rows, columns))
    return points


def smell_food(
    food: NDArray[np.float32],
    positions: Positions,
    here: Values,
    reach: Values,
    points: SmellPoints | None = None,
    sea: NDArray[np.float32] | None = None,
    ease: Values | None = None,
    browse: Browse | None = None,
) -> tuple[Values, Values]:
    """Direction in which there is more food than underfoot, out to the sense range.

    Nearer food pulls harder; the result is 0 on uniform ground. ``points`` are
    `smell_points` of the same positions and reach, if already computed. With ``sea``
    (food in the water) each creature smells it weighted by its ``ease`` in water, so
    the food it smells is ``food + ease × sea``; with ``browse`` it smells of ``food``
    only the share it can bite (``here`` must be read the same way).
    """
    if points is None:
        points = smell_points(positions, reach, (food.shape[0], food.shape[1]))
    pull = np.zeros_like(positions)
    for ring, direction, rows, columns in points:
        there = food[rows, columns]
        if browse is not None:
            there = there * browse.share(rows, columns)
        if sea is not None and ease is not None:
            there = there + ease * sea[rows, columns]
        better = np.maximum(there - here, 0.0) / np.float32(ring)
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
    carrion: NDArray[np.float32],
    land: NDArray[np.float32],
    offsets: NDArray[np.float32],
    distance: NDArray[np.float32],
    sight: NDArray[np.float32] | None = None,
    sea: NDArray[np.float32] | None = None,
    ease: Values | None = None,
    browse: Browse | None = None,
) -> Senses:
    """Everything the brains perceive this tick. ``offsets`` and ``distance`` come from
    `separations` of the same positions; ``ready`` marks creatures able to breed now
    (only they look for a mate) and ``hungry`` those with room for a meal (only they
    look for prey). ``low`` and ``woody`` are ``biomass`` split by plant form: a
    creature sees which plants grow where, not how well they feed it. ``sight`` [i, j]
    is how far i sees j in the dark (`rare.sight`); None in daylight, when each sees out
    to its sense range. Smell is not affected by the dark. ``sea`` is food in the water
    (algae, M11), smelled and seen underfoot in proportion to each creature's ``ease``
    in water; None when there is none. ``browse`` limits the plant food each creature
    senses to what it can reach (M11)."""
    n = positions.shape[0]
    senses = np.zeros((n, SENSE_COUNT), dtype=np.float32)
    rows, columns = cells_of(positions, (biomass.shape[0], biomass.shape[1]))
    senses[:, Sense.ENERGY] = energy / body.capacity
    here: Values = biomass[rows, columns]
    if browse is not None:
        here = (here * browse.share(rows, columns)).astype(np.float32)
    if sea is not None and ease is not None:
        here = (here + ease * sea[rows, columns]).astype(np.float32)
    senses[:, Sense.FOOD_HERE] = here
    points = smell_points(positions, body.sense_range, (biomass.shape[0], biomass.shape[1]))
    senses[:, Sense.FOOD_X], senses[:, Sense.FOOD_Y] = smell_food(
        biomass, positions, here, body.sense_range, points, sea, ease, browse
    )
    for field, sense_x, sense_y in ((low, Sense.LOW_X, Sense.LOW_Y),
                                    (woody, Sense.WOODY_X, Sense.WOODY_Y),
                                    (carrion, Sense.CARRION_X, Sense.CARRION_Y)):  # fmt: skip
        senses[:, sense_x], senses[:, sense_y] = smell_food(
            field, positions, field[rows, columns], body.sense_range, points
        )
    senses[:, Sense.LAND_X], senses[:, Sense.LAND_Y] = _gradient(land, positions)
    senses[:, Sense.IN_WATER] = 1.0 - land[rows, columns]

    in_range = distance <= (body.sense_range[:, None] if sight is None else sight)
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
    waterproof: Flags | None = None,
) -> Values:
    """Energy burnt this tick: resting metabolism, movement, and struggling in water
    (except for the ``waterproof``)."""
    struggling = in_water if waterproof is None else in_water & ~waterproof
    drowning = cfg.water_stress * body.mass * (1.0 - genes[:, Gene.AQUATIC]) * struggling
    return ((body.basal_burn + drowning) * np.float32(hours) + body.move_cost * travelled).astype(
        np.float32
    )


def reach(cfg: FaunaConfig, mass: Values) -> Values:
    """How tall a plant each creature reaches, in the plants' height units (M11)."""
    return (cfg.reach_at_unit_mass * np.cbrt(mass)).astype(np.float32)


def hidden(plant_height: Values, density: Values, reaches: Values) -> Values:
    """How hidden each prey is among the plants where it stands (M11): the share of the
    plants' height above its reach, times their density in [0, 1]."""
    above = np.clip(1.0 - reaches / np.maximum(plant_height, 1e-6), 0.0, 1.0)
    return (above * np.clip(density, 0.0, 1.0)).astype(np.float32)


def appetite(cfg: FaunaConfig, energy: Values, body: Phenotype, hours: float) -> Values:
    """Plant biomass each creature tries to graze this tick: its bite rate, less when it
    is nearly full, nothing when it cannot digest plants."""
    room = np.maximum(body.capacity - energy, 0.0)
    useful = room / np.maximum(cfg.plant_energy * body.plant_efficiency, 1e-6)
    bite = body.graze_rate * np.float32(hours)
    return np.where(body.plant_efficiency > 0.01, np.minimum(bite, useful), 0.0).astype(np.float32)


def spread(field: NDArray[np.float32], radius: int) -> NDArray[np.float32]:
    """Mean of ``field`` over the (2 radius + 1)² box around every cell, counting cells
    beyond the edge as empty: a scent that reaches beyond the cell it comes from, so that
    the sparse sampling of `smell_food` finds point sources such as carcasses."""
    if radius <= 0 or not field.any():
        return field
    width = 2 * radius + 1
    summed = np.pad(field.astype(np.float64), ((radius + 1, radius), (radius + 1, radius)))
    summed = summed.cumsum(0).cumsum(1)
    box = (
        summed[width:, width:] - summed[:-width, width:]
        - summed[width:, :-width] + summed[:-width, :-width]
    )  # fmt: skip
    return (box / float(width * width)).astype(np.float32)


def stamp(
    scent: NDArray[np.float32], rows: Index, columns: Index, amounts: Values, radius: int
) -> None:
    """Add each amount's scent to ``scent`` in place: amount / (2 radius + 1)² over the box
    around its cell (cells beyond the edge dropped), as `spread` would give for it. Keeps a
    scent up to date as carrion is left and eaten, without spreading the whole map."""
    height, width = int(scent.shape[0]), int(scent.shape[1])
    share = 1.0 / float((2 * radius + 1) ** 2)
    for row, column, amount in zip(rows.tolist(), columns.tolist(), amounts.tolist(), strict=True):
        top, left = max(0, row - radius), max(0, column - radius)
        bottom, right = min(height, row + radius + 1), min(width, column + radius + 1)
        scent[top:bottom, left:right] += np.float32(amount * share)


def share_out(field: NDArray[np.float32], rows: Index, columns: Index, demand: Values) -> Values:
    """Creatures at cells (rows, columns) ask for ``demand`` of what ``field`` holds there;
    several on one cell share it in proportion to their demand. Takes what they get out of
    ``field`` (in place) and returns it."""
    width = field.shape[1]
    cells, group = np.unique(rows * width + columns, return_inverse=True)
    cell_rows, cell_columns = cells // width, cells % width
    asked = np.bincount(group, weights=demand, minlength=cells.size)
    there = field[cell_rows, cell_columns].astype(np.float64)
    share = np.minimum(1.0, there / np.maximum(asked, 1e-12))
    got = (demand * share[group]).astype(np.float32)
    left = there - np.bincount(group, weights=got, minlength=cells.size)
    field[cell_rows, cell_columns] = np.maximum(left, 0.0).astype(np.float32)
    return got


def kill_chance(
    cfg: FaunaConfig, body: Phenotype, hunter: Index, prey: Index, still: Flags | None = None
) -> Values:
    """Probability that an attack by ``hunter`` kills ``prey`` (matching index arrays).
    Prey marked ``still`` (per creature) do not flee: speed does not save them."""
    edge = np.log(body.attack[hunter] / body.defence[prey]) / cfg.attack_softness
    power = 1.0 / (1.0 + np.exp(-np.clip(edge, -30.0, 30.0)))
    catch = np.minimum(1.0, body.land_speed[hunter] / np.maximum(body.land_speed[prey], 1e-6))
    if still is not None:
        catch = np.where(still[prey], 1.0, catch)
    return (power * catch).astype(np.float32)
