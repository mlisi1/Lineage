"""v6 → v7. Species (M6).

The world gains the species subsystem, empty: no species on record and no creature
labelled. At its first daily census the creatures of each lineage (`origin`) found one
root species, which later splits as its groups drift apart.
"""

from __future__ import annotations

from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree

# Values of this version, written out so the migration never depends on current code.
_GENES = 14


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    if "fauna" not in subsystems:
        return {**tree, "schema_version": 7}  # the species start with the creatures
    ids = np.zeros(0, dtype=np.int64)
    species: Tree = {
        "creatures": ids,
        "labels": ids.copy(),
        "parent": ids.copy(),
        "lineage": ids.copy(),
        "born_ms": ids.copy(),
        "extinct_ms": ids.copy(),
        "members": np.zeros(0, dtype=np.int32),
        "peak": np.zeros(0, dtype=np.int32),
        "divided_s": np.zeros(0, dtype=np.float64),
        "founding": np.zeros((0, _GENES), dtype=np.float32),
        "centroid": np.zeros((0, _GENES), dtype=np.float32),
        "names": [],
    }
    return {**tree, "schema_version": 7, "subsystems": {**subsystems, "species": species}}
