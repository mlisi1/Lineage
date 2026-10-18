"""Typed config parsing and validation."""

import pytest
from lineage_sim.config import Config, ConfigError, Hemisphere, MonthDay, parse_config


def test_default_config(config: Config) -> None:
    assert config.calendar.hemisphere is Hemisphere.NORTH
    assert config.calendar.spring_start == MonthDay(3, 20)
    assert config.calendar.winter_start == MonthDay(12, 21)
    assert dict(config.schedule) == {
        "terrain": 86_400.0,
        "flora": 86_400.0,
        "fire": 3600.0,
        "fauna": 600.0,
        "species": 86_400.0,
    }
    assert config.species.min_members == 8
    assert (config.terrain.grid_width, config.terrain.grid_height) == (256, 150)


def test_schedule_periods(default_config_text: str) -> None:
    config = parse_config(default_config_text + "chronicle = 900\napocalypse = 0.25\n")
    assert config.period_ms("chronicle") == 900_000
    assert config.period_ms("apocalypse") == 250
    with pytest.raises(ConfigError, match="no \\[schedule\\] period"):
        config.period_ms("presence")


def test_schedule_is_read_only(config: Config) -> None:
    with pytest.raises(TypeError):
        config.schedule["x"] = 1.0  # type: ignore[index]


@pytest.mark.parametrize(
    ("edit", "message"),
    [
        (("[meta]", "[meta]\nextra = 1"), "unknown keys in \\[meta\\]"),
        (('hemisphere = "north"', 'hemisphere = "east"'), "invalid hemisphere"),
        (('spring_start = "03-20"', 'spring_start = "3/20"'), "expected 'MM-DD'"),
        (('spring_start = "03-20"', 'spring_start = "02-29"'), "invalid month-day"),
        (('summer_start = "06-21"', 'summer_start = "02-01"'), "must be in order"),
        (('winter_start = "12-21"', ""), "missing keys in \\[calendar\\]"),
        (("config_version = 1", "config_version = 2"), "unsupported config_version"),
        (("[schedule]", "[schedule]\nchronicle = -5"), "positive number of seconds"),
        (("[schedule]", "[schedule]\nchronicle = true"), "positive number of seconds"),
        (("[schedule]", "[schedule]\nchronicle = 0.0001"), "shorter than 1 ms"),
        (("min_members = 8", "min_members = 0"), "min_members must be at least 1"),
        (("link_distance = 0.035", "link_distance = 0.0"), "link_distance must be within"),
        (("split_days = 3.0", "split_days = -1.0"), "split_days must not be negative"),
        (("min_members = 8", "min_members = 8.5"), "min_members must be an integer"),
        (("[schedule]", "[schedul]"), "unknown sections"),
        (("[meta]", "[meta"), "invalid TOML"),
        (("learning = true", "learning = 1"), "learning must be true or false"),
        (("exploration_max = 1.0", "exploration_max = true"), "exploration_max must be a number"),
        (("trace_hours = 2.0", "trace_hours = 0.0"), "trace_hours must be positive"),
    ],
)
def test_invalid_config_is_rejected(
    default_config_text: str, edit: tuple[str, str], message: str
) -> None:
    old, new = edit
    assert old in default_config_text
    with pytest.raises(ConfigError, match=message):
        parse_config(default_config_text.replace(old, new, 1))


def test_learning_switch(default_config_text: str) -> None:
    assert parse_config(default_config_text).fauna.learning is True
    off = parse_config(default_config_text.replace("learning = true", "learning = false", 1))
    assert off.fauna.learning is False
