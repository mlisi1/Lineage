"""Calendar, seasons, leap years and day boundaries from injected time."""

import datetime as dt
from dataclasses import replace

import pytest
from hypothesis import given
from hypothesis import strategies as st
from lineage_sim import clock
from lineage_sim.clock import MS_PER_DAY, Season
from lineage_sim.config import Config, Hemisphere

# Unix ms covering 1970–2200, well past any device lifetime.
UNIX_MS = st.integers(min_value=0, max_value=7_258_118_400_000)
DATES = st.dates(min_value=dt.date(1971, 1, 1), max_value=dt.date(2199, 12, 31))


def _instant(config: Config, when: dt.datetime) -> clock.Instant:
    unix_ms = round(when.timestamp() * 1000)
    return clock.instant(unix_ms, 0, config.calendar)


@pytest.mark.parametrize(
    ("day", "season"),
    [
        (dt.date(2026, 3, 19), Season.WINTER),
        (dt.date(2026, 3, 20), Season.SPRING),
        (dt.date(2026, 6, 20), Season.SPRING),
        (dt.date(2026, 6, 21), Season.SUMMER),
        (dt.date(2026, 9, 21), Season.SUMMER),
        (dt.date(2026, 9, 22), Season.AUTUMN),
        (dt.date(2026, 12, 20), Season.AUTUMN),
        (dt.date(2026, 12, 21), Season.WINTER),
        (dt.date(2027, 1, 1), Season.WINTER),
    ],
)
def test_astronomical_seasons(config: Config, day: dt.date, season: Season) -> None:
    assert clock.season_of(day, config.calendar) is season


def test_southern_hemisphere_swaps_seasons(config: Config) -> None:
    south = replace(config.calendar, hemisphere=Hemisphere.SOUTH)
    assert clock.season_of(dt.date(2026, 1, 15), south) is Season.SUMMER
    assert clock.season_of(dt.date(2026, 4, 15), south) is Season.AUTUMN
    assert clock.season_of(dt.date(2026, 7, 15), south) is Season.WINTER
    assert clock.season_of(dt.date(2026, 10, 15), south) is Season.SPRING


def test_instant_fields(config: Config) -> None:
    # Saturday 2028-02-29 18:30 UTC, a leap day.
    now = _instant(config, dt.datetime(2028, 2, 29, 18, 30, tzinfo=dt.UTC))
    assert now.date == dt.date(2028, 2, 29)
    assert now.weekday == 1  # Tuesday
    assert not now.is_weekend
    assert now.day_of_year == 60
    assert now.days_in_year == 366
    assert now.ms_of_day == (18 * 3600 + 30 * 60) * 1000
    assert now.iso_week == 9
    assert now.season is Season.WINTER


def test_weekend(config: Config) -> None:
    assert _instant(config, dt.datetime(2026, 10, 10, tzinfo=dt.UTC)).is_weekend  # Saturday
    assert _instant(config, dt.datetime(2026, 10, 11, 23, tzinfo=dt.UTC)).is_weekend
    assert not _instant(config, dt.datetime(2026, 10, 12, tzinfo=dt.UTC)).is_weekend


def test_year_end_in_leap_and_common_years(config: Config) -> None:
    leap = _instant(config, dt.datetime(2028, 12, 31, 12, tzinfo=dt.UTC))
    common = _instant(config, dt.datetime(2027, 12, 31, 12, tzinfo=dt.UTC))
    assert (leap.day_of_year, leap.days_in_year) == (366, 366)
    assert (common.day_of_year, common.days_in_year) == (365, 365)
    assert (
        _instant(config, dt.datetime(2100, 3, 1, tzinfo=dt.UTC)).day_of_year == 60
    )  # 2100 not leap


def test_next_midnight() -> None:
    epoch = round(dt.datetime(2026, 3, 1, 22, tzinfo=dt.UTC).timestamp() * 1000)
    assert clock.next_midnight_t_ms(epoch, 0) == 2 * 3600 * 1000
    # Exactly at midnight, the next one is a full day later.
    assert clock.next_midnight_t_ms(epoch, 2 * 3600 * 1000) == 2 * 3600 * 1000 + MS_PER_DAY


@given(epoch=UNIX_MS, t=UNIX_MS)
def test_instant_depends_only_on_absolute_time(config: Config, epoch: int, t: int) -> None:
    # No time zones, no DST: only epoch + t matters.
    a = clock.instant(epoch, t, config.calendar)
    b = clock.instant(epoch + t, 0, config.calendar)
    assert (a.date, a.ms_of_day, a.season, a.year_fraction) == (
        b.date,
        b.ms_of_day,
        b.season,
        b.year_fraction,
    )


@given(unix_ms=UNIX_MS)
def test_instant_invariants(config: Config, unix_ms: int) -> None:
    now = clock.instant(unix_ms, 0, config.calendar)
    reference = dt.datetime.fromtimestamp(unix_ms / 1000, tz=dt.UTC)
    assert now.date == reference.date()
    assert now.weekday == reference.weekday()
    assert 0 <= now.ms_of_day < MS_PER_DAY
    assert 0.0 <= now.year_fraction < 1.0
    assert 0.0 <= now.season_progress < 1.0
    assert 1 <= now.day_of_year <= now.days_in_year
    assert now.days_in_year in (365, 366)


@given(day=DATES)
def test_season_changes_only_on_configured_dates(config: Config, day: dt.date) -> None:
    cal = config.calendar
    starts = {
        (cal.spring_start.month, cal.spring_start.day): Season.SPRING,
        (cal.summer_start.month, cal.summer_start.day): Season.SUMMER,
        (cal.autumn_start.month, cal.autumn_start.day): Season.AUTUMN,
        (cal.winter_start.month, cal.winter_start.day): Season.WINTER,
    }
    today = clock.season_of(day, cal)
    yesterday = clock.season_of(day - dt.timedelta(days=1), cal)
    expected = starts.get((day.month, day.day))
    if expected is None:
        assert today is yesterday
    else:
        assert today is expected
        assert yesterday is not expected


@given(day=DATES)
def test_season_progress_restarts_at_boundaries(config: Config, day: dt.date) -> None:
    season, start, end = clock.season_bounds(day, config.calendar)
    assert start <= day < end
    assert 85 <= (end - start).days <= 95
    first = clock.instant(clock.date_to_unix_ms(start), 0, config.calendar)
    assert first.season is season
    assert first.season_progress == 0.0
