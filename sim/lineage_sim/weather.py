"""Weather: the island's own rain (R4; the owner, 2026-10-20).

Spells of rain begin at random, more often in the wet seasons, and last hours to a day or
more. Between them the sky may cloud over for a while (round 5, the owner): only seen, it
changes nothing in the sim, so that plants and animals live under the light as before.
A spell is plain rain, rain with thunder (seen and heard only), or, rarely, a
thunderstorm: its lightning is the only thing that sets the land alight, so fires start
only while it rains. While any rain falls fire spreads slowly, as on wet land.

Every hour it tells the fire whether rain falls and whether a storm rages (registered
before the fire, so the fire always sees the weather of the hour). The rain god power is
the presence model's own soaking rain (`presence.py`): it puts fires out and never
strikes.
"""

from __future__ import annotations

from enum import IntEnum

from lineage_sim.clock import Season
from lineage_sim.config import WeatherConfig
from lineage_sim.events import InputEvent, OutputEvent
from lineage_sim.flora import Wildfire
from lineage_sim.rng import WEATHER
from lineage_sim.state.schema import StateError, Tree
from lineage_sim.subsystem import Context

_HOURS_PER_MONTH = 30 * 24
_MS_PER_HOUR = 3_600_000


class Rain(IntEnum):
    """What falls from the sky now."""

    NONE = 0
    RAIN = 1
    THUNDER = 2  # rain with thunder: seen and heard, starts nothing
    STORM = 3  # a thunderstorm: its lightning can set the land alight
    CLOUD = 4  # overcast, nothing falls: seen only


_FALLING = (Rain.RAIN, Rain.THUNDER, Rain.STORM)


class Weather:
    """The weather subsystem. ``rain`` is what falls now."""

    def __init__(self, cfg: WeatherConfig, fire: Wildfire) -> None:
        self._cfg = cfg
        self._fire = fire
        self._rain = Rain.NONE
        self._until_ms = 0  # the spell falls until then

    @property
    def name(self) -> str:
        return WEATHER

    @property
    def rain(self) -> Rain:
        return self._rain

    def spells_per_month(self, season: Season) -> float:
        cfg = self._cfg
        return {
            Season.SPRING: cfg.rain_spells_per_month_spring,
            Season.SUMMER: cfg.rain_spells_per_month_summer,
            Season.AUTUMN: cfg.rain_spells_per_month_autumn,
            Season.WINTER: cfg.rain_spells_per_month_winter,
        }[season]

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        self._push()
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        cfg, rng = self._cfg, ctx.rng
        hours = ctx.dt_s / 3600.0
        # The same draws every tick, so the stream does not depend on the weather.
        begins, kind, length = rng.random(), rng.random(), rng.random()
        clouds, cloud_length = rng.random(), rng.random()
        if ctx.t_ms >= self._until_ms:
            self._rain = Rain.NONE
        if self._rain not in _FALLING:
            rate = self.spells_per_month(ctx.instant.season) / _HOURS_PER_MONTH
            if begins < rate * hours:
                if kind < cfg.storm_share:
                    self._rain = Rain.STORM
                    shortest, longest = cfg.storm_hours_min, cfg.storm_hours_max
                else:
                    thunder = kind < cfg.storm_share + cfg.thunder_share
                    self._rain = Rain.THUNDER if thunder else Rain.RAIN
                    shortest, longest = cfg.rain_hours_min, cfg.rain_hours_max
                hours_long = shortest + (longest - shortest) * length
                self._until_ms = ctx.t_ms + round(hours_long * _MS_PER_HOUR)
        overcast = cfg.cloud_spells_per_month / _HOURS_PER_MONTH * hours
        if self._rain is Rain.NONE and clouds < overcast:
            self._rain = Rain.CLOUD
            shortest, longest = cfg.cloud_hours_min, cfg.cloud_hours_max
            hours_long = shortest + (longest - shortest) * cloud_length
            self._until_ms = ctx.t_ms + round(hours_long * _MS_PER_HOUR)
        self._push()
        return []

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {"rain": int(self._rain), "until_ms": self._until_ms}

    def set_state(self, tree: Tree) -> None:
        try:
            rain = Rain(int(tree["rain"]))
        except (ValueError, TypeError):
            raise StateError(f"weather rain must be one of {[r.value for r in Rain]}") from None
        until = tree["until_ms"]
        if not isinstance(until, int) or isinstance(until, bool):
            raise StateError("weather until_ms must be an integer")
        self._rain, self._until_ms = rain, until
        self._push()

    def _push(self) -> None:
        self._fire.set_weather(self._rain in _FALLING, self._rain is Rain.STORM)
