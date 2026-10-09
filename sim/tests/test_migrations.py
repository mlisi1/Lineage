"""Every frozen fixture save upgrades to the current schema and passes invariants."""

from collections.abc import Callable
from pathlib import Path

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
    _check_invariants(world.snapshot())


def test_v0_to_v1_values(config: Config) -> None:
    state = io.loads(_fixture(0))
    assert state.seed == 42
    assert state.epoch_unix_ms == EPOCH_2026_03_01
    assert state.t_ms == 90_061_500
    assert state.rng == {}
    assert World.restore(config, state).instant.date.isoformat() == "2026-03-02"


def test_v1_fixture_values() -> None:
    state = io.loads(_fixture(1))
    assert state.seed == 42
    assert state.t_ms == 865_234_567
    assert state.subsystems == {}


def test_migration_must_advance_version(monkeypatch: pytest.MonkeyPatch) -> None:
    broken: Callable[[dict[str, object]], dict[str, object]] = lambda tree: tree  # noqa: E731
    monkeypatch.setitem(MIGRATIONS, 0, broken)
    with pytest.raises(StateError, match="did not produce v1"):
        migrate({"schema_version": 0})


def test_invalid_version_is_rejected() -> None:
    with pytest.raises(StateError, match="invalid schema_version"):
        migrate({"schema_version": "1"})
