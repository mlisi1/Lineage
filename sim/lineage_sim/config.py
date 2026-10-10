"""Typed configuration, parsed from TOML text.

The caller reads the file (the sim does no I/O) and passes its text to `parse_config`.
Unknown sections or keys are errors so a typo cannot silently fall back to a default.
"""

from __future__ import annotations

import tomllib
from collections.abc import Mapping
from dataclasses import dataclass, fields
from enum import Enum
from types import MappingProxyType
from typing import Any, TypeVar, cast

CONFIG_VERSION = 1

_T = TypeVar("_T")


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
class TerrainConfig:
    """``[terrain]``; units and intent of every key are documented in default.toml."""

    grid_width: int
    grid_height: int
    edge_margin_cells: float
    edge_depth: float
    sea_base: float
    initial_land_fraction: float
    noise_wavelength_cells: float
    noise_large_octaves: int
    noise_detail_octaves: int
    noise_detail_share: float
    drift_period_years: float
    noise_persistence: float
    falloff_strength: float
    falloff_exponent: float
    relief_scale: float
    fertility_min: float
    fertility_max: float
    fertility_wavelength_cells: float
    fertility_elevation_decay: float
    sea_cycle_period_years: float
    sea_cycle_amplitude: float
    sea_slow_period_years: float
    sea_slow_amplitude: float
    hotspot_count: int
    hotspot_radius_min_cells: float
    hotspot_radius_max_cells: float
    hotspot_rate_max_per_year: float
    hotspot_speed_max_cells_per_year: float
    hotspot_lifetime_min_years: float
    hotspot_lifetime_max_years: float
    hotspot_ruggedness: float
    relax_time_years: float
    relax_blur_cells: int
    creep_rate_per_year: float
    thermal_rate_per_year: float
    talus_slope: float
    vegetation_protection: float
    erosion_fertility_exchange: float
    marine_sediment_rate_per_year: float
    leaching_rate_per_year: float
    volcano_rate_per_year: float
    volcano_radius_min_cells: float
    volcano_radius_max_cells: float
    volcano_height_min: float
    volcano_height_max: float
    volcano_lava_fertility: float
    volcano_ash_fertility: float
    earthquake_rate_per_year: float
    earthquake_radius_min_cells: float
    earthquake_radius_max_cells: float
    earthquake_throw_min: float
    earthquake_throw_max: float
    crater_rate_per_year: float
    crater_radius_min_cells: float
    crater_radius_max_cells: float
    crater_depth_min: float
    crater_depth_max: float
    crater_rim_fraction: float
    crater_fertility_factor: float
    landmass_min_cells: int

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[terrain] {message}")

        unit = (
            "sea_base", "initial_land_fraction", "noise_persistence", "noise_detail_share",
            "fertility_min", "fertility_max", "hotspot_ruggedness", "vegetation_protection",
            "volcano_lava_fertility", "volcano_ash_fertility", "crater_fertility_factor",
        )  # fmt: skip
        for key in unit:
            check(0.0 <= getattr(self, key) <= 1.0, f"{key} must be within [0, 1]")
        for key, value in vars(self).items():
            check(value >= 0, f"{key} must not be negative")
        positive = (
            "grid_width", "grid_height", "edge_margin_cells", "noise_wavelength_cells",
            "noise_large_octaves", "relief_scale", "drift_period_years",
            "fertility_wavelength_cells",
            "sea_cycle_period_years", "sea_slow_period_years", "hotspot_radius_min_cells",
            "hotspot_lifetime_min_years", "relax_time_years", "relax_blur_cells",
            "talus_slope", "volcano_radius_min_cells", "earthquake_radius_min_cells",
            "crater_radius_min_cells", "landmass_min_cells",
        )  # fmt: skip
        for key in positive:
            check(getattr(self, key) > 0, f"{key} must be positive")
        check(self.grid_width >= 16 and self.grid_height >= 16, "grid must be at least 16×16")
        check(self.fertility_min <= self.fertility_max, "fertility_min exceeds fertility_max")
        ranges = (
            ("hotspot_radius_min_cells", "hotspot_radius_max_cells"),
            ("hotspot_lifetime_min_years", "hotspot_lifetime_max_years"),
            ("volcano_radius_min_cells", "volcano_radius_max_cells"),
            ("volcano_height_min", "volcano_height_max"),
            ("earthquake_radius_min_cells", "earthquake_radius_max_cells"),
            ("earthquake_throw_min", "earthquake_throw_max"),
            ("crater_radius_min_cells", "crater_radius_max_cells"),
            ("crater_depth_min", "crater_depth_max"),
        )
        for low, high in ranges:
            check(getattr(self, low) <= getattr(self, high), f"{low} exceeds {high}")


@dataclass(frozen=True)
class FloraConfig:
    """``[flora]``; units and intent of every key are documented in default.toml."""

    cover_min_biomass: float
    closed_canopy_biomass: float
    form_grass_max_height: float
    form_shrub_max_height: float
    form_lichen_max_height: float
    form_lichen_min_frugality: float
    form_conifer_min_evergreen: float
    temperature_mean: float
    temperature_season_amplitude: float
    temperature_lapse_per_height: float
    optimum_warm: float
    optimum_cold: float
    temperature_tolerance: float
    growth_rate_max_per_year: float
    growth_rate_min_share: float
    stature_slowdown: float
    cost_frugality: float
    cost_shade: float
    cost_defence: float
    cost_evergreen: float
    mortality_base_per_year: float
    mortality_growth_per_year: float
    mortality_stature_relief: float
    shore_span: float
    treeline_height: float
    treeline_span: float
    exposure_per_year: float
    winter_dieback_per_year: float
    winter_reserve_biomass: float
    need_base: float
    need_height: float
    need_frugality: float
    need_floor: float
    need_sharpness: float
    soil_build_rate_per_year: float
    soil_cap_base: float
    soil_cap_height: float
    seed_rate_per_year: float
    seed_min_biomass: float
    near_weight_wind: float
    far_offsets_per_tick: int
    wind_range_cells: float
    fruit_establishment_bonus: float
    seedling_biomass: float
    takeover_keep: float
    establishment_sharpness: float
    canopy_base: float
    competition_base: float
    competition_softness: float
    competition_margin: float
    mutation_sigma: float
    seed_rain_per_year: float
    rare_gain_probability: float
    rare_loss_probability: float
    fire_pine_survival: float
    fire_pine_growth_cost: float
    nitrogen_fixer_need_relief: float
    nitrogen_fixer_soil_boost: float
    nitrogen_fixer_growth_cost: float
    mangrove_max_depth: float
    mangrove_growth_cost: float
    defence_strength: float
    fire_ignitions_per_year: float
    fire_dry_temperature: float
    fire_dry_span: float
    fire_spread_per_hour: float
    fire_wet_spread: float
    fire_burn_hours: float
    fire_min_fuel: float
    flammability_lichen: float
    flammability_grass: float
    flammability_shrub: float
    flammability_broadleaf: float
    flammability_conifer: float
    fire_loss_low: float
    fire_loss_tree: float
    fire_fertility_loss: float
    scorch_days: float
    species_min_cells: int

    def __post_init__(self) -> None:
        def check(ok: bool, message: str) -> None:
            if not ok:
                raise ConfigError(f"[flora] {message}")

        for key, value in vars(self).items():
            check(value >= 0, f"{key} must not be negative")
        unit = (
            "cover_min_biomass",
            "closed_canopy_biomass",
            "form_grass_max_height",
            "form_shrub_max_height",
            "form_lichen_max_height",
            "form_lichen_min_frugality",
            "form_conifer_min_evergreen",
            "growth_rate_min_share",
            "cost_frugality",
            "cost_shade",
            "cost_defence",
            "cost_evergreen",
            "mortality_stature_relief",
            "need_floor",
            "soil_cap_base",
            "seed_min_biomass",
            "near_weight_wind",
            "seedling_biomass",
            "winter_reserve_biomass",
            "takeover_keep",
            "canopy_base",
            "rare_gain_probability",
            "rare_loss_probability",
            "fire_pine_survival",
            "fire_pine_growth_cost",
            "nitrogen_fixer_need_relief",
            "nitrogen_fixer_growth_cost",
            "mangrove_growth_cost",
            "defence_strength",
            "fire_wet_spread",
            "fire_min_fuel",
            "flammability_lichen",
            "flammability_grass",
            "flammability_shrub",
            "flammability_broadleaf",
            "flammability_conifer",
            "fire_loss_low",
            "fire_loss_tree",
            "fire_fertility_loss",
        )
        for key in unit:
            check(getattr(self, key) <= 1.0, f"{key} must be within [0, 1]")
        positive = (
            "temperature_tolerance",
            "growth_rate_max_per_year",
            "need_sharpness",
            "establishment_sharpness",
            "competition_softness",
            "treeline_span",
            "shore_span",
            "fire_dry_span",
            "fire_burn_hours",
            "wind_range_cells",
            "scorch_days",
            "species_min_cells",
        )
        for key in positive:
            check(getattr(self, key) > 0, f"{key} must be positive")
        check(
            self.form_lichen_max_height <= self.form_grass_max_height <= self.form_shrub_max_height,
            "form height thresholds must be in order lichen <= grass <= shrub",
        )
        check(self.optimum_cold < self.optimum_warm, "optimum_cold must be below optimum_warm")
        check(self.soil_cap_base + self.soil_cap_height <= 1.0, "soil cap exceeds 1")


@dataclass(frozen=True)
class Config:
    config_version: int
    calendar: CalendarConfig
    terrain: TerrainConfig
    flora: FloraConfig
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


def _numeric_section(raw: Mapping[str, Any], name: str, cls: type[_T]) -> _T:
    """Build a dataclass of int/float fields from section ``[name]``, checking every key."""
    types = {f.name: str(f.type) for f in fields(cast(Any, cls))}
    section = _section(raw, name, frozenset(types))
    values: dict[str, int | float] = {}
    for key, kind in types.items():
        value = section[key]
        if isinstance(value, bool) or not isinstance(value, int | float):
            raise ConfigError(f"[{name}] {key} must be a number")
        if kind == "int":
            if not isinstance(value, int):
                raise ConfigError(f"[{name}] {key} must be an integer")
            values[key] = value
        else:
            values[key] = float(value)
    return cls(**values)


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
    unknown = set(raw) - {"meta", "calendar", "schedule", "terrain", "flora"}
    if unknown:
        raise ConfigError(f"unknown sections: {sorted(unknown)}")
    meta = _section(raw, "meta", frozenset({"config_version"}))
    if meta["config_version"] != CONFIG_VERSION:
        raise ConfigError(f"unsupported config_version {meta['config_version']!r}")
    return Config(
        CONFIG_VERSION,
        _calendar(raw),
        _numeric_section(raw, "terrain", TerrainConfig),
        _numeric_section(raw, "flora", FloraConfig),
        _schedule(raw),
    )
