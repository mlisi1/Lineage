"""v8 → v9. The chronicle and the bestiary (M9).

The world gains the chronicle subsystem, with no entries. An upgraded world's chronicle
starts unprimed: on its first call it takes stock of the world in silence, so what
happened before the upgrade is not announced as news. Its birthday is the world's
creation date.
"""

from __future__ import annotations

import datetime as dt
from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree

_MS_PER_DAY = 86_400_000
_RECORDS = 5  # population, species alive, fire, species peak, species age


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    if "terrain" not in subsystems:
        return {**tree, "schema_version": 9}  # an empty world: the chronicle starts fresh
    epoch_ms = int(tree["epoch_unix_ms"])
    birth = dt.date(1970, 1, 1) + dt.timedelta(days=epoch_ms // _MS_PER_DAY)
    chronicle: Tree = {
        "primed": False,
        "birth": birth.isoformat(),
        "years_told": 0,
        "ticks": 0,
        "day": -1,
        "day_count": 0,
        "firsts": [],
        "dark_since_ms": -1,
        "god_ms": -1,
        "fire_xy": [-1.0, -1.0],
        "dedup_keys": [],
        "dedup_ms": np.zeros(0, dtype=np.int64),
        "best": np.zeros(_RECORDS, dtype=np.float64),
        "announced": np.zeros(_RECORDS, dtype=np.float64),
        "holder": np.zeros(_RECORDS, dtype=np.int64),
        "peak": np.zeros(0, dtype=np.int32),
        "peak_ms": np.zeros(0, dtype=np.int64),
        "rare": np.zeros(0, dtype=np.uint16),
        "years": np.zeros(0, dtype=np.int32),
        "ring": np.full((1, 1), -1, dtype=np.int32),  # resized to the config's window
        "prev_cells": np.zeros(0, dtype=np.int64),
        "prev_species": np.zeros(0, dtype=np.int64),
        "entry_t_ms": np.zeros(0, dtype=np.int64),
        "entry_kind": [],
        "entry_importance": np.zeros(0, dtype=np.int8),
        "entry_text": [],
        "entry_species": np.zeros(0, dtype=np.int64),
        "entry_x": np.zeros(0, dtype=np.float32),
        "entry_y": np.zeros(0, dtype=np.float32),
    }
    return {**tree, "schema_version": 9, "subsystems": {**subsystems, "chronicle": chronicle}}
