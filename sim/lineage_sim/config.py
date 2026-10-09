"""Typed configuration, parsed from TOML text.

The caller reads the file (the sim does no I/O) and passes its text to `parse_config`.
Unknown sections or keys are errors so a typo cannot silently fall back to a default.
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Any, cast

CONFIG_VERSION = 1


class ConfigError(ValueError):
    """The configuration text is malformed or has invalid values."""


class Hemisphere(Enum):
    NORTH = "north"
    SOUTH = "south"


@dataclass(frozen=True, order=True)
class MonthDay:
    month: int
    day: int

    @classmethod
    def parse(cls, text: str) -> MonthDay:
        parts = text.split("-")
        if len(parts) != 2 or not all(p.isdigit() for p in parts):
            raise ConfigError(f"expected 'MM-DD', got {text!r}")
        month, day = int(parts[0]), int(parts[1])
        # Feb 29 is rejected: a season must start every year.
        days_in_month = (31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31)
        if not 1 <= month <= 12 or not 1 <= day <= days_in_month[month - 1]:
            raise ConfigError(f"invalid month-day {text!r}")
        return cls(month, day)


@dataclass(frozen=True)
class CalendarConfig:
    hemisphere: Hemisphere
    spring_start: MonthDay
    summer_start: MonthDay
    autumn_start: MonthDay
    winter_start: MonthDay


@dataclass(frozen=True)
class Config:
    config_version: int
    calendar: CalendarConfig
    # Subsystem name -> tick period in sim seconds.
    schedule: Mapping[str, float]

    def period_ms(self, subsystem: str) -> int:
        try:
            return round(self.schedule[subsystem] * 1000)
        except KeyError:
            raise ConfigError(f"no [schedule] period for subsystem {subsystem!r}") from None


def _section(raw: Mapping[str, Any], name: str, keys: frozenset[str]) -> dict[str, Any]:
    value = raw.get(name)
    if not isinstance(value, dict):
        raise ConfigError(f"missing section [{name}]")
    section = cast(dict[str, Any], value)
    unknown = set(section) - keys
    missing = keys - set(section)
    if unknown:
        raise ConfigError(f"unknown keys in [{name}]: {sorted(unknown)}")
    if missing:
        raise ConfigError(f"missing keys in [{name}]: {sorted(missing)}")
    return section


def _calendar(raw: Mapping[str, Any]) -> CalendarConfig:
    keys = frozenset({"hemisphere", "spring_start", "summer_start", "autumn_start", "winter_start"})
    section = _section(raw, "calendar", keys)
    try:
        hemisphere = Hemisphere(section["hemisphere"])
    except ValueError:
        raise ConfigError(f"invalid hemisphere {section['hemisphere']!r}") from None
    spring = MonthDay.parse(str(section["spring_start"]))
    summer = MonthDay.parse(str(section["summer_start"]))
    autumn = MonthDay.parse(str(section["autumn_start"]))
    winter = MonthDay.parse(str(section["winter_start"]))
    if not spring < summer < autumn < winter:
        raise ConfigError("season starts must be in order spring < summer < autumn < winter")
    return CalendarConfig(hemisphere, spring, summer, autumn, winter)


def _schedule(raw: Mapping[str, Any]) -> Mapping[str, float]:
    if not isinstance(raw.get("schedule"), dict):
        raise ConfigError("missing section [schedule]")
    section = cast(dict[str, Any], raw["schedule"])
    schedule: dict[str, float] = {}
    for name, value in sorted(section.items()):
        if isinstance(value, bool) or not isinstance(value, int | float) or value <= 0:
            raise ConfigError(f"[schedule] {name} must be a positive number of seconds")
        if round(value * 1000) < 1:
            raise ConfigError(f"[schedule] {name} is shorter than 1 ms")
        schedule[name] = float(value)
    return MappingProxyType(schedule)


def parse_config(text: str) -> Config:
    """Parse and validate configuration TOML text."""
    try:
        raw = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"invalid TOML: {exc}") from None
    unknown = set(raw) - {"meta", "calendar", "schedule"}
    if unknown:
        raise ConfigError(f"unknown sections: {sorted(unknown)}")
    meta = _section(raw, "meta", frozenset({"config_version"}))
    if meta["config_version"] != CONFIG_VERSION:
        raise ConfigError(f"unsupported config_version {meta['config_version']!r}")
    return Config(CONFIG_VERSION, _calendar(raw), _schedule(raw))
