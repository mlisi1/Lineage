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
