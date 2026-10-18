"""World: owns the clock, the random streams and the subsystems.

Time advances only through ``step(dt)``; the real world arrives only through
``apply(event)``. Both return output events instead of pushing them anywhere.

Scheduling: a subsystem with period ``p`` (``[schedule]`` in the config) ticks at sim
times ``p, 2p, 3p, …``; UTC midnights emit ``DayStarted`` (and ``SeasonStarted`` when the
season changes). Within one ``step`` everything due is processed in time order, ties
broken by calendar first, then subsystem registration order. Because tick times are
absolute, any way of chunking the same total time gives a bit-identical world.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

from lineage_sim import clock
from lineage_sim.config import Config
from lineage_sim.events import DayStarted, InputEvent, OutputEvent, SeasonStarted
from lineage_sim.fauna.population import Fauna
from lineage_sim.flora import Flora, Wildfire
from lineage_sim.rng import FAUNA, FIRE, FLORA, SPECIES, TERRAIN, Streams
from lineage_sim.species import Species
from lineage_sim.state import io
from lineage_sim.state.schema import StateError, WorldState
from lineage_sim.subsystem import Context, Subsystem
from lineage_sim.terrain import Terrain

__all__ = ["Context", "Subsystem", "World", "default_subsystems"]


def default_subsystems(config: Config) -> list[Subsystem]:
    """The subsystems of a real world, in tick order."""
    terrain = Terrain(config.terrain)
    flora = Flora(config.flora, terrain)
    fire = Wildfire(config.flora, flora, terrain)
    fauna = Fauna(config.fauna, terrain, flora)
    species = Species(config.species, config.fauna.compat_distance, fauna)
    return [terrain, flora, fire, fauna, species]


class World:
    def __init__(self, config: Config, state: WorldState, subsystems: Sequence[Subsystem]) -> None:
        """Use `World.create` or `World.restore`."""
        names = [s.name for s in subsystems]
        if len(set(names)) != len(names):
            raise ValueError(f"duplicate subsystem names in {names}")
        self._config = config
        self._seed = state.seed
        self._epoch_unix_ms = state.epoch_unix_ms
        self._t_ms = state.t_ms
        self._streams = Streams(state.seed)
        self._streams.set_state(state.rng)
        self._subsystems = list(subsystems)
        self._periods_ms = [config.period_ms(name) for name in names]
        self._next_tick_ms = [(self._t_ms // p + 1) * p for p in self._periods_ms]
        self._next_midnight_ms = clock.next_midnight_t_ms(self._epoch_unix_ms, self._t_ms)

    @classmethod
    def create(
        cls,
        config: Config,
        seed: int,
        epoch_unix_ms: int,
        subsystems: Sequence[Subsystem] | None = None,
    ) -> tuple[World, list[OutputEvent]]:
        """A new world at sim time 0, and the outputs of initialising its subsystems."""
        subs = default_subsystems(config) if subsystems is None else list(subsystems)
        world = cls(config, WorldState(seed=seed, epoch_unix_ms=epoch_unix_ms, t_ms=0), subs)
        outputs: list[OutputEvent] = []
        for subsystem in world._subsystems:
            outputs += subsystem.initialize(world._context(subsystem, 0.0))
        return world, outputs

    @classmethod
    def restore(
        cls,
        config: Config,
        state: WorldState,
        subsystems: Sequence[Subsystem] | None = None,
    ) -> World:
        """A world continuing exactly from ``state``.

        A subsystem the save does not know (it was added after the save was written) is
        initialised fresh at the save's sim time, from its own random stream.
        """
        subs = default_subsystems(config) if subsystems is None else list(subsystems)
        unknown = sorted(set(state.subsystems) - {s.name for s in subs})
        if unknown:
            raise StateError(f"save has subsystems {unknown} that this world does not")
        world = cls(config, state, subs)
        for subsystem in world._subsystems:
            saved = state.subsystems.get(subsystem.name)
            if saved is None:
                subsystem.initialize(world._context(subsystem, 0.0))
            else:
                subsystem.set_state(saved)
        return world

    @property
    def config(self) -> Config:
        return self._config

    @property
    def seed(self) -> int:
        return self._seed

    @property
    def epoch_unix_ms(self) -> int:
        return self._epoch_unix_ms

    @property
    def t_ms(self) -> int:
        return self._t_ms

    def subsystem(self, name: str) -> Subsystem:
        """The subsystem called ``name`` (for read-only inspection by callers)."""
        for subsystem in self._subsystems:
            if subsystem.name == name:
                return subsystem
        raise KeyError(name)

    @property
    def terrain(self) -> Terrain:
        terrain = self.subsystem(TERRAIN)
        if not isinstance(terrain, Terrain):
            raise TypeError("the terrain subsystem was replaced")
        return terrain

    @property
    def flora(self) -> Flora:
        flora = self.subsystem(FLORA)
        if not isinstance(flora, Flora):
            raise TypeError("the flora subsystem was replaced")
        return flora

    @property
    def fauna(self) -> Fauna:
        fauna = self.subsystem(FAUNA)
        if not isinstance(fauna, Fauna):
            raise TypeError("the fauna subsystem was replaced")
        return fauna

    @property
    def species(self) -> Species:
        species = self.subsystem(SPECIES)
        if not isinstance(species, Species):
            raise TypeError("the species subsystem was replaced")
        return species

    @property
    def wildfire(self) -> Wildfire:
        fire = self.subsystem(FIRE)
        if not isinstance(fire, Wildfire):
            raise TypeError("the fire subsystem was replaced")
        return fire

    @property
    def instant(self) -> clock.Instant:
        return clock.instant(self._epoch_unix_ms, self._t_ms, self._config.calendar)

    def step(self, dt_s: float) -> list[OutputEvent]:
        """Advance sim time by ``dt_s`` seconds (rounded to the millisecond)."""
        if not math.isfinite(dt_s) or dt_s < 0:
            raise ValueError(f"dt must be a finite non-negative number of seconds, got {dt_s}")
        return self.advance_to(self._t_ms + round(dt_s * clock.MS_PER_SECOND))

    def advance_to(self, t_ms: int) -> list[OutputEvent]:
        """Advance sim time to ``t_ms``, processing everything due on the way."""
        if t_ms < self._t_ms:
            raise ValueError(f"cannot go back in time from {self._t_ms} to {t_ms} ms")
        outputs: list[OutputEvent] = []
        while True:
            # Next due item: index -1 is the calendar, i >= 0 is subsystem i.
            due_ms, index = self._next_midnight_ms, -1
            for i, tick_ms in enumerate(self._next_tick_ms):
                if tick_ms < due_ms:
                    due_ms, index = tick_ms, i
            if due_ms > t_ms:
                break
            self._t_ms = due_ms
            if index < 0:
                outputs += self._start_day()
            else:
                subsystem = self._subsystems[index]
                period_ms = self._periods_ms[index]
                self._next_tick_ms[index] += period_ms
                ctx = self._context(subsystem, period_ms / clock.MS_PER_SECOND)
                outputs += subsystem.tick(ctx)
        self._t_ms = t_ms
        return outputs

    def apply(self, event: InputEvent) -> list[OutputEvent]:
        """Deliver an input event at the current sim time to every subsystem, in order."""
        outputs: list[OutputEvent] = []
        for subsystem in self._subsystems:
            outputs += subsystem.handle(event, self._context(subsystem, 0.0))
        return outputs

    def snapshot(self) -> WorldState:
        return WorldState(
            seed=self._seed,
            epoch_unix_ms=self._epoch_unix_ms,
            t_ms=self._t_ms,
            rng=self._streams.get_state(),
            subsystems={s.name: s.get_state() for s in self._subsystems},
        )

    def state_hash(self) -> str:
        return io.state_hash(self.snapshot())

    def _context(self, subsystem: Subsystem, dt_s: float) -> Context:
        return Context(self._t_ms, dt_s, self.instant, self._streams.get(subsystem.name))

    def _start_day(self) -> list[OutputEvent]:
        calendar = self._config.calendar
        today = self.instant.date
        yesterday = clock.unix_ms_to_datetime(
            self._epoch_unix_ms + self._t_ms - clock.MS_PER_DAY
        ).date()
        self._next_midnight_ms += clock.MS_PER_DAY
        outputs: list[OutputEvent] = [DayStarted(self._t_ms, today)]
        season = clock.season_of(today, calendar)
        if season != clock.season_of(yesterday, calendar):
            outputs.append(SeasonStarted(self._t_ms, season))
        return outputs
