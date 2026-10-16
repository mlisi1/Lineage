"""Step cost of an empty world (CLAUDE.md §4.8 budgets start here)."""

from pathlib import Path
from typing import Any

from lineage_sim.config import Config
from lineage_sim.state import io
from lineage_sim.terrain import Terrain
from lineage_sim.world import World

EPOCH_UNIX_MS = 1_772_323_200_000
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "saves"
# Generous ceilings for CI machines; an empty world must be essentially free.
EMPTY_STEP_BUDGET_S = 50e-6
EMPTY_DAY_STEP_BUDGET_S = 500e-6
EMPTY_SAVE_BUDGET_S = 20e-3
# Terrain ticks once per sim-day. 25 ms here leaves two orders of magnitude of headroom
# under the device budget (25% of one core, CLAUDE.md §4.8) on a CPU ~10× slower.
TERRAIN_TICK_BUDGET_S = 25e-3
# A full sim-day of an inhabited world: terrain, flora, 24 fire ticks, 144 fauna ticks.
WORLD_DAY_BUDGET_S = 400e-3
# One fauna tick (every 10 sim-minutes) with 150 creatures. On a device 10× slower this
# is still under 0.01 % of a core.
FAUNA_TICK_BUDGET_S = 4e-3
# Daily save of a full world: device budget is 2 s; allow a tenth of it here.
WORLD_SAVE_BUDGET_S = 0.3


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
    world, _ = World.create(config, 1, EPOCH_UNIX_MS, [Terrain(config.terrain)])
    benchmark(world.step, 86_400.0)
    assert benchmark.stats.stats.median < TERRAIN_TICK_BUDGET_S


def test_bench_inhabited_world_day(benchmark: Any, config: Config) -> None:
    world = _inhabited_world(config)  # green, and about 200 creatures
    assert world.fauna.count > 100
    benchmark.pedantic(world.step, args=(86_400.0,), rounds=5, iterations=1)
    assert benchmark.stats.stats.median < WORLD_DAY_BUDGET_S


def _inhabited_world(config: Config) -> World:
    return World.restore(config, io.loads((FIXTURES / "v4.lzma").read_bytes()))


def test_bench_fauna_tick_at_150_creatures(benchmark: Any, config: Config) -> None:
    world = _inhabited_world(config)
    fauna = world.fauna
    state = fauna.get_state()
    for key in ("positions", "energy", "age_h", "idle_h", "heading", "genes", "weights",
                "slots", "ids", "origin", "generation", "learned", "trace", "noise",
                "baseline", "balance", "competent_h", "young_eaten", "young_burnt"):  # fmt: skip
        state[key] = state[key][:150]
    fauna.set_state(state)
    assert fauna.count == 150
    context = world._context(fauna, 600.0)  # pyright: ignore[reportPrivateUsage]

    def tick() -> None:
        fauna.set_state(state)  # same 150 creatures every round
        fauna.tick(context)

    benchmark.pedantic(tick, rounds=60, iterations=1)
    assert benchmark.stats.stats.median < FAUNA_TICK_BUDGET_S


def test_bench_world_save(benchmark: Any, config: Config) -> None:
    world = _inhabited_world(config)
    benchmark(lambda: io.dumps(world.snapshot()))
    assert benchmark.stats.stats.median < WORLD_SAVE_BUDGET_S
