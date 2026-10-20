"""v9 → v10. Worlds end and are numbered (M10).

Every save so far holds the first world: number 1, with no world before it. The world
gains the apocalypse subsystem. If creatures live on the island, life is taken as
established since the world began, so their extinction ends the world; an empty island
still waits for its founders.
"""

from __future__ import annotations

from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    out: Tree = {**tree, "schema_version": 10, "world": 1, "worlds": []}
    if "fauna" not in subsystems:
        return out  # no creatures yet: the apocalypse starts fresh
    alive = int(np.asarray(subsystems["fauna"]["ids"]).size) > 0
    apocalypse: Tree = {"life_since_ms": 0 if alive else -1}
    return {**out, "subsystems": {**subsystems, "apocalypse": apocalypse}}
