"""Every frozen fixture save upgrades to the current schema and passes invariants."""

from collections.abc import Callable
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.config import Config
from lineage_sim.fauna import brain
from lineage_sim.fauna.brain import Sense
from lineage_sim.fauna.genome import GENE_COUNT, Gene
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
    # No fauna in v3; loading migrates to the current version, which adds presence (v8)
    # and the chronicle (v9).
    assert sorted(state.subsystems) == ["chronicle", "fire", "flora", "presence", "terrain"]
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
    # Loading migrates to the current version, which adds species, presence, chronicle,
    # apocalypse.
    assert sorted(state.subsystems) == [
        "apocalypse", "chronicle", "fauna", "fire", "flora", "presence", "species",
        "terrain",
    ]  # fmt: skip
    world = World.restore(config, state)
    fauna = world.fauna
    assert fauna.count > 50
    assert fauna.genes.shape == (fauna.count, GENE_COUNT)
    assert len(set(fauna.ids.tolist())) == fauna.count


def test_v4_creatures_wake_up_as_non_learners(config: Config) -> None:
    world = World.restore(config, io.loads(_fixture(4)))
    fauna = world.fauna
    assert fauna.count > 50
    assert float(np.abs(fauna.genes[:, [Gene.LEARNING, Gene.EXPLORATION]]).max()) == 0.0
    assert float(np.abs(fauna.learned).max()) == 0.0
    assert (fauna.generation == 0).all()
    np.testing.assert_array_equal(fauna.competent_hours, fauna.age_hours)
    world.step(86_400)  # and they live on
    assert world.fauna.count > 0


def test_v5_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(5))
    assert state.seed == 42
    assert state.t_ms == 520 * 86_400_000
    fauna = World.restore(config, state).fauna
    assert fauna.count > 50
    assert int(fauna.generation.max()) > 0
    assert float(np.abs(fauna.learned).max()) > 0.0


def test_migration_must_advance_version(monkeypatch: pytest.MonkeyPatch) -> None:
    broken: Callable[[dict[str, object]], dict[str, object]] = lambda tree: tree  # noqa: E731
    monkeypatch.setitem(MIGRATIONS, 0, broken)
    with pytest.raises(StateError, match="did not produce v1"):
        migrate({"schema_version": 0})


def test_invalid_version_is_rejected() -> None:
    with pytest.raises(StateError, match="invalid schema_version"):
        migrate({"schema_version": "1"})


def test_v5_brains_steer_as_before_after_the_upgrade(config: Config) -> None:
    """v5 → v6 inserts zero weights for the plant-form and carrion senses: the old brain's drive is
    unchanged, whatever the new senses say."""
    raw = io.loads(_fixture(5))  # already upgraded to the current version by loading
    fauna = World.restore(config, raw).fauna
    weights = fauna.weights
    rng = np.random.Generator(np.random.PCG64(2))
    senses = rng.normal(0.0, 0.5, (fauna.count, brain.SENSE_COUNT)).astype(np.float32)
    quiet = senses.copy()
    quiet[:, [Sense.LOW_X, Sense.LOW_Y, Sense.WOODY_X, Sense.WOODY_Y, Sense.CARRION_X,
              Sense.CARRION_Y]] = 0.0  # fmt: skip
    np.testing.assert_array_equal(brain.think(weights, senses), brain.think(weights, quiet))
    assert fauna.learned.shape == (fauna.count, brain.LEARNED_COUNT)


def test_v6_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(6))
    assert state.seed == 42
    assert state.t_ms == 520 * 86_400_000
    fauna = World.restore(config, state).fauna
    assert fauna.count > 50
    assert fauna.weights.shape == (fauna.count, brain.WEIGHT_COUNT)


def test_v6_world_wakes_up_with_one_species_per_lineage(config: Config) -> None:
    state = io.loads(_fixture(6))
    assert state.subsystems["species"]["names"] == []  # v6 → v7 adds no species
    world = World.restore(config, state)
    lineages = sorted(set(world.fauna.origin.tolist()))
    world.step(86_400)  # the first census
    records = world.species.records()
    assert sorted(r.lineage for r in records) == lineages
    assert all(r.parent == 0 for r in records)
    assert sum(r.members for r in records) > 50


def test_v7_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(7))
    assert state.seed == 42
    assert state.t_ms == 520 * 86_400_000
    world = World.restore(config, state)
    species = world.species
    assert species.alive_count >= 1
    labels = species.species_of(world.fauna.ids)
    assert (labels > 0).all()  # saved at midnight, right after the census
    assert species.record(1).parent == 0


def test_v7_world_wakes_up_lit_with_the_button_ready(config: Config) -> None:
    state = io.loads(_fixture(7))  # v7 → v8 adds presence
    presence = state.subsystems["presence"]
    assert presence["present"] is True
    assert presence["light"] == 1.0
    assert presence["wet"] is False
    world = World.restore(config, state)
    assert world.presence.ready_t_ms <= world.t_ms
    assert world.fauna.daylight == 1.0


def test_v8_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(8))
    assert state.seed == 42
    assert state.t_ms == 520 * 86_400_000
    presence = state.subsystems["presence"]
    assert presence["present"] is False  # gone home at 18:00
    assert presence["wet"] is True  # rain used at noon
    world = World.restore(config, state)
    assert world.presence.ready_t_ms > world.t_ms
    assert world.fauna.daylight == config.presence.night_light
    assert world.wildfire.dryness(world.instant) == 0.0


def test_v8_world_gains_an_unprimed_chronicle(config: Config) -> None:
    state = io.loads(_fixture(8))  # v8 → v9 adds the chronicle
    chronicle = state.subsystems["chronicle"]
    assert chronicle["primed"] is False
    assert chronicle["birth"] == "2026-03-01"
    assert chronicle["entry_text"] == []
    world = World.restore(config, state)
    assert len(world.chronicle) == 0
    world.step(86_400.0)  # it takes stock in silence, then writes as things happen
    assert all(e.kind not in ("first_life", "first") for e in world.chronicle.entries())


def test_v9_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(9))
    assert state.seed == 42
    assert state.t_ms == 520 * 86_400_000
    world = World.restore(config, state)
    entries = world.chronicle.entries()
    kinds = [e.kind for e in entries]
    assert kinds[0] != "first_life" or entries[0].importance == 5
    assert "first_life" in kinds
    assert "dark_age" in kinds
    assert "dawn" in kinds
    assert "god_power" in kinds  # the ark on day 515
    assert [e.number for e in entries] == list(range(1, len(entries) + 1))
    assert len(world.chronicle.bestiary()) == world.species.count


def test_v9_upgrades_to_v10_as_the_first_world(config: Config) -> None:
    state = io.loads(_fixture(9))
    assert state.world == 1
    assert state.worlds == []
    world = World.restore(config, state)
    # Creatures live there: life counts as established since the world began.
    assert world.fauna.count > 0
    assert world.apocalypse.life_since_ms == 0
    assert world.apocalypse.established(world.t_ms)


def test_an_empty_world_upgrades_to_v10_waiting_for_founders(config: Config) -> None:
    world = World.restore(config, io.loads(_fixture(3)))  # plants only
    assert world.number == 1
    assert world.apocalypse.life_since_ms == -1


def test_v10_fixture_values(config: Config) -> None:
    state = io.loads(_fixture(10))
    assert state.world == 2
    assert state.seed == 660476933
    assert state.t_ms == 30 * 86_400_000
    assert state.worlds == [
        {
            "world": 1,
            "seed": 42,
            "began_unix_ms": EPOCH_2026_03_01,
            "ended_unix_ms": EPOCH_2026_03_01 + 527 * 86_400_000,
            "cause": "last_creature",
            "species": 9,
        }
    ]
    assert state.epoch_unix_ms == EPOCH_2026_03_01 + 527 * 86_400_000
    world = World.restore(config, state)
    assert world.chronicle.entries()[0].kind == "world_begin"
    assert world.fauna.count == 0  # founders wait for the plants of the new island
