"""Chronicle and bestiary (M9): each detector fires exactly once on its scenario, the
filters drop what they should, templates render, state survives a save."""

from __future__ import annotations

import dataclasses
from collections.abc import Sequence
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest
from lineage_sim import clock
from lineage_sim.chronicle import (
    CREATURE_GENE_NAMES,
    PLANT_GENE_NAMES,
    TEMPLATES,
    Chronicle,
    Kind,
    span,
)
from lineage_sim.config import ChronicleConfig, Config, SpeciesConfig
from lineage_sim.events import (
    ChronicleEntry,
    CraterFormed,
    EarthquakeStruck,
    FireEnded,
    FireStarted,
    GodPowerUsed,
    LandmassesRejoined,
    LandmassSplit,
    OutputEvent,
    PopulationExtinct,
    PresenceChanged,
    SeasonStarted,
    VolcanoErupted,
)
from lineage_sim.fauna.genome import GENE_COUNT, Gene
from lineage_sim.flora import Rare as PlantRare
from lineage_sim.rare import CreatureRare
from lineage_sim.rng import CHRONICLE, new_generator
from lineage_sim.species import Species
from lineage_sim.state import io
from lineage_sim.state.schema import Tree
from lineage_sim.subsystem import Context
from lineage_sim.world import World
from numpy.typing import NDArray

FIXTURES = Path(__file__).resolve().parent / "fixtures" / "saves"
EPOCH = 1_772_323_200_000  # 2026-03-01 00:00 UTC
DAY_MS = clock.MS_PER_DAY
SPECIES_CFG = SpeciesConfig(link_distance=0.1, min_members=5, predator_min_members=3, split_days=3)
W, H = 40, 20  # two landmasses: x < 18 and x > 22, sea between


@dataclass
class Herd:
    """Animals and census double: creatures are rows that tests edit between days."""

    ids: NDArray[np.int64] = field(default_factory=lambda: np.zeros(0, dtype=np.int64))
    genes: NDArray[np.float32] = field(
        default_factory=lambda: np.zeros((0, GENE_COUNT), dtype=np.float32)
    )
    origin: NDArray[np.int32] = field(default_factory=lambda: np.zeros(0, dtype=np.int32))
    positions: NDArray[np.float32] = field(
        default_factory=lambda: np.zeros((0, 2), dtype=np.float32)
    )
    slots: NDArray[np.uint16] = field(default_factory=lambda: np.zeros(0, dtype=np.uint16))
    next_id: int = 1

    @property
    def count(self) -> int:
        return int(self.ids.size)

    def add(
        self, count: int, origin: int, *, gene: float = 0.3, x: float = 5.0, slots: int = 0,
        **genes: float,
    ) -> NDArray[np.int64]:  # fmt: skip
        new = np.arange(self.next_id, self.next_id + count, dtype=np.int64)
        self.next_id += count
        genome = np.full((count, GENE_COUNT), gene, dtype=np.float32)
        for name, value in genes.items():
            genome[:, Gene[name.upper()]] = value
        self.ids = np.concatenate([self.ids, new])
        self.genes = np.concatenate([self.genes, genome])
        self.origin = np.concatenate([self.origin, np.full(count, origin, dtype=np.int32)])
        where = np.column_stack([np.full(count, x), np.full(count, 10.0)]).astype(np.float32)
        self.positions = np.concatenate([self.positions, where])
        self.slots = np.concatenate([self.slots, np.full(count, slots, dtype=np.uint16)])
        return new

    def remove(self, ids: NDArray[np.int64]) -> None:
        keep = ~np.isin(self.ids, ids)
        self.ids, self.genes, self.origin = self.ids[keep], self.genes[keep], self.origin[keep]
        self.positions, self.slots = self.positions[keep], self.slots[keep]

    def move(self, ids: NDArray[np.int64], x: float) -> None:
        self.positions[np.isin(self.ids, ids), 0] = x


@dataclass
class Land:
    land: NDArray[np.bool_] = field(default_factory=lambda: np.zeros((H, W), dtype=np.bool_))

    def __post_init__(self) -> None:
        self.land[:, :18] = True
        self.land[:, 23:] = True

    @property
    def landmass_labels(self) -> NDArray[np.int32]:
        labels = np.zeros((H, W), dtype=np.int32)
        labels[:, :18] = 1
        labels[:, 23:] = 2
        return labels


@dataclass
class Plants:
    biomass: NDArray[np.float32] = field(default_factory=lambda: np.ones((H, W), dtype=np.float32))
    rare: NDArray[np.uint8] = field(default_factory=lambda: np.zeros((H, W), dtype=np.uint8))
    forest: float = 0.0

    def closed_forest_share(self) -> float:
        return self.forest


@dataclass
class Sun:
    present: bool = True
    absent_hours: float = 0.0


def chronicle_config(config: Config, **changes: float) -> ChronicleConfig:
    return dataclasses.replace(config.chronicle, **changes)


class Island:
    """A chronicle over hand-built land, plants, sun and a herd with a real census."""

    def __init__(self, cfg: ChronicleConfig, config: Config) -> None:
        self.herd = Herd()
        self.land = Land()
        self.plants = Plants()
        self.sun = Sun()
        self.species = Species(SPECIES_CFG, self.herd, config.fauna.predator_min_diet)
        self.calendar = config.calendar
        self.chronicle = Chronicle(
            cfg, self.land, self.plants, self.herd, self.species, self.sun,
            landmass_min_cells=100, herbivore_max_diet=config.fauna.herbivore_max_diet,
            predator_min_diet=config.fauna.predator_min_diet,
        )  # fmt: skip
        self.rng = new_generator(7, CHRONICLE)
        self.t_ms = 0
        self.chronicle.initialize(self.ctx(0.0))

    def ctx(self, dt_s: float) -> Context:
        return Context(self.t_ms, dt_s, clock.instant(EPOCH, self.t_ms, self.calendar), self.rng)

    def days(self, n: int = 1) -> list[ChronicleEntry]:
        """Midnights: the census, what the chronicle makes of it, then its daily look."""
        out: list[OutputEvent] = []
        for _ in range(n):
            self.t_ms += DAY_MS
            ctx = self.ctx(86_400.0)
            census = self.species.tick(ctx)
            out += census + self.chronicle.observe(census, ctx)
            out += self.chronicle.tick(ctx)
        return entries(out)

    def see(self, *events: OutputEvent) -> list[ChronicleEntry]:
        return entries(self.chronicle.observe(list(events), self.ctx(0.0)))


def entries(outputs: Sequence[OutputEvent], kind: Kind | None = None) -> list[ChronicleEntry]:
    found = [o for o in outputs if isinstance(o, ChronicleEntry)]
    return [e for e in found if kind is None or e.kind == kind.value]


@pytest.fixture
def island(config: Config) -> Island:
    # Records from day 0 (they wait from the first landing), no rate limit by default.
    return Island(chronicle_config(config, record_after_days=0.0, daily_cap=100), config)


# --- Species: arrivals, splits, extinctions -----------------------------------------------


def test_first_life_then_arrivals(island: Island) -> None:
    island.herd.add(10, origin=1)
    first = island.days()
    assert [e.kind for e in entries(first, Kind.FIRST_LIFE)] == ["first_life"]
    assert entries(first, Kind.FIRST_LIFE)[0].importance == 5
    assert entries(island.days(5), Kind.FIRST_LIFE) == []
    island.herd.add(6, origin=2, gene=0.8)
    later = island.days()
    assert len(entries(later, Kind.ARRIVAL)) == 1
    assert entries(later, Kind.FIRST_LIFE) == []


def test_speciation_is_told_once(island: Island) -> None:
    island.herd.add(10, origin=1, gene=0.3)
    island.herd.add(10, origin=1, gene=0.6)
    found = island.days(10)
    told = entries(found, Kind.SPECIATION)
    assert len(told) == 1
    parent = island.species.record(1).name
    assert parent in told[0].text
    assert island.species.record(2).name in told[0].text
    assert told[0].species == 2
    assert 0 <= told[0].x < W  # where its members stand


def test_extinction_of_a_short_lived_species_is_minor(island: Island) -> None:
    ids = island.herd.add(10, origin=1)
    island.days(5)
    island.herd.remove(ids)
    found = entries(island.days(3), Kind.EXTINCTION)
    assert len(found) == 1
    assert found[0].importance == island.chronicle.config.importance_minor_extinction


def test_extinction_of_a_long_lived_species_is_notable(island: Island) -> None:
    ids = island.herd.add(10, origin=1)
    days = int(island.chronicle.config.notable_species_days) + 1
    island.days(days)
    island.herd.remove(ids)
    found = entries(island.days(1), Kind.EXTINCTION)
    assert len(found) == 1
    assert found[0].importance == island.chronicle.config.importance_extinction
    assert "months" in found[0].text or "days" in found[0].text


def test_last_creature(island: Island) -> None:
    found = island.see(PopulationExtinct(island.t_ms))
    assert [e.importance for e in found] == [5]


# --- Firsts ---------------------------------------------------------------------------


def test_firsts_are_told_once(island: Island, config: Config) -> None:
    hunters = island.herd.add(8, origin=1, gene=0.5, diet=0.95)
    island.herd.add(8, origin=2, gene=0.2, aquatic=0.9, slots=int(CreatureRare.GLOW))
    island.plants.forest = 0.1
    island.plants.rare[3, 3] = PlantRare.MANGROVE
    found = entries(island.days(3), Kind.FIRST)
    texts = [e.text for e in found]
    assert sum("first hunters" in t for t in texts) == 1
    assert sum("first swimmers" in t for t in texts) == 1
    assert sum("closed forest" in t for t in texts) == 1
    assert sum(CREATURE_GENE_NAMES[CreatureRare.GLOW] in t for t in texts) == 1
    assert sum(PLANT_GENE_NAMES[PlantRare.MANGROVE] in t for t in texts) == 1
    assert len(found) == 5
    island.herd.remove(hunters)
    island.days(2)
    island.herd.add(8, origin=3, gene=0.5, diet=0.95)
    assert entries(island.days(3), Kind.FIRST) == []


def test_first_fire_once(island: Island) -> None:
    first = island.see(FireStarted(island.t_ms, 3.0, 4.0))
    assert [(e.kind, e.x, e.y) for e in first] == [("first", 3.0, 4.0)]
    assert island.see(FireStarted(island.t_ms, 5.0, 4.0)) == []


# --- Records, booms and crashes ---------------------------------------------------------


def test_population_record_once_per_gap(config: Config) -> None:
    cfg = chronicle_config(config, record_after_days=10.0, daily_cap=100)
    island = Island(cfg, config)
    island.herd.add(20, origin=1)
    early = island.days(12)
    assert entries(early, Kind.RECORD) == []  # too young for records
    island.herd.add(10, origin=1)  # 30 > 20 × 1.1
    found = [e for e in entries(island.days(1), Kind.RECORD) if "creatures" in e.text]
    assert len(found) == 1
    assert "30" in found[0].text
    island.herd.add(10, origin=1)
    again = [e for e in entries(island.days(1), Kind.RECORD) if "creatures" in e.text]
    assert again == []  # within record_gap_days


def test_boom_and_crash(island: Island) -> None:
    cfg = island.chronicle.config
    ids = island.herd.add(cfg.swing_min_members, origin=1)
    island.days(cfg.swing_days)
    more = island.herd.add(cfg.swing_min_members * 2, origin=1)
    booms = entries(island.days(cfg.swing_days), Kind.BOOM)
    assert len(booms) == 2  # the species, and all creatures with it
    assert {e.species for e in booms} == {0, 1}
    island.herd.remove(np.concatenate([ids, more[:-10]]))
    crashes = entries(island.days(cfg.swing_days), Kind.CRASH)
    assert {e.species for e in crashes} == {0, 1}
    assert len(crashes) == 2


# --- Migration ----------------------------------------------------------------------------


def test_migration_to_another_landmass_once(island: Island) -> None:
    ids = island.herd.add(10, origin=1, x=5.0)
    island.days(2)
    island.herd.move(ids[:4], 30.0)
    found = entries(island.days(1), Kind.MIGRATION)
    assert len(found) == 1
    assert found[0].x == pytest.approx(30.0)
    island.herd.move(ids[:4], 5.0)
    island.days(1)
    island.herd.move(ids[:4], 30.0)
    assert entries(island.days(1), Kind.MIGRATION) == []  # within migration_gap_days


def test_too_few_wanderers_are_no_migration(island: Island) -> None:
    ids = island.herd.add(10, origin=1, x=5.0)
    island.days(2)
    island.herd.move(ids[:2], 30.0)
    assert entries(island.days(2), Kind.MIGRATION) == []


def test_crossing_one_by_one_settles_once(island: Island) -> None:
    ids = island.herd.add(10, origin=1, x=5.0)
    island.days(2)
    told: list[ChronicleEntry] = []
    for k in range(5):  # one more crosses each day
        island.herd.move(ids[: k + 1], 30.0)
        told += entries(island.days(1), Kind.MIGRATION)
    assert len(told) == 1
    assert told[0].x == pytest.approx(30.0)


# --- Events from the other subsystems -------------------------------------------------


def test_land_and_god_events(island: Island) -> None:
    t = island.t_ms
    cases: list[tuple[OutputEvent, str]] = [
        (LandmassSplit(t, 2, 3), "split"),
        (LandmassesRejoined(t, 2, 1), "rejoin"),
        (VolcanoErupted(t, 3.0, 4.0, 5.0, 0.2), "volcano"),
        (EarthquakeStruck(t, 3.0, 4.0, 5.0, 0.1), "earthquake"),
        (CraterFormed(t, 6.0, 4.0, 5.0, 0.1), "meteor"),
        (SeasonStarted(t, clock.Season.WINTER), "season"),
    ]
    for event, kind in cases:
        assert [e.kind for e in island.see(event)] == [kind]


def test_god_meteor_is_one_entry(island: Island) -> None:
    t = island.t_ms
    found = island.see(GodPowerUsed(t, "meteor", 3.0, 4.0), CraterFormed(t, 3.0, 4.0, 8.0, 0.15))
    assert [e.kind for e in found] == ["god_power"]


def _records(found: list[ChronicleEntry], words: str) -> list[ChronicleEntry]:
    return [e for e in entries(found, Kind.RECORD) if words in e.text]


def test_species_alive_record_once_per_gap(config: Config) -> None:
    cfg = chronicle_config(config, record_after_days=10.0, daily_cap=100)
    island = Island(cfg, config)
    island.herd.add(10, origin=1, gene=0.2)
    assert _records(island.days(12), "at once") == []  # one species: nothing beaten yet
    island.herd.add(10, origin=2, gene=0.5)
    found = _records(island.days(1), "at once")
    assert len(found) == 1
    assert found[0].text.startswith("2 species")
    island.herd.add(10, origin=3, gene=0.8)
    assert _records(island.days(1), "at once") == []  # within record_gap_days
    island.days(round(cfg.record_gap_days))
    island.herd.add(10, origin=4, gene=0.65)
    later = _records(island.days(1), "at once")
    assert len(later) == 1
    assert later[0].text.startswith("4 species")


def test_largest_species_record_needs_another_species_by_the_margin(config: Config) -> None:
    cfg = chronicle_config(config, record_after_days=10.0, daily_cap=100)
    island = Island(cfg, config)
    island.herd.add(20, origin=1, gene=0.2)
    island.days(12)
    island.herd.add(10, origin=1, gene=0.2)  # the holder grows: no news
    assert _records(island.days(3), "largest species") == []
    island.herd.add(31, origin=2, gene=0.8)  # 31 < 30 × 1.1: not by the margin
    assert _records(island.days(3), "largest species") == []
    newcomer = island.species.record(2)
    island.herd.add(10, origin=2, gene=0.8)  # 41: taken
    found = _records(island.days(3), "largest species")
    assert len(found) == 1
    assert found[0].species == newcomer.id
    assert newcomer.name in found[0].text
    assert "41" in found[0].text
    assert _records(island.days(40), "largest species") == []  # still its own


def test_oldest_species_record_goes_to_the_survivor_once(config: Config) -> None:
    cfg = chronicle_config(config, record_after_days=10.0, daily_cap=100)
    island = Island(cfg, config)
    first = island.herd.add(10, origin=1, gene=0.2)
    island.days(4)
    island.herd.add(10, origin=2, gene=0.8)
    island.days(8)  # the first species holds the record, silently while young
    island.herd.remove(first)
    found = _records(island.days(30), "longer than any species")
    assert len(found) == 1  # the survivor passes the dead species' 12 days by 10 %
    survivor = island.species.record(2)
    assert found[0].species == survivor.id
    assert survivor.name in found[0].text
    assert found[0].t_ms - survivor.born_t_ms >= 12 * 1.1 * DAY_MS
    assert _records(island.days(60), "longer than any species") == []


def test_fire_record_is_beaten_by_the_margin(island: Island) -> None:
    cfg = island.chronicle.config
    island.t_ms += round(cfg.record_after_days * DAY_MS)
    first = island.see(FireEnded(island.t_ms, cfg.fire_cells, 5.0))
    assert [e.kind for e in first] == ["record"]
    island.t_ms += round(cfg.record_gap_days * DAY_MS)
    close = cfg.fire_cells + 1  # bigger, but not by the margin: an ordinary big fire
    assert [e.kind for e in island.see(FireEnded(island.t_ms, close, 5.0))] == ["fire"]
    island.t_ms += round(cfg.record_gap_days * DAY_MS)
    bigger = round(cfg.fire_cells * (1 + 2 * cfg.record_margin))
    assert [e.kind for e in island.see(FireEnded(island.t_ms, bigger, 5.0))] == ["record"]


def test_fires_by_size(island: Island) -> None:
    cfg = island.chronicle.config
    island.see(FireStarted(island.t_ms, 3.0, 4.0))  # the first fire
    assert island.see(FireEnded(island.t_ms, cfg.fire_cells - 1, 5.0)) == []
    island.t_ms += 10 * DAY_MS
    big = island.see(FireEnded(island.t_ms, cfg.fire_cells, 5.0))
    assert len(big) == 1  # told as the record fire
    island.t_ms += 40 * DAY_MS
    second = island.see(FireEnded(island.t_ms, cfg.fire_cells, 5.0))
    assert [(e.kind, e.importance) for e in second] == [("fire", cfg.importance_fire)]


# --- Anniversaries and dark ages ------------------------------------------------------


def test_world_anniversary_once_a_year(island: Island) -> None:
    found = entries(island.days(370), Kind.ANNIVERSARY)
    assert [e.text for e in found] == [
        "The island is 1 year old, and no creature has set foot on it yet."
    ]


def test_species_anniversary(island: Island) -> None:
    island.herd.add(10, origin=1)
    found = [e for e in entries(island.days(400), Kind.ANNIVERSARY) if e.species == 1]
    assert len(found) == 1
    assert "1 year" in found[0].text


def test_dark_age_and_dawn_once(island: Island) -> None:
    cfg = island.chronicle.config
    island.sun.present = False
    island.sun.absent_hours = cfg.dark_age_hours - 1
    assert entries(island.days(1), Kind.DARK_AGE) == []
    island.sun.absent_hours = cfg.dark_age_hours + 1
    assert len(entries(island.days(1), Kind.DARK_AGE)) == 1
    island.sun.absent_hours += 48
    assert entries(island.days(2), Kind.DARK_AGE) == []
    island.sun.present, island.sun.absent_hours = True, 0.0
    dawn = entries(island.chronicle.handle(PresenceChanged(True), island.ctx(0.0)))
    assert [e.kind for e in dawn] == ["dawn"]
    assert entries(island.chronicle.handle(PresenceChanged(True), island.ctx(0.0))) == []


def test_weekend_is_no_dark_age(island: Island) -> None:
    island.sun.present, island.sun.absent_hours = False, 63.0
    assert entries(island.days(1), Kind.DARK_AGE) == []


# --- Filters ------------------------------------------------------------------------------


def test_duplicates_are_dropped(island: Island) -> None:
    t = island.t_ms
    first = island.see(VolcanoErupted(t, 3.0, 4.0, 5.0, 0.2))
    assert len(first) == 1
    island.t_ms += DAY_MS
    assert island.see(VolcanoErupted(island.t_ms, 9.0, 4.0, 5.0, 0.2)) == []
    island.t_ms += round(island.chronicle.config.dedup_days * DAY_MS)
    assert len(island.see(VolcanoErupted(island.t_ms, 9.0, 4.0, 5.0, 0.2))) == 1


def test_rate_limit_spares_major_entries(config: Config) -> None:
    cfg = chronicle_config(config, daily_cap=2)
    island = Island(cfg, config)
    t = island.t_ms
    notable = [EarthquakeStruck(t, float(k), 0.0, 1.0, 0.1) for k in range(1)]
    notable += [LandmassesRejoined(t, 2, 1), SeasonStarted(t, clock.Season.SPRING)]
    found = island.see(*notable, VolcanoErupted(t, 1.0, 1.0, 1.0, 0.1))
    assert [e.kind for e in found] == ["earthquake", "rejoin", "volcano"]
    island.t_ms += DAY_MS  # a new day, a new allowance
    assert len(island.see(SeasonStarted(island.t_ms, clock.Season.SUMMER))) == 1


# --- Text, bestiary, state ------------------------------------------------------------


def test_every_template_renders() -> None:
    fields: dict[str, object] = {
        "name": "Gamiti", "parent": "Gamito", "members": 12, "lived": span(400), "value": 99,
        "share": "4%", "before": 10, "days": 30, "parts": 2, "landmasses": 3, "hours": 12,
        "years": "2 years", "ever": 7, "alive": 3, "season": "Winter", "creatures": 40,
        "gene": "giant", "species": "9 species", "world": 2,
    }  # fmt: skip
    for name, variants in TEMPLATES.items():
        for text in variants:
            rendered = text.format(**fields)
            assert "{" not in rendered, name
            assert rendered.strip(), name


@pytest.mark.parametrize(
    ("days", "text"),
    [(0.2, "1 day"), (12, "12 days"), (90, "3 months"), (800, "2 years")],
)
def test_span(days: float, text: str) -> None:
    assert span(days) == text


def test_bestiary(island: Island) -> None:
    island.herd.add(10, origin=1, gene=0.3, diet=0.1, slots=int(CreatureRare.GIANT))
    island.herd.add(10, origin=1, gene=0.6, diet=0.1)
    island.days(10)
    bestiary = island.chronicle.bestiary()
    assert [b.species.id for b in bestiary] == [1, 2]
    root, daughter = bestiary
    assert root.ancestry == ()
    assert root.daughters == (2,)
    assert daughter.ancestry == (root.species.name,)
    assert root.rare & CreatureRare.GIANT
    assert root.diet == "herbivore"
    assert root.habitat == "land"
    assert any("waded ashore" in f or "landed" in f for f in root.facts)
    assert any(daughter.species.name in f for f in daughter.facts)
    assert root.species.founding.shape == (GENE_COUNT,)  # the portrait's genome


def test_state_round_trip(island: Island, config: Config) -> None:
    island.herd.add(10, origin=1, gene=0.3)
    island.herd.add(10, origin=1, gene=0.6)
    island.days(12)
    tree = io.decode(io.encode(island.chronicle.get_state()))
    copy = Island(island.chronicle.config, config)
    copy.chronicle.set_state(tree)
    assert copy.chronicle.entries() == island.chronicle.entries()
    assert io.encode(copy.chronicle.get_state()) == io.encode(island.chronicle.get_state())


def test_unprimed_chronicle_takes_stock_in_silence(island: Island, config: Config) -> None:
    island.herd.add(10, origin=1, gene=0.5, diet=0.95, slots=int(CreatureRare.VENOM))
    island.plants.forest = 0.2
    island.days(3)
    tree = island.chronicle.get_state()
    upgraded = Island(island.chronicle.config, config)
    upgraded.herd, upgraded.species = island.herd, island.species
    upgraded.chronicle = Chronicle(
        island.chronicle.config, island.land, island.plants, island.herd, island.species,
        island.sun, landmass_min_cells=100, herbivore_max_diet=config.fauna.herbivore_max_diet,
        predator_min_diet=config.fauna.predator_min_diet,
    )  # fmt: skip
    # What v8_to_v9 gives an upgraded world: no history, not primed.
    blank: Tree = dict(tree)
    empty = Island(island.chronicle.config, config).chronicle.get_state()
    for key in ("firsts", "entry_t_ms", "entry_kind", "entry_importance", "entry_text",
                "entry_species", "entry_x", "entry_y"):  # fmt: skip
        blank[key] = empty[key]
    blank["primed"] = False
    upgraded.chronicle.set_state(blank)
    upgraded.t_ms = island.t_ms
    found = upgraded.days(3)
    assert entries(found, Kind.FIRST) == []
    assert entries(found, Kind.RECORD) == []


# --- In a real world ------------------------------------------------------------------


def test_upgraded_v8_world_writes_its_history(config: Config) -> None:
    """The v8 fixture (520 days, inhabited) gains a chronicle that starts quietly and then
    writes entries that respect the filters."""
    world = World.restore(config, io.loads((FIXTURES / "v8.lzma").read_bytes()))
    hunters_at_upgrade = world.fauna.diet_counts()[2] > 0
    outputs: list[OutputEvent] = []
    for _ in range(60):
        outputs += world.step(86_400.0)
    found = entries(outputs)
    assert found == world.chronicle.entries()
    assert [e.number for e in found] == list(range(1, len(found) + 1))
    # It takes stock of what lives there: no first life, and no first hunters if hunters
    # were alive when it began (a hunter group that lands later is its first).
    assert not any(e.kind == "first_life" for e in found)
    if hunters_at_upgrade:
        assert not any(e.kind == "first" and "hunters" in e.text for e in found)
    cfg = world.chronicle.config
    per_day: dict[int, int] = {}
    for e in found:
        if e.importance < cfg.major_importance:
            per_day[e.t_ms // DAY_MS] = per_day.get(e.t_ms // DAY_MS, 0) + 1
    assert max(per_day.values(), default=0) <= cfg.daily_cap
    seen: dict[tuple[str, str], int] = {}
    for e in found:
        last = seen.get((e.kind, e.text))
        assert last is None or e.t_ms - last >= cfg.dedup_days * DAY_MS, e.text
        seen[(e.kind, e.text)] = e.t_ms


def test_the_chronicle_only_watches(config: Config) -> None:
    """A world with a chronicle evolves exactly as one without: it reads, never writes,
    and draws only from its own stream."""
    from lineage_sim.world import default_subsystems

    watched, _ = World.create(config, 3, EPOCH)
    unwatched, _ = World.create(config, 3, EPOCH, default_subsystems(config)[:-1])
    watched.step(40 * 86_400.0)
    unwatched.step(40 * 86_400.0)
    a, b = watched.snapshot(), unwatched.snapshot()
    assert set(a.subsystems) - set(b.subsystems) == {"chronicle"}
    for name, tree in b.subsystems.items():
        assert io.encode(a.subsystems[name]) == io.encode(tree), name
    assert {k: v for k, v in a.rng.items() if k != "chronicle"} == b.rng
