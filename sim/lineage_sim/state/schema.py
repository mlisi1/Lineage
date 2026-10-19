"""Versioned, serialisable world state.

A state is converted to a *tree*: nested dicts with string keys, lists, JSON scalars and
NumPy arrays. `state.io` turns trees into bytes. Any change to the persisted fields bumps
``SCHEMA_VERSION`` and adds a migration in ``state/migrations/`` (CLAUDE.md §4.4).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, cast

SCHEMA_VERSION = 9

# A JSON-like mapping whose leaves may also be NumPy arrays.
Tree = dict[str, Any]


class StateError(ValueError):
    """A state tree is malformed, from an unknown version, or fails an invariant."""


@dataclass(frozen=True)
class WorldState:
    seed: int
    epoch_unix_ms: int  # world creation instant, injected by the caller
    t_ms: int  # sim time: milliseconds since world creation
    rng: dict[str, dict[str, Any]] = field(default_factory=dict[str, dict[str, Any]])
    subsystems: dict[str, Tree] = field(default_factory=dict[str, Tree])
    schema_version: int = SCHEMA_VERSION

    def to_tree(self) -> Tree:
        return {
            "schema_version": self.schema_version,
            "seed": self.seed,
            "epoch_unix_ms": self.epoch_unix_ms,
            "t_ms": self.t_ms,
            "rng": self.rng,
            "subsystems": self.subsystems,
        }

    @classmethod
    def from_tree(cls, tree: Tree) -> WorldState:
        expected = {"schema_version", "seed", "epoch_unix_ms", "t_ms", "rng", "subsystems"}
        if set(tree) != expected:
            raise StateError(f"state keys {sorted(tree)} differ from {sorted(expected)}")
        if tree["schema_version"] != SCHEMA_VERSION:
            raise StateError(f"expected schema v{SCHEMA_VERSION}, got v{tree['schema_version']}")
        for key in ("seed", "epoch_unix_ms", "t_ms"):
            if not isinstance(tree[key], int) or isinstance(tree[key], bool):
                raise StateError(f"{key} must be an integer")
        if tree["seed"] < 0 or tree["t_ms"] < 0:
            raise StateError("seed and t_ms must be non-negative")
        if not isinstance(tree["rng"], dict) or not isinstance(tree["subsystems"], dict):
            raise StateError("rng and subsystems must be mappings")
        return cls(
            seed=tree["seed"],
            epoch_unix_ms=tree["epoch_unix_ms"],
            t_ms=tree["t_ms"],
            rng=cast(dict[str, dict[str, Any]], tree["rng"]),
            subsystems=cast(dict[str, Tree], tree["subsystems"]),
        )
