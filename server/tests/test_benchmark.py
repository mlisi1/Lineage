"""The server's save, as the device makes it (S1): the world encoded, written, fsynced and
renamed by the store. The device's budget is 2 s (CLAUDE.md §4.8); as for the sim's own
save benchmark, a tenth of it is allowed on the PC, the device being about ten times
slower. The device's own numbers come from /status on the board."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from lineage_server.store import Store
from lineage_sim.config import parse_config
from lineage_sim.state import io
from lineage_sim.world import World

REPO = Path(__file__).resolve().parents[2]
SAVE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v9.lzma"
CONFIG = REPO / "sim" / "config" / "default.toml"
SERVER_SAVE_BUDGET_S = 0.3


def test_bench_a_full_world_saved_through_the_store(benchmark: Any, tmp_path: Path) -> None:
    config = parse_config(CONFIG.read_text("utf-8"))
    world = World.restore(config, io.loads(SAVE.read_bytes()))
    assert world.fauna.count > 100
    store = Store(tmp_path)

    def save() -> Path:
        return store.save(io.dumps(world.snapshot()), world.unix_ms)

    benchmark.pedantic(save, rounds=5, iterations=1)
    assert benchmark.stats.stats.median < SERVER_SAVE_BUDGET_S
