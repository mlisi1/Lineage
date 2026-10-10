"""Sim time, calendar and seasons.

Sim time is an integer number of milliseconds since world creation (``t_ms``). The world's
creation instant (``epoch_unix_ms``) is injected by the caller; the sim never reads the
clock. Calendar fields are computed in UTC, so daylight saving time never applies.
Seasons are astronomical, with start dates from ``[calendar]`` in the config.
"""

from __future__ import annotations

import datetime as dt
import itertools
from dataclasses import dataclass
from enum import Enum

from lineage_sim.config import CalendarConfig, Hemisphere, MonthDay

MS_PER_SECOND = 1000
MS_PER_DAY = 86_400 * MS_PER_SECOND
# Julian year: the unit behind every "per year" rate in the config.
SECONDS_PER_YEAR = 365.25 * 86_400
_UNIX_EPOCH = dt.datetime(1970, 1, 1, tzinfo=dt.UTC)
_SATURDAY = 5


class Season(Enum):
    SPRING = "spring"
    SUMMER = "summer"
    AUTUMN = "autumn"
    WINTER = "winter"


_SOUTHERN = {
    Season.SPRING: Season.AUTUMN,
    Season.SUMMER: Season.WINTER,
    Season.AUTUMN: Season.SPRING,
    Season.WINTER: Season.SUMMER,
}


@dataclass(frozen=True)
class Instant:
    """Calendar view of one sim time."""

    t_ms: int
    unix_ms: int
    date: dt.date
    ms_of_day: int
    weekday: int  # 0 = Monday … 6 = Sunday
    iso_week: int
    day_of_year: int  # 1-based
    days_in_year: int  # 365 or 366
    year_fraction: float  # [0, 1): elapsed share of the calendar year
    season: Season
    season_progress: float  # [0, 1): elapsed share of the current season

    @property
    def is_weekend(self) -> bool:
        return self.weekday >= _SATURDAY


def unix_ms_to_datetime(unix_ms: int) -> dt.datetime:
    return _UNIX_EPOCH + dt.timedelta(milliseconds=unix_ms)


def date_to_unix_ms(day: dt.date) -> int:
    """Unix milliseconds of UTC midnight at the start of ``day``."""
    return (day - _UNIX_EPOCH.date()).days * MS_PER_DAY


def _on(year: int, md: MonthDay) -> dt.date:
    return dt.date(year, md.month, md.day)


def season_bounds(day: dt.date, calendar: CalendarConfig) -> tuple[Season, dt.date, dt.date]:
    """Season of ``day`` and its [start, end) dates, end being the next season's start."""
    y = day.year
    starts = (
        (Season.WINTER, _on(y - 1, calendar.winter_start)),
        (Season.SPRING, _on(y, calendar.spring_start)),
        (Season.SUMMER, _on(y, calendar.summer_start)),
        (Season.AUTUMN, _on(y, calendar.autumn_start)),
        (Season.WINTER, _on(y, calendar.winter_start)),
        (Season.SPRING, _on(y + 1, calendar.spring_start)),
    )
    for (season, start), (_, end) in itertools.pairwise(starts):
        if start <= day < end:
            if calendar.hemisphere is Hemisphere.SOUTH:
                season = _SOUTHERN[season]
            return season, start, end
    raise AssertionError(f"no season contains {day}")  # unreachable: bounds cover the year


def season_of(day: dt.date, calendar: CalendarConfig) -> Season:
    return season_bounds(day, calendar)[0]


def instant(epoch_unix_ms: int, t_ms: int, calendar: CalendarConfig) -> Instant:
    """Calendar view of sim time ``t_ms`` in a world created at ``epoch_unix_ms``."""
    unix_ms = epoch_unix_ms + t_ms
    day_start_ms = unix_ms - unix_ms % MS_PER_DAY
    day = unix_ms_to_datetime(day_start_ms).date()

    year_start_ms = date_to_unix_ms(dt.date(day.year, 1, 1))
    year_end_ms = date_to_unix_ms(dt.date(day.year + 1, 1, 1))
    season, start, end = season_bounds(day, calendar)
    season_start_ms, season_end_ms = date_to_unix_ms(start), date_to_unix_ms(end)

    return Instant(
        t_ms=t_ms,
        unix_ms=unix_ms,
        date=day,
        ms_of_day=unix_ms - day_start_ms,
        weekday=day.weekday(),
        iso_week=day.isocalendar().week,
        day_of_year=day.timetuple().tm_yday,
        days_in_year=(year_end_ms - year_start_ms) // MS_PER_DAY,
        year_fraction=(unix_ms - year_start_ms) / (year_end_ms - year_start_ms),
        season=season,
        season_progress=(unix_ms - season_start_ms) / (season_end_ms - season_start_ms),
    )


def next_midnight_t_ms(epoch_unix_ms: int, t_ms: int) -> int:
    """Sim time of the first UTC midnight strictly after ``t_ms``."""
    unix_ms = epoch_unix_ms + t_ms
    return unix_ms - unix_ms % MS_PER_DAY + MS_PER_DAY - epoch_unix_ms
