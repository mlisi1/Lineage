"""v12 → v13. Seeds in guts (M11).

Every creature gains an empty gut: no seed carried (``gut_h`` -1), a zero plant genome
and no rare genes in it.
"""

from __future__ import annotations

from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree

_PLANT_GENES = 8  # the plant genome's length when v13 was released


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    upgraded: dict[str, Tree] = dict(subsystems)
    if "fauna" in subsystems:
        fauna = subsystems["fauna"]
        count = int(np.asarray(fauna["energy"]).shape[0])
        upgraded["fauna"] = {
            **fauna,
            "gut_genome": np.zeros((count, _PLANT_GENES), dtype=np.uint8),
            "gut_rare": np.zeros(count, dtype=np.uint8),
            "gut_h": np.full(count, -1.0, dtype=np.float32),
        }
    return {**tree, "schema_version": 13, "subsystems": upgraded}
