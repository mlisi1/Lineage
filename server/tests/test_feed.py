"""The stream's feed (S1). The recordings are made through it too: `tools/tests/
test_stream.py` checks the feed's order of messages, a world's end and the land after
events, and that the committed recordings are what it writes."""

from __future__ import annotations

from pathlib import Path

import pytest
from lineage_server.feed import Feed
from lineage_sim.config import parse_config
from lineage_sim.state import io
from lineage_sim.world import World

REPO = Path(__file__).resolve().parents[2]
SAVE = REPO / "sim" / "tests" / "fixtures" / "saves" / "v9.lzma"
CONFIG = REPO / "sim" / "config" / "default.toml"


@pytest.fixture(scope="module")
def world() -> World:
    config = parse_config(CONFIG.read_text("utf-8"))
    return World.restore(config, io.loads(SAVE.read_bytes()))


def _born(messages: list[dict[str, object]]) -> list[int]:
    ids: list[int] = []
    for message in messages:
        if message["type"] == "creatures":
            born = message["born"]
            assert isinstance(born, list)
            ids += [entry["id"] for entry in born]  # pyright: ignore[reportUnknownVariableType]
    return ids


def test_a_client_connecting_gets_every_genome(world: World) -> None:
    feed = Feed(world)
    opening = feed.start(world)
    alive = sorted(int(ident) for ident in world.fauna.ids)
    assert sorted(_born(opening)) == alive
    # A later client gets them all again, and the broadcast still sends none of them twice.
    assert sorted(_born(feed.connect(world))) == alive
    assert _born(feed.advance(world, [], step=True)) == []


def test_nothing_due_and_nothing_happened_sends_nothing(world: World) -> None:
    feed = Feed(world)
    feed.start(world)
    assert feed.advance(world, []) == []


def test_what_is_due_is_sent_in_order(world: World) -> None:
    feed = Feed(world)
    feed.start(world)
    types = [m["type"] for m in feed.advance(world, [], step=True, sky_due=True, land_due=True)]
    assert types == ["clock", "land", "creatures", "sky"]
    quiet = Feed(world, creatures=False, sky=False)
    assert [m["type"] for m in quiet.start(world)] == ["clock", "land", "fauna", "species", "rare"]
    types = [m["type"] for m in quiet.advance(world, [], step=True, sky_due=True, land_due=True)]
    assert types == ["clock", "land"]
