"""The end of a world (M10, ADR 0018).

A world ends when life collapses: once creatures have lived on the island for
``established_days``, the death of the last one is the end. A landing that dies out
before then is not yet life on the island; the founders come again, as before M10.

The apocalypse only watches: it draws from its own stream only when the world ends (the
seed of the next one) and reports ``WorldCollapsed``. The World archives the ended world
and starts the next (`world.py`).
"""

from __future__ import annotations

from collections.abc import Sequence

from lineage_sim.clock import MS_PER_DAY
from lineage_sim.config import ApocalypseConfig
from lineage_sim.events import (
    CreaturesArrived,
    InputEvent,
    OutputEvent,
    PopulationExtinct,
    WorldCollapsed,
)
from lineage_sim.rng import APOCALYPSE
from lineage_sim.state.schema import StateError, Tree
from lineage_sim.subsystem import Context

CAUSE_LAST_CREATURE = "last_creature"
SEED_LIMIT = 2**31  # next seeds stay below this, so every reader keeps them exact


class Apocalypse:
    """Detects the collapse of life; a subsystem and an observer."""

    def __init__(self, cfg: ApocalypseConfig) -> None:
        self._cfg = cfg
        self._life_since_ms = -1  # when the creatures alive now first landed; -1: none

    @property
    def name(self) -> str:
        return APOCALYPSE

    @property
    def life_since_ms(self) -> int:
        """Sim time the island's creatures first landed (-1 while it is empty)."""
        return self._life_since_ms

    def established(self, t_ms: int) -> bool:
        """Whether life on the island counts as established at ``t_ms``."""
        if self._life_since_ms < 0:
            return False
        return t_ms - self._life_since_ms >= self._cfg.established_days * MS_PER_DAY

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        return []  # it acts on what it observes

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def observe(self, outputs: Sequence[OutputEvent], ctx: Context) -> list[OutputEvent]:
        out: list[OutputEvent] = []
        for event in outputs:
            if isinstance(event, CreaturesArrived) and self._life_since_ms < 0:
                self._life_since_ms = event.t_ms
            elif isinstance(event, PopulationExtinct):
                if self.established(event.t_ms):
                    seed = int(ctx.rng.integers(SEED_LIMIT))
                    out.append(WorldCollapsed(event.t_ms, CAUSE_LAST_CREATURE, seed))
                else:
                    self._life_since_ms = -1  # a failed landing: wait for the next
        return out

    def get_state(self) -> Tree:
        return {"life_since_ms": self._life_since_ms}

    def set_state(self, tree: Tree) -> None:
        since = tree["life_since_ms"]
        if not isinstance(since, int) or isinstance(since, bool) or since < -1:
            raise StateError("apocalypse life_since_ms must be an integer >= -1")
        self._life_since_ms = since
