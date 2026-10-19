"""Rare gene tables for creatures and plants (M7).

A rare gene gives an extreme bonus at a real cost. Creatures carry theirs as bits of
`Fauna.slots` (`CreatureRare`, inherited bit by bit with rare gains and losses,
`genome.inherit_slots`); plants as bits of the per-cell mask `Flora.rare`
(`flora.Rare`, gained and lost when a plant establishes).

Creature rare genes act beside the phenotype: `phenotype()` stays a function of the
genes alone (the renderer ports it), and `adjust` changes the derived body values of the
carriers afterwards. What cannot be a body value (dormancy, sunlight, the dark) is read
by the fauna tick through the helpers below.

Each gene has a visual signature for the renderer (`CREATURE_SIGNATURES`,
`PLANT_SIGNATURES`, `signature_table`).
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from enum import IntFlag

import numpy as np
from numpy.typing import NDArray

from lineage_sim.config import FaunaConfig
from lineage_sim.fauna.genome import Gene, Genes, Slots
from lineage_sim.fauna.phenotype import Phenotype, phenotype
from lineage_sim.flora import Rare as PlantRare

Values = NDArray[np.float32]
Flags = NDArray[np.bool_]


class CreatureRare(IntFlag):
    """Creature rare genes: one bit each in `Fauna.slots`."""

    VENOM = 1  # attack power multiplied: kills prey far larger than itself
    TOXIC = 2  # warning colours: hunters seldom kill it
    GIANT = 4  # twice the mass (reserve, attack, defence), later maturity
    LONGEVITY = 8  # lives twice as long, breeds more slowly
    AMPHIBIOUS = 16  # walks like a land animal and swims like a fish
    HIBERNATION = 32  # torpid in winter and in long darkness: burns and ages slowly
    PHOTOSYNTHESIS = 64  # feeds on sunlight on open land; slow, and starves in the dark
    GLOW = 128  # sees and is seen in the dark


CREATURE_GENES = tuple(CreatureRare)
PLANT_GENES = tuple(PlantRare)


def carries(slots: Slots, gene: CreatureRare) -> Flags:
    """Which creatures carry ``gene``."""
    return (slots & np.uint16(gene)) != 0


# --- Body -------------------------------------------------------------------------------


def adjust(cfg: FaunaConfig, genes: Genes, slots: Slots, body: Phenotype) -> Phenotype:
    """The body values of ``body`` (``phenotype(cfg, genes)``) after the carriers' rare
    genes. Creatures without rare genes keep their values exactly."""
    if not slots.any():
        return body
    f32 = np.float32
    mass = body.mass.copy()
    capacity, attack, defence = body.capacity.copy(), body.attack.copy(), body.defence.copy()
    basal, move_cost, graze = body.basal_burn.copy(), body.move_cost.copy(), body.graze_rate.copy()
    land, swim = body.land_speed.copy(), body.swim_speed.copy()
    lifespan, maturity, brood = body.lifespan_h.copy(), body.maturity_h.copy(), body.brood.copy()

    giant = carries(slots, CreatureRare.GIANT)
    if giant.any():
        # Everything that scales with mass scales again, by the same laws as the size gene.
        k = f32(cfg.giant_mass_factor)
        metabolic = k ** f32(cfg.metabolic_exponent)
        mass[giant] *= k
        capacity[giant] *= k
        attack[giant] *= k
        defence[giant] *= k
        basal[giant] *= metabolic
        move_cost[giant] *= metabolic
        graze[giant] *= metabolic
        land[giant] *= k ** f32(cfg.speed_mass_exponent)
        swim[giant] *= k ** f32(cfg.speed_mass_exponent)
        lifespan[giant] *= k ** f32(cfg.lifespan_mass_exponent)
        maturity[giant] *= k ** f32(cfg.lifespan_mass_exponent) * f32(cfg.giant_maturity_factor)

    longevity = carries(slots, CreatureRare.LONGEVITY)
    lifespan[longevity] *= f32(cfg.longevity_factor)  # maturity stays where it was
    brood[longevity] = np.maximum(1.0, np.rint(brood[longevity] * f32(cfg.longevity_brood_factor)))

    venom = carries(slots, CreatureRare.VENOM)
    attack[venom] *= f32(cfg.venom_attack_factor)

    amphibious = carries(slots, CreatureRare.AMPHIBIOUS)
    if amphibious.any():
        # Legs of a land animal and the fins of a swimmer: each speed as if its swimming
        # gene were at the favourable end.
        walker, swimmer = genes[amphibious].copy(), genes[amphibious].copy()
        walker[:, Gene.AQUATIC], swimmer[:, Gene.AQUATIC] = 0.0, 1.0
        scale = mass[amphibious] / body.mass[amphibious]  # a giant amphibian is giant too
        speed_scale = scale ** f32(cfg.speed_mass_exponent)
        land[amphibious] = np.maximum(
            land[amphibious], phenotype(cfg, walker).land_speed * speed_scale
        )
        swim[amphibious] = np.maximum(
            swim[amphibious], phenotype(cfg, swimmer).swim_speed * speed_scale
        )

    photosynthesis = carries(slots, CreatureRare.PHOTOSYNTHESIS)
    land[photosynthesis] *= f32(cfg.photosynthesis_land_speed)

    # Every rare gene costs resting burn, like a body gene: basal_rate × mass^exponent ×
    # its cost, added on top.
    extra = np.zeros(slots.shape, dtype=np.float32)
    for gene, cost in rare_costs(cfg):
        extra += np.where(carries(slots, gene), f32(cost), f32(0.0))
    basal += f32(cfg.basal_rate) * mass ** f32(cfg.metabolic_exponent) * extra

    return replace(
        body,
        mass=mass.astype(np.float32),
        capacity=capacity.astype(np.float32),
        attack=attack.astype(np.float32),
        defence=defence.astype(np.float32),
        basal_burn=basal.astype(np.float32),
        move_cost=move_cost.astype(np.float32),
        graze_rate=graze.astype(np.float32),
        land_speed=land.astype(np.float32),
        swim_speed=swim.astype(np.float32),
        lifespan_h=lifespan.astype(np.float32),
        maturity_h=maturity.astype(np.float32),
        brood=brood.astype(np.float32),
    )


def rare_costs(cfg: FaunaConfig) -> tuple[tuple[CreatureRare, float], ...]:
    """Each creature rare gene's resting-burn cost (× basal_rate × mass^exponent)."""
    return (
        (CreatureRare.VENOM, cfg.venom_burn_cost),
        (CreatureRare.TOXIC, cfg.toxic_burn_cost),
        (CreatureRare.GIANT, cfg.giant_burn_cost),
        (CreatureRare.LONGEVITY, cfg.longevity_burn_cost),
        (CreatureRare.AMPHIBIOUS, cfg.amphibious_burn_cost),
        (CreatureRare.HIBERNATION, cfg.hibernation_burn_cost),
        (CreatureRare.PHOTOSYNTHESIS, cfg.photosynthesis_burn_cost),
        (CreatureRare.GLOW, cfg.glow_burn_cost),
    )


# The `[fauna]` keys the renderer needs to draw rare genes beside its port of `phenotype`
# (R2): a giant is drawn at its adjusted mass, the phenotype's mass × this factor.
RENDER_KEYS = ("giant_mass_factor",)


def render_config(cfg: FaunaConfig) -> dict[str, float]:
    """The values of `RENDER_KEYS`, as the renderer reads them."""
    return {key: float(getattr(cfg, key)) for key in RENDER_KEYS}


def body_of(cfg: FaunaConfig, genes: Genes, slots: Slots) -> Phenotype:
    """Phenotype of genes and rare genes together."""
    return adjust(cfg, genes, slots, phenotype(cfg, genes))


# --- Behaviour in the tick --------------------------------------------------------------


def torpid(
    cfg: FaunaConfig,
    slots: Slots,
    energy: Values,
    capacity: Values,
    winter: bool,
    daylight: float,
) -> Flags:
    """Hibernators that are torpid now: in winter, or when it is darker than
    ``hibernation_daylight``, as long as their reserve is above ``hibernation_wake_share``
    of capacity (below it they wake to feed)."""
    season = winter or daylight < cfg.hibernation_daylight
    if not season:
        return np.zeros(slots.shape, dtype=np.bool_)
    fed = energy > np.float32(cfg.hibernation_wake_share) * capacity
    return carries(slots, CreatureRare.HIBERNATION) & fed


def sunlight(
    cfg: FaunaConfig,
    slots: Slots,
    mass: Values,
    daylight: float,
    shade: Values,
    on_land: Flags,
    hours: float,
) -> Values:
    """Energy photosynthesisers gain this tick: photosynthesis_rate × mass^exponent per
    hour in full daylight on open land, less under a canopy (``shade``, share of light
    intercepted where each stands), nothing in water or in the dark."""
    who = carries(slots, CreatureRare.PHOTOSYNTHESIS) & on_land
    light = np.float32(daylight) * (np.float32(1.0) - shade)
    rate = np.float32(cfg.photosynthesis_rate) * mass ** np.float32(cfg.metabolic_exponent)
    return np.where(who, rate * light * np.float32(hours), np.float32(0.0)).astype(np.float32)


def sight(cfg: FaunaConfig, slots: Slots, sense_range: Values, daylight: float) -> Values | None:
    """How far each creature (row) sees each other one (column) in the dark, or None in
    full daylight (everyone sees out to its sense range). In darkness sight falls toward
    ``night_sight`` of the range; a glowing creature lights its own way and is seen by
    everyone at full range."""
    if daylight >= 1.0:
        return None
    dim = np.float32(cfg.night_sight + (1.0 - cfg.night_sight) * daylight)
    glow = carries(slots, CreatureRare.GLOW)
    full = glow[:, None] | glow[None, :]
    return np.where(full, sense_range[:, None], dim * sense_range[:, None]).astype(np.float32)


def kill_factor(cfg: FaunaConfig, slots: Slots) -> Values:
    """Multiplier on the chance of killing each creature: toxic prey are seldom killed."""
    toxic = carries(slots, CreatureRare.TOXIC)
    return np.where(toxic, np.float32(cfg.toxic_kill_factor), np.float32(1.0)).astype(np.float32)


def cooldown_factor(cfg: FaunaConfig, slots: Slots) -> Values:
    """Multiplier on the wait between broods: long-lived creatures breed slowly."""
    longevity = carries(slots, CreatureRare.LONGEVITY)
    return np.where(longevity, np.float32(cfg.longevity_cooldown_factor), np.float32(1.0)).astype(
        np.float32
    )


def waterproof(slots: Slots) -> Flags:
    """Creatures that do not struggle in water whatever their swimming gene."""
    return carries(slots, CreatureRare.AMPHIBIOUS)


# --- Signatures for the renderer --------------------------------------------------------


@dataclass(frozen=True)
class Signature:
    """How a rare gene shows: a stable key the renderer draws by, and what it looks like."""

    key: str
    look: str


# Two tables: an IntFlag equals its integer value, so creature and plant bits would clash
# as keys of one dict.
CREATURE_SIGNATURES: dict[CreatureRare, Signature] = {
    CreatureRare.VENOM: Signature("venom", "bright fangs and a dark-tipped tail"),
    CreatureRare.TOXIC: Signature("warning", "bold warning bands over the body colour"),
    CreatureRare.GIANT: Signature("giant", "drawn at its (rare-adjusted) mass: much larger"),
    CreatureRare.LONGEVITY: Signature("elder", "pale, grizzled markings"),
    CreatureRare.AMPHIBIOUS: Signature("gills", "frilled gills beside the legs"),
    CreatureRare.HIBERNATION: Signature("coat", "a thick coat; curled up while torpid"),
    CreatureRare.PHOTOSYNTHESIS: Signature("leaves", "green tint and leaf-like frills"),
    CreatureRare.GLOW: Signature("glow", "glowing spots, lit in the dark"),
}
PLANT_SIGNATURES: dict[PlantRare, Signature] = {
    PlantRare.FIRE_PINE: Signature("bark", "thick red bark; stands black after a fire"),
    PlantRare.NITROGEN_FIXER: Signature("clover", "small round leaves and pale flowers"),
    PlantRare.MANGROVE: Signature("stilts", "stilt roots in shallow water"),
    PlantRare.POISONOUS: Signature("berries", "purple berries"),
    PlantRare.FRUITING: Signature("fruit", "large bright fruit"),
    PlantRare.EMERGENT: Signature("crown", "a crown standing above the canopy"),
}


def signature_table() -> list[dict[str, str | int]]:
    """Every rare gene, for the wire protocol: kingdom, bit, name, signature key, look."""
    table: list[dict[str, str | int]] = []
    kingdoms: tuple[tuple[str, dict[CreatureRare, Signature] | dict[PlantRare, Signature]], ...]
    kingdoms = (("creature", CREATURE_SIGNATURES), ("plant", PLANT_SIGNATURES))
    for kingdom, signatures in kingdoms:
        for gene, signature in signatures.items():
            table.append(
                {
                    "kingdom": kingdom,
                    "bit": int(gene),
                    "name": str(gene.name).lower(),
                    "signature": signature.key,
                    "look": signature.look,
                }
            )
    return table
