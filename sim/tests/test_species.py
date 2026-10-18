"""Species (M6): clustering stability, splits, names, phylogeny."""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from lineage_sim import clock
from lineage_sim.config import Config, SpeciesConfig
from lineage_sim.events import OutputEvent, SpeciesBorn, SpeciesExtinct
from lineage_sim.fauna.genome import GENE_COUNT, Gene
from lineage_sim.species import (
    Species,
    SpeciesRecord,
    components,
    daughter_name,
    display,
    root_name,
    syllable,
)
from lineage_sim.state import io
from lineage_sim.subsystem import Context
from lineage_sim.world import World
from numpy.random import PCG64, Generator
from numpy.typing import NDArray

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "saves"
EPOCH = 1_772_323_200_000  # 2026-03-01 00:00 UTC
DAY_S = 86_400.0
LINK = 0.10
CFG = SpeciesConfig(link_distance=LINK, min_members=5, predator_min_members=3, split_days=7.0)


@dataclass
class Herd:
    """A population double: creatures are rows; tests edit them between censuses."""

    ids: NDArray[np.int64] = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    genes: NDArray[np.float32] = field(
        default_factory=lambda: np.zeros((0, GENE_COUNT), dtype=np.float32)
    )
    origin: NDArray[np.int32] = field(default_factory=lambda: np.zeros(0, dtype=np.int32))
    next_id: int = 1

    def add(self, genes: NDArray[np.float32], origin: int) -> NDArray[np.int64]:
        count = genes.shape[0]
        new = np.arange(self.next_id, self.next_id + count, dtype=np.int64)
        self.next_id += count
        self.ids = np.concatenate([self.ids, new])
        self.genes = np.concatenate([self.genes, genes.astype(np.float32)])
        self.origin = np.concatenate([self.origin, np.full(count, origin, dtype=np.int32)])
        return new

    def remove(self, ids: NDArray[np.int64]) -> None:
        keep = ~np.isin(self.ids, ids)
        self.ids, self.genes, self.origin = self.ids[keep], self.genes[keep], self.origin[keep]


def group(base: float, count: int, seed: int = 0, spread: float = 0.01) -> NDArray[np.float32]:
    """``count`` genomes near the genome with every gene at ``base``."""
    rng = Generator(PCG64(seed))
    noise = rng.uniform(-spread, spread, (count, GENE_COUNT))
    return np.clip(base + noise, 0.0, 1.0).astype(np.float32)


class Census:
    """A species subsystem over a herd, ticked once a day by hand."""

    def __init__(self, config: Config, cfg: SpeciesConfig = CFG) -> None:
        self.calendar = config.calendar
        self.herd = Herd()
        self.species = Species(cfg, self.herd)
        self.day = 0

    def tick(self, days: int = 1) -> list[OutputEvent]:
        outputs: list[OutputEvent] = []
        for _ in range(days):
            self.day += 1
            t_ms = self.day * clock.MS_PER_DAY
            instant = clock.instant(EPOCH, t_ms, self.calendar)
            ctx = Context(t_ms, DAY_S, instant, Generator(PCG64(0)))
            outputs += self.species.tick(ctx)
        return outputs

    def labels(self) -> NDArray[np.int64]:
        return self.species.species_of(self.herd.ids)


def born(outputs: list[OutputEvent]) -> list[SpeciesBorn]:
    return [e for e in outputs if isinstance(e, SpeciesBorn)]


def extinct(outputs: list[OutputEvent]) -> list[SpeciesExtinct]:
    return [e for e in outputs if isinstance(e, SpeciesExtinct)]


def check_phylogeny(records: list[SpeciesRecord]) -> None:
    """A valid forest: ids 1..n in order of birth, parents older, names unique."""
    assert [r.id for r in records] == list(range(1, len(records) + 1))
    by_id = {r.id: r for r in records}
    for r in records:
        if r.parent:
            parent = by_id[r.parent]
            assert parent.id < r.id
            assert parent.born_t_ms <= r.born_t_ms
            assert parent.lineage == r.lineage
        if not r.alive:
            assert r.extinct_t_ms >= r.born_t_ms
            assert r.members == 0
        assert r.peak >= r.members
    assert len({r.name for r in records}) == len(records)


# -- units --


def test_components() -> None:
    linked = np.zeros((6, 6), dtype=np.bool_)
    for a, b in [(0, 3), (3, 5), (1, 4)]:
        linked[a, b] = linked[b, a] = True
    np.testing.assert_array_equal(components(linked), [0, 1, 2, 0, 1, 0])
    assert components(np.zeros((0, 0), dtype=np.bool_)).size == 0


def test_components_of_a_chain_in_reverse() -> None:
    n = 40  # node i linked to i + 1: the smallest label must travel the whole chain
    linked = np.zeros((n, n), dtype=np.bool_)
    idx = np.arange(n - 1)
    linked[idx, idx + 1] = linked[idx + 1, idx] = True
    assert (components(linked) == 0).all()


def test_syllables_cover_the_gene_range() -> None:
    assert syllable(0.0, 0.0) == "ba"
    assert syllable(1.0, 1.0) == "shu"
    assert syllable(0.5, 0.5) == "ni"


def test_root_names_are_deterministic_and_unique() -> None:
    genes = group(0.3, 1)[0]
    first = root_name(genes, set())
    assert len(first) == 3
    assert root_name(genes, set()) == first
    taken = {display(first)}
    second = root_name(genes, taken)
    assert second[:3] == first
    assert display(second) not in taken
    # Even if every one-syllable extension is taken, a new name is found.
    taken |= {display([*first, o + v]) for o in "bdfghklmnprstvz" for v in "aeiou"}
    taken |= {display([*first, "sh" + v]) for v in "aeiou"}
    assert display(root_name(genes, taken)) not in taken


def test_daughter_keeps_the_stem_and_names_the_divergence() -> None:
    parent = ["ta", "vo", "ru"]
    mother = np.full(GENE_COUNT, 0.5, dtype=np.float32)
    daughter = mother.copy()
    daughter[Gene.ARMOUR] = 0.95  # diverged most on armour, to a high value
    name = daughter_name(parent, daughter, mother, set())
    assert name == ["ta", "vo", "hu"]  # 'h' is the onset of ARMOUR, 'u' a high value
    taken = {display(name)}
    assert daughter_name(parent, daughter, mother, taken)[:2] == parent[:2]
    assert display(daughter_name(parent, daughter, mother, taken)) not in taken


# -- scenarios --


def test_founders_found_one_species_and_newborns_join_it(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 20), origin=0)
    outputs = census.tick()
    assert len(born(outputs)) == 1
    event = born(outputs)[0]
    assert (event.species_id, event.parent, event.members) == (1, 0, 20)
    assert (census.labels() == 1).all()

    census.herd.add(group(0.3, 6, seed=1), origin=0)  # their young
    assert census.tick() == []
    assert (census.labels() == 1).all()
    assert census.species.record(1).members == 26


def test_arrivals_of_a_new_lineage_found_a_root_species(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 20), origin=0)
    census.tick()
    census.herd.add(group(0.7, 8), origin=1)
    outputs = census.tick()
    assert [(e.species_id, e.parent, e.members) for e in born(outputs)] == [(2, 0, 8)]
    assert census.species.alive_count == 2
    assert born(outputs)[0].name != census.species.record(1).name


def test_a_divided_species_splits_once_after_split_days(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 12), origin=0)
    census.tick()
    census.herd.add(group(0.7, 10, seed=2), origin=0)  # young of its lineage, far off
    outputs: list[OutputEvent] = []
    for _ in range(int(CFG.split_days) - 1):
        outputs += census.tick()
    assert born(outputs) == []  # divided, but not yet for long enough
    outputs = census.tick()
    assert len(born(outputs)) == 1
    daughter = born(outputs)[0]
    assert (daughter.species_id, daughter.parent, daughter.members) == (2, 1, 10)
    labels = census.labels()
    assert (labels[:12] == 1).all()  # the larger group keeps the species
    assert (labels[12:] == 2).all()
    assert census.species.record(2).name[:4] == census.species.record(1).name[:4]
    assert born(census.tick(30)) == []  # and never splits again


def test_a_small_predator_pack_splits_where_a_herd_would_not(config: Config) -> None:
    """Predators have their own cap, so their species split from smaller groups."""
    small = SpeciesConfig(link_distance=LINK, min_members=8, predator_min_members=4, split_days=1.0)

    def pack(diet: float) -> int:
        census = Census(config, small)
        census.species = Species(small, census.herd, predator_min_diet=0.65)
        near = group(0.3, 5)
        far = group(0.6, 5, seed=1)
        near[:, Gene.DIET] = far[:, Gene.DIET] = diet
        census.herd.add(near, origin=0)
        census.tick()  # one species, its centroid's diet now known
        census.herd.add(far, origin=0)
        return len(born(census.tick(3)))

    assert pack(0.9) == 1  # hunters: two groups of 5 make two species
    assert pack(0.1) == 0  # grazers: groups of 5 are strays


def test_a_short_separation_does_not_split(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 12), origin=0)
    far = census.herd.add(group(0.7, 10, seed=2), origin=0)
    census.herd.genes[-10:] = group(0.3, 10, seed=3)
    census.tick()  # all one species
    census.herd.genes[-10:] = group(0.7, 10, seed=2)
    census.tick(int(CFG.split_days) - 1)  # apart, but not long enough...
    census.herd.remove(far[:6])  # ...then the far group dwindles below min_members
    assert born(census.tick(30)) == []
    assert census.species.alive_count == 1


def test_strays_too_few_for_a_species_stay(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 30), origin=0)
    census.tick()
    census.herd.add(group(0.8, CFG.min_members - 1, seed=4), origin=0)
    assert born(census.tick(30)) == []
    assert (census.labels() == 1).all()


def test_extinction_is_reported_once(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 10), origin=0)
    hunters = census.herd.add(group(0.8, 8, seed=5), origin=1)
    census.tick()
    census.herd.remove(hunters)
    outputs = census.tick()
    assert [(e.species_id, e.born_t_ms) for e in extinct(outputs)] == [(2, clock.MS_PER_DAY)]
    assert extinct(census.tick(5)) == []
    record = census.species.record(2)
    assert not record.alive
    assert record.extinct_t_ms == 2 * clock.MS_PER_DAY
    assert record.lived_days(0) == 1.0
    assert census.species.alive_count == 1


def test_labels_now_resolves_newborns_without_changing_anything(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 10), origin=0)
    census.tick()
    before = io.encode(census.species.get_state())
    census.herd.add(group(0.3, 3, seed=7), origin=0)  # born since the census
    census.herd.add(group(0.8, 4, seed=8), origin=1)  # strangers landed since
    np.testing.assert_array_equal(census.species.labels_now(), [1] * 13 + [0] * 4)
    assert io.encode(census.species.get_state()) == before
    assert census.species.count == 1


def test_orphans_join_their_lineages_living_species(config: Config) -> None:
    """Young born after the last census whose parents all died since join the species of
    their lineage still on record, rather than founding a new one."""
    census = Census(config)
    parents = census.herd.add(group(0.3, 10), origin=0)
    census.tick()
    census.herd.remove(parents)
    census.herd.add(group(0.3, 4, seed=6), origin=0)
    outputs = census.tick()
    assert outputs == []
    assert (census.labels() == 1).all()


@settings(max_examples=25, deadline=None)
@given(
    seed=st.integers(0, 2**31 - 1),
    spread=st.floats(0.0, 0.03),
    churn=st.integers(0, 10),
)
def test_small_noise_never_splits_a_species(
    config: Config, seed: int, spread: float, churn: int
) -> None:
    """Genomes scattered by much less than the link distance stay one species while members
    die and are born every day."""
    census = Census(config)
    rng = Generator(PCG64(seed))
    base = float(rng.uniform(0.1, 0.9))
    census.herd.add(group(base, 40, seed, spread), origin=0)
    outputs = census.tick()
    for day in range(30):
        dead = rng.choice(census.herd.ids, size=min(churn, census.herd.ids.size), replace=False)
        census.herd.remove(dead)
        census.herd.add(group(base, churn, seed + day + 1, spread), origin=0)
        outputs += census.tick()
    assert len(born(outputs)) == 1
    assert census.species.alive_count == 1


def test_state_round_trip(config: Config) -> None:
    census = Census(config)
    census.herd.add(group(0.3, 12), origin=0)
    census.herd.add(group(0.7, 10, seed=2), origin=1)
    census.tick(3)
    tree = census.species.get_state()
    copy = Species(CFG, census.herd)
    copy.set_state(io.decode(io.encode(tree)))
    assert io.encode(copy.get_state()) == io.encode(tree)
    assert [r.name for r in copy.records()] == [r.name for r in census.species.records()]


# -- in a real world --


@pytest.fixture(scope="module")
def inhabited(config: Config) -> World:
    """The v6 fixture world (520 days, creatures present) run on for 20 days."""
    world = World.restore(config, io.loads((FIXTURES / "v6.lzma").read_bytes()))
    world.step(20 * DAY_S)
    return world


def test_every_creature_has_a_species_after_a_census(inhabited: World) -> None:
    world = inhabited
    labels = world.species.species_of(world.fauna.ids)
    newborns = labels == 0  # born since today's midnight census
    assert np.count_nonzero(~newborns) > 0
    records = world.species.records()
    alive = [r for r in records if r.alive]
    assert alive
    assert world.species.alive_count == len(alive)
    assert set(labels[~newborns].tolist()) <= {r.id for r in alive}
    check_phylogeny(records)


def test_two_worlds_name_their_species_alike(config: Config, inhabited: World) -> None:
    again = World.restore(config, io.loads((FIXTURES / "v6.lzma").read_bytes()))
    again.step(20 * DAY_S)
    assert again.state_hash() == inhabited.state_hash()
    assert [r.name for r in again.species.records()] == [
        r.name for r in inhabited.species.records()
    ]
