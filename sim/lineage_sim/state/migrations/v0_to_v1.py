"""v0 → v1. Toy migration that exercises the framework (M1).

v0 was a pre-release layout: ``seed``, ``epoch_unix_s`` (whole seconds) and
``sim_time_s`` (float seconds), with no random-stream or subsystem state.
v1 stores times as integer milliseconds and adds ``rng`` and ``subsystems``; streams
missing from ``rng`` are recreated fresh from the seed on first use.
"""

from __future__ import annotations

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    return {
        "schema_version": 1,
        "seed": tree["seed"],
        "epoch_unix_ms": tree["epoch_unix_s"] * 1000,
        "t_ms": round(tree["sim_time_s"] * 1000),
        "rng": {},
        "subsystems": {},
    }
