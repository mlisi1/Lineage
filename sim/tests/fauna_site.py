"""A hand-built site for fauna scenarios: frozen terrain, flora that only changes when
grazed, and fauna ticks driven by hand. Shared by test_fauna.py and test_learning.py."""

from __future__ import annotations

import datetime as dt
from dataclasses import replace
from typing import Any

import numpy as np
from lineage_sim import clock
from lineage_sim.config import Config, FaunaConfig
from lineage_sim.events import OutputEvent
from lineage_sim.fauna import brain
from lineage_sim.fauna.genome import Gene
from lineage_sim.fauna.population import Fauna
from lineage_sim.flora import Flora, Wildfire
from lineage_sim.rare import body_of
from lineage_sim.subsystem import Context
from lineage_sim.terrain import Terrain
from numpy.random import PCG64, Generator
from numpy.typing import NDArray

TICK_S = 600.0
ROWS, COLUMNS = 40, 60
SEA = 0.42
Array = NDArray[np.float32]

# Hand-made genomes, by gene:
# SIZE DIET LIMBS SPEED ARMOUR SENSE AQUATIC JAW BROOD HUE PATTERN LEARNING EXPLORATION
# SOCIAL
# (These do not learn: M5's scenarios in test_learning.py give the last two genes.)
GRAZER = (0.30, 0.05, 0.50, 0.50, 0.20, 0.50, 0.00, 0.50, 0.00, 0.30, 0.30, 0.00, 0.00, 0.00)
HUNTER = (0.60, 0.90, 0.50, 0.80, 0.10, 0.70, 0.00, 0.90, 0.00, 0.90, 0.90, 0.00, 0.00, 0.00)


def genes_of(*rows: tuple[float, ...]) -> Array:
    return np.array(rows, dtype=np.float32)


def with_gene(genome: tuple[float, ...], gene: Gene, value: float) -> tuple[float, ...]:
    changed = list(genome)
    changed[gene] = value
    return tuple(changed)


class Site:
    """A frozen terrain with flora and fauna on it; fauna ticks are driven by hand."""

    def __init__(
        self,
        config: Config,
        *,
        biomass: float = 0.8,
        water_from: int | None = None,
        fauna: FaunaConfig | None = None,
        fire: bool = False,
        seed: int = 1,
    ) -> None:
        self.config = config
        # No strangers unless a test asks for them.
        self.cfg = fauna or replace(config.fauna, immigrant_groups_per_year=0.0)
        height = np.full((ROWS, COLUMNS), SEA + 0.10, dtype=np.float32)
        if water_from is not None:
            height[:, water_from:] = SEA - 0.2
        self.terrain = Terrain(replace(config.terrain, grid_height=ROWS, grid_width=COLUMNS))
        self.terrain.set_state(
            {
                "height": height,
                "fertility": np.full((ROWS, COLUMNS), 0.5, dtype=np.float32),
                "hotspots": np.zeros((0, 7)),
                "sea_phases": [0.0, 0.0],
                "sea_level": SEA,
                "continent_seeds": [1, 2, 3],
                "roughness_seed": 4,
            }
        )
        self.flora = Flora(config.flora, self.terrain)
        state = self.flora.get_state()
        state["biomass"][height > SEA] = biomass
        state["genome"][:, height > SEA] = 60
        self.flora.set_state(state)
        # A fire on the site when a test asks for one (R4: it burns the creatures in it).
        self.fire = Wildfire(config.flora, self.flora, self.terrain) if fire else None
        self.fauna = Fauna(self.cfg, self.terrain, self.flora, self.fire)
        self.rng = Generator(PCG64(seed))
        self.t_ms = 0

    def add(
        self,
        genome: tuple[float, ...],
        positions: list[tuple[float, float]],
        *,
        energy_share: float = 0.9,
        age_days: float = 20.0,
        idle_days: float = 0.0,
        slots: int = 0,
    ) -> NDArray[np.int64]:
        """Put creatures with ``genome`` (and rare genes ``slots``) at ``positions``;
        returns their ids."""
        count = len(positions)
        genes = np.repeat(genes_of(genome), count, axis=0)
        rare = np.full(count, slots, dtype=np.uint16)
        state = self.fauna.get_state()
        body = body_of(self.cfg, genes, rare)
        ids = np.arange(state["next_id"], state["next_id"] + count, dtype=np.int64)
        weights = brain.founder_weights(Generator(PCG64(7)), self.cfg, genes)
        extra: dict[str, Any] = {
            "positions": np.array(positions, dtype=np.float32),
            "energy": energy_share * body.capacity,
            "age_h": np.full(count, age_days * 24.0, dtype=np.float32),
            "idle_h": np.full(count, idle_days * 24.0, dtype=np.float32),
            "heading": np.zeros(count, dtype=np.float32),
            "genes": genes,
            "weights": weights,
            "slots": rare,
            "ids": ids,
            "origin": np.full(count, len(state["ancestors"]), dtype=np.int32),
            "generation": np.zeros(count, dtype=np.int32),
            "learned": np.zeros((count, brain.LEARNED_COUNT), dtype=np.float32),
            "trace": np.zeros((count, brain.LEARNED_COUNT), dtype=np.float32),
            "noise": np.zeros((count, brain.OUTPUTS), dtype=np.float32),
            "baseline": -body.basal_burn / body.capacity,
            "meal_value": np.full(count, np.nan, dtype=np.float32),
            "balance": -body.basal_burn,
            "competent_h": np.full(count, -1.0, dtype=np.float32),
            "young_eaten": np.zeros(count, dtype=np.float32),
            "young_burnt": np.zeros(count, dtype=np.float32),
        }
        for key, value in extra.items():
            state[key] = np.concatenate([state[key], value])
        state["ancestors"] = np.concatenate([state["ancestors"], genes_of(genome)])
        state["next_id"] = int(ids[-1]) + 1
        self.fauna.set_state(state)
        return ids

    def run(self, hours: float, when: dt.date = dt.date(2026, 6, 1)) -> list[OutputEvent]:
        """Fauna ticks for ``hours``, on ``when`` (June: summer in the default calendar)."""
        outputs: list[OutputEvent] = []
        for _ in range(round(hours * 3600 / TICK_S)):
            self.t_ms += int(TICK_S * 1000)
            unix_ms = clock.date_to_unix_ms(when) + self.t_ms
            instant = clock.instant(unix_ms, 0, self.config.calendar)
            outputs += self.fauna.tick(Context(self.t_ms, TICK_S, instant, self.rng))
        return outputs

    def alive(self, ids: NDArray[np.int64]) -> int:
        return int(np.isin(ids, self.fauna.ids).sum())

    def energy_share(self, ids: NDArray[np.int64]) -> Array:
        mask = np.isin(self.fauna.ids, ids)
        return self.fauna.energy[mask] / self.fauna.body.capacity[mask]
