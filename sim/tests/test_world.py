"""World loop: scheduling, calendar outputs, events, restore checks."""

import datetime as dt
from collections.abc import Callable

import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from lineage_sim.clock import MS_PER_DAY, Season
from lineage_sim.config import Config, ConfigError
from lineage_sim.events import DayStarted, InputEvent, OutputEvent, PresenceChanged, SeasonStarted
from lineage_sim.state.schema import StateError, Tree
from lineage_sim.world import Context, Subsystem, World

EPOCH_UNIX_MS = 1_772_323_200_000  # 2026-03-01 00:00 UTC (a Sunday)
HOUR_MS = 3_600_000


class Recorder:
    """Appends (name, t_ms) to a shared log on every tick."""

    def __init__(self, name: str, log: list[tuple[str, int]]) -> None:
        self._name = name
        self._log = log

    @property
    def name(self) -> str:
        return self._name

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        self._log.append((self._name, ctx.t_ms))
        return []

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {}

    def set_state(self, tree: Tree) -> None:
        pass


def test_new_world_starts_at_zero(config: Config) -> None:
    world, outputs = World.create(config, 1, EPOCH_UNIX_MS)
    assert world.t_ms == 0
    assert outputs == []
    assert world.instant.date == dt.date(2026, 3, 1)


def test_day_started_at_each_utc_midnight(config: Config) -> None:
    epoch = EPOCH_UNIX_MS + 22 * HOUR_MS  # created at 22:00
    world, _ = World.create(config, 1, epoch)
    outputs = world.step(3 * 86_400)
    assert outputs == [
        DayStarted(2 * HOUR_MS, dt.date(2026, 3, 2)),
        DayStarted(2 * HOUR_MS + MS_PER_DAY, dt.date(2026, 3, 3)),
        DayStarted(2 * HOUR_MS + 2 * MS_PER_DAY, dt.date(2026, 3, 4)),
    ]


def test_season_started_on_equinox(config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS)
    outputs = world.step(30 * 86_400)
    seasons = [o for o in outputs if isinstance(o, SeasonStarted)]
    assert seasons == [SeasonStarted(19 * MS_PER_DAY, Season.SPRING)]  # 2026-03-20
    days = [o for o in outputs if isinstance(o, DayStarted)]
    assert len(days) == 30
    # Calendar output comes first at a shared instant.
    index = outputs.index(seasons[0])
    assert outputs[index - 1] == DayStarted(19 * MS_PER_DAY, dt.date(2026, 3, 20))


def test_ticks_fire_at_period_multiples_in_registration_order(config: Config) -> None:
    schedule_config = Config(config.config_version, config.calendar, {"a": 3600.0, "b": 5400.0})
    log: list[tuple[str, int]] = []
    world, _ = World.create(
        schedule_config, 1, EPOCH_UNIX_MS, [Recorder("b", log), Recorder("a", log)]
    )
    world.step(3 * 3600)
    h = HOUR_MS
    assert log == [("a", h), ("b", 3 * h // 2), ("a", 2 * h), ("b", 3 * h), ("a", 3 * h)]


def test_tick_context(make_toy_world: Callable[[int], World]) -> None:
    world = make_toy_world(1)
    world.step(3600)
    walker = world.snapshot().subsystems["walker"]
    assert walker["ticks"] == 1


@settings(max_examples=40, deadline=None)
@given(chunks=st.lists(st.integers(0, 3 * MS_PER_DAY), min_size=1, max_size=12))
def test_chunking_does_not_change_the_world(
    toy_config: Config, toy_factory: Callable[[], list[Subsystem]], chunks: list[int]
) -> None:
    total = sum(chunks)
    chunked, _ = World.create(toy_config, 9, EPOCH_UNIX_MS, toy_factory())
    chunked_outputs: list[OutputEvent] = []
    for chunk in chunks:
        chunked_outputs += chunked.step(chunk / 1000)
    whole, _ = World.create(toy_config, 9, EPOCH_UNIX_MS, toy_factory())
    whole_outputs = whole.step(total / 1000)
    assert chunked.t_ms == whole.t_ms == total
    assert chunked.state_hash() == whole.state_hash()
    assert chunked_outputs == whole_outputs


def test_presence_event_reaches_subsystems(make_toy_world: Callable[[int], World]) -> None:
    world = make_toy_world(1)
    assert world.apply(PresenceChanged(present=True)) == []
    assert world.snapshot().subsystems["walker"]["present"] is True
    assert world.snapshot().subsystems["grazer"]["present"] is True


@pytest.mark.parametrize("dt_s", [-1.0, float("nan"), float("inf")])
def test_invalid_step_is_rejected(config: Config, dt_s: float) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS)
    with pytest.raises(ValueError, match="finite non-negative"):
        world.step(dt_s)


def test_time_never_goes_back(config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS)
    world.step(10)
    with pytest.raises(ValueError, match="cannot go back"):
        world.advance_to(5)


def test_step_rounds_to_milliseconds(config: Config) -> None:
    world, _ = World.create(config, 1, EPOCH_UNIX_MS)
    world.step(0.0004)
    world.step(1.2346)
    assert world.t_ms == 1235


def test_subsystem_without_schedule_is_rejected(config: Config) -> None:
    with pytest.raises(ConfigError, match="no \\[schedule\\] period"):
        World.create(config, 1, EPOCH_UNIX_MS, [Recorder("ghost", [])])


def test_duplicate_subsystems_are_rejected(toy_config: Config) -> None:
    with pytest.raises(ValueError, match="duplicate"):
        World.create(toy_config, 1, EPOCH_UNIX_MS, [Recorder("walker", [])] * 2)


def test_restore_requires_matching_subsystems(
    toy_config: Config, make_toy_world: Callable[[int], World]
) -> None:
    state = make_toy_world(1).snapshot()
    with pytest.raises(StateError, match="world expects"):
        World.restore(toy_config, state, [Recorder("walker", [])])
