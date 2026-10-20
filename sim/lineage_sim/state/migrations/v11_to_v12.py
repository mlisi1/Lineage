"""v11 → v12. The island's own weather, fire that burns animals, and bare land round
volcanoes and craters (R4).

A world with fire gains the weather subsystem, starting dry: no rain falls until a spell
begins (a world without subsystems yet gets it when it is generated). The fauna's tally
of deaths gains the burnt, none so far. The flora gains the days each cell stays bare
after a volcano or a crater: none so far.
"""

from __future__ import annotations

from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    upgraded: dict[str, Tree] = dict(subsystems)
    if "fire" in subsystems:
        upgraded["weather"] = {"rain": 0, "until_ms": 0}
    if "flora" in subsystems:
        flora = subsystems["flora"]
        shape = np.asarray(flora["biomass"]).shape
        upgraded["flora"] = {**flora, "barren": np.zeros(shape, dtype=np.float32)}
    if "fauna" in subsystems:
        fauna = subsystems["fauna"]
        tally = {**cast(dict[str, int], fauna["tally"]), "burnt": 0}
        upgraded["fauna"] = {**fauna, "tally": tally}
    return {**tree, "schema_version": 12, "subsystems": upgraded}
