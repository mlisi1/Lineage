"""tools.stream: a recording of the state stream, for the renderer to play (R1)."""

from __future__ import annotations

import json
from pathlib import Path

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
