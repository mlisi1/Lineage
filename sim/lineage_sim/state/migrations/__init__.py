"""Schema migrations: one ``vN_to_vN+1.py`` per bump, never edited after release.

Each module exposes ``migrate(tree) -> tree`` working on raw state trees (not typed
objects), so old saves never depend on current classes. Register every module below; a
test checks the chain covers every version up to the current one.
"""

from __future__ import annotations

from collections.abc import Callable

from lineage_sim.state.migrations import (
    v0_to_v1,
    v1_to_v2,
    v2_to_v3,
    v3_to_v4,
    v4_to_v5,
    v5_to_v6,
    v6_to_v7,
    v7_to_v8,
    v8_to_v9,
    v9_to_v10,
    v10_to_v11,
    v11_to_v12,
    v12_to_v13,
)
from lineage_sim.state.schema import SCHEMA_VERSION, StateError, Tree

# from_version -> function producing a tree of from_version + 1
MIGRATIONS: dict[int, Callable[[Tree], Tree]] = {
    0: v0_to_v1.migrate,
    1: v1_to_v2.migrate,
    2: v2_to_v3.migrate,
    3: v3_to_v4.migrate,
    4: v4_to_v5.migrate,
    5: v5_to_v6.migrate,
    6: v6_to_v7.migrate,
    7: v7_to_v8.migrate,
    8: v8_to_v9.migrate,
    9: v9_to_v10.migrate,
    10: v10_to_v11.migrate,
    11: v11_to_v12.migrate,
    12: v12_to_v13.migrate,
}


def migrate(tree: Tree) -> Tree:
    """Upgrade a state tree of any past schema version to ``SCHEMA_VERSION``."""
    version = tree.get("schema_version")
    if not isinstance(version, int) or isinstance(version, bool):
        raise StateError(f"invalid schema_version {version!r}")
    if version > SCHEMA_VERSION:
        raise StateError(f"save is schema v{version}, newer than this code (v{SCHEMA_VERSION})")
    while version < SCHEMA_VERSION:
        try:
            step = MIGRATIONS[version]
        except KeyError:
            raise StateError(f"no migration from schema v{version}") from None
        tree = step(tree)
        if tree.get("schema_version") != version + 1:
            raise StateError(f"migration from v{version} did not produce v{version + 1}")
        version += 1
    return tree
