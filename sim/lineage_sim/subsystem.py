"""The interface between the World and its subsystems."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Protocol, runtime_checkable

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


@runtime_checkable
class Observer(Protocol):
    """A subsystem that also sees what the others report (the chronicle, M9).

    The World hands it every batch of outputs as they are produced (a tick, a midnight,
    an input event, the initialisation), at the same sim time; what it returns is added
    to the outputs but not shown to observers again.
    """

    def observe(self, outputs: Sequence[OutputEvent], ctx: Context) -> list[OutputEvent]: ...
