"""Presence and daylight: the owner's presence is the island's sun.

The core of M8, pulled forward so that evolution is tuned in the light the gadget will
have (ADR 0011). `PresenceChanged` events (hold logic is upstream) say whether the owner
is at the desk. Light follows: it rises toward full day when they are present (dawn) and
falls toward a night level when they leave (dusk). After a long absence it settles on a
moonlight floor instead, so a holiday is dim, not black. A world that never hears of the
owner stays fully lit.

The subsystem ticks before the others. It integrates light over each sim-day and, at
midnight, hands the day's mean light to the plants, which grow with it. Creatures read
the light of the moment. God powers, holidays from a calendar and the device's hold logic
remain in M8.
"""

from __future__ import annotations

from lineage_sim.clock import MS_PER_DAY
from lineage_sim.config import PresenceConfig
from lineage_sim.events import InputEvent, OutputEvent, PresenceChanged
from lineage_sim.flora import Flora
from lineage_sim.rng import PRESENCE
from lineage_sim.state.schema import Tree
from lineage_sim.subsystem import Context

_SECONDS_PER_HOUR = 3600.0


def target_light(cfg: PresenceConfig, present: bool, absent_h: float) -> float:
    """The light the island moves toward: day while the owner is present, night once
    they left, moonlight once they have been away long enough."""
    if present:
        return 1.0
    return cfg.moonlight if absent_h >= cfg.moonlight_after_hours else cfg.night_light


def next_light(cfg: PresenceConfig, light: float, target: float, hours: float) -> float:
    """Light after ``hours`` of moving toward ``target``: up over ``dawn_hours`` from
    darkness to full day, down over ``dusk_hours``."""
    if target > light:
        return min(target, light + hours / cfg.dawn_hours)
    return max(target, light - hours / cfg.dusk_hours)


class Presence:
    """The presence subsystem. ``light`` is the light of the moment, in [0, 1]."""

    def __init__(self, cfg: PresenceConfig, flora: Flora | None = None) -> None:
        self._cfg = cfg
        self._flora = flora
        self._present = True  # a new world starts lit, and stays lit without events
        self._light = 1.0
        self._absent_h = 0.0  # hours since the owner left (0 while present)
        self._light_hours = 0.0  # light × hours since the last midnight
        self._hours = 0.0  # hours since the last midnight

    @property
    def name(self) -> str:
        return PRESENCE

    @property
    def present(self) -> bool:
        return self._present

    @property
    def light(self) -> float:
        return self._light

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        hours = ctx.dt_s / _SECONDS_PER_HOUR
        target = target_light(self._cfg, self._present, self._absent_h)
        self._light = next_light(self._cfg, self._light, target, hours)
        self._light_hours += self._light * hours
        self._hours += hours
        if not self._present:
            self._absent_h += hours
        if ctx.t_ms % MS_PER_DAY == 0 and self._hours > 0:
            # Registered first, this runs before the plants' midnight tick.
            if self._flora is not None:
                self._flora.set_daylight(self._light_hours / self._hours)
            self._light_hours = self._hours = 0.0
        return []

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        if isinstance(event, PresenceChanged) and event.present != self._present:
            self._present = event.present
            self._absent_h = 0.0
        return []

    def get_state(self) -> Tree:
        return {
            "present": self._present,
            "light": self._light,
            "absent_h": self._absent_h,
            "light_hours": self._light_hours,
            "hours": self._hours,
        }

    def set_state(self, tree: Tree) -> None:
        self._present = bool(tree["present"])
        self._light = float(tree["light"])
        self._absent_h = float(tree["absent_h"])
        self._light_hours = float(tree["light_hours"])
        self._hours = float(tree["hours"])
