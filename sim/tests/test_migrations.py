"""Every frozen fixture save upgrades to the current schema and passes invariants."""

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.config import Config
from lineage_sim.state import io
from lineage_sim.state.migrations import MIGRATIONS, migrate
from lineage_sim.state.schema import SCHEMA_VERSION, StateError, WorldState
from lineage_sim.world import World

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "saves"
EPOCH_2026_03_01 = 1_772_323_200_000


def _fixture(version: int) -> bytes:
    return (FIXTURES / f"v{version}.lzma").read_bytes()


def _check_invariants(state: WorldState) -> None:
    assert state.schema_version == SCHEMA_VERSION
    assert state.seed >= 0
    assert state.t_ms >= 0
    assert all(isinstance(name, str) for name in state.rng)


def test_every_version_has_a_fixture_and_a_migration() -> None:
    for version in range(SCHEMA_VERSION + 1):
        assert (FIXTURES / f"v{version}.lzma").exists(), f"missing fixture v{version}"
    assert sorted(MIGRATIONS) == list(range(SCHEMA_VERSION))


@pytest.mark.parametrize("version", range(SCHEMA_VERSION + 1))
def test_fixture_loads_and_runs(config: Config, version: int) -> None:
    state = io.loads(_fixture(version))
    _check_invariants(state)
    world = World.restore(config, state)
    world.step(3 * 86_400)
    after = world.snapshot()
    _check_invariants(after)
    height = after.subsystems["terrain"]["height"]
    assert height.shape == (config.terrain.grid_height, config.terrain.grid_width)
    assert float(height.min()) >= 0.0
    assert float(height.max()) <= 1.0
    assert 0.0 < world.terrain.land_fraction < 1.0


def test_v0_to_v1_values(config: Config) -> None:
    state = io.loads(_fixture(0))
    assert state.seed == 42
    assert state.epoch_unix_ms == EPOCH_2026_03_01
    assert state.t_ms == 90_061_500
    assert state.rng == {}
    assert World.restore(config, state).instant.date.isoformat() == "2026-03-02"


def test_v1_to_v2_keeps_values_and_grows_terrain(config: Config) -> None:
    state = io.loads(_fixture(1))
    assert state.seed == 42
    assert state.t_ms == 865_234_567
    assert state.subsystems == {}  # v1 had no terrain; restore generates it
    first, second = World.restore(config, state), World.restore(config, state)
    assert first.t_ms == 865_234_567
    assert first.state_hash() == second.state_hash()
    assert "terrain" in first.snapshot().subsystems


def test_v2_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(2))
    assert state.seed == 42
    assert state.t_ms == 30 * 86_400_000
    world = World.restore(config, state)
    assert world.terrain.landmass_count >= 1
    assert world.snapshot().subsystems["terrain"]["hotspots"].shape == (
        config.terrain.hotspot_count,
        7,
    )


def test_v2_world_wakes_up_bare_and_is_colonised(config: Config) -> None:
    world = World.restore(config, io.loads(_fixture(2)))
    assert float(world.flora.biomass.max()) == 0.0
    assert not world.wildfire.burning.any()
    world.step(150 * 86_400)
    assert float(world.flora.biomass.max()) > 0.2


def test_v3_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(3))
    assert state.seed == 42
    assert state.t_ms == 200 * 86_400_000
    assert sorted(state.subsystems) == ["fire", "flora", "terrain"]  # no fauna in v3
    world = World.restore(config, state)
    shares = world.flora.cover_shares()
    assert sum(shares.values()) == pytest.approx(1.0)
    assert world.flora.genome.shape == (8, 150, 256)
    assert world.flora.genome.dtype == np.uint8


def test_v3_world_wakes_up_without_creatures(config: Config) -> None:
    world = World.restore(config, io.loads(_fixture(3)))
    assert world.fauna.count == 0
    assert float(world.flora.biomass.max()) > 0.2  # the plants of the save are kept


def test_v4_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(4))
    assert state.seed == 42
    assert state.t_ms == 520 * 86_400_000
    assert sorted(state.subsystems) == ["fauna", "fire", "flora", "terrain"]
    world = World.restore(config, state)
    fauna = world.fauna
    assert fauna.count > 50
    assert fauna.genes.shape == (fauna.count, 11)
    assert len(set(fauna.ids.tolist())) == fauna.count


def test_migration_must_advance_version(monkeypatch: pytest.MonkeyPatch) -> None:
    broken: Callable[[dict[str, object]], dict[str, object]] = lambda tree: tree  # noqa: E731
    monkeypatch.setitem(MIGRATIONS, 0, broken)
    with pytest.raises(StateError, match="did not produce v1"):
        migrate({"schema_version": 0})


def test_invalid_version_is_rejected() -> None:
    with pytest.raises(StateError, match="invalid schema_version"):
        migrate({"schema_version": "1"})
