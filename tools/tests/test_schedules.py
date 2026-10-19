"""Synthetic presence schedules for fast-forward runs (M8)."""

from __future__ import annotations

import datetime as dt

import pytest

from tools.schedules import CONFERENCE_DAYS, SCHEDULES, day_events, starts_present

MONDAY = dt.date(2026, 10, 19)


def test_always_has_no_events_and_starts_present() -> None:
    assert day_events("always", 1, 0, MONDAY) == []
    assert starts_present("always")
    assert not any(starts_present(s) for s in SCHEDULES if s != "always")


def test_office_days_and_weekends() -> None:
    weekdays = [day_events("office", 1, k, MONDAY + dt.timedelta(k)) for k in range(5)]
    assert sum(bool(events) for events in weekdays) >= 4  # a weekday away is rare
    for events in weekdays:
        if events:
            (arrive, present), (leave, gone) = events
            assert present
            assert not gone
            assert 6.0 <= arrive < leave <= 23.0
    for k in (5, 6):
        assert day_events("office", 1, k, MONDAY + dt.timedelta(k)) == []


def test_a_day_replays_the_same_events() -> None:
    assert day_events("office", 7, 40, MONDAY) == day_events("office", 7, 40, MONDAY)
    assert day_events("office", 7, 40, MONDAY) != day_events("office", 8, 40, MONDAY)


def test_holidays() -> None:
    august = [dt.date(2027, 8, d) for d in range(1, 32)]
    assert all(day_events("office-august", 2, k, day) == [] for k, day in enumerate(august))
    start = dt.date(2027, 10, 1)
    away = [start + dt.timedelta(k) for k in range(CONFERENCE_DAYS)]
    assert all(day_events("conference", 2, k, day) == [] for k, day in enumerate(away))
    back = start + dt.timedelta(CONFERENCE_DAYS)  # a Friday
    assert day_events("conference", 2, 0, back) == day_events("office", 2, 0, back)


def test_unknown_schedule() -> None:
    with pytest.raises(ValueError, match="unknown schedule"):
        day_events("nightshift", 0, 0, MONDAY)
