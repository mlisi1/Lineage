"""M7 acceptance on many seeds (nightly). See reports/M7-rare-genes/ and ADR 0015.

Each seed is stepped one day at a time and the carriers of every rare gene counted after
each day, as the report's fast-forward does. M7.2 is checked without photosynthesis,
which pays its cost only at night: the full reading is deferred to M8 (ADR 0015).
"""

from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.config import parse_config
from lineage_sim.flora import Rare as PlantRare
from lineage_sim.rare import CREATURE_GENES, PLANT_GENES, CreatureRare, carries
from lineage_sim.world import World

CONFIG = Path(__file__).resolve().parents[1] / "config" / "default.toml"
EPOCH_UNIX_MS = 1_767_225_600_000  # 2026-01-01 00:00 UTC
SEEDS = range(20)
DAYS = round(3 * 365.25)
DAY_S = 86_400
WORKERS = 4
# Acceptance bands from CLAUDE.md §8 M7.
MIN_SEEDS_APPEARING = 0.3
FIXATION_SHARE = 0.9
FIXATION_DAYS = 91
MIN_SEEDS_WITHOUT_FIXATION = 0.9
DEFERRED = ("creature", int(CreatureRare.PHOTOSYNTHESIS))

Gene = tuple[str, int]  # (kingdom, bit)
GENES: list[Gene] = [("creature", int(g)) for g in CREATURE_GENES] + [
    ("plant", int(g)) for g in PLANT_GENES
]


def _run(seed: int) -> dict[Gene, tuple[bool, int]]:
    """Per gene: whether it ever had a carrier, and its longest run of days above the
    fixation share of its population (creatures; vegetated cells for plants)."""
    config = parse_config(CONFIG.read_text(encoding="utf-8"))
    world, _ = World.create(config, seed, EPOCH_UNIX_MS)
    seen = dict.fromkeys(GENES, False)
    run = dict.fromkeys(GENES, 0)
    longest = dict.fromkeys(GENES, 0)
    for _ in range(DAYS):
        world.step(DAY_S)
        fauna, flora = world.fauna, world.flora
        vegetated = flora.biomass > 0
        for kingdom, bit in GENES:
            if kingdom == "creature":
                carriers = int(np.count_nonzero(carries(fauna.slots, CreatureRare(bit))))
                total = fauna.count
            else:
                carriers = int(np.count_nonzero(vegetated & ((flora.rare & PlantRare(bit)) != 0)))
                total = int(np.count_nonzero(vegetated))
            gene = (kingdom, bit)
            seen[gene] |= carriers > 0
            fixed = total > 0 and carriers / total > FIXATION_SHARE
            run[gene] = run[gene] + 1 if fixed else 0
            longest[gene] = max(longest[gene], run[gene])
    return {gene: (seen[gene], longest[gene]) for gene in GENES}


@pytest.mark.slow
def test_rare_genes_appear_and_none_takes_over() -> None:
    with ProcessPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(_run, SEEDS))
    appeared = {gene: np.mean([r[gene][0] for r in results]) for gene in GENES}
    spread = f"share of seeds where each gene appeared: {appeared}"
    assert min(appeared.values()) >= MIN_SEEDS_APPEARING, spread

    judged = [gene for gene in GENES if gene != DEFERRED]
    free = np.array([max(r[gene][1] for gene in judged) <= FIXATION_DAYS for r in results])
    longest = [{gene: r[gene][1] for gene in GENES if r[gene][1] > FIXATION_DAYS} for r in results]
    assert free.mean() >= MIN_SEEDS_WITHOUT_FIXATION, f"long fixations by seed: {longest}"
