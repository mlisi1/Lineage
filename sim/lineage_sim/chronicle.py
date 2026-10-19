"""The chronicle and the bestiary (M9): the island writes its own history.

Detectors turn what happens into dated entries (`ChronicleEntry`) with English text and
an importance from 1 (background) to 5 (historic) (ADR 0017). Some read the other
subsystems' outputs as they come (the World hands them over: `observe`): species born
and gone, fires, volcanoes, the island splitting, god powers, seasons. The others look
at the world once a day, after the species census: firsts, records, booms and crashes,
migrations to other landmasses, anniversaries and dark ages (long absences of the owner).

Every entry passes two filters. Deduplication drops an entry of the same kind about the
same subject within a gap (``dedup_days``; records, swings and migrations have their own).
The rate limit keeps at most ``daily_cap`` entries below ``major_importance`` per day;
major entries always pass.

The chronicle is saved with the world, so the save is the whole history. A world saved
before the chronicle existed wakes up with an empty one that first takes stock in
silence (``primed``), so it does not announce as firsts what happened long ago.

The bestiary (`bestiary`) is a record per species that ever lived: the species record
(`Species.records`, whose founding genome is the portrait), its ancestry and daughters,
its diet and habitat, the rare genes its members ever carried, when it peaked, and the
chronicle's entries about it.
"""

from __future__ import annotations

import datetime as dt
from collections.abc import Sequence
from dataclasses import dataclass
from enum import Enum
from typing import Protocol

import numpy as np
from numpy.typing import NDArray

from lineage_sim.clock import MS_PER_DAY, Instant, Season
from lineage_sim.config import ChronicleConfig
from lineage_sim.events import (
    ChronicleEntry,
    CraterFormed,
    EarthquakeStruck,
    FireEnded,
    FireStarted,
    GodPowerUsed,
    InputEvent,
    LandmassesRejoined,
    LandmassSplit,
    OutputEvent,
    PopulationExtinct,
    PresenceChanged,
    SeasonStarted,
    SpeciesBorn,
    SpeciesExtinct,
    VolcanoErupted,
)
from lineage_sim.fauna.genome import Gene
from lineage_sim.flora import Rare as PlantRare
from lineage_sim.rare import CREATURE_GENES, PLANT_GENES, CreatureRare
from lineage_sim.rng import CHRONICLE
from lineage_sim.species import SpeciesRecord
from lineage_sim.state.schema import StateError, Tree
from lineage_sim.subsystem import Context

Ids = NDArray[np.int64]

_MS_PER_HOUR = 3_600_000
_DAYS_PER_MONTH = 365.25 / 12
_NOWHERE = -1.0  # x and y of an entry with no one place


class Kind(Enum):
    """Kinds of entry ("event types" of the M9 criteria)."""

    FIRST_LIFE = "first_life"
    LAST_CREATURE = "last_creature"
    FIRST = "first"
    ARRIVAL = "arrival"
    SPECIATION = "speciation"
    EXTINCTION = "extinction"
    RECORD = "record"
    BOOM = "boom"
    CRASH = "crash"
    MIGRATION = "migration"
    SPLIT = "split"
    REJOIN = "rejoin"
    FIRE = "fire"
    VOLCANO = "volcano"
    EARTHQUAKE = "earthquake"
    METEOR = "meteor"
    GOD_POWER = "god_power"
    ANNIVERSARY = "anniversary"
    DARK_AGE = "dark_age"
    DAWN = "dawn"
    SEASON = "season"


KINDS = tuple(Kind)


class Record(Enum):
    """The island's records."""

    POPULATION = "population"  # most creatures alive at once
    SPECIES_ALIVE = "species_alive"  # most species alive at once
    FIRE = "fire"  # largest fire (cells)
    SPECIES_PEAK = "species_peak"  # most members of one species (held by a species)
    SPECIES_AGE = "species_age"  # longest time on the island (days; held by a species)


RECORDS = tuple(Record)
_HELD = (Record.SPECIES_PEAK, Record.SPECIES_AGE)  # beaten only by another species

# Firsts that are not rare genes.
FIRST_HUNTERS = "hunters"
FIRST_SWIMMERS = "swimmers"
FIRST_FOREST = "forest"
FIRST_FIRE = "fire"
FIRST_LIFE = "life"


# --- Text -------------------------------------------------------------------------------
# Every template has variants; the chronicle's stream picks one. Fields in braces.

TEMPLATES: dict[str, tuple[str, ...]] = {
    "first_life": (
        "Life came to the island: {members} {name} waded ashore.",
        "The first creatures, {members} {name}, landed on the empty shore.",
    ),
    "last_creature": (
        "The last creature on the island died. The land is empty.",
        "Nothing walks the island any more: its last creature is dead.",
    ),
    "arrival": (
        "Strangers landed: {members} {name} came ashore from elsewhere.",
        "{members} {name} arrived from across the sea.",
    ),
    "speciation": (
        "The {name} split from the {parent}.",
        "A new species, the {name}, branched off the {parent}.",
        "Among the {parent}, a group grew apart: the {name}.",
    ),
    "extinction": (
        "The last {name} died; the species lived here {lived}.",
        "The {name} are gone, after {lived} on the island.",
    ),
    "first_hunters": ("The {name} are the island's first hunters.",),
    "first_swimmers": ("The {name} took to the water: the island's first swimmers.",),
    "first_forest": ("The first closed forest grew on the island.",),
    "first_fire": ("Lightning set the island alight for the first time.",),
    "first_creature_rare": (
        "The first {gene} appeared among the {name}.",
        "A {gene}, the first of its kind, was born among the {name}.",
    ),
    "first_plant_rare": ("The first {gene} took root on the island.",),
    "record_population": (
        "The island has never held so many creatures: {value}.",
        "{value} creatures live on the island, more than ever before.",
    ),
    "record_species_alive": ("{value} species live on the island at once, more than ever before.",),
    "record_fire": ("The largest fire the island has seen burnt {share} of its land.",),
    "record_species_peak": ("The {name} number {value}, the largest species the island has seen.",),
    "record_species_age": (
        "The {name} have lived here {lived}, longer than any species before them.",
    ),
    "boom": (
        "The {name} are thriving: from {before} to {value} in {days} days.",
        "The {name} multiply: {value} now, {before} a month ago.",
    ),
    "boom_all": (
        "Good times: the island's creatures grew from {before} to {value} in {days} days.",
    ),
    "crash": (
        "The {name} are dwindling: from {before} to {value} in {days} days.",
        "Hard times for the {name}: only {value} are left of {before}.",
    ),
    "crash_all": (
        "Hard times: the island's creatures fell from {before} to {value} in {days} days.",
    ),
    "migration": (
        "The {name} crossed to new land across the water.",
        "{members} {name} reached another island.",
    ),
    "split": (
        "The sea cut the island in {parts}: there are now {landmasses} landmasses.",
        "A strait opened and split the land in {parts}.",
    ),
    "rejoin": (
        "A land bridge rose: {parts} landmasses joined into one.",
        "The strait closed: {parts} islands became one.",
    ),
    "fire": (
        "A wildfire burnt {share} of the island over {hours} hours.",
        "Fire swept the island: {share} of the land burnt.",
    ),
    "volcano": (
        "A volcano erupted and raised new land.",
        "The ground split and a volcano rose, spilling new rock.",
    ),
    "earthquake": ("An earthquake shook the island.", "The earth shook and the land shifted."),
    "meteor": ("A meteor struck the island and left a crater.",),
    "power_meteor": ("A meteor fell from the sky at the god's call.",),
    "power_rain": ("The heavens opened at the god's call: rain fell over the island.",),
    "power_seed": ("At the god's call, seeds rained on the island from distant lands.",),
    "power_ark": ("At the god's call, an ark ran aground, carrying strangers.",),
    "anniversary": (
        "The island is {years} old. {ever} species have lived here; {alive} live today.",
    ),
    "anniversary_empty": ("The island is {years} old, and no creature has set foot on it yet.",),
    "species_anniversary": ("The {name} have lived on the island for {years}.",),
    "dark_age": (
        "A dark age began: the sun has not risen for {days} days.",
        "The sun is gone. The island has been dark for {days} days.",
    ),
    "dawn": (
        "The sun returned after {days} days of darkness.",
        "Dawn at last, after a dark age of {days} days.",
    ),
    "season": ("{season} came. {creatures} creatures of {alive} species live on the island.",),
    "season_empty": ("{season} came to an empty island.",),
}

CREATURE_GENE_NAMES: dict[CreatureRare, str] = {
    CreatureRare.VENOM: "venomous creature",
    CreatureRare.TOXIC: "poisonous creature with warning colours",
    CreatureRare.GIANT: "giant",
    CreatureRare.LONGEVITY: "long-lived creature",
    CreatureRare.AMPHIBIOUS: "amphibious creature",
    CreatureRare.HIBERNATION: "creature that sleeps through the cold",
    CreatureRare.PHOTOSYNTHESIS: "creature that feeds on sunlight",
    CreatureRare.GLOW: "creature that glows in the dark",
}

PLANT_GENE_NAMES: dict[PlantRare, str] = {
    PlantRare.FIRE_PINE: "fire pines",
    PlantRare.NITROGEN_FIXER: "nitrogen-fixing plants",
    PlantRare.MANGROVE: "mangroves",
    PlantRare.POISONOUS: "poisonous plants",
    PlantRare.FRUITING: "fruit trees",
    PlantRare.EMERGENT: "giant trees above the canopy",
}


def span(days: float) -> str:
    """A stretch of time in words: days, then months, then years."""
    if days < 60:
        n = max(1, round(days))
        return f"{n} day" if n == 1 else f"{n} days"
    if days < 730:
        return f"{round(days / _DAYS_PER_MONTH)} months"
    years = int(days // 365.25)
    return f"{years} years"


def years_text(years: int) -> str:
    return "1 year" if years == 1 else f"{years} years"


def percent(share: float) -> str:
    return f"{max(1, round(100 * share))}%"


# --- What the chronicle reads -----------------------------------------------------------


class Land(Protocol):
    @property
    def land(self) -> NDArray[np.bool_]: ...

    @property
    def landmass_labels(self) -> NDArray[np.int32]: ...


class Plants(Protocol):
    @property
    def biomass(self) -> NDArray[np.float32]: ...

    @property
    def rare(self) -> NDArray[np.uint8]: ...

    def closed_forest_share(self) -> float: ...


class Animals(Protocol):
    @property
    def count(self) -> int: ...

    @property
    def ids(self) -> Ids: ...

    @property
    def positions(self) -> NDArray[np.float32]: ...

    @property
    def genes(self) -> NDArray[np.float32]: ...

    @property
    def slots(self) -> NDArray[np.uint16]: ...


class Census(Protocol):
    @property
    def count(self) -> int: ...

    @property
    def alive_count(self) -> int: ...

    def record(self, species_id: int) -> SpeciesRecord: ...

    def records(self) -> list[SpeciesRecord]: ...

    def species_of(self, creature_ids: Ids) -> Ids: ...


class Sun(Protocol):
    @property
    def present(self) -> bool: ...

    @property
    def absent_hours(self) -> float: ...


@dataclass(frozen=True)
class BestiaryRecord:
    """One species that ever lived, for the bestiary page and its portrait."""

    species: SpeciesRecord  # founding genome = the portrait
    ancestry: tuple[str, ...]  # names from its parent back to the arrival it comes from
    daughters: tuple[int, ...]  # species ids
    diet: str  # "herbivore", "omnivore" or "predator" (founding genome)
    habitat: str  # "land" or "water" (founding genome)
    rare: CreatureRare  # rare genes any of its members ever carried
    peak_t_ms: int  # when it was most numerous
    facts: tuple[str, ...]  # the chronicle's entries about it, oldest first


class Chronicle:
    """The chronicle subsystem. Read the history through `entries` and `bestiary`."""

    def __init__(
        self,
        cfg: ChronicleConfig,
        land: Land,
        plants: Plants,
        animals: Animals,
        census: Census,
        sun: Sun,
        *,
        landmass_min_cells: int,
        herbivore_max_diet: float,
        predator_min_diet: float,
    ) -> None:
        self._cfg = cfg
        self._land = land
        self._plants = plants
        self._animals = animals
        self._census = census
        self._sun = sun
        self._landmass_min_cells = landmass_min_cells
        self._herbivore_diet = herbivore_max_diet
        self._predator_diet = predator_min_diet
        self._primed = True
        self._birth = dt.date(1970, 1, 1)  # the world's first day (set at initialize)
        self._years_told = 0
        self._ticks = 0
        self._day = -1  # sim-day of the rate limit's count
        self._day_count = 0
        self._firsts: list[str] = []
        self._dark_since_ms = -1  # absence start of the dark age being told, -1: none
        self._god_ms = -1  # sim time of the last god power (its crater is no news)
        self._fire_xy = (_NOWHERE, _NOWHERE)  # where the last fire started
        self._last: dict[str, int] = {}  # dedup key -> sim time of its last entry
        self._best = np.zeros(len(RECORDS), dtype=np.float64)
        self._announced = np.zeros(len(RECORDS), dtype=np.float64)
        self._holder = np.zeros(len(RECORDS), dtype=np.int64)
        # One row per species ever (species k is row k - 1), grown as species appear.
        self._peak = np.zeros(0, dtype=np.int32)
        self._peak_ms = np.zeros(0, dtype=np.int64)
        self._rare = np.zeros(0, dtype=np.uint16)
        self._years = np.zeros(0, dtype=np.int32)
        # Members of each species (column k; column 0: all creatures) on each of the
        # last swing_days days, a ring indexed by tick; -1 before the species existed.
        self._ring = np.full((cfg.swing_days, 1), -1, dtype=np.int32)
        # Yesterday's cell (flat index) and species of every living creature on land.
        self._prev_cells = np.zeros(0, dtype=np.int64)
        self._prev_species = np.zeros(0, dtype=np.int64)
        # The entries, column by column.
        self._t_ms: list[int] = []
        self._kind: list[str] = []
        self._importance: list[int] = []
        self._text: list[str] = []
        self._species: list[int] = []
        self._x: list[float] = []
        self._y: list[float] = []

    @property
    def name(self) -> str:
        return CHRONICLE

    @property
    def config(self) -> ChronicleConfig:
        return self._cfg

    # -- views --

    def __len__(self) -> int:
        return len(self._t_ms)

    def entries(self, start: int = 0) -> list[ChronicleEntry]:
        """Every entry from number ``start + 1`` on, oldest first."""
        return [self._entry(i) for i in range(start, len(self._t_ms))]

    def bestiary(self) -> list[BestiaryRecord]:
        """Every species that ever lived, in order of appearance."""
        records = self._census.records()
        self._grow(len(records))
        facts: dict[int, list[str]] = {}
        for species, text in zip(self._species, self._text, strict=True):
            if species:
                facts.setdefault(species, []).append(text)
        daughters: dict[int, list[int]] = {}
        for r in records:
            if r.parent:
                daughters.setdefault(r.parent, []).append(r.id)
        bestiary: list[BestiaryRecord] = []
        for r in records:
            ancestry: list[str] = []
            parent = r.parent
            while parent:
                ancestry.append(records[parent - 1].name)
                parent = records[parent - 1].parent
            row = r.id - 1
            bestiary.append(
                BestiaryRecord(
                    species=r,
                    ancestry=tuple(ancestry),
                    daughters=tuple(daughters.get(r.id, [])),
                    diet=self._diet(float(r.founding[Gene.DIET])),
                    habitat="water"
                    if r.founding[Gene.AQUATIC] >= self._cfg.swimmer_min_aquatic
                    else "land",
                    rare=CreatureRare(int(self._rare[row])),
                    peak_t_ms=int(self._peak_ms[row]) if self._peak[row] else r.born_t_ms,
                    facts=tuple(facts.get(r.id, [])),
                )
            )
        return bestiary

    # -- subsystem interface --

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        self._birth = ctx.instant.date
        self._primed = True  # a new world: nothing has happened yet
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        if not self._primed:
            self._prime(ctx)
        cfg = self._cfg
        records = self._census.records()
        self._grow(len(records))
        animals = self._animals
        labels = self._census.species_of(animals.ids)
        members = np.bincount(labels, minlength=len(records) + 1).astype(np.int32)
        out: list[OutputEvent] = []
        self._species_facts(ctx, records, members, labels)
        out += self._state_firsts(ctx, records, labels)
        out += self._records(ctx, records, members)
        out += self._swings(ctx, records, members)
        out += self._migrations(ctx, records, labels)
        out += self._anniversaries(ctx, records)
        absent_h = self._sun.absent_hours
        if self._dark_since_ms < 0 and absent_h >= cfg.dark_age_hours:
            self._dark_since_ms = max(0, ctx.t_ms - round(absent_h * _MS_PER_HOUR))
            days = round(absent_h / 24)
            out += self._write(ctx, Kind.DARK_AGE, cfg.importance_dark_age, "dark_age",
                               {"days": days})  # fmt: skip
        self._ticks += 1
        return out

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        if not self._primed:
            self._prime(ctx)
        if isinstance(event, PresenceChanged) and event.present and self._dark_since_ms >= 0:
            days = round((ctx.t_ms - self._dark_since_ms) / MS_PER_DAY)
            self._dark_since_ms = -1
            return self._write(ctx, Kind.DAWN, self._cfg.importance_dawn, "dawn", {"days": days})
        return []

    def observe(self, outputs: Sequence[OutputEvent], ctx: Context) -> list[OutputEvent]:
        if not self._primed:
            self._prime(ctx)
        out: list[OutputEvent] = []
        for event in outputs:
            out += self._event(event, ctx)
        return out

    def get_state(self) -> Tree:
        return {
            "primed": self._primed,
            "birth": self._birth.isoformat(),
            "years_told": self._years_told,
            "ticks": self._ticks,
            "day": self._day,
            "day_count": self._day_count,
            "firsts": list(self._firsts),
            "dark_since_ms": self._dark_since_ms,
            "god_ms": self._god_ms,
            "fire_xy": [self._fire_xy[0], self._fire_xy[1]],
            "dedup_keys": sorted(self._last),
            "dedup_ms": np.array([self._last[k] for k in sorted(self._last)], dtype=np.int64),
            "best": self._best.copy(),
            "announced": self._announced.copy(),
            "holder": self._holder.copy(),
            "peak": self._peak.copy(),
            "peak_ms": self._peak_ms.copy(),
            "rare": self._rare.copy(),
            "years": self._years.copy(),
            "ring": self._ring.copy(),
            "prev_cells": self._prev_cells.copy(),
            "prev_species": self._prev_species.copy(),
            "entry_t_ms": np.array(self._t_ms, dtype=np.int64),
            "entry_kind": list(self._kind),
            "entry_importance": np.array(self._importance, dtype=np.int8),
            "entry_text": list(self._text),
            "entry_species": np.array(self._species, dtype=np.int64),
            "entry_x": np.array(self._x, dtype=np.float32),
            "entry_y": np.array(self._y, dtype=np.float32),
        }

    def set_state(self, tree: Tree) -> None:
        self._primed = bool(tree["primed"])
        self._birth = dt.date.fromisoformat(str(tree["birth"]))
        self._years_told = int(tree["years_told"])
        self._ticks = int(tree["ticks"])
        self._day = int(tree["day"])
        self._day_count = int(tree["day_count"])
        self._firsts = [str(f) for f in tree["firsts"]]
        self._dark_since_ms = int(tree["dark_since_ms"])
        self._god_ms = int(tree["god_ms"])
        self._fire_xy = (float(tree["fire_xy"][0]), float(tree["fire_xy"][1]))
        keys = [str(k) for k in tree["dedup_keys"]]
        times = np.array(tree["dedup_ms"], dtype=np.int64).tolist()
        if len(keys) != len(times):
            raise StateError("chronicle dedup keys and times differ in length")
        self._last = dict(zip(keys, times, strict=True))
        self._best = np.array(tree["best"], dtype=np.float64)
        self._announced = np.array(tree["announced"], dtype=np.float64)
        self._holder = np.array(tree["holder"], dtype=np.int64)
        if not self._best.shape == self._announced.shape == self._holder.shape == (len(RECORDS),):
            raise StateError("chronicle records have the wrong shape")
        self._peak = np.array(tree["peak"], dtype=np.int32)
        self._peak_ms = np.array(tree["peak_ms"], dtype=np.int64)
        self._rare = np.array(tree["rare"], dtype=np.uint16)
        self._years = np.array(tree["years"], dtype=np.int32)
        if not self._peak.shape == self._peak_ms.shape == self._rare.shape == self._years.shape:
            raise StateError("chronicle species arrays differ in length")
        ring = np.array(tree["ring"], dtype=np.int32)
        if ring.ndim != 2 or ring.shape[1] != self._peak.size + 1:
            raise StateError("chronicle ring does not match its species")
        if ring.shape[0] != self._cfg.swing_days:  # the window was changed: start afresh
            ring = np.full((self._cfg.swing_days, ring.shape[1]), -1, dtype=np.int32)
        self._ring = ring
        self._prev_cells = np.array(tree["prev_cells"], dtype=np.int64)
        self._prev_species = np.array(tree["prev_species"], dtype=np.int64)
        self._t_ms = np.array(tree["entry_t_ms"], dtype=np.int64).tolist()
        self._kind = [str(k) for k in tree["entry_kind"]]
        self._importance = np.array(tree["entry_importance"], dtype=np.int8).tolist()
        self._text = [str(t) for t in tree["entry_text"]]
        self._species = np.array(tree["entry_species"], dtype=np.int64).tolist()
        self._x = np.array(tree["entry_x"], dtype=np.float32).tolist()
        self._y = np.array(tree["entry_y"], dtype=np.float32).tolist()
        columns = (self._kind, self._importance, self._text, self._species, self._x, self._y)
        if any(len(c) != len(self._t_ms) for c in columns):
            raise StateError("chronicle entry columns differ in length")

    # -- writing --

    def _entry(self, i: int) -> ChronicleEntry:
        return ChronicleEntry(
            self._t_ms[i], i + 1, self._kind[i], self._importance[i], self._text[i],
            self._species[i], self._x[i], self._y[i],
        )  # fmt: skip

    def _write(
        self,
        ctx: Context,
        kind: Kind,
        importance: int,
        template: str,
        fields: dict[str, object],
        *,
        species: int = 0,
        tag: str = "",
        gap_days: float | None = None,
        xy: tuple[float, float] | None = None,
    ) -> list[OutputEvent]:
        """Add an entry unless deduplication or the rate limit drops it."""
        cfg, t_ms = self._cfg, ctx.t_ms
        key = f"{kind.value}:{species}:{tag}"
        gap = cfg.dedup_days if gap_days is None else gap_days
        last = self._last.get(key)
        if last is not None and t_ms - last < gap * MS_PER_DAY:
            return []
        day = t_ms // MS_PER_DAY
        if day != self._day:
            self._day, self._day_count = day, 0
        if importance < cfg.major_importance:
            if self._day_count >= cfg.daily_cap:
                return []
            self._day_count += 1
        self._last[key] = t_ms
        variants = TEMPLATES[template]
        text = variants[int(ctx.rng.integers(len(variants)))]
        if xy is None:
            xy = self._where(species) if species else (_NOWHERE, _NOWHERE)
        self._t_ms.append(t_ms)
        self._kind.append(kind.value)
        self._importance.append(importance)
        self._text.append(text.format(**fields))
        self._species.append(species)
        self._x.append(xy[0])
        self._y.append(xy[1])
        return [self._entry(len(self._t_ms) - 1)]

    def _where(self, species: int) -> tuple[float, float]:
        """Mean position of a species' living members (as of the last census)."""
        animals = self._animals
        mine = self._census.species_of(animals.ids) == species
        if not mine.any():
            return _NOWHERE, _NOWHERE
        x, y = animals.positions[mine].mean(axis=0).tolist()
        return float(x), float(y)

    # -- events, as they happen --

    def _event(self, event: OutputEvent, ctx: Context) -> list[OutputEvent]:
        cfg = self._cfg
        if isinstance(event, SpeciesBorn):
            fields: dict[str, object] = {"name": event.name, "members": event.members}
            if event.parent:
                fields["parent"] = self._census.record(event.parent).name
                return self._write(ctx, Kind.SPECIATION, cfg.importance_speciation,
                                   "speciation", fields, species=event.species_id)  # fmt: skip
            if FIRST_LIFE not in self._firsts:
                self._firsts.append(FIRST_LIFE)
                return self._write(ctx, Kind.FIRST_LIFE, cfg.importance_first_life,
                                   "first_life", fields, species=event.species_id)  # fmt: skip
            return self._write(ctx, Kind.ARRIVAL, cfg.importance_arrival, "arrival", fields,
                               species=event.species_id)  # fmt: skip
        if isinstance(event, SpeciesExtinct):
            record = self._census.record(event.species_id)
            lived = (event.t_ms - event.born_t_ms) / MS_PER_DAY
            notable = lived >= cfg.notable_species_days or record.peak >= cfg.notable_species_peak
            importance = cfg.importance_extinction if notable else cfg.importance_minor_extinction
            fields = {"name": event.name, "lived": span(lived)}
            return self._write(ctx, Kind.EXTINCTION, importance, "extinction", fields,
                               species=event.species_id, xy=(_NOWHERE, _NOWHERE))  # fmt: skip
        if isinstance(event, PopulationExtinct):
            return self._write(ctx, Kind.LAST_CREATURE, cfg.importance_last_creature,
                               "last_creature", {})  # fmt: skip
        if isinstance(event, LandmassSplit):
            fields = {"parts": event.parts, "landmasses": event.landmasses}
            return self._write(ctx, Kind.SPLIT, cfg.importance_split, "split", fields)
        if isinstance(event, LandmassesRejoined):
            fields = {"parts": event.parts, "landmasses": event.landmasses}
            return self._write(ctx, Kind.REJOIN, cfg.importance_rejoin, "rejoin", fields)
        if isinstance(event, FireStarted):
            self._fire_xy = (event.x, event.y)
            if FIRST_FIRE not in self._firsts:
                self._firsts.append(FIRST_FIRE)
                return self._write(ctx, Kind.FIRST, cfg.importance_first, "first_fire", {},
                                   tag=FIRST_FIRE, xy=self._fire_xy)  # fmt: skip
            return []
        if isinstance(event, FireEnded):
            return self._fire(event, ctx)
        if isinstance(event, VolcanoErupted):
            return self._write(ctx, Kind.VOLCANO, cfg.importance_volcano, "volcano", {},
                               xy=(event.x, event.y))  # fmt: skip
        if isinstance(event, EarthquakeStruck):
            return self._write(ctx, Kind.EARTHQUAKE, cfg.importance_earthquake, "earthquake",
                               {}, xy=(event.x, event.y))  # fmt: skip
        if isinstance(event, CraterFormed):
            if event.t_ms == self._god_ms:
                return []  # the god power's entry tells it
            return self._write(ctx, Kind.METEOR, cfg.importance_meteor, "meteor", {},
                               xy=(event.x, event.y))  # fmt: skip
        if isinstance(event, GodPowerUsed):
            self._god_ms = event.t_ms
            return self._write(ctx, Kind.GOD_POWER, cfg.importance_god_power,
                               f"power_{event.power}", {}, xy=(event.x, event.y))  # fmt: skip
        if isinstance(event, SeasonStarted):
            return self._season(event.season, ctx)
        return []

    def _fire(self, event: FireEnded, ctx: Context) -> list[OutputEvent]:
        cfg = self._cfg
        land = max(1, int(np.count_nonzero(self._land.land)))
        share = percent(event.cells / land)
        out: list[OutputEvent] = []
        if event.cells >= cfg.fire_cells:
            out = self._beat(ctx, Record.FIRE, float(event.cells), 0, {"share": share})
        if event.cells < cfg.fire_cells or out:
            return out  # a record fire is told once, as the record
        huge = event.cells >= cfg.huge_fire_cells
        importance = cfg.importance_huge_fire if huge else cfg.importance_fire
        fields: dict[str, object] = {"share": share, "hours": round(event.hours)}
        return self._write(ctx, Kind.FIRE, importance, "fire", fields, xy=self._fire_xy)

    def _season(self, season: Season, ctx: Context) -> list[OutputEvent]:
        name = season.name.capitalize()
        creatures = self._animals.count
        if creatures == 0:
            return self._write(ctx, Kind.SEASON, self._cfg.importance_season, "season_empty",
                               {"season": name})  # fmt: skip
        fields: dict[str, object] = {
            "season": name, "creatures": creatures, "alive": self._census.alive_count
        }  # fmt: skip
        return self._write(ctx, Kind.SEASON, self._cfg.importance_season, "season", fields)

    # -- the daily look --

    def _grow(self, n: int) -> None:
        """Rows for species that appeared since the last look."""
        new = n - self._peak.size
        if new <= 0:
            return
        self._peak = np.concatenate([self._peak, np.zeros(new, dtype=np.int32)])
        self._peak_ms = np.concatenate([self._peak_ms, np.zeros(new, dtype=np.int64)])
        self._rare = np.concatenate([self._rare, np.zeros(new, dtype=np.uint16)])
        self._years = np.concatenate([self._years, np.zeros(new, dtype=np.int32)])
        empty = np.full((self._ring.shape[0], new), -1, dtype=np.int32)
        self._ring = np.concatenate([self._ring, empty], axis=1)

    def _diet(self, diet: float) -> str:
        if diet <= self._herbivore_diet:
            return "herbivore"
        return "predator" if diet >= self._predator_diet else "omnivore"

    def _species_facts(
        self, ctx: Context, records: list[SpeciesRecord], members: NDArray[np.int32], labels: Ids
    ) -> None:
        """Peaks and rare genes carried, for the bestiary."""
        n = len(records)
        grew = members[1:] > self._peak[:n]
        self._peak[:n] = np.maximum(self._peak[:n], members[1:])
        self._peak_ms[:n][grew] = ctx.t_ms
        known = labels > 0
        np.bitwise_or.at(self._rare, labels[known] - 1, self._animals.slots[known])

    def _first(
        self, ctx: Context, tag: str, template: str, fields: dict[str, object], species: int = 0
    ) -> list[OutputEvent]:
        if tag in self._firsts:
            return []
        self._firsts.append(tag)
        return self._write(ctx, Kind.FIRST, self._cfg.importance_first, template, fields,
                           species=species, tag=tag)  # fmt: skip

    def _state_firsts(
        self, ctx: Context, records: list[SpeciesRecord], labels: Ids
    ) -> list[OutputEvent]:
        cfg = self._cfg
        out: list[OutputEvent] = []
        alive = [r for r in records if r.alive and r.members > 0]
        hunters = [r for r in alive if r.centroid[Gene.DIET] >= self._predator_diet]
        if hunters:
            top = max(hunters, key=lambda r: (r.members, -r.id))
            out += self._first(ctx, FIRST_HUNTERS, "first_hunters", {"name": top.name}, top.id)
        swimmers = [r for r in alive if r.centroid[Gene.AQUATIC] >= cfg.swimmer_min_aquatic]
        if swimmers:
            top = max(swimmers, key=lambda r: (r.members, -r.id))
            out += self._first(ctx, FIRST_SWIMMERS, "first_swimmers", {"name": top.name}, top.id)
        if FIRST_FOREST not in self._firsts and self._plants.closed_forest_share() > 0:
            out += self._first(ctx, FIRST_FOREST, "first_forest", {})
        slots = self._animals.slots
        for gene in CREATURE_GENES:
            tag = f"rare_{(gene.name or '').lower()}"
            if tag in self._firsts:
                continue
            carriers = ((slots & np.uint16(gene)) != 0) & (labels > 0)
            if not carriers.any():
                continue
            species = int(np.bincount(labels[carriers]).argmax())
            fields: dict[str, object] = {
                "gene": CREATURE_GENE_NAMES[gene], "name": records[species - 1].name
            }  # fmt: skip
            out += self._first(ctx, tag, "first_creature_rare", fields, species)
        growing = self._plants.biomass > 0
        rare = self._plants.rare
        for plant_gene in PLANT_GENES:
            tag = f"plant_{(plant_gene.name or '').lower()}"
            if tag in self._firsts or not (growing & ((rare & plant_gene) != 0)).any():
                continue
            out += self._first(ctx, tag, "first_plant_rare", {"gene": PLANT_GENE_NAMES[plant_gene]})
        return out

    def _beat(
        self,
        ctx: Context,
        record: Record,
        value: float,
        holder: int,
        fields: dict[str, object],
        second: float = 0.0,
    ) -> list[OutputEvent]:
        """Keep a record; announce it once the world is old enough and it beats the last
        announced value by the margin. A record held by a species (``holder``) is told
        only when another species takes it, by the margin over every other (``second``)."""
        cfg = self._cfg
        k = RECORDS.index(record)
        held = record in _HELD
        if not held and value <= self._best[k]:
            return []
        self._best[k] = max(self._best[k], value)
        # Creature records wait from the first landing, the others from the world's start.
        records = self._census.records() if record is not Record.FIRE else []
        since = records[0].born_t_ms if records else 0
        if ctx.t_ms - since < cfg.record_after_days * MS_PER_DAY:
            self._announced[k], self._holder[k] = self._best[k], holder
            return []
        if held:
            if holder == self._holder[k] or value < second * (1 + cfg.record_margin):
                return []
        elif value < self._announced[k] * (1 + cfg.record_margin):
            return []
        out = self._write(ctx, Kind.RECORD, cfg.importance_record, f"record_{record.value}",
                          {"value": round(value), **fields}, species=holder, tag=record.value,
                          gap_days=cfg.record_gap_days)  # fmt: skip
        if out:
            self._announced[k], self._holder[k] = value, holder
        return out

    def _records(
        self, ctx: Context, records: list[SpeciesRecord], members: NDArray[np.int32]
    ) -> list[OutputEvent]:
        out: list[OutputEvent] = []
        out += self._beat(ctx, Record.POPULATION, float(self._animals.count), 0, {})
        out += self._beat(ctx, Record.SPECIES_ALIVE, float(self._census.alive_count), 0, {})
        if len(records) >= 1:
            peaks = self._peak[: len(records)].astype(np.float64)
            out += self._held(ctx, Record.SPECIES_PEAK, records, peaks, {})
            ages = np.array([r.lived_days(ctx.t_ms) for r in records], dtype=np.float64)
            top = int(ages.argmax())
            out += self._held(ctx, Record.SPECIES_AGE, records, ages, {"lived": span(ages[top])})
        return out

    def _held(
        self,
        ctx: Context,
        record: Record,
        records: list[SpeciesRecord],
        values: NDArray[np.float64],
        fields: dict[str, object],
    ) -> list[OutputEvent]:
        top = int(values.argmax())  # the first species wins a tie
        if not records[top].alive:
            return []
        second = float(np.delete(values, top).max()) if values.size > 1 else 0.0
        name = {"name": records[top].name, **fields}
        return self._beat(ctx, record, float(values[top]), top + 1, name, second)

    def _swings(
        self, ctx: Context, records: list[SpeciesRecord], members: NDArray[np.int32]
    ) -> list[OutputEvent]:
        """Booms and crashes over ``swing_days``, of each species and of all creatures."""
        cfg = self._cfg
        now = members.copy()
        now[0] = self._animals.count
        row = self._ticks % cfg.swing_days
        before = self._ring[row].copy()
        alive = np.ones(now.size, dtype=np.bool_)
        alive[1:] = np.array([r.alive for r in records], dtype=np.bool_)
        self._ring[row] = np.where(alive, now, -1)
        out: list[OutputEvent] = []
        for k in np.flatnonzero(alive & (before > 0)).tolist():
            b, n = int(before[k]), int(now[k])
            fields: dict[str, object] = {"before": b, "value": n, "days": cfg.swing_days}
            suffix = "" if k else "_all"
            if k:
                fields["name"] = records[k - 1].name
            if n >= cfg.boom_factor * b and n >= cfg.swing_min_members:
                out += self._write(ctx, Kind.BOOM, cfg.importance_boom, "boom" + suffix, fields,
                                   species=k, gap_days=cfg.swing_days)  # fmt: skip
            elif b >= cfg.swing_min_members and 0 < n * cfg.crash_factor <= b:
                out += self._write(ctx, Kind.CRASH, cfg.importance_crash, "crash" + suffix,
                                   fields, species=k, gap_days=cfg.swing_days)  # fmt: skip
        return out

    def _cells_and_masses(self, labels: Ids) -> tuple[Ids, Ids, Ids]:
        """Cell, landmass (0: sea or a small islet) and species of each living creature."""
        landmass = self._land.landmass_labels
        h, w = landmass.shape
        xy = np.rint(self._animals.positions).astype(np.int64)
        cells = np.clip(xy[:, 1], 0, h - 1) * w + np.clip(xy[:, 0], 0, w - 1)
        flat = landmass.reshape(-1).astype(np.int64)
        big = np.bincount(flat, minlength=1) >= self._landmass_min_cells
        big[0] = False
        where = flat[cells]
        return cells, np.where(big[where], where, 0), labels

    def _migrations(
        self, ctx: Context, records: list[SpeciesRecord], labels: Ids
    ) -> list[OutputEvent]:
        """A species standing on a large landmass where none of it stood yesterday."""
        cfg = self._cfg
        cells, masses, species = self._cells_and_masses(labels)
        base = int(self._land.landmass_labels.max()) + 1  # pairs coded species * base + mass
        flat = self._land.landmass_labels.reshape(-1).astype(np.int64)
        before = set((self._prev_species * base + flat[self._prev_cells]).tolist())
        known = set(self._prev_species.tolist())
        on = (masses > 0) & (species > 0)
        self._prev_cells, self._prev_species = cells[on], species[on]
        pairs, counts = np.unique(species[on] * base + masses[on], return_counts=True)
        out: list[OutputEvent] = []
        for pair, count in zip(pairs.tolist(), counts.tolist(), strict=True):
            s, mass = divmod(int(pair), base)
            if count < cfg.migration_min_members or pair in before or s not in known:
                continue
            here = on & (species == s) & (masses == mass)
            x, y = self._animals.positions[here].mean(axis=0).tolist()
            fields: dict[str, object] = {"name": records[s - 1].name, "members": int(count)}
            out += self._write(ctx, Kind.MIGRATION, cfg.importance_migration, "migration",
                               fields, species=s, gap_days=cfg.migration_gap_days,
                               xy=(float(x), float(y)))  # fmt: skip
        return out

    def _anniversaries(self, ctx: Context, records: list[SpeciesRecord]) -> list[OutputEvent]:
        cfg = self._cfg
        out: list[OutputEvent] = []
        years = _years_between(self._birth, ctx.instant)
        if years > self._years_told:
            self._years_told = years
            fields: dict[str, object] = {
                "years": years_text(years), "ever": len(records), "alive": self._census.alive_count
            }  # fmt: skip
            template = "anniversary" if records else "anniversary_empty"
            out += self._write(ctx, Kind.ANNIVERSARY, cfg.importance_anniversary, template,
                               fields, tag=f"world{years}")  # fmt: skip
        for r in records:
            if not r.alive:
                continue
            n = int(r.lived_days(ctx.t_ms) // cfg.species_anniversary_days)
            if n > self._years[r.id - 1]:
                self._years[r.id - 1] = n
                fields = {"name": r.name, "years": years_text(n)}
                out += self._write(ctx, Kind.ANNIVERSARY, cfg.importance_anniversary,
                                   "species_anniversary", fields, species=r.id,
                                   tag=f"years{n}")  # fmt: skip
        return out

    def _prime(self, ctx: Context) -> None:
        """Take stock in silence: a world older than its chronicle (an upgraded save)
        starts with what is already there as known, not as news."""
        self._primed = True
        records = self._census.records()
        self._grow(len(records))
        labels = self._census.species_of(self._animals.ids)
        self._peak[:] = [r.peak for r in records]
        self._peak_ms[:] = [r.born_t_ms for r in records]
        known = labels > 0
        np.bitwise_or.at(self._rare, labels[known] - 1, self._animals.slots[known])
        self._years[:] = [
            int(r.lived_days(ctx.t_ms) // self._cfg.species_anniversary_days) for r in records
        ]
        self._years_told = _years_between(self._birth, ctx.instant)
        if records:
            self._firsts.append(FIRST_LIFE)
        if ctx.t_ms > 0:
            self._firsts.append(FIRST_FIRE)  # fires burn from the first summer on
        for tag in self._true_firsts(records):
            if tag not in self._firsts:
                self._firsts.append(tag)
        k = RECORDS.index
        self._best[k(Record.POPULATION)] = self._animals.count
        self._best[k(Record.SPECIES_ALIVE)] = self._census.alive_count
        if records:
            peaks = self._peak[: len(records)]
            ages = np.array([r.lived_days(ctx.t_ms) for r in records])
            self._best[k(Record.SPECIES_PEAK)] = float(peaks.max())
            self._holder[k(Record.SPECIES_PEAK)] = int(peaks.argmax()) + 1
            self._best[k(Record.SPECIES_AGE)] = float(ages.max())
            self._holder[k(Record.SPECIES_AGE)] = int(ages.argmax()) + 1
        self._announced[:] = self._best
        cells, masses, species = self._cells_and_masses(labels)
        on = (masses > 0) & (species > 0)
        self._prev_cells, self._prev_species = cells[on], species[on]

    def _true_firsts(self, records: list[SpeciesRecord]) -> list[str]:
        """The firsts that already happened, as far as the world shows."""
        tags: list[str] = []
        if any(r.founding[Gene.DIET] >= self._predator_diet for r in records):
            tags.append(FIRST_HUNTERS)
        if any(r.founding[Gene.AQUATIC] >= self._cfg.swimmer_min_aquatic for r in records):
            tags.append(FIRST_SWIMMERS)
        if self._plants.closed_forest_share() > 0:
            tags.append(FIRST_FOREST)
        rare = int(np.bitwise_or.reduce(self._rare)) if self._rare.size else 0
        tags += [f"rare_{(g.name or '').lower()}" for g in CREATURE_GENES if rare & g]
        growing = self._plants.biomass > 0
        for gene in PLANT_GENES:
            if (growing & ((self._plants.rare & gene) != 0)).any():
                tags.append(f"plant_{(gene.name or '').lower()}")
        return tags


def _years_between(birth: dt.date, instant: Instant) -> int:
    """Whole years from ``birth`` to the day of ``instant`` (a 29 February birthday
    falls on 28 February in other years)."""
    today = instant.date
    years = today.year - birth.year
    day = min(birth.day, 28) if birth.month == 2 and birth.day == 29 else birth.day
    if (today.month, today.day) < (birth.month, day):
        years -= 1
    return max(0, years)
