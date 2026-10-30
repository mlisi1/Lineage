"""The island the server keeps (S1): opening, catching up, living, saving, a world's end."""

from __future__ import annotations

import shutil
from pathlib import Path

import numpy as np
import pytest
from lineage_device.interface import (
    GodPowerPressed,
    PowerLost,
    PowerRestored,
    Presence,
    ViewPressed,
)
from lineage_server.island import Island
from lineage_server.settings import DEFAULT_SETTINGS, load_settings
from lineage_server.store import Store, save_name
from lineage_sim import clock
from lineage_sim.config import Config, parse_config
from lineage_sim.events import PresenceChanged
from lineage_sim.state import io
from lineage_sim.world import World

REPO = Path(__file__).resolve().parents[2]
SAVE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v9.lzma"
CONFIG = REPO / "sim" / "config" / "default.toml"
DAY = clock.MS_PER_DAY
MINUTE = 60_000
SETTINGS = load_settings(DEFAULT_SETTINGS)


@pytest.fixture(scope="module")
def config() -> Config:
    return parse_config(CONFIG.read_text("utf-8"))


@pytest.fixture(scope="module")
def saved_unix_ms(config: Config) -> int:
    return World.restore(config, io.loads(SAVE.read_bytes())).unix_ms


def _island(config: Config, data: Path, from_fixture: bool = True) -> Island:
    store = Store(data)
    if from_fixture and not store.saves():
        shutil.copy(SAVE, store.saves_dir / "2026-01-01T00-00-00.000Z.lzma")
    return Island(config, store, SETTINGS, seed=lambda: 77)


def _types(messages: list[dict[str, object]]) -> list[object]:
    return [message["type"] for message in messages]


def test_a_first_start_makes_world_one_and_saves_it(config: Config, tmp_path: Path) -> None:
    island = _island(config, tmp_path, from_fixture=False)
    opened = island.open(1_793_145_600_000)
    assert opened.save is None
    assert island.world.number == 1
    assert island.world.seed == 77
    assert [p.name for p in Store(tmp_path).saves()] == [save_name(1_793_145_600_000)]


def test_a_restart_without_downtime_goes_on_as_if_never_stopped(
    config: Config, tmp_path: Path, saved_unix_ms: int
) -> None:
    start = saved_unix_ms
    first = _island(config, tmp_path / "a")
    first.open(start)
    first.handle(Presence(True), start)
    # Polled as the server does (here every ten minutes), never a jump of the clock.
    for now in range(start, start + 5 * 60 * MINUTE + 1234, 10 * MINUTE):
        first.advance(now + 1234)
    cut = first.world.unix_ms
    first.save()
    shutil.copytree(tmp_path / "a", tmp_path / "b")
    again = _island(config, tmp_path / "b")
    opened = again.open(cut)
    assert opened.caught_up_ms == 0
    for island in (first, again):
        for now in range(cut, cut + 3 * 60 * MINUTE, 10 * MINUTE):
            island.advance(now + 10 * MINUTE)
    assert again.world.state_hash() == first.world.state_hash()


def test_a_restart_after_downtime_lives_it_with_the_owner_away(
    config: Config, tmp_path: Path, saved_unix_ms: int
) -> None:
    start = saved_unix_ms
    island = _island(config, tmp_path)
    island.open(start)
    island.handle(Presence(True), start)
    island.save()
    saves_before = len(Store(tmp_path).saves())
    later = start + 2 * DAY + 7 * 60 * MINUTE
    again = _island(config, tmp_path)
    opened = again.open(later)
    assert opened.caught_up_ms == later - start
    assert again.numbers.caught_up_days == pytest.approx((later - start) / DAY)
    assert again.numbers.catch_up_cpu_s > 0
    assert not again.world.presence.present
    # The same as a world that went on uninterrupted, the owner leaving at the cut.
    world = World.restore(config, io.loads(SAVE.read_bytes()))
    world.apply(PresenceChanged(True))
    world.apply(PresenceChanged(False))
    world.advance_to_unix(later)
    assert again.world.state_hash() == world.state_hash()
    # A save at each midnight on the way and one at the end; the retention keeps the newest
    # of each day, so every day crossed has one, and the newest is the end.
    saves = Store(tmp_path).saves()
    days = {path.name[:10] for path in saves}
    for day in range(start // DAY, later // DAY + 1):
        assert save_name(day * DAY)[:10] in days
    assert saves[-1].name == save_name(later)
    assert len(saves) > saves_before


def test_a_day_of_life_streams_creatures_light_and_land_on_the_sims_schedule(
    config: Config, tmp_path: Path, saved_unix_ms: int
) -> None:
    island = _island(config, tmp_path)
    island.open(saved_unix_ms)
    start_t = island.world.t_ms
    messages: list[dict[str, object]] = []
    # Polled every 7 wall-minutes, as a slow server would: nothing is missed or doubled.
    for now in range(saved_unix_ms + 7 * MINUTE, saved_unix_ms + DAY + 1, 7 * MINUTE):
        messages += island.advance(now)
    messages += island.advance(saved_unix_ms + DAY)
    types = _types(messages)
    fauna_s, presence_s = config.period_ms("fauna") // 1000, config.period_ms("presence") // 1000
    assert types.count("creatures") == 86_400 // fauna_s
    assert types.count("clock") == 86_400 // fauna_s
    assert types.count("sky") == 86_400 // presence_s
    assert types.count("land") >= 1
    times = [m["t_ms"] for m in messages if m["type"] == "creatures"]
    assert times == [start_t + (k + 1) * fauna_s * 1000 for k in range(len(times))]


def test_the_device_reaches_the_world_and_the_view_only_the_desk(
    config: Config, tmp_path: Path, saved_unix_ms: int
) -> None:
    island = _island(config, tmp_path)
    island.open(saved_unix_ms)
    now = saved_unix_ms + MINUTE
    view = island.handle(ViewPressed(), now)
    assert view.desk == [{"type": "view", "protocol": 1}]
    assert "view" not in _types(view.everyone)
    arrived = island.handle(Presence(True), now)
    assert [m for m in arrived.everyone if m["type"] == "sky"][-1]["present"] is True
    left = island.handle(Presence(False), now)
    skies = [m for m in left.everyone if m["type"] == "sky"]
    assert skies[-1]["present"] is False
    assert island.handle(Presence(False), now).everyone == []


def test_the_god_power_fires_and_the_led_says_it_cools_down(config: Config, tmp_path: Path) -> None:
    island = _island(config, tmp_path, from_fixture=False)
    start = 1_793_145_600_000
    island.open(start)
    assert not island.cooling_down
    power = island.handle(GodPowerPressed(), start + MINUTE)
    events = [e for m in power.everyone if m["type"] == "events" for e in m["events"]]  # type: ignore[union-attr]
    assert any(event["kind"] == "god_power" for event in events)  # type: ignore[index]
    assert island.cooling_down
    # Pressed again while it cools down: refused, nothing shown.
    again = island.handle(GodPowerPressed(), start + 2 * MINUTE)
    assert "events" not in _types(again.everyone)


def test_a_clock_that_jumps_ahead_is_caught_up_on_and_the_island_sent_anew(
    config: Config, tmp_path: Path, saved_unix_ms: int
) -> None:
    island = _island(config, tmp_path)
    island.open(saved_unix_ms)
    island.handle(Presence(True), saved_unix_ms)
    later = saved_unix_ms + round(SETTINGS.jump_seconds * 1000) + 10 * MINUTE
    messages = island.advance(later)
    types = _types(messages)
    # The opening alone, not every tick of the time jumped over.
    assert types[:4] == ["clock", "sky", "land", "fauna"]
    assert types.count("creatures") == 1
    assert island.world.unix_ms == later
    assert island.world.presence.present
    # A small step is lived as usual.
    assert "creatures" in _types(island.advance(later + 10 * MINUTE))


def test_power_lost_saves_at_once(config: Config, tmp_path: Path, saved_unix_ms: int) -> None:
    island = _island(config, tmp_path)
    island.open(saved_unix_ms)
    now = saved_unix_ms + 3 * MINUTE + 456
    island.handle(PowerLost(), now)
    assert Store(tmp_path).saves()[-1].name == save_name(now)
    island.handle(PowerRestored(), now + MINUTE)


def test_a_world_that_ends_is_archived_and_the_next_one_saved_and_streamed(
    config: Config, tmp_path: Path, saved_unix_ms: int
) -> None:
    island = _island(config, tmp_path)
    island.open(saved_unix_ms)
    fauna = island.world.fauna
    state = fauna.get_state()
    state["energy"] = np.full_like(state["energy"], -1e6)
    fauna.set_state(state)
    messages = island.advance(saved_unix_ms + 2 * config.period_ms("fauna"))
    assert island.world.number == 2
    archives = sorted(Store(tmp_path).archives_dir.iterdir())
    assert [p.name for p in archives] == [
        f"world-001-seed-{World.restore(config, io.loads(SAVE.read_bytes())).seed}.lzma"
    ]
    assert io.loads(archives[0].read_bytes()).world == 1
    newest = Store(tmp_path).saves()[-1]
    assert io.loads(newest.read_bytes()).world == 2
    types = _types(messages)
    assert "events" in types
    assert types.index("fauna") > types.index("events")
