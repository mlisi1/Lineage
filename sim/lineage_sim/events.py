"""Events crossing the sim boundary.

Input events are how the real world reaches the sim, through ``World.apply(event)``.
Output events are returned by ``World.step`` and ``World.apply``; the sim never pushes
them anywhere.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from lineage_sim.clock import Season
from lineage_sim.state.schema import WorldState

# --- Input events -----------------------------------------------------------------------


@dataclass(frozen=True)
class InputEvent:
    """Base of every input event."""


@dataclass(frozen=True)
class PresenceChanged(InputEvent):
    """The owner arrived at (True) or left (False) the desk; hold logic is upstream."""

    present: bool


@dataclass(frozen=True)
class GodPower(InputEvent):
    """The god-power button was pressed (M8). The island chooses which power fires unless
    ``power`` names one (``presence.Power`` values: tests, or a future phone app)."""

    power: str = ""


@dataclass(frozen=True)
class PowerLost(InputEvent):
    """Mains power was lost; the device is running on its UPS."""


@dataclass(frozen=True)
class PowerRestored(InputEvent):
    """Mains power came back."""


# --- Output events ----------------------------------------------------------------------


@dataclass(frozen=True)
class OutputEvent:
    """Base of every output event: something that happened at sim time ``t_ms``."""

    t_ms: int


@dataclass(frozen=True)
class DayStarted(OutputEvent):
    """A UTC calendar day began."""

    date: dt.date


@dataclass(frozen=True)
class SeasonStarted(OutputEvent):
    """A season began (always at the start of a UTC day)."""

    season: Season


@dataclass(frozen=True)
class VolcanoErupted(OutputEvent):
    """A volcano built a cone centred on cell (x, y)."""

    x: float
    y: float
    radius_cells: float
    height: float


@dataclass(frozen=True)
class EarthquakeStruck(OutputEvent):
    """A fault through cell (x, y) slipped by ``throw`` height units."""

    x: float
    y: float
    radius_cells: float
    throw: float


@dataclass(frozen=True)
class CraterFormed(OutputEvent):
    """A meteor dug a crater centred on cell (x, y)."""

    x: float
    y: float
    radius_cells: float
    depth: float


@dataclass(frozen=True)
class LandmassSplit(OutputEvent):
    """One landmass became ``parts`` separate landmasses (sea rose or land sank)."""

    parts: int
    landmasses: int  # total landmasses afterwards


@dataclass(frozen=True)
class LandmassesRejoined(OutputEvent):
    """``parts`` landmasses merged into one (a strait closed)."""

    parts: int
    landmasses: int  # total landmasses afterwards


@dataclass(frozen=True)
class FireStarted(OutputEvent):
    """Lightning set vegetation alight at cell (x, y)."""

    x: float
    y: float


@dataclass(frozen=True)
class FireEnded(OutputEvent):
    """A fire went out after burning ``cells`` cells over ``hours`` sim-hours."""

    cells: int
    hours: float


@dataclass(frozen=True)
class CreaturesArrived(OutputEvent):
    """A group of one new species landed near cell (x, y): the founders of an empty
    world, or strangers joining an inhabited one. Their ids start at ``first_id``."""

    count: int
    founders: bool
    x: float
    y: float
    first_id: int


@dataclass(frozen=True)
class CreaturesDied(OutputEvent):
    """Creatures died in one tick (R5: the scene shows each death by its cause). Each id in
    ``ids`` died of the cause at the same place in ``causes``: ``starved``, ``old_age``,
    ``killed`` (by a hunter), ``drowned``, ``burnt`` or ``blast`` (a meteor, or a cone or
    crater rising under it)."""

    ids: tuple[int, ...]
    causes: tuple[str, ...]
    #: For each id, the hunter that killed it (R5: the scene shows the hunt), -1 for a death
    #: of another cause or a blast's; empty from callers that do not say.
    killers: tuple[int, ...] = ()


@dataclass(frozen=True)
class CreaturesBorn(OutputEvent):
    """Creatures were born on the island in one tick (R5: the scene shows each beside its
    parent). Each id in ``ids`` was born to the mother (the parent whose place and learned
    preferences it takes; a clone's only parent) at the same place in ``parents``."""

    ids: tuple[int, ...]
    parents: tuple[int, ...]


@dataclass(frozen=True)
class PopulationExtinct(OutputEvent):
    """The last creature died."""


@dataclass(frozen=True)
class JuvenileGrown(OutputEvent):
    """A creature's youth ended: it reached breeding age, or died before it (``died``).

    Records how it fed while young: energy eaten and burnt from birth (or arrival) to
    now, and the age at which it became competent (its day-averaged energy balance
    stopped being negative), -1 if it never did. Generation 0 arrived from elsewhere.
    """

    creature_id: int
    generation: int
    age_h: float
    eaten: float
    burnt: float
    competent_h: float
    died: bool


@dataclass(frozen=True)
class SpeciesBorn(OutputEvent):
    """A species appeared with ``members`` creatures: a group that arrived from elsewhere
    (``parent`` 0), or one that split off species ``parent`` on the island."""

    species_id: int
    name: str
    parent: int
    members: int


@dataclass(frozen=True)
class SpeciesExtinct(OutputEvent):
    """The last creature of a species died; it had lived since ``born_t_ms``."""

    species_id: int
    name: str
    born_t_ms: int


@dataclass(frozen=True)
class GodPowerUsed(OutputEvent):
    """A god power fired (``presence.Power`` value), aimed at cell (x, y); its effects
    come as their own events (``CraterFormed``, ``FireEnded``, ``CreaturesArrived``)."""

    power: str
    x: float
    y: float


@dataclass(frozen=True)
class GodPowerRefused(OutputEvent):
    """The button was pressed while the powers were cooling down, until ``ready_t_ms``."""

    ready_t_ms: int


@dataclass(frozen=True)
class GodPowerReady(OutputEvent):
    """The cooldown is over: the button works again (the LED's cue)."""


@dataclass(frozen=True)
class WorldCollapsed(OutputEvent):
    """Life on the island has collapsed (M10): the world ends at this instant. Reported by
    the apocalypse; the World then archives this world and starts the next one, from
    ``next_seed``."""

    cause: str
    next_seed: int


@dataclass(frozen=True)
class WorldEnded(OutputEvent):
    """World number ``world`` (from 1), grown from ``seed``, ended at its sim time
    ``t_ms``. ``archive`` is its final state, saved like any other (``state.io.dumps``)
    and loadable after later schema bumps."""

    world: int
    seed: int
    cause: str
    archive: WorldState


@dataclass(frozen=True)
class WorldBegan(OutputEvent):
    """World number ``world`` began from ``seed``: a new continent, created at
    ``epoch_unix_ms`` (the instant the last one ended). Its sim time starts at 0."""

    world: int
    seed: int
    epoch_unix_ms: int


@dataclass(frozen=True)
class ChronicleEntry(OutputEvent):
    """A line of the island's history (M9): entry ``number`` (from 1) of the chronicle.

    ``importance`` runs from 1 (background) through 3 (notable) to 5 (historic); entries
    at the config's ``major_importance`` and above are pushed to the phone (S4).
    ``species`` is the species it is about (0: none); (x, y) the cell where it happened,
    (-1, -1) when it has no one place.
    """

    number: int
    kind: str
    importance: int
    text: str
    species: int
    x: float
    y: float
