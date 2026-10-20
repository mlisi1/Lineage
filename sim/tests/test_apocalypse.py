"""The end of a world and the start of the next (M10, ADR 0018).

A toy world (a Walker, the apocalypse and a scripted population) tests the hand-over
itself; the real world, loaded from the v9 fixture and emptied by a meteor, tests the
archive, the chronicle's last and first words, and the new continent.
"""

from __future__ import annotations

import dataclasses
from pathlib import Path

import numpy as np
import pytest
from lineage_sim.apocalypse import CAUSE_LAST_CREATURE, Apocalypse
from lineage_sim.config import Config, ConfigError, parse_config
from lineage_sim.events import (
    ChronicleEntry,
    CreaturesArrived,
    GodPower,
    InputEvent,
    OutputEvent,
    PopulationExtinct,
    WorldBegan,
    WorldCollapsed,
    WorldEnded,
)
from lineage_sim.rng import Streams
from lineage_sim.state import io
from lineage_sim.state.schema import StateError, Tree, WorldState
from lineage_sim.subsystem import Context, Subsystem
from lineage_sim.world import World

EPOCH_UNIX_MS = 1_772_323_200_000  # 2026-03-01 00:00 UTC
# The scripted population ticks as the toy "grazer" (every 7 hours).
TOY_SCHEDULE = "grazer = 25200\n"
DAY_S = 86_400
DAY_MS = DAY_S * 1000
LIFE_TICK_MS = 7 * 3600_000  # the grazer's period in TOY_SCHEDULE
FIXTURES = Path(__file__).resolve().parent / "fixtures" / "saves"


class Life:
    """A scripted population (named ``grazer`` for its schedule, every 7 hours): it lands
    on day ``land_day`` and dies out on day ``die_day`` of every world. ``mark`` is drawn
    from its stream when a world begins."""

    def __init__(self, land_day: float, die_day: float) -> None:
        self.land_ms = round(land_day * DAY_MS)
        self.die_ms = round(die_day * DAY_MS)
        self.alive = False
        self.landed = False
        self.mark = 0.0

    @property
    def name(self) -> str:
        return "grazer"

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        self.mark = float(ctx.rng.random())
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        if not self.landed and ctx.t_ms >= self.land_ms:
            self.alive = self.landed = True
            return [CreaturesArrived(ctx.t_ms, 10, True, 1.0, 1.0, 1)]
        if self.alive and ctx.t_ms >= self.die_ms:
            self.alive = False
            return [PopulationExtinct(ctx.t_ms)]
        return []

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {"alive": self.alive, "landed": self.landed, "mark": self.mark}

    def set_state(self, tree: Tree) -> None:
        self.alive = bool(tree["alive"])
        self.landed = bool(tree["landed"])
        self.mark = float(tree["mark"])


@pytest.fixture(scope="module")
def toy(default_config_text: str) -> Config:
    return parse_config(default_config_text + TOY_SCHEDULE)


def toy_world(config: Config, land_day: float = 1.0, die_day: float = 40.0, seed: int = 7) -> World:
    def factory(cfg: Config) -> list[Subsystem]:
        return [Life(land_day, die_day), Apocalypse(cfg.apocalypse)]

    world, _ = World.create(config, seed, EPOCH_UNIX_MS, factory=factory)
    return world


def first_tick_from(t_ms: int) -> int:
    """The scripted population's first tick at or after ``t_ms`` (never a multiple)."""
    return (t_ms // LIFE_TICK_MS + 1) * LIFE_TICK_MS


def of(outputs: list[OutputEvent], kind: type[OutputEvent]) -> list[OutputEvent]:
    return [o for o in outputs if isinstance(o, kind)]


# --- the hand-over --------------------------------------------------------------------


def test_the_last_death_of_established_life_ends_the_world_once(toy: Config) -> None:
    world = toy_world(toy)
    outputs = world.step(100 * DAY_S)  # the next world's life also ends, on its day 40
    ended = of(outputs, WorldEnded)
    began = of(outputs, WorldBegan)
    assert [e.world for e in ended if isinstance(e, WorldEnded)] == [1, 2]
    assert [b.world for b in began if isinstance(b, WorldBegan)] == [2, 3]
    assert world.number == 3
    first = ended[0]
    assert isinstance(first, WorldEnded)
    assert first.cause == CAUSE_LAST_CREATURE
    assert first.seed == 7
    # The first world died on day 40 (the 7-hour tick at or after it), the second 40 days
    # into its own clock, and the third has lived what is left of the 100 days.
    end_ms = first_tick_from(40 * DAY_MS)
    assert first.t_ms == end_ms
    assert world.unix_ms == EPOCH_UNIX_MS + 100 * DAY_MS
    assert world.t_ms == 100 * DAY_MS - 2 * end_ms


def test_the_next_world_begins_where_the_last_ended(toy: Config) -> None:
    world = toy_world(toy)
    outputs = world.step(50 * DAY_S)
    collapsed = of(outputs, WorldCollapsed)[0]
    ended = of(outputs, WorldEnded)[0]
    began = of(outputs, WorldBegan)[0]
    assert isinstance(collapsed, WorldCollapsed)
    assert isinstance(ended, WorldEnded)
    assert isinstance(began, WorldBegan)
    assert outputs.index(ended) < outputs.index(began)
    assert began.t_ms == 0
    assert began.seed == collapsed.next_seed == world.seed != 7
    assert began.epoch_unix_ms == world.epoch_unix_ms == EPOCH_UNIX_MS + ended.t_ms
    assert world.past_worlds == [
        {
            "world": 1,
            "seed": 7,
            "began_unix_ms": EPOCH_UNIX_MS,
            "ended_unix_ms": EPOCH_UNIX_MS + ended.t_ms,
            "cause": CAUSE_LAST_CREATURE,
            "species": 0,  # no species census in the toy world
        }
    ]
    # Every subsystem is new, with streams from the new seed; life landed again, on the
    # new world's own clock.
    life = world.subsystem("grazer")
    assert isinstance(life, Life)
    assert life.mark != ended.archive.subsystems["grazer"]["mark"]
    assert world.apocalypse.life_since_ms == first_tick_from(DAY_MS)


def test_a_landing_that_dies_before_it_is_established_is_not_the_end(toy: Config) -> None:
    world = toy_world(toy, land_day=1.0, die_day=20.0)  # established after 30 days
    outputs = world.step(60 * DAY_S)
    assert not of(outputs, WorldCollapsed)
    assert world.number == 1
    assert world.apocalypse.life_since_ms == -1  # waits for the next landing


def test_life_is_established_after_the_configured_days(default_config_text: str) -> None:
    text = default_config_text.replace("established_days = 30.0", "established_days = 10.0")
    world = toy_world(parse_config(text + TOY_SCHEDULE), land_day=1.0, die_day=20.0)
    assert of(world.step(60 * DAY_S), WorldEnded)


def test_the_next_seed_is_drawn_from_the_apocalypse_stream(toy: Config) -> None:
    seeds: list[int] = []
    for seed in (7, 7, 8):
        world = toy_world(toy, seed=seed)
        world.step(50 * DAY_S)
        seeds.append(world.seed)
    assert seeds[0] == seeds[1] != seeds[2]


def test_any_chunking_across_an_ending_gives_the_same_worlds(toy: Config) -> None:
    whole = toy_world(toy)
    whole_out = whole.step(100 * DAY_S)
    hourly = toy_world(toy)
    hourly_out: list[OutputEvent] = []
    for _ in range(100 * 24):
        hourly_out += hourly.step(3600)
    assert hourly.state_hash() == whole.state_hash()
    assert [type(o) for o in hourly_out] == [type(o) for o in whole_out]


def test_advance_to_unix_follows_the_desk_across_worlds(toy: Config) -> None:
    world = toy_world(toy)
    target = EPOCH_UNIX_MS + 75 * DAY_MS
    world.advance_to_unix(target)
    assert world.number == 2
    assert world.unix_ms == target
    stepped = toy_world(toy)
    stepped.step(75 * DAY_S)
    assert stepped.state_hash() == world.state_hash()


def test_a_save_after_an_ending_resumes_identically(toy: Config) -> None:
    world = toy_world(toy)
    world.step(50 * DAY_S)
    state = io.loads(io.dumps(world.snapshot()))
    assert state.world == 2
    assert len(state.worlds) == 1

    def factory(cfg: Config) -> list[Subsystem]:
        return [Life(1.0, 40.0), Apocalypse(cfg.apocalypse)]

    resumed = World.restore(toy, state, factory=factory)
    world.step(60 * DAY_S)
    resumed.step(60 * DAY_S)
    assert resumed.number == world.number == 3
    assert resumed.state_hash() == world.state_hash()


def test_the_archive_is_the_final_state_of_the_ended_world(toy: Config) -> None:
    world = toy_world(toy)
    ended = of(world.step(50 * DAY_S), WorldEnded)[0]
    assert isinstance(ended, WorldEnded)
    archive = ended.archive
    assert archive.world == 1
    assert archive.worlds == []
    assert archive.seed == 7
    assert archive.t_ms == ended.t_ms
    assert archive.subsystems["apocalypse"]["life_since_ms"] == first_tick_from(DAY_MS)
    assert io.state_hash(io.loads(io.dumps(archive))) == io.state_hash(archive)


def test_a_world_of_hand_picked_subsystems_cannot_start_over(toy: Config) -> None:
    subsystems: list[Subsystem] = [Life(1.0, 40.0), Apocalypse(toy.apocalypse)]
    world, _ = World.create(toy, 7, EPOCH_UNIX_MS, subsystems)
    with pytest.raises(RuntimeError, match="cannot start over"):
        world.step(50 * DAY_S)


def test_world_numbers_and_records_must_agree() -> None:
    tree = WorldState(seed=1, epoch_unix_ms=0, t_ms=0, world=2).to_tree()
    with pytest.raises(StateError, match="one record per world"):
        WorldState.from_tree(tree)
    tree["world"] = 0
    with pytest.raises(StateError, match="start at 1"):
        WorldState.from_tree(tree)


def test_established_days_must_not_be_negative(default_config_text: str) -> None:
    text = default_config_text.replace("established_days = 30.0", "established_days = -1.0")
    with pytest.raises(ConfigError, match="established_days"):
        parse_config(text)


# --- the real world --------------------------------------------------------------------


@pytest.fixture(scope="module")
def doomsday(config: Config) -> tuple[World, list[OutputEvent], WorldState]:
    """The v9 fixture world (day 520, inhabited) after a meteor whose blast covers the
    island; its state before the strike is returned too."""
    presence = dataclasses.replace(config.presence, meteor_blast_factor=1000.0)
    lethal = dataclasses.replace(config, presence=presence)
    world = World.restore(lethal, io.loads((FIXTURES / "v9.lzma").read_bytes()))
    assert world.fauna.count > 0
    before = world.snapshot()
    world.step(7 * DAY_S)  # past the fixture's god-power cooldown
    return world, world.apply(GodPower("meteor")), before


def test_a_meteor_over_the_whole_island_ends_the_real_world(
    doomsday: tuple[World, list[OutputEvent], WorldState],
) -> None:
    world, outputs, before = doomsday
    assert len(of(outputs, PopulationExtinct)) == 1
    assert len(of(outputs, WorldEnded)) == 1
    assert world.number == 2
    assert world.t_ms == 0
    assert world.fauna.count == 0  # founders come once plants cover the new island
    old = before.subsystems["terrain"]["height"]
    assert not np.array_equal(world.terrain.height, old)


def test_the_chronicle_tells_of_the_end_and_the_beginning(
    doomsday: tuple[World, list[OutputEvent], WorldState],
) -> None:
    world, outputs, _ = doomsday
    entries = [o for o in outputs if isinstance(o, ChronicleEntry)]
    kinds = [e.kind for e in entries]
    assert kinds[-3:] == ["last_creature", "world_end", "world_begin"]
    end, begin = entries[-2], entries[-1]
    assert end.importance == 5
    assert begin.importance == 4
    assert "world 2" in begin.text
    # The new world's chronicle starts with its beginning; the old one ends with its end.
    assert [e.kind for e in world.chronicle.entries()] == ["world_begin"]
    ended = of(outputs, WorldEnded)[0]
    assert isinstance(ended, WorldEnded)
    config = world.config
    archived = World.restore(config, io.loads(io.dumps(ended.archive)))
    assert archived.chronicle.entries()[-1].kind == "world_end"
    assert archived.number == 1
    assert len(archived.chronicle.bestiary()) == archived.species.count > 0


def test_the_apocalypse_only_watches(config: Config) -> None:
    """While no world ends, a world with the apocalypse evolves exactly as one without:
    it reads, never writes, and draws nothing."""
    from lineage_sim.world import default_subsystems

    state = io.loads((FIXTURES / "v7.lzma").read_bytes())  # inhabited
    others = {k: v for k, v in state.subsystems.items() if k != "apocalypse"}
    blind = dataclasses.replace(state, subsystems=others)
    without = [s for s in default_subsystems(config) if s.name != "apocalypse"]
    watched = World.restore(config, state)
    unwatched = World.restore(config, blind, without)
    watched.step(5 * DAY_S)
    unwatched.step(5 * DAY_S)
    a, b = watched.snapshot(), unwatched.snapshot()
    assert set(a.subsystems) - set(b.subsystems) == {"apocalypse"}
    for name, tree in b.subsystems.items():
        assert io.encode(a.subsystems[name]) == io.encode(tree), name
    fresh = Streams(state.seed)
    fresh.get("apocalypse")
    assert a.rng["apocalypse"] == fresh.get_state()["apocalypse"]  # never drawn from
    assert {k: v for k, v in a.rng.items() if k != "apocalypse"} == b.rng
