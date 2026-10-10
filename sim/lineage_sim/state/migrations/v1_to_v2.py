"""v1 → v2. Terrain joins the world (M2).

v1 worlds have no terrain. The migration only bumps the version: a subsystem missing from
``subsystems`` is initialised fresh by ``World.restore`` at the save's sim time, from its
own random stream, because generating an island needs the config, which a migration does
not have.
"""

from __future__ import annotations

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    return {**tree, "schema_version": 2}
