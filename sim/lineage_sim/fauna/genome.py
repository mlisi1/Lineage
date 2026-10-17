"""Creature genome: genes in [0, 1] (body and learning), brain weights, rare-gene slots.

Genomes are rows of arrays, one row per creature, so every function here works on a
whole population at once.
"""

from __future__ import annotations

from enum import IntEnum

import numpy as np
from numpy.random import Generator
from numpy.typing import NDArray

from lineage_sim.config import FaunaConfig

Genes = NDArray[np.float32]  # shape (creatures, GENE_COUNT)
Weights = NDArray[np.float32]  # shape (creatures, brain parameters)
Slots = NDArray[np.uint16]  # shape (creatures,): one bit per rare-gene slot


class Gene(IntEnum):
    """The genes. Each is in [0, 1]; the phenotype gives each a benefit and a cost."""

    SIZE = 0  # body mass
    DIET = 1  # 0 eats plants … 1 eats meat
    LIMBS = 2  # number of leg pairs
    SPEED = 3  # muscle: top speed
    ARMOUR = 4  # plates: protection, weight
    SENSE = 5  # eyes and ears: perception range
    AQUATIC = 6  # 0 land animal … 1 swimmer
    JAW = 7  # bite: grazing rate and attack power
    BROOD = 8  # 0 one large young … 1 many small ones
    HUE = 9  # body colour (and mate recognition)
    PATTERN = 10  # body pattern (and mate recognition)
    LEARNING = 11  # how fast the brain learns during life
    EXPLORATION = 12  # how much it tries out while steering, so it has something to learn from
    SOCIAL = 13  # how much of its mother's learned plant preferences a newborn takes on


GENE_COUNT = len(Gene)


def random_genes(rng: Generator, count: int) -> Genes:
    return rng.random((count, GENE_COUNT)).astype(np.float32)


def distance(a: Genes, b: Genes) -> NDArray[np.float32]:
    """Mean absolute difference per gene between matching rows of ``a`` and ``b``."""
    return np.abs(a - b).mean(axis=-1).astype(np.float32)


def distance_matrix(genes: Genes) -> NDArray[np.float32]:
    """Genetic distance between every pair of creatures, shape (n, n)."""
    return np.abs(genes[:, None, :] - genes[None, :, :]).mean(axis=-1).astype(np.float32)


def crossover(
    rng: Generator, a: NDArray[np.float32], b: NDArray[np.float32]
) -> NDArray[np.float32]:
    """Each value of a child row comes from parent ``a`` or parent ``b`` with equal odds."""
    return np.where(rng.random(a.shape) < 0.5, a, b).astype(np.float32)


def mutate_genes(rng: Generator, genes: Genes, sigma: float) -> Genes:
    return np.clip(genes + rng.normal(0.0, sigma, genes.shape), 0.0, 1.0).astype(np.float32)


def mutate_weights(rng: Generator, weights: Weights, sigma: float) -> Weights:
    return (weights + rng.normal(0.0, sigma, weights.shape)).astype(np.float32)


def inherit_slots(rng: Generator, cfg: FaunaConfig, a: Slots, b: Slots) -> Slots:
    """Rare-gene slots of children: each bit from one parent, then rare gains and losses."""
    bits = np.arange(cfg.rare_slots, dtype=np.uint16)
    from_a = rng.random((a.size, cfg.rare_slots)) < 0.5
    carried = np.where(from_a, (a[:, None] >> bits) & 1, (b[:, None] >> bits) & 1).astype(bool)
    chance = np.where(carried, cfg.rare_loss_probability, cfg.rare_gain_probability)
    carried ^= rng.random(carried.shape) < chance
    return (carried.astype(np.uint16) << bits).sum(axis=1).astype(np.uint16)
