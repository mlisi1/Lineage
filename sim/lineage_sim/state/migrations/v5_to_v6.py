"""v5 → v6. Creatures see plant form (M5, revised plan in ADR 0009).

Brains gain four senses after the sixteen of v5: where low growth and where woody growth
increase (x, y each). Their weights are inserted as zeros, in the direct block (2 × 16 →
2 × 20) and in the hidden layer's input block (8 × 16 → 8 × 20), so a v5 creature steers
exactly as before until mutation brings the new senses in. Learned gains and their traces
gain the two new followed senses, at zero, and each creature gains a running average
meal value, NaN until its next meal (it has tasted nothing yet).
"""

from __future__ import annotations

from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree

# Values of this version, written out so the migration never depends on current code.
_OLD_SENSES, _NEW_SENSES = 16, 20
_OUTPUTS, _HIDDEN = 2, 8
_OLD_WEIGHTS = 186
_OLD_GAINS, _NEW_GAINS = 6, 8


def _widen_senses(block: np.ndarray, rows: int) -> np.ndarray:
    """(n, rows × 16) weights → (n, rows × 20), new sense columns zero."""
    n = block.shape[0]
    wide = np.zeros((n, rows, _NEW_SENSES), dtype=np.float32)
    wide[:, :, :_OLD_SENSES] = block.reshape(n, rows, _OLD_SENSES)
    return wide.reshape(n, rows * _NEW_SENSES)


def _widen_gains(gains: np.ndarray) -> np.ndarray:
    gains = np.asarray(gains, dtype=np.float32).reshape(-1, _OLD_GAINS)
    extra = np.zeros((gains.shape[0], _NEW_GAINS - _OLD_GAINS), dtype=np.float32)
    return np.concatenate([gains, extra], axis=1)


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    fauna = subsystems.get("fauna")
    if fauna is None:
        return {**tree, "schema_version": 6}
    weights = np.asarray(fauna["weights"], dtype=np.float32).reshape(-1, _OLD_WEIGHTS)
    direct_end = _OUTPUTS * _OLD_SENSES
    hidden_end = direct_end + _HIDDEN * _OLD_SENSES
    widened = np.concatenate(
        [
            _widen_senses(weights[:, :direct_end], _OUTPUTS),
            _widen_senses(weights[:, direct_end:hidden_end], _HIDDEN),
            weights[:, hidden_end:],
        ],
        axis=1,
    )
    upgraded = {
        **fauna,
        "weights": widened,
        "learned": _widen_gains(fauna["learned"]),
        "trace": _widen_gains(fauna["trace"]),
        "meal_value": np.full(weights.shape[0], np.nan, dtype=np.float32),
    }
    return {**tree, "schema_version": 6, "subsystems": {**subsystems, "fauna": upgraded}}
