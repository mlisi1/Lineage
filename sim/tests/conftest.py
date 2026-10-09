"""Shared fixtures: the default config and a toy subsystem that exercises the world loop."""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from lineage_sim.config import Config, parse_config
from lineage_sim.events import InputEvent, OutputEvent, PresenceChanged
from lineage_sim.state.schema import Tree
from lineage_sim.world import Context, Subsystem, World
from numpy.typing import NDArray

DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "default.toml"
# 2026-03-01 00:00:00 UTC: a fixed, injected world creation instant.
EPOCH_UNIX_MS = 1_772_323_200_000
TRAIL = 8


@dataclass(frozen=True)
class Stepped(OutputEvent):
    """Toy output: a Walker completed a multiple of 100 ticks."""

    walker: str
    ticks: int


class Walker:
    """Random walk on its own stream; tracks presence; keeps an array trail."""

    def __init__(self, name: str) -> None:
        self._name = name
        self.position = 0.0
        self.ticks = 0
        self.present = False
        self.trail: NDArray[np.float64] = np.zeros(TRAIL)
        self.tick_times: list[int] = []

    @property
    def name(self) -> str:
        return self._name

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        self.position = float(ctx.rng.uniform(-1.0, 1.0))
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        drift = 0.1 if self.present else 0.0
        self.position += float(ctx.rng.normal(drift, math.sqrt(ctx.dt_s / 3600.0)))
        self.trail = np.roll(self.trail, 1)
        self.trail[0] = self.position
        self.ticks += 1
        self.tick_times.append(ctx.t_ms)
        return [Stepped(ctx.t_ms, self._name, self.ticks)] if self.ticks % 100 == 0 else []

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        if isinstance(event, PresenceChanged):
            self.present = event.present
        return []

    def get_state(self) -> Tree:
        return {
            "position": self.position,
            "ticks": self.ticks,
            "present": self.present,
            "trail": self.trail.copy(),
        }

    def set_state(self, tree: Tree) -> None:
        self.position = float(tree["position"])
        self.ticks = int(tree["ticks"])
        self.present = bool(tree["present"])
        trail: Any = tree["trail"]
        self.trail = np.array(trail, dtype=np.float64)


# Walker ticks hourly, grazer every 7 hours: they interleave and sometimes coincide.
TOY_SCHEDULE = "walker = 3600\ngrazer = 25200\n"


@pytest.fixture(scope="session")
def default_config_text() -> str:
    return DEFAULT_CONFIG_PATH.read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def config(default_config_text: str) -> Config:
    return parse_config(default_config_text)


@pytest.fixture(scope="session")
def toy_config(default_config_text: str) -> Config:
    return parse_config(default_config_text + TOY_SCHEDULE)


def toy_subsystems() -> list[Subsystem]:
    return [Walker("walker"), Walker("grazer")]


@pytest.fixture(scope="session")
def toy_factory() -> Callable[[], list[Subsystem]]:
    return toy_subsystems


@pytest.fixture
def make_toy_world(toy_config: Config) -> Callable[[int], World]:
    def make(seed: int) -> World:
        world, _ = World.create(toy_config, seed, EPOCH_UNIX_MS, toy_subsystems())
        return world

    return make


@pytest.fixture
def restore_toy_world(toy_config: Config) -> Callable[[World], World]:
    """Round-trip a world through save bytes into fresh subsystem objects."""
    from lineage_sim.state import io

    def restore(world: World) -> World:
        state = io.loads(io.dumps(world.snapshot()))
        return World.restore(toy_config, state, toy_subsystems())

    return restore
