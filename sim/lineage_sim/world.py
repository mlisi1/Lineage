"""World: owns the clock, the random streams and the subsystems.

Time advances only through ``step(dt)``; the real world arrives only through
``apply(event)``. Both return output events instead of pushing them anywhere.

Scheduling: a subsystem with period ``p`` (``[schedule]`` in the config) ticks at sim
times ``p, 2p, 3p, …``; UTC midnights emit ``DayStarted`` (and ``SeasonStarted`` when the
season changes). Within one ``step`` everything due is processed in time order, ties
broken by calendar first, then subsystem registration order. Because tick times are
absolute, any way of chunking the same total time gives a bit-identical world.

Observers (the apocalypse, then the chronicle) see each batch of outputs right after it is
produced, at the same sim time, and add their own; each also sees what the observers
before it added.

Worlds end (M10, ADR 0018). When the apocalypse reports ``WorldCollapsed``, the World
archives itself (``WorldEnded`` carries the final state), then becomes the next world at
once: a new seed, its creation instant the end of the last (so the calendar runs on), sim
time back to 0, the world number one higher (``WorldBegan``). Output events carry their
own world's sim time. ``advance_to`` targets the current world's time: past an ending, the
time left over is spent in the next world.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Sequence

from lineage_sim import clock
from lineage_sim.apocalypse import Apocalypse
from lineage_sim.chronicle import Chronicle
from lineage_sim.config import Config
from lineage_sim.events import (
    DayStarted,
    InputEvent,
    OutputEvent,
    SeasonStarted,
    WorldBegan,
    WorldCollapsed,
    WorldEnded,
)
from lineage_sim.fauna.population import Fauna
from lineage_sim.flora import Flora, Wildfire
from lineage_sim.presence import Presence
from lineage_sim.rng import (
    APOCALYPSE,
    CHRONICLE,
    FAUNA,
    FIRE,
    FLORA,
    PRESENCE,
    SPECIES,
    TERRAIN,
    WEATHER,
    Streams,
)
from lineage_sim.species import Species
from lineage_sim.state import io
from lineage_sim.state.schema import StateError, Tree, WorldState
from lineage_sim.subsystem import Context, Observer, Subsystem
from lineage_sim.terrain import Terrain
from lineage_sim.weather import Weather

__all__ = ["Context", "Observer", "Subsystem", "World", "default_subsystems"]


def default_subsystems(config: Config) -> list[Subsystem]:
    """The subsystems of a real world, in tick order."""
    terrain = Terrain(config.terrain)
    flora = Flora(config.flora, terrain)
    fire = Wildfire(config.flora, flora, terrain)
    fauna = Fauna(config.fauna, terrain, flora, fire)
    # The weather before the fire, which strikes and spreads by it (R4).
    weather = Weather(config.weather, fire)
    species = Species(config.species, fauna, config.fauna.predator_min_diet)
    # Presence first: it hands the others the light before they tick.
    presence = Presence(config.presence, terrain, flora, fire, fauna)
    # The apocalypse watches for the last death; the chronicle, after it, tells of the end.
    apocalypse = Apocalypse(config.apocalypse)
    # The chronicle last: it reads the others after they ticked.
    chronicle = Chronicle(
        config.chronicle,
        terrain,
        flora,
        fauna,
        species,
        presence,
        landmass_min_cells=config.terrain.landmass_min_cells,
        herbivore_max_diet=config.fauna.herbivore_max_diet,
        predator_min_diet=config.fauna.predator_min_diet,
    )
    return [presence, weather, terrain, flora, fire, fauna, species, apocalypse, chronicle]


# Makes the subsystems of a new world (the next one, after an apocalypse).
Factory = Callable[[Config], list[Subsystem]]


def _parts(
    config: Config, subsystems: Sequence[Subsystem] | None, factory: Factory | None
) -> tuple[list[Subsystem], Factory | None]:
    """A world's subsystems and the factory of its successors' (see `World.create`)."""
    if subsystems is not None:
        return list(subsystems), factory
    factory = default_subsystems if factory is None else factory
    return factory(config), factory


class World:
    def __init__(
        self,
        config: Config,
        state: WorldState,
        subsystems: Sequence[Subsystem],
        factory: Factory | None,
    ) -> None:
        """Use `World.create` or `World.restore`. ``factory`` makes the next world's
        subsystems; ``None`` (a world of hand-picked subsystems) cannot start over."""
        self._config = config
        self._factory = factory
        self._load(state, subsystems)

    def _load(self, state: WorldState, subsystems: Sequence[Subsystem]) -> None:
        names = [s.name for s in subsystems]
        if len(set(names)) != len(names):
            raise ValueError(f"duplicate subsystem names in {names}")
        self._seed = state.seed
        self._epoch_unix_ms = state.epoch_unix_ms
        self._t_ms = state.t_ms
        self._world = state.world
        self._worlds = list(state.worlds)
        self._streams = Streams(state.seed)
        self._streams.set_state(state.rng)
        self._subsystems = list(subsystems)
        self._observers = [s for s in self._subsystems if isinstance(s, Observer)]
        self._periods_ms = [self._config.period_ms(name) for name in names]
        self._next_tick_ms = [(self._t_ms // p + 1) * p for p in self._periods_ms]
        self._next_midnight_ms = clock.next_midnight_t_ms(self._epoch_unix_ms, self._t_ms)

    @classmethod
    def create(
        cls,
        config: Config,
        seed: int,
        epoch_unix_ms: int,
        subsystems: Sequence[Subsystem] | None = None,
        factory: Factory | None = None,
    ) -> tuple[World, list[OutputEvent]]:
        """A new world at sim time 0, and the outputs of initialising its subsystems.

        Without ``subsystems`` they come from ``factory`` (default: the real world's);
        ``factory`` also makes the next world's after an apocalypse.
        """
        subs, factory = _parts(config, subsystems, factory)
        state = WorldState(seed=seed, epoch_unix_ms=epoch_unix_ms, t_ms=0)
        world = cls(config, state, subs, factory)
        return world, world._initialize([])

    @classmethod
    def restore(
        cls,
        config: Config,
        state: WorldState,
        subsystems: Sequence[Subsystem] | None = None,
        factory: Factory | None = None,
    ) -> World:
        """A world continuing exactly from ``state``.

        A subsystem the save does not know (it was added after the save was written) is
        initialised fresh at the save's sim time, from its own random stream.
        """
        subs, factory = _parts(config, subsystems, factory)
        unknown = sorted(set(state.subsystems) - {s.name for s in subs})
        if unknown:
            raise StateError(f"save has subsystems {unknown} that this world does not")
        world = cls(config, state, subs, factory)
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

    @property
    def unix_ms(self) -> int:
        """The current instant as Unix milliseconds (the desk's clock, across worlds)."""
        return self._epoch_unix_ms + self._t_ms

    @property
    def number(self) -> int:
        """The world's number: 1 for the first continent, one more after each apocalypse."""
        return self._world

    @property
    def past_worlds(self) -> list[Tree]:
        """A record of every world that ended before this one, oldest first (see
        `WorldState.worlds`)."""
        return [dict(record) for record in self._worlds]

    @property
    def apocalypse(self) -> Apocalypse:
        apocalypse = self.subsystem(APOCALYPSE)
        if not isinstance(apocalypse, Apocalypse):
            raise TypeError("the apocalypse subsystem was replaced")
        return apocalypse

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
    def presence(self) -> Presence:
        presence = self.subsystem(PRESENCE)
        if not isinstance(presence, Presence):
            raise TypeError("the presence subsystem was replaced")
        return presence

    @property
    def weather(self) -> Weather:
        weather = self.subsystem(WEATHER)
        if not isinstance(weather, Weather):
            raise TypeError("the weather subsystem was replaced")
        return weather

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
        """Advance sim time to ``t_ms``, processing everything due on the way. If the world
        ends on the way, the rest of the time passes in the next one."""
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
                due = self._start_day()
            else:
                subsystem = self._subsystems[index]
                period_ms = self._periods_ms[index]
                self._next_tick_ms[index] += period_ms
                ctx = self._context(subsystem, period_ms / clock.MS_PER_SECOND)
                due = subsystem.tick(ctx)
            ended_ms = self._t_ms
            outputs += self._settle(due)
            if self._t_ms < ended_ms:  # a new world began: its clock starts at 0
                t_ms -= ended_ms
        self._t_ms = t_ms
        return outputs

    def advance_to_unix(self, unix_ms: int) -> list[OutputEvent]:
        """Advance to the instant ``unix_ms``, whichever world is living then (a caller
        that follows the wall clock, like the server, need not track world changes)."""
        return self.advance_to(unix_ms - self._epoch_unix_ms)

    def apply(self, event: InputEvent) -> list[OutputEvent]:
        """Deliver an input event at the current sim time to every subsystem, in order."""
        outputs: list[OutputEvent] = []
        for subsystem in self._subsystems:
            outputs += subsystem.handle(event, self._context(subsystem, 0.0))
        return self._settle(outputs)

    def snapshot(self) -> WorldState:
        return WorldState(
            seed=self._seed,
            epoch_unix_ms=self._epoch_unix_ms,
            t_ms=self._t_ms,
            rng=self._streams.get_state(),
            subsystems={s.name: s.get_state() for s in self._subsystems},
            world=self._world,
            worlds=self.past_worlds,
        )

    def state_hash(self) -> str:
        return io.state_hash(self.snapshot())

    @property
    def chronicle(self) -> Chronicle:
        chronicle = self.subsystem(CHRONICLE)
        if not isinstance(chronicle, Chronicle):
            raise TypeError("the chronicle subsystem was replaced")
        return chronicle

    def witness(self, outputs: list[OutputEvent]) -> list[OutputEvent]:
        """What the observers make of ``outputs`` made outside a step (a tool staging an
        event by the subsystems' own functions), as they would of the step's own: the flora
        bares the land round a staged cone, the chronicle writes it down."""
        return self._observe(list(outputs))

    def _observe(self, outputs: list[OutputEvent]) -> list[OutputEvent]:
        """What the observers make of ``outputs`` (nothing to see: no call). Each observer
        also sees what the ones before it added."""
        if not outputs:
            return []
        seen: list[OutputEvent] = []
        for observer in self._observers:
            seen += observer.observe(outputs + seen, self._context(observer, 0.0))
        return seen

    def _settle(self, batch: list[OutputEvent]) -> list[OutputEvent]:
        """``batch``, what the observers make of it, and the next world if this one
        collapsed."""
        outputs = batch + self._observe(batch)
        for output in outputs:
            if isinstance(output, WorldCollapsed):
                return outputs + self._start_over(output)
        return outputs

    def _initialize(self, outputs: list[OutputEvent]) -> list[OutputEvent]:
        """Initialise every subsystem at time 0; the observers see ``outputs`` (the news
        of the world's beginning) with what initialising gave."""
        for subsystem in self._subsystems:
            outputs = outputs + subsystem.initialize(self._context(subsystem, 0.0))
        return outputs + self._observe(outputs)

    def _start_over(self, collapse: WorldCollapsed) -> list[OutputEvent]:
        """Archive this world and become the next one, from ``collapse.next_seed``."""
        if self._factory is None:
            raise RuntimeError("a world of hand-picked subsystems cannot start over")
        archive = self.snapshot()
        ended = WorldEnded(self._t_ms, self._world, self._seed, collapse.cause, archive)
        census = [s for s in self._subsystems if isinstance(s, Species)]
        record: Tree = {
            "world": self._world,
            "seed": self._seed,
            "began_unix_ms": self._epoch_unix_ms,
            "ended_unix_ms": self._epoch_unix_ms + self._t_ms,
            "cause": collapse.cause,
            "species": len(census[0].records()) if census else 0,
        }
        epoch_unix_ms = self._epoch_unix_ms + self._t_ms
        state = WorldState(
            seed=collapse.next_seed,
            epoch_unix_ms=epoch_unix_ms,
            t_ms=0,
            world=self._world + 1,
            worlds=[*self._worlds, record],
        )
        self._load(state, self._factory(self._config))
        began = WorldBegan(0, self._world, self._seed, epoch_unix_ms)
        return [ended, *self._initialize([began])]

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
