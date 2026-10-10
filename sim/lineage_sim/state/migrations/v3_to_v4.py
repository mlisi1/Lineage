"""v3 → v4. Fauna joins the world (M4).

Only the version changes: `World.restore` initialises the fauna subsystem a v3 save lacks.
A v3 world wakes up with no creatures; founders arrive as on a new world, once enough of
the land is vegetated and it is spring or summer.
"""

from __future__ import annotations

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    return {**tree, "schema_version": 4}
