"""Events crossing the sim boundary.

Input events are how the real world reaches the sim, through ``World.apply(event)``.
Output events are returned by ``World.step`` and ``World.apply``; the sim never pushes
them anywhere.
"""

from __future__ import annotations

import datetime as dt
from dataclasses import dataclass

from lineage_sim.clock import Season

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
    """The covered switch was flipped. Which powers exist and their effects arrive in M8."""

    power: str


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
