"""Synthetic presence schedules for fast-forward runs: when the owner arrives and leaves.

The device gets `PresenceChanged` events from its PIR sensor; a fast-forward run gets them
from one of these schedules instead (ADR 0011), so the island is tuned in the light it
will have. Times are UTC hours of the sim day. Each day's events come from a generator
seeded by (world seed, day number), so a day replayed after a power cut gets exactly the
same events.

- ``always``: present all the time (no events; the island stays lit, as before M8).
- ``office``: weekdays at the desk from about 9:00 to about 18:00, with some spread;
  now and then a weekday away (illness, travel); weekends away: the Long Night.
- ``office-august``: ``office``, and away for the whole of August.
- ``conference``: ``office``, and away for three weeks from 1 October.
"""

from __future__ import annotations

import datetime as dt

import numpy as np

# Office hours (UTC hours of the day) and their spread (standard deviation, hours).
ARRIVE_H, ARRIVE_SPREAD_H = 9.0, 0.5
LEAVE_H, LEAVE_SPREAD_H = 18.0, 0.75
# Share of weekdays the owner does not come in at all.
WEEKDAY_AWAY = 0.05
CONFERENCE_START = (10, 1)  # month, day
CONFERENCE_DAYS = 21

SCHEDULES = ("always", "office", "office-august", "conference")

Event = tuple[float, bool]  # (hour of the day, present)


def _away_all_day(schedule: str, day: dt.date) -> bool:
    if schedule == "office-august" and day.month == 8:
        return True
    if schedule == "conference":
        start = dt.date(day.year, *CONFERENCE_START)
        return start <= day < start + dt.timedelta(days=CONFERENCE_DAYS)
    return False


def day_events(schedule: str, seed: int, day_index: int, day: dt.date) -> list[Event]:
    """The owner's arrivals and departures on ``day`` (the ``day_index``-th of the run),
    in time order. ``always`` has none."""
    if schedule not in SCHEDULES:
        raise ValueError(f"unknown schedule {schedule!r}; known: {', '.join(SCHEDULES)}")
    if schedule == "always":
        return []
    rng = np.random.Generator(np.random.PCG64([seed, day_index]))
    away_today = rng.random() < WEEKDAY_AWAY
    arrive = float(np.clip(rng.normal(ARRIVE_H, ARRIVE_SPREAD_H), 6.0, 12.0))
    leave = float(np.clip(rng.normal(LEAVE_H, LEAVE_SPREAD_H), 14.0, 23.0))
    if day.weekday() >= 5 or away_today or _away_all_day(schedule, day):
        return []
    return [(arrive, True), (leave, False)]


def starts_present(schedule: str) -> bool:
    """Whether the owner is at the desk when a world is created (at midnight)."""
    return schedule == "always"
