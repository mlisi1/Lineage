"""Same seed + config + event sequence ⇒ bit-identical state (CLAUDE.md §4.2)."""

from collections.abc import Callable

import pytest
from lineage_sim.config import Config
from lineage_sim.events import InputEvent, PresenceChanged
from lineage_sim.state import io
from lineage_sim.world import Subsystem, World

EPOCH_UNIX_MS = 1_772_323_200_000  # 2026-03-01 00:00 UTC
DAY_S = 86_400

# (seconds to step before the event, event). Office-ish presence over three days.
SCHEDULE: list[tuple[float, InputEvent]] = [
    (9 * 3600, PresenceChanged(present=True)),
    (8.5 * 3600, PresenceChanged(present=False)),
    (15.5 * 3600 + 9 * 3600, PresenceChanged(present=True)),
    (8 * 3600, PresenceChanged(present=False)),
]

# Golden hashes. Change only with an explanation in the commit message (CLAUDE.md §6).
# They change with every schema bump because the hashed state includes schema_version
# (M2: 1 -> 2, M3: 2 -> 3, M4: 3 -> 4); nothing else in these worlds changed.
GOLDEN_TOY_SEED_42 = "49020afc5379d7f32ae821ce2750d22b66295f01eede9c0629180ff146ea48ea"
GOLDEN_EMPTY_SEED_42 = "f02e3aab278777e77ef931a31c6027c0745f5f3e8a2feaaae7e226000ff211c3"


def _run(world: World, days: float = 3) -> World:
    elapsed = 0.0
    for dt_s, event in SCHEDULE:
        world.step(dt_s)
        world.apply(event)
        elapsed += dt_s
    world.step(days * DAY_S - elapsed)
    return world


def test_two_runs_are_identical(make_toy_world: Callable[[int], World]) -> None:
    assert _run(make_toy_world(42)).state_hash() == _run(make_toy_world(42)).state_hash()


def test_seed_changes_the_world(make_toy_world: Callable[[int], World]) -> None:
    assert _run(make_toy_world(42)).state_hash() != _run(make_toy_world(43)).state_hash()


def test_events_change_the_world(make_toy_world: Callable[[int], World]) -> None:
    quiet = make_toy_world(42)
    quiet.step(3 * DAY_S)
    assert quiet.state_hash() != _run(make_toy_world(42)).state_hash()


def test_golden_hash_toy(make_toy_world: Callable[[int], World]) -> None:
    assert _run(make_toy_world(42)).state_hash() == GOLDEN_TOY_SEED_42


def test_golden_hash_empty(config: Config) -> None:
    world, _ = World.create(config, 42, EPOCH_UNIX_MS, [])
    assert _run(world).state_hash() == GOLDEN_EMPTY_SEED_42


def test_subsystem_order_and_presence_do_not_cross_streams(
    toy_config: Config, toy_factory: Callable[[], list[Subsystem]]
) -> None:
    walker, grazer = toy_factory()
    alone, _ = World.create(toy_config, 5, EPOCH_UNIX_MS, [walker])
    reversed_subs = list(reversed(toy_factory()))
    both, _ = World.create(toy_config, 5, EPOCH_UNIX_MS, reversed_subs)
    alone.step(10 * DAY_S)
    both.step(10 * DAY_S)
    del grazer
    a = alone.snapshot().subsystems["walker"]
    b = both.snapshot().subsystems["walker"]
    assert a["position"] == b["position"]
    assert a["trail"].tobytes() == b["trail"].tobytes()
    assert alone.snapshot().rng["walker"] == both.snapshot().rng["walker"]


@pytest.mark.parametrize("cut_s", [1.0, 3600.0, 1.5 * DAY_S, 2 * DAY_S + 7 * 3600 + 0.123])
def test_save_load_continue_equals_uninterrupted(
    make_toy_world: Callable[[int], World],
    restore_toy_world: Callable[[World], World],
    cut_s: float,
) -> None:
    straight = make_toy_world(11)
    straight.step(3 * DAY_S)

    interrupted = make_toy_world(11)
    interrupted.step(cut_s)
    resumed = restore_toy_world(interrupted)
    resumed.step(3 * DAY_S - cut_s)
    assert resumed.t_ms == straight.t_ms
    assert resumed.state_hash() == straight.state_hash()


def test_three_years_daily_saves_survive_a_power_cut(
    toy_config: Config, toy_factory: Callable[[], list[Subsystem]]
) -> None:
    """M1 done-criterion: fast-forward 3 sim-years saving daily; a power cut mid-run loses
    the in-memory world; resuming from the last daily save ends bit-identical."""
    days = 3 * 365 + 1
    cut_day, cut_offset_s = 500, 13 * 3600 + 17.5  # power fails mid-afternoon

    straight, _ = World.create(toy_config, 2026, EPOCH_UNIX_MS, toy_factory())
    for _ in range(days):
        straight.step(DAY_S)

    world, _ = World.create(toy_config, 2026, EPOCH_UNIX_MS, toy_factory())
    last_save = io.dumps(world.snapshot())
    for _ in range(cut_day):
        world.step(DAY_S)
        last_save = io.dumps(world.snapshot())
    world.step(cut_offset_s)
    del world  # power cut: everything since the last save is lost

    resumed = World.restore(toy_config, io.loads(last_save), toy_factory())
    assert resumed.t_ms == cut_day * DAY_S * 1000
    for _ in range(days - cut_day):
        resumed.step(DAY_S)
        last_save = io.dumps(resumed.snapshot())
    assert resumed.state_hash() == straight.state_hash()
    assert io.loads(last_save).t_ms == days * DAY_S * 1000
