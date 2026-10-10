"""The interface between the World and its subsystems."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from numpy.random import Generator

from lineage_sim import clock
from lineage_sim.events import InputEvent, OutputEvent
from lineage_sim.state.schema import Tree


@dataclass(frozen=True)
class Context:
    """What a subsystem sees when it runs."""

    t_ms: int
    dt_s: float  # time covered by this tick (its period); 0 outside ticks
    instant: clock.Instant
    rng: Generator  # the subsystem's own stream


class Subsystem(Protocol):
    """A part of the world (terrain, flora, fauna…) that runs on its own schedule.

    ``name`` is also its random-stream name and its ``[schedule]`` key.
    """

    @property
    def name(self) -> str: ...

    def initialize(self, ctx: Context) -> list[OutputEvent]: ...

    def tick(self, ctx: Context) -> list[OutputEvent]: ...

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]: ...

    def get_state(self) -> Tree: ...

    def set_state(self, tree: Tree) -> None: ...
