"""Weather (R4): the island's own rain, its thunder, and the storms that light fires."""

from __future__ import annotations

import datetime as dt
import itertools
from dataclasses import replace
from typing import cast

import pytest
from lineage_sim import clock
from lineage_sim.config import Config, ConfigError, parse_config
from lineage_sim.flora import Wildfire
from lineage_sim.state.schema import StateError
from lineage_sim.subsystem import Context
from lineage_sim.weather import Rain, Weather
from numpy.random import PCG64, Generator

HOUR_S = 3600.0
SEASON_DAYS = {"spring": dt.date(2026, 4, 15), "summer": dt.date(2026, 7, 15),
               "autumn": dt.date(2026, 10, 15), "winter": dt.date(2026, 1, 15)}  # fmt: skip


class Sky:
    """Stands in for the fire: what the weather told it last."""

    def __init__(self) -> None:
        self.raining = False
        self.storm = False

    def set_weather(self, raining: bool, storm: bool) -> None:
        self.raining, self.storm = raining, storm


FALLING = (Rain.RAIN, Rain.THUNDER, Rain.STORM)


def _clear(config: Config) -> Config:
    """``config`` without overcast spells: what the rain tests measure is the rain alone."""
    return replace(config, weather=replace(config.weather, cloud_spells_per_month=0.0))


def _weather(config: Config) -> tuple[Weather, Sky]:
    sky = Sky()
    return Weather(config.weather, cast(Wildfire, sky)), sky


def _ticks(
    weather: Weather, config: Config, day: dt.date, hours: int, sky: Sky | None = None
) -> list[tuple[Rain, int]]:
    """The rain and the spell's end (sim ms) after each of ``hours`` hourly ticks, the
    calendar held at ``day``; with ``sky``, also checks what the fire was told each hour."""
    rng = Generator(PCG64(3))
    instant = clock.instant(clock.date_to_unix_ms(day), 0, config.calendar)
    seen: list[tuple[Rain, int]] = []
    for hour in range(1, hours + 1):
        weather.tick(Context(hour * 3_600_000, HOUR_S, instant, rng))
        seen.append((weather.rain, int(weather.get_state()["until_ms"])))
        if sky is not None:
            assert sky.raining == (weather.rain in FALLING)
            assert sky.storm == (weather.rain is Rain.STORM)
    return seen


def _hours(weather: Weather, config: Config, day: dt.date, hours: int) -> list[Rain]:
    return [rain for rain, _ in _ticks(weather, config, day, hours)]


def _spells(seen: list[tuple[Rain, int]]) -> list[tuple[Rain, float]]:
    """Each spell that began: its kind and how many hours it was set to fall (a spell can
    follow another at once, so spells are told apart by when they end)."""
    spells: list[tuple[Rain, float]] = []
    last_end = 0
    for hour, (rain, until) in enumerate(seen, start=1):
        if rain is not Rain.NONE and until != last_end:
            spells.append((rain, (until - hour * 3_600_000) / 3_600_000))
            last_end = until
    return spells


@pytest.mark.parametrize("season", ["spring", "summer", "autumn", "winter"])
def test_spells_begin_at_the_seasons_rate(config: Config, season: str) -> None:
    config = _clear(config)
    weather, _ = _weather(config)
    hours = 24 * 365 * 8
    seen = _ticks(weather, config, SEASON_DAYS[season], hours)
    expected = weather.spells_per_month(clock.Season(season))
    # A spell can only begin in an hour when none is falling: the rate is per such hour.
    ends = [0] + [until for _, until in seen[:-1]]
    open_hours = sum(end <= hour * 3_600_000 for hour, end in enumerate(ends, start=1))
    per_month = len(_spells(seen)) / open_hours * 30 * 24
    assert per_month == pytest.approx(expected, rel=0.15)


def test_spells_last_as_long_as_configured_and_come_in_three_kinds(config: Config) -> None:
    config = _clear(config)
    cfg = config.weather
    weather, _ = _weather(config)
    spells = _spells(_ticks(weather, config, SEASON_DAYS["autumn"], 24 * 365 * 10))
    kinds = [kind for kind, _ in spells]
    assert len(spells) > 500
    storms = kinds.count(Rain.STORM) / len(kinds)
    thunder = kinds.count(Rain.THUNDER) / len(kinds)
    assert storms == pytest.approx(cfg.storm_share, abs=0.04)
    assert thunder == pytest.approx(cfg.thunder_share, abs=0.05)
    for kind, hours in spells:
        shortest, longest = (
            (cfg.storm_hours_min, cfg.storm_hours_max)
            if kind is Rain.STORM
            else (cfg.rain_hours_min, cfg.rain_hours_max)
        )
        assert shortest <= hours <= longest


def test_the_fire_is_told_the_weather_of_the_hour(config: Config) -> None:
    weather, sky = _weather(config)
    seen = _ticks(weather, config, SEASON_DAYS["spring"], 24 * 60, sky=sky)
    assert any(rain is not Rain.NONE for rain, _ in seen)


def test_no_rain_where_no_spell_is_due(config: Config) -> None:
    dry = replace(
        config,
        weather=replace(
            config.weather,
            rain_spells_per_month_spring=0.0,
            rain_spells_per_month_summer=0.0,
            rain_spells_per_month_autumn=0.0,
            rain_spells_per_month_winter=0.0,
        ),
    )
    weather, _ = _weather(dry)
    assert not set(_hours(weather, dry, SEASON_DAYS["autumn"], 24 * 365)) & set(FALLING)


def test_the_sky_clouds_over_between_rains_and_nothing_falls(config: Config) -> None:
    cfg = config.weather
    dry = replace(
        config,
        weather=replace(
            cfg,
            rain_spells_per_month_spring=0.0,
            rain_spells_per_month_summer=0.0,
            rain_spells_per_month_autumn=0.0,
            rain_spells_per_month_winter=0.0,
        ),
    )
    weather, sky = _weather(dry)
    seen = _ticks(weather, dry, SEASON_DAYS["summer"], 24 * 365 * 4, sky=sky)
    spells = _spells(seen)
    assert {kind for kind, _ in spells} == {Rain.CLOUD}
    # At the configured rate (a spell begins only in a clear hour), as long as configured.
    clear_hours = sum(rain is Rain.NONE for rain, _ in seen)
    per_month = len(spells) / clear_hours * 30 * 24
    assert per_month == pytest.approx(cfg.cloud_spells_per_month, rel=0.15)
    assert all(cfg.cloud_hours_min <= hours <= cfg.cloud_hours_max for _, hours in spells)
    # Clouds never wet the land: the fire was told dry every hour (checked in `_ticks`).
    assert not sky.raining


def test_rain_comes_out_of_a_clouded_sky(config: Config) -> None:
    weather, _ = _weather(config)
    rains = _hours(weather, config, SEASON_DAYS["autumn"], 24 * 365 * 2)
    after_cloud = [b for a, b in itertools.pairwise(rains) if a is Rain.CLOUD]
    assert any(rain in FALLING for rain in after_cloud)


def test_state_round_trips_and_tells_the_fire_again(config: Config) -> None:
    seen = _hours(_weather(config)[0], config, SEASON_DAYS["autumn"], 24 * 40)
    assert Rain.NONE in seen
    first_rain = next(hour for hour, rain in enumerate(seen) if rain is not Rain.NONE)
    # The same hours again, stopped while that rain falls.
    weather, _ = _weather(config)
    _hours(weather, config, SEASON_DAYS["autumn"], first_rain + 1)
    assert weather.rain is not Rain.NONE
    state = weather.get_state()
    again, sky = _weather(config)
    again.set_state(state)
    assert again.rain is weather.rain
    assert again.get_state() == state
    assert sky.raining  # restored, it tells the fire at once


@pytest.mark.parametrize(
    "tree",
    [{"rain": 7, "until_ms": 0}, {"rain": 1, "until_ms": 1.5}, {"rain": "x", "until_ms": 0}],
)
def test_bad_state_is_refused(config: Config, tree: dict[str, object]) -> None:
    weather, _ = _weather(config)
    with pytest.raises(StateError):
        weather.set_state(tree)


@pytest.mark.parametrize(
    ("line", "replacement", "message"),
    [
        ("storm_share = 0.12", "storm_share = 0.9", "thunder_share \\+ storm_share above 1"),
        ("rain_hours_max = 30.0", "rain_hours_max = 1.0", "rain_hours_max below"),
        ("storm_hours_min = 1.0", "storm_hours_min = 0.0", "storm_hours_min must be positive"),
        ("rain_spells_per_month_winter = 5.0", "rain_spells_per_month_winter = -1.0",
         "must not be negative"),
    ],
)  # fmt: skip
def test_weather_config_is_checked(
    default_config_text: str, line: str, replacement: str, message: str
) -> None:
    assert line in default_config_text
    with pytest.raises(ConfigError, match=message):
        parse_config(default_config_text.replace(line, replacement))
