"""M0 smoke tests for the sim package and its default config."""

import tomllib
from pathlib import Path

import lineage_sim

DEFAULT_CONFIG = Path(__file__).resolve().parents[1] / "config" / "default.toml"


def test_package_has_version() -> None:
    assert lineage_sim.__version__.count(".") == 2


def test_default_config_parses() -> None:
    config = tomllib.loads(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    assert config["meta"]["config_version"] == 1
    assert "schedule" in config
