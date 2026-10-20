"""Fast-forward across the end of a world (M10): archives, the world series, the owner's
schedule following the desk, and a power cut after an ending."""

from __future__ import annotations

import datetime as dt
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.config import Config, parse_config
from lineage_sim.state import io
from lineage_sim.world import World

from tools import replay
from tools.fastforward import DAY_MS, desk, epoch_unix_ms, fastforward, live_day
from tools.runs import DEFAULT_CONFIG, REPO_ROOT, read_run
from tools.schedules import day_events

FIXTURES = REPO_ROOT / "sim" / "tests" / "fixtures" / "saves"
EPOCH_2026_03_01 = 1_772_323_200_000
# A doomed island: founders land on the first day of summer whatever the plants, with
# hardly any energy, and life counts as established at once; they starve within weeks.
DOOM = (
    "fauna.founder_min_plant_cover=0.0",
    "fauna.arrival_delay_days=0.0",
    "fauna.founder_energy_share=0.01",
    "apocalypse.established_days=0.0",
)
SUMMER = dt.date(2026, 6, 1)


@pytest.fixture(scope="module")
def doomed(tmp_path_factory: pytest.TempPathFactory) -> Path:
    run_dir = tmp_path_factory.mktemp("runs") / "doomed"
    fastforward(0.08, [0], run_dir, start=SUMMER, snapshot_days=0, overrides=DOOM)
    return run_dir


def test_an_ended_world_is_archived_and_the_run_goes_on(doomed: Path) -> None:
    run = read_run(doomed)
    series = run.series[0]
    worlds = series["world"]
    assert worlds[0] == 1
    assert worlds[-1] >= 2
    assert np.all(np.diff(worlds) >= 0)
    ended = int(series["worlds_ended"][-1])
    assert ended == worlds[-1] - 1
    archives = sorted((doomed / "archives" / "0").iterdir())
    assert [p.name for p in archives] == [f"world-{n}.lzma" for n in range(1, ended + 1)]
    # The run lasted its 29 days on the desk's clock, whatever the worlds did.
    final = World.restore(run_config(doomed), io.loads((doomed / "saves" / "0.lzma").read_bytes()))
    assert final.unix_ms == epoch_unix_ms(SUMMER) + 29 * DAY_MS
    assert final.number == worlds[-1]


def test_an_archive_from_a_run_renders(doomed: Path, tmp_path: Path) -> None:
    archive = doomed / "archives" / "0" / "world-1.lzma"
    world = replay.load_world(archive, doomed / "config.toml")
    assert replay.history(world)["world"] == 1
    assert world.fauna.count == 0
    assert world.chronicle.entries()[-1].kind == "world_end"
    still = replay.render_still(world)
    assert still.shape[:2] == world.terrain.height.shape


def test_a_power_cut_after_an_ending_resumes_identically(tmp_path: Path) -> None:
    straight = fastforward(0.08, [0], tmp_path / "a", start=SUMMER, snapshot_days=0,
                           overrides=DOOM)  # fmt: skip
    cut = fastforward(0.08, [0], tmp_path / "b", start=SUMMER, snapshot_days=0,
                      overrides=DOOM, power_cut_day=25, save_days=3)  # fmt: skip
    assert read_run(tmp_path / "b").series[0]["world"][-1] >= 2
    assert cut.manifest.final_state_hashes == straight.manifest.final_state_hashes


def test_the_owner_keeps_the_desk_schedule_in_a_later_world() -> None:
    config = parse_config(DEFAULT_CONFIG.read_text(encoding="utf-8"))
    world = World.restore(config, io.loads((FIXTURES / "v10.lzma").read_bytes()))
    assert world.number == 2
    assert desk(world) == (42, EPOCH_2026_03_01)
    day_index = (world.unix_ms - EPOCH_2026_03_01) // DAY_MS
    assert day_index == 557
    events = day_events("office", 42, day_index, world.instant.date)
    start = world.unix_ms
    live_day(world, "office")
    assert world.unix_ms == start + DAY_MS
    # The fixture's owner is away; the day's last event leaves them as the schedule says.
    if events:
        assert world.presence.present == events[-1][1]


def run_config(run_dir: Path) -> Config:
    return parse_config((run_dir / "config.toml").read_text(encoding="utf-8"))
