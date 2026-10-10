"""Typed config parsing and validation."""

import pytest
from lineage_sim.config import Config, ConfigError, Hemisphere, MonthDay, parse_config


def test_default_config(config: Config) -> None:
    assert config.calendar.hemisphere is Hemisphere.NORTH
    assert config.calendar.spring_start == MonthDay(3, 20)
    assert config.calendar.winter_start == MonthDay(12, 21)
    assert dict(config.schedule) == {"terrain": 86_400.0, "flora": 86_400.0, "fire": 3600.0}
    assert (config.terrain.grid_width, config.terrain.grid_height) == (256, 150)


def test_schedule_periods(default_config_text: str) -> None:
    config = parse_config(default_config_text + "chronicle = 900\nfauna = 0.25\n")
    assert config.period_ms("chronicle") == 900_000
    assert config.period_ms("fauna") == 250
    with pytest.raises(ConfigError, match="no \\[schedule\\] period"):
        config.period_ms("species")


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
        (("[schedule]", "[schedule]\nfauna = -5"), "positive number of seconds"),
        (("[schedule]", "[schedule]\nfauna = true"), "positive number of seconds"),
        (("[schedule]", "[schedule]\nfauna = 0.0001"), "shorter than 1 ms"),
        (("[schedule]", "[schedul]"), "unknown sections"),
        (("[meta]", "[meta"), "invalid TOML"),
    ],
)
def test_invalid_config_is_rejected(
    default_config_text: str, edit: tuple[str, str], message: str
) -> None:
    old, new = edit
    assert old in default_config_text
    with pytest.raises(ConfigError, match=message):
        parse_config(default_config_text.replace(old, new, 1))
