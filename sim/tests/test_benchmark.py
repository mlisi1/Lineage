"""Step cost of an empty world (CLAUDE.md §4.8 budgets start here)."""

from typing import Any

from lineage_sim.config import Config
from lineage_sim.state import io
from lineage_sim.world import World

EPOCH_UNIX_MS = 1_772_323_200_000
# Generous ceilings for CI machines; an empty world must be essentially free.
EMPTY_STEP_BUDGET_S = 50e-6
EMPTY_DAY_STEP_BUDGET_S = 500e-6
EMPTY_SAVE_BUDGET_S = 20e-3
# Terrain ticks once per sim-day. 25 ms here leaves two orders of magnitude of headroom
# under the device budget (25% of one core, CLAUDE.md §4.8) on a CPU ~10× slower.
TERRAIN_TICK_BUDGET_S = 25e-3
# Daily save of a full world: device budget is 2 s; allow a tenth of it here.
WORLD_SAVE_BUDGET_S = 0.2


def test_bench_empty_step_one_second(benchmark: Any, config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS, [])
    benchmark(world.step, 1.0)
    assert benchmark.stats.stats.median < EMPTY_STEP_BUDGET_S


def test_bench_empty_step_one_day(benchmark: Any, config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS, [])
    benchmark(world.step, 86_400.0)
    assert benchmark.stats.stats.median < EMPTY_DAY_STEP_BUDGET_S


def test_bench_empty_save(benchmark: Any, config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS, [])
    world.step(10 * 86_400)
    benchmark(lambda: io.dumps(world.snapshot()))
    assert benchmark.stats.stats.median < EMPTY_SAVE_BUDGET_S


def test_bench_terrain_tick(benchmark: Any, config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS)
    benchmark(world.step, 86_400.0)
    assert benchmark.stats.stats.median < TERRAIN_TICK_BUDGET_S


def test_bench_world_save(benchmark: Any, config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS)
    world.step(10 * 86_400)
    benchmark(lambda: io.dumps(world.snapshot()))
    assert benchmark.stats.stats.median < WORLD_SAVE_BUDGET_S
