"""v10 → v11. Algae grow on the shallow sea (M11).

Flora gains an algae biomass grid, empty in old saves: the next flora tick sows the
habitat with spores (``[flora] algae_seed``) and the algae grow from there.
"""

from __future__ import annotations

from typing import cast

import numpy as np

from lineage_sim.state.schema import Tree


def migrate(tree: Tree) -> Tree:
    subsystems = cast(dict[str, Tree], tree["subsystems"])
    out: Tree = {**tree, "schema_version": 11}
    if "flora" not in subsystems:
        return out
    flora = subsystems["flora"]
    algae = np.zeros(np.asarray(flora["biomass"]).shape, dtype=np.float32)
    return {**out, "subsystems": {**subsystems, "flora": {**flora, "algae": algae}}}
