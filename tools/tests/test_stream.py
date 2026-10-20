"""tools.stream: a recording of the state stream, for the renderer to play (R1)."""

from __future__ import annotations

import base64
import itertools
import json
from pathlib import Path

import pytest
from lineage_sim.config import parse_config
from lineage_sim.state import io
from lineage_sim.world import World

from tools import stream
from tools.runs import DEFAULT_CONFIG, REPO_ROOT

SAVE = REPO_ROOT / "sim" / "tests" / "fixtures" / "saves" / "v4.lzma"
RECORDING = REPO_ROOT / "renderer" / "public" / "stream" / "recording.json"


def _world() -> World:
    return World.restore(
        parse_config(DEFAULT_CONFIG.read_text("utf-8")), io.loads(SAVE.read_bytes())
    )


def test_a_recording_is_what_a_server_sends_day_by_day() -> None:
    world = _world()
    start = world.t_ms
    messages = stream.record(world, days=4, land_every=2, creatures=True)
    types = [message["type"] for message in messages]
    assert types[:3] == ["clock", "land", "fauna"]
    assert types.count("land") == 1 + 2
    assert types.count("clock") == 1 + 4
    assert world.t_ms == start + 4 * stream.MS_PER_DAY
    clocks = [message["t_ms"] for message in messages if message["type"] == "clock"]
    assert clocks == sorted(clocks)
    # Genomes are sent once: on connect, then only for the newly born.
    born = [
        b["id"] for message in messages if message["type"] == "creatures" for b in message["born"]
    ]
    assert len(born) == len(set(born))


def test_creatures_can_be_recorded_more_often_than_daily() -> None:
    world = _world()
    start = world.t_ms
    messages = stream.record(world, days=1, land_every=1, creatures=True, creatures_every_s=3600)
    types = [message["type"] for message in messages]
    # On connect, then each hour a clock and the creatures; the land once, at the day's end.
    assert types.count("creatures") == 1 + 24
    assert types.count("clock") == 1 + 24
    assert types.count("land") == 1 + 1
    times = [message["t_ms"] for message in messages if message["type"] == "creatures"]
    assert times == [start + hour * 3_600_000 for hour in range(25)]
    with pytest.raises(ValueError, match="divide"):
        stream.record(_world(), days=1, land_every=1, creatures=True, creatures_every_s=7000)


def test_new_chronicle_entries_follow_and_none_is_sent_twice() -> None:
    world = _world()
    before = len(world.chronicle.entries())
    messages = stream.record(world, days=30, land_every=30, creatures=True, creatures_every_s=21600)
    numbers = [
        entry["number"]
        for message in messages
        if message["type"] == "chronicle"
        for entry in message["entries"]
    ]
    # Only what was written while recording, each once, in order.
    assert numbers == list(range(before + 1, len(world.chronicle.entries()) + 1))
    assert numbers, "a month of the v4 world writes some history"
    # Species are sent again when the census changes, and only then.
    censuses = [message for message in messages if message["type"] == "species"]
    assert len(censuses) >= 2
    assert all(a != b for a, b in itertools.pairwise(censuses))


def test_the_sky_follows_the_office_schedule_and_the_button() -> None:
    world = _world()
    messages = stream.record(
        world,
        days=3,
        land_every=3,
        creatures=True,
        creatures_every_s=7200,
        sky_every_s=600,
        schedule="office",
        press_days=[2],
    )
    skies = [message for message in messages if message["type"] == "sky"]
    # On connect, then every ten minutes.
    assert len(skies) == 1 + 3 * 144
    assert [sky["t_ms"] for sky in skies] == sorted(sky["t_ms"] for sky in skies)
    lights = [sky["light"] for sky in skies]
    # The v4 world's first days are weekdays: dark nights, full days.
    assert min(lights) <= 0.06
    assert max(lights) == 1.0
    assert any(sky["present"] for sky in skies) and not all(sky["present"] for sky in skies)
    powers = [
        event
        for message in messages
        if message["type"] == "events"
        for event in message["events"]
        if event["kind"] == "god_power"
    ]
    assert len(powers) == 1
    assert powers[0]["power"] in {"meteor", "rain", "seed", "ark"}


def test_a_famine_ends_the_world_and_the_next_one_is_recorded() -> None:
    world = _world()
    messages = stream.record(
        world, days=3, land_every=1, creatures=True, creatures_every_s=7200, sky_every_s=3600,
        famine_day=2,
    )  # fmt: skip
    types = [message["type"] for message in messages]
    events = [
        (index, event)
        for index, message in enumerate(messages)
        if message["type"] == "events"
        for event in message["events"]
    ]
    ended = [index for index, event in events if event["kind"] == "world_ended"]
    began = [index for index, event in events if event["kind"] == "world_began"]
    assert len(ended) == 1 and len(began) == 1
    assert ended[0] < began[0]
    assert world.number == 2
    # The old world's last entries, then the next world is met as on connect.
    after = types[ended[0] + 1 :]
    assert after[:4] == ["chronicle", "clock", "sky", "land"]
    lands = [message for message in messages if message["type"] == "land"]
    seeds = [land["world"]["seed"] for land in lands]
    assert seeds[0] != seeds[-1]
    kinds = [
        entry["kind"]
        for message in messages
        if message["type"] == "chronicle"
        for entry in message["entries"]
    ]
    assert kinds.index("world_end") < kinds.index("world_begin")
    # Nothing lives in the new world at first.
    assert messages[-1]["type"] in {"sky", "events", "chronicle", "creatures"}
    last = [message for message in messages if message["type"] == "creatures"][-1]
    assert last["ids"] == []


def test_the_committed_recording_is_what_the_tool_writes(tmp_path: Path) -> None:
    """renderer/public/stream/recording.json: regenerate with the command in its README line."""
    out = tmp_path / "recording.json"
    stream.main([SAVE.as_posix(), "--out", out.as_posix(), "--days", "56", "--land-every", "28"])
    written = json.loads(out.read_text("utf-8"))
    committed = json.loads(RECORDING.read_text("utf-8"))
    assert committed["format"] == stream.FORMAT
    assert committed["messages"] == written["messages"], (
        "run `uv run python -m tools.stream sim/tests/fixtures/saves/v4.lzma "
        "--out renderer/public/stream/recording.json --days 56 --land-every 28`"
    )


WINTER = REPO_ROOT / "renderer" / "public" / "stream" / "winter.json"


@pytest.mark.slow
def test_the_committed_winter_recording_is_what_the_tool_writes(tmp_path: Path) -> None:
    """renderer/public/stream/winter.json: 186 sim-days to run, so nightly only."""
    out = tmp_path / "winter.json"
    stream.main(
        [
            SAVE.as_posix(),
            "--out",
            out.as_posix(),
            "--skip-days",
            "165",
            "--days",
            "21",
            "--land-every",
            "10",
        ]
    )
    written = json.loads(out.read_text("utf-8"))
    committed = json.loads(WINTER.read_text("utf-8"))
    assert committed["messages"] == written["messages"], (
        "run `uv run python -m tools.stream sim/tests/fixtures/saves/v4.lzma --out "
        "renderer/public/stream/winter.json --skip-days 165 --days 21 --land-every 10`"
    )
    # Snow lies on the hills in the simulation's own winter.
    lands = [message for message in committed["messages"] if message["type"] == "land"]
    snowy = sum(1 for byte in base64.b64decode(lands[-1]["snow"]["data"]) if byte > 0)
    assert snowy > len(base64.b64decode(lands[-1]["snow"]["data"])) / 10
