"""v4 → v5. Lifetime learning (M5).

Creatures gain two genes (learning rate and exploration, appended after the eleven body
genes) and the state their learning needs. A v4 creature never learned: both new genes
are 0, for it and for the genome its lineage arrived with, so it and its descendants go
on as before until mutation brings learning in. It has learned nothing, its reward
baseline and energy balance start at 0 (break-even), and it counts as generation 0 with
no record of its youth: it is treated as competent from now, and its youth, if not over,
is reported with what it eats from now on.
"""

from __future__ import annotations

from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree

# Values of this version, written out so the migration never depends on current code.
_NEW_GENES = 2
_LEARNED_GAINS = 6
_STEERING = 2


def _widen(genes: np.ndarray) -> np.ndarray:
    genes = np.asarray(genes, dtype=np.float32).reshape(-1, 11)
    return np.concatenate([genes, np.zeros((genes.shape[0], _NEW_GENES), np.float32)], axis=1)


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    fauna = subsystems.get("fauna")
    if fauna is None:
        return {**tree, "schema_version": 5}
    n = int(np.asarray(fauna["energy"]).size)
    zeros = np.zeros(n, dtype=np.float32)
    age = np.asarray(fauna["age_h"], dtype=np.float32)
    upgraded = {
        **fauna,
        "genes": _widen(fauna["genes"]),
        "ancestors": _widen(fauna["ancestors"]),
        "generation": np.zeros(n, dtype=np.int32),
        "learned": np.zeros((n, _LEARNED_GAINS), dtype=np.float32),
        "trace": np.zeros((n, _LEARNED_GAINS), dtype=np.float32),
        "noise": np.zeros((n, _STEERING), dtype=np.float32),
        "baseline": zeros.copy(),
        "balance": zeros.copy(),
        "competent_h": age.copy(),
        "young_eaten": zeros.copy(),
        "young_burnt": zeros.copy(),
    }
    return {**tree, "schema_version": 5, "subsystems": {**subsystems, "fauna": upgraded}}
