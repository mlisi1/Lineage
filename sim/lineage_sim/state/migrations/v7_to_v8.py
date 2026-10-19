"""v7 → v8. Presence and god powers (M8).

The world gains the presence subsystem. An upgraded world wakes up as a new one does:
the owner present, full light, the god-power button ready, no rain.
"""

from __future__ import annotations

from typing import cast

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    if "terrain" not in subsystems:
        return {**tree, "schema_version": 8}  # an empty world: presence starts fresh
    presence: Tree = {
        "present": True,
        "light": 1.0,
        "absent_h": 0.0,
        "light_hours": 0.0,
        "hours": 0.0,
        "recent_light": 1.0,
        "ready_ms": 0,
        "ready_told": True,
        "rain_until_ms": 0,
        "wet": False,
    }
    return {**tree, "schema_version": 8, "subsystems": {**subsystems, "presence": presence}}
