"""v2 → v3. Flora and wildfire join the world (M3).

Like v1 → v2, this only bumps the version: `World.restore` initialises the subsystems a
save lacks. A v2 world therefore wakes up with bare ground and is colonised by seed rain,
exactly like a new world.
"""

from __future__ import annotations

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    return {**tree, "schema_version": 3}
