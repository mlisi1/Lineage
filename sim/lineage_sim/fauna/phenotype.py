"""Genome → body. The single definition of what the genes mean physically.

The renderer draws bodies from the same derived values (R2 ports these formulas and is
checked against `sim/tests/fixtures/phenotypes.json`). Every benefit has a cost:
anything that makes a creature bigger, faster, tougher or sharper raises its energy burn.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from numpy.typing import NDArray

from lineage_sim.config import FaunaConfig
from lineage_sim.fauna.genome import Gene, Genes

Values = NDArray[np.float32]  # one value per creature


@dataclass(frozen=True)
class Phenotype:
    """Derived body values, one entry per creature."""

    mass: Values
    limb_pairs: Values  # whole numbers, 0 … limb_pairs_max
    land_speed: Values  # cells per hour
    swim_speed: Values  # cells per hour
    sense_range: Values  # cells
    basal_burn: Values  # energy per hour at rest
    move_cost: Values  # energy per cell travelled
    capacity: Values  # largest energy reserve
    graze_rate: Values  # plant biomass (full cells) per hour
    plant_efficiency: Values  # share of plant energy absorbed
    meat_efficiency: Values  # share of meat energy absorbed
    attack: Values  # attack power
    defence: Values
    lifespan_h: Values  # hours
    maturity_h: Values  # age at which it can breed, hours
    brood: Values  # young per brood, whole numbers


def phenotype(cfg: FaunaConfig, genes: Genes) -> Phenotype:
    g = genes.astype(np.float32)
    size, diet, speed = g[:, Gene.SIZE], g[:, Gene.DIET], g[:, Gene.SPEED]
    armour, aquatic, jaw = g[:, Gene.ARMOUR], g[:, Gene.AQUATIC], g[:, Gene.JAW]

    mass = cfg.mass_min * (cfg.mass_max / cfg.mass_min) ** size
    scaled = mass**cfg.metabolic_exponent
    limb_pairs = np.rint(g[:, Gene.LIMBS] * cfg.limb_pairs_max)

    muscle = cfg.speed_floor + (1.0 - cfg.speed_floor) * speed
    legs = cfg.limbless_speed + (1.0 - cfg.limbless_speed) * np.minimum(limb_pairs, 2.0) / 2.0
    legs = legs - cfg.extra_limb_drag * np.maximum(limb_pairs - 2.0, 0.0)
    plates = 1.0 - cfg.armour_slowdown * armour * np.maximum(
        1.0 - cfg.armour_limb_relief * limb_pairs, 0.0
    )
    land_speed = (
        cfg.speed_base
        * muscle
        * legs
        * plates
        * (1.0 - cfg.aquatic_land_slowdown * aquatic)
        * mass**cfg.speed_mass_exponent
    )
    swim_speed = (
        cfg.swim_speed
        * (cfg.swim_floor + (1.0 - cfg.swim_floor) * aquatic)
        * (1.0 - cfg.swim_limb_drag * limb_pairs / cfg.limb_pairs_max)
        * muscle
        * mass**cfg.speed_mass_exponent
    )

    upkeep = (
        1.0
        + cfg.cost_speed * speed
        + cfg.cost_sense * g[:, Gene.SENSE]
        + cfg.cost_armour * armour
        + cfg.cost_jaw * jaw
        + cfg.cost_limb_pair * limb_pairs
        + cfg.cost_aquatic * aquatic
    )
    lifespan_h = 24.0 * cfg.lifespan_base * mass**cfg.lifespan_mass_exponent

    def out(values: NDArray[np.floating]) -> Values:
        return values.astype(np.float32)

    return Phenotype(
        mass=out(mass),
        limb_pairs=out(limb_pairs),
        land_speed=out(land_speed),
        swim_speed=out(swim_speed),
        sense_range=out(cfg.sense_base + cfg.sense_gain * g[:, Gene.SENSE]),
        basal_burn=out(cfg.basal_rate * scaled * upkeep),
        move_cost=out(cfg.move_cost * scaled),
        capacity=out(cfg.capacity_per_mass * mass),
        graze_rate=out(
            cfg.graze_rate * scaled * (cfg.graze_jaw_floor + (1.0 - cfg.graze_jaw_floor) * jaw)
        ),
        plant_efficiency=out((1.0 - diet) ** cfg.diet_exponent),
        meat_efficiency=out(diet**cfg.diet_exponent),
        attack=out(mass * (cfg.attack_jaw_floor + jaw)),
        defence=out(mass * (1.0 + cfg.armour_strength * armour)),
        lifespan_h=out(lifespan_h),
        maturity_h=out(cfg.maturity_share * lifespan_h),
        brood=out(1.0 + np.rint(g[:, Gene.BROOD] * (cfg.brood_max - 1))),
    )
