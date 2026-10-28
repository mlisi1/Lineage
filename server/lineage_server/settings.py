"""The server's settings, typed, from ``server/config/server.toml`` (S1, ADR 0023).

How the server runs on the device: where it listens, how often it looks at the clock,
which saves it keeps. The island's own tunables are the sim's (``sim/config/default.toml``).
Unknown sections or keys are errors, as in the sim's config.
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any

DEFAULT_SETTINGS = Path(__file__).resolve().parents[1] / "config" / "server.toml"


class SettingsError(ValueError):
    """The settings text is malformed or has invalid values."""


@dataclass(frozen=True)
class Settings:
    host: str
    port: int
    poll_seconds: float
    catch_up_days: int
    client_backlog: int
    daily_kept: int
    monthly_kept: bool
    log_every_seconds: float


_KEYS: Mapping[str, Mapping[str, type]] = {
    "server": {
        "host": str,
        "port": int,
        "poll_seconds": float,
        "catch_up_days": int,
        "client_backlog": int,
    },
    "saves": {"daily_kept": int, "monthly_kept": bool},
    "status": {"log_every_seconds": float},
}


def _value(section: str, key: str, value: Any, kind: type) -> Any:
    # bool is an int in Python: refuse it where a number is meant, and the other way round.
    if kind is bool:
        ok = isinstance(value, bool)
    elif kind is float:
        ok = isinstance(value, int | float) and not isinstance(value, bool)
    elif kind is int:
        ok = isinstance(value, int) and not isinstance(value, bool)
    else:
        ok = isinstance(value, kind)
    if not ok:
        raise SettingsError(f"[{section}] {key}: expected {kind.__name__}, got {value!r}")
    return float(value) if kind is float else value


def parse_settings(text: str) -> Settings:
    try:
        raw = tomllib.loads(text)
    except tomllib.TOMLDecodeError as exc:
        raise SettingsError(f"invalid TOML: {exc}") from None
    unknown = sorted(set(raw) - set(_KEYS))
    if unknown:
        raise SettingsError(f"unknown sections {unknown}")
    values: dict[str, Any] = {}
    for section, keys in _KEYS.items():
        table = raw.get(section)
        if not isinstance(table, dict):
            raise SettingsError(f"missing section [{section}]")
        extra = sorted(set(table) - set(keys))
        missing = sorted(set(keys) - set(table))
        if extra or missing:
            raise SettingsError(f"[{section}]: unknown keys {extra}, missing keys {missing}")
        for key, kind in keys.items():
            values[key] = _value(section, key, table[key], kind)
    settings = Settings(**values)
    if not 0 < settings.port < 65536:
        raise SettingsError(f"port {settings.port} out of range")
    if settings.poll_seconds <= 0 or settings.log_every_seconds <= 0:
        raise SettingsError("poll_seconds and log_every_seconds must be positive")
    if min(settings.catch_up_days, settings.daily_kept, settings.client_backlog) < 1:
        raise SettingsError("catch_up_days, daily_kept and client_backlog must be at least 1")
    return settings


def load_settings(path: Path = DEFAULT_SETTINGS) -> Settings:
    return parse_settings(path.read_text(encoding="utf-8"))
