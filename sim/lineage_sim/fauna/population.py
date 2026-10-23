"""The population of creatures and the fauna subsystem.

Each tick (every 10 sim-minutes): creatures sense, steer, move and burn energy; graze the
flora; hunters attack prey in reach; brains learn from the tick's energy balance (M5);
the starved, the old and the eaten die; ready adults breed with a compatible neighbour,
or alone if none came by for too long. Founders arrive on an empty, vegetated world, and
a few strangers arrive every year.

Creatures are rows of parallel arrays (struct of arrays). Loops in Python only run over
the handful of attacks and broods of a tick, in creature order, so results are
deterministic.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from enum import IntEnum
from typing import cast

import numpy as np
from numpy.random import Generator
from numpy.typing import NDArray

from lineage_sim import rare
from lineage_sim.clock import MS_PER_DAY, Season
from lineage_sim.config import FaunaConfig
from lineage_sim.events import (
    CraterFormed,
    CreaturesArrived,
    CreaturesDied,
    InputEvent,
    JuvenileGrown,
    OutputEvent,
    PopulationExtinct,
    VolcanoErupted,
)
from lineage_sim.fauna import brain, creature
from lineage_sim.fauna import genome as gn
from lineage_sim.fauna.genome import GENE_COUNT, Gene
from lineage_sim.fauna.phenotype import Phenotype
from lineage_sim.flora import LOW_FORMS, WOODY_FORMS, Flora, Wildfire
from lineage_sim.rare import body_of
from lineage_sim.rng import FAUNA
from lineage_sim.state.schema import Tree
from lineage_sim.subsystem import Context
from lineage_sim.terrain import Terrain

Values = NDArray[np.float32]
Flags = NDArray[np.bool_]

_HOURS_PER_DAY = 24.0
_HOURS_PER_YEAR = 365.25 * _HOURS_PER_DAY
# Spread, in cells, of newborns around their parent.
_BIRTH_SCATTER = 0.6
# Founders and hunter species are land walkers: their swimming gene is at most this,
# their limbs gene within these bounds.
_WALKER_AQUATIC_MAX = 0.2
_WALKER_LIMBS = (0.4, 0.8)
# Smallest size, jaw, speed and sense gene of an arriving hunter species.
_HUNTER_MIN = 0.5
# Initial headings of newcomers are spaced by the golden angle (radians).
_GOLDEN_ANGLE = 2.399963
# Founders only arrive in these seasons.
_FOUNDING_SEASONS = (Season.SPRING, Season.SUMMER)
# Plant biomass a cell needs for newcomers to land on it.
_LANDING_BIOMASS = 0.3
# Learned gains on the plant-form senses, which meals teach.
_LOW_GAIN = brain.FOLLOWED.index(brain.Sense.LOW_X)
_WOODY_GAIN = brain.FOLLOWED.index(brain.Sense.WOODY_X)


class Death(IntEnum):
    STARVED = 0
    OLD_AGE = 1
    KILLED = 2
    DROWNED = 3
    BURNT = 4  # caught in a burning cell on land (R4)


@dataclass
class Tally:
    """Cumulative counts since the world began."""

    births: int = 0
    clones: int = 0  # births without a mate (included in births)
    arrivals: int = 0
    extinctions: int = 0
    starved: int = 0
    old_age: int = 0
    killed: int = 0
    drowned: int = 0
    burnt: int = 0

    @property
    def deaths(self) -> int:
        return self.starved + self.old_age + self.killed + self.drowned + self.burnt


class Fauna:
    """The fauna subsystem. Read the population through the properties."""

    def __init__(
        self, cfg: FaunaConfig, terrain: Terrain, flora: Flora, fire: Wildfire | None = None
    ) -> None:
        self._cfg = cfg
        self._terrain = terrain
        self._flora = flora
        # Burning cells hurt the creatures in them (R4); none in a world without fire.
        self._fire = fire
        self._shape: tuple[int, int] = (terrain.height.shape[0], terrain.height.shape[1])
        self._positions = np.zeros((0, 2), dtype=np.float32)
        self._energy = np.zeros(0, dtype=np.float32)
        self._age_h = np.zeros(0, dtype=np.float32)
        self._idle_h = np.zeros(0, dtype=np.float32)  # hours since its last brood
        self._heading = np.zeros(0, dtype=np.float32)  # direction it roams in, radians
        self._genes = np.zeros((0, GENE_COUNT), dtype=np.float32)
        self._weights = np.zeros((0, brain.WEIGHT_COUNT), dtype=np.float32)
        self._slots = np.zeros(0, dtype=np.uint16)
        self._ids = np.zeros(0, dtype=np.int64)
        self._origin = np.zeros(0, dtype=np.int32)  # row of _ancestors it descends from
        self._ancestors = np.zeros((0, GENE_COUNT), dtype=np.float32)
        self._generation = np.zeros(0, dtype=np.int32)  # 0: arrived from elsewhere
        # Lifetime learning (M5): learned gains on the followed senses, their
        # eligibility traces, and the running energy balance (share of capacity per hour)
        # that serves as the reward baseline.
        self._learned = np.zeros((0, brain.LEARNED_COUNT), dtype=np.float32)
        self._trace = np.zeros((0, brain.LEARNED_COUNT), dtype=np.float32)
        # Exploration noise on each steering drive, in units of the creature's own
        # exploration: it persists for about exploration_hours, so a creature tries a
        # different way for a while rather than jittering.
        self._noise: NDArray[np.float32] = np.zeros((0, brain.OUTPUTS), dtype=np.float32)
        self._baseline = np.zeros(0, dtype=np.float32)
        # Running average value of its plant meals (share of the plant energy it really
        # got, after toxins); NaN before its first meal.
        self._meal_value = np.zeros(0, dtype=np.float32)
        # How it fends for itself: energy balance per hour averaged over about a day, the
        # age at which that stopped being negative (-1: not yet), and what it ate and
        # burnt while young.
        self._balance = np.zeros(0, dtype=np.float32)
        self._competent_h = np.zeros(0, dtype=np.float32)
        self._young_eaten = np.zeros(0, dtype=np.float32)
        self._young_burnt = np.zeros(0, dtype=np.float32)
        # Remains of the dead, in units of meat mass per cell; they rot away.
        self._carrion = np.zeros(self._shape, dtype=np.float32)
        # Its scent: carrion spread over carrion_scent_cells (creature.spread), kept up to
        # date as carrion is left, eaten and rots, rather than recomputed every tick.
        self._scent = np.zeros(self._shape, dtype=np.float32)
        self._next_id = 1
        self._arrival_at_h = -1.0  # sim hour founders are due; negative: none scheduled
        self.tally = Tally()
        # Derived from the genes; rebuilt whenever the population changes.
        self._body: Phenotype = body_of(cfg, self._genes, self._slots)
        self._compatible: Flags = np.zeros((0, 0), dtype=np.bool_)
        self._kills: Flags = np.zeros((0, 0), dtype=np.bool_)
        self._in_water: Flags = np.zeros(0, dtype=np.bool_)  # where each stood this tick
        self._meal = np.zeros(0, dtype=np.float32)  # energy eaten this tick
        self._meat = np.zeros(0, dtype=np.float32)  # of it, from meat (kills and carrion)
        self._leftover = np.zeros(0, dtype=np.float32)  # meat mass a kill left, per victim
        # Youths that ended and creatures that died this tick: outputs not yet handed on.
        self._grown: list[OutputEvent] = []
        # Pairwise offsets and distances for the current positions; None when stale.
        self._apart: tuple[NDArray[np.float32], NDArray[np.float32]] | None = None
        # Daylight in [0, 1], set by the presence model (M8): the dark dims sight, stops
        # photosynthesis and sends hibernators into torpor.
        self._daylight = 1.0
        self._torpid: Flags = np.zeros(0, dtype=np.bool_)  # hibernators torpid this tick

    @property
    def name(self) -> str:
        return FAUNA

    # -- views --

    @property
    def config(self) -> FaunaConfig:
        return self._cfg

    @property
    def count(self) -> int:
        return int(self._energy.size)

    @property
    def positions(self) -> NDArray[np.float32]:
        """x, y in cells, one row per creature."""
        return self._positions

    @property
    def energy(self) -> Values:
        return self._energy

    @property
    def age_hours(self) -> Values:
        return self._age_h

    @property
    def genes(self) -> NDArray[np.float32]:
        return self._genes

    @property
    def weights(self) -> NDArray[np.float32]:
        return self._weights

    @property
    def slots(self) -> NDArray[np.uint16]:
        return self._slots

    @property
    def ids(self) -> NDArray[np.int64]:
        return self._ids

    @property
    def origin(self) -> NDArray[np.int32]:
        """Which arrival each creature descends from (through its mother): its lineage."""
        return self._origin

    @property
    def generation(self) -> NDArray[np.int32]:
        """Generations since its lineage arrived (0: arrived from elsewhere)."""
        return self._generation

    @property
    def learned(self) -> NDArray[np.float32]:
        """What each brain has learned: gains on its `brain.FOLLOWED` senses."""
        return self._learned

    @property
    def competent_hours(self) -> Values:
        """Age at which each creature began to feed itself; -1 if it has not yet."""
        return self._competent_h

    @property
    def carrion(self) -> NDArray[np.float32]:
        """Remains of the dead on each cell, in units of meat mass."""
        return self._carrion

    @property
    def body(self) -> Phenotype:
        return self._body

    @property
    def torpid(self) -> Flags:
        """Hibernators lying torpid this tick (the renderer curls them up)."""
        return self._torpid

    @property
    def daylight(self) -> float:
        return self._daylight

    def set_daylight(self, level: float) -> None:
        """Hook for the presence model: daylight in [0, 1]."""
        self._daylight = min(max(level, 0.0), 1.0)

    def rare_counts(self) -> dict[rare.CreatureRare, int]:
        """Number of living carriers of each creature rare gene."""
        return {g: int(np.count_nonzero(rare.carries(self._slots, g))) for g in rare.CREATURE_GENES}

    @property
    def adult(self) -> Flags:
        return self._age_h >= self._body.maturity_h

    @property
    def maturity(self) -> Values:
        """How grown each creature is: age over the age it comes of age at, in [0, 1]."""
        grown = self._age_h / np.maximum(self._body.maturity_h, np.float32(1e-6))
        return np.clip(grown, 0.0, 1.0).astype(np.float32)

    @property
    def eating(self) -> NDArray[np.int8]:
        """What each creature ate in the last tick (R5, the renderer draws it): 0 nothing,
        1 plants or algae, 2 meat (a kill or carrion), whichever gave it more."""
        if self._meal.size != self.count:
            return np.zeros(self.count, dtype=np.int8)
        plants = self._meal - self._meat
        return np.select(
            [self._meat > np.maximum(plants, 0.0), self._meal > 0.0], [2, 1], 0
        ).astype(np.int8)

    @property
    def ready(self) -> Flags:
        """Adults with the energy to breed whose last brood is long enough ago."""
        cfg = self._cfg
        return (
            self.adult
            & (self._energy >= cfg.repro_energy_share * self._body.capacity)
            & (
                self._idle_h
                >= cfg.repro_cooldown_days * _HOURS_PER_DAY * rare.cooldown_factor(cfg, self._slots)
            )
            & ~self._torpid
        )

    @property
    def hungry(self) -> Flags:
        """Creatures with room for a meal: only they hunt."""
        hungry = self._energy < self._cfg.hunt_below_energy_share * self._body.capacity
        return hungry & ~self._torpid

    def distance_from_ancestors(self) -> Values:
        """Genetic distance of each creature from the genome its lineage arrived with."""
        return gn.distance(self._genes, self._ancestors[self._origin])

    def diet_counts(self) -> tuple[int, int, int]:
        """(herbivores, omnivores, predators) by diet gene."""
        diet = self._genes[:, Gene.DIET]
        herbivores = int(np.count_nonzero(diet <= self._cfg.herbivore_max_diet))
        predators = int(np.count_nonzero(diet >= self._cfg.predator_min_diet))
        return herbivores, self.count - herbivores - predators, predators

    # -- subsystem interface --

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        return []  # nobody yet: founders arrive once plants have taken hold

    def tick(self, ctx: Context) -> list[OutputEvent]:
        hours = ctx.dt_s / 3600.0
        now_h = ctx.t_ms / 3_600_000.0
        rng = ctx.rng
        outputs: list[OutputEvent] = []
        # Fixed draws per tick, so the stream does not depend on what happens.
        stranger_roll = rng.random()

        if self.count == 0:
            # Founders land in spring or summer, with a growing season ahead of them.
            if ctx.instant.season in _FOUNDING_SEASONS:
                outputs += self._await_founders(rng, now_h, ctx.t_ms)
            return outputs

        before = self._energy.copy()
        self._meal = np.zeros(self.count, dtype=np.float32)
        self._meat = np.zeros(self.count, dtype=np.float32)
        self._leftover = np.zeros(self.count, dtype=np.float32)
        self._torpid = rare.torpid(
            self._cfg, self._slots, self._energy, self._body.capacity,
            ctx.instant.season is Season.WINTER, self._daylight,
        )  # fmt: skip
        rot = np.float32(np.exp(-hours / self._cfg.carrion_decay_hours))
        self._carrion *= rot
        self._scent *= rot
        self._live(rng, hours)
        dead = self._hunt(rng, hours)
        # The tick's own balance, before any breeding: what eating and moving earned.
        self._learn(self._energy - before, hours, ctx.t_ms)
        in_fire = self._burn(hours)
        dead = self._expire(dead, in_fire)
        newborn = self._breed(rng, dead)
        self._bury(dead, ctx.t_ms)
        if newborn is not None:
            self._append(*newborn)
        outputs += self._grown
        self._grown = []
        if self.count == 0:
            self.tally.extinctions += 1
            self._arrival_at_h = -1.0
            outputs.append(PopulationExtinct(ctx.t_ms))
        elif stranger_roll < self._cfg.immigrant_groups_per_year * hours / _HOURS_PER_YEAR:
            outputs += self._arrive(rng, ctx.t_ms, self._cfg.immigrant_group_size, founders=False)
        return outputs

    def observe(self, outputs: Sequence[OutputEvent], ctx: Context) -> list[OutputEvent]:
        """A volcano's cone rising or a crater striking kills the creatures on it."""
        seen: list[OutputEvent] = []
        for event in outputs:
            if isinstance(event, VolcanoErupted | CraterFormed):
                reach = self._cfg.blast_kill_reach * event.radius_cells
                seen += self.strike(event.x, event.y, reach, ctx.t_ms)
        return seen

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {
            "positions": self._positions.copy(),
            "energy": self._energy.copy(),
            "age_h": self._age_h.copy(),
            "idle_h": self._idle_h.copy(),
            "heading": self._heading.copy(),
            "genes": self._genes.copy(),
            "weights": self._weights.copy(),
            "slots": self._slots.copy(),
            "ids": self._ids.copy(),
            "origin": self._origin.copy(),
            "ancestors": self._ancestors.copy(),
            "generation": self._generation.copy(),
            "learned": self._learned.copy(),
            "trace": self._trace.copy(),
            "noise": self._noise.copy(),
            "baseline": self._baseline.copy(),
            "meal_value": self._meal_value.copy(),
            "balance": self._balance.copy(),
            "competent_h": self._competent_h.copy(),
            "young_eaten": self._young_eaten.copy(),
            "young_burnt": self._young_burnt.copy(),
            "carrion": self._carrion.copy(),
            "scent": self._scent.copy(),
            "next_id": self._next_id,
            "arrival_at_h": self._arrival_at_h,
            "tally": {name: int(value) for name, value in vars(self.tally).items()},
        }

    def set_state(self, tree: Tree) -> None:
        self._positions = np.array(tree["positions"], dtype=np.float32).reshape(-1, 2)
        self._energy = np.array(tree["energy"], dtype=np.float32)
        self._age_h = np.array(tree["age_h"], dtype=np.float32)
        self._idle_h = np.array(tree["idle_h"], dtype=np.float32)
        self._heading = np.array(tree["heading"], dtype=np.float32)
        self._genes = np.array(tree["genes"], dtype=np.float32).reshape(-1, GENE_COUNT)
        self._weights = np.array(tree["weights"], dtype=np.float32).reshape(-1, brain.WEIGHT_COUNT)
        self._slots = np.array(tree["slots"], dtype=np.uint16)
        self._ids = np.array(tree["ids"], dtype=np.int64)
        self._origin = np.array(tree["origin"], dtype=np.int32)
        self._ancestors = np.array(tree["ancestors"], dtype=np.float32).reshape(-1, GENE_COUNT)
        self._generation = np.array(tree["generation"], dtype=np.int32)
        gains = (-1, brain.LEARNED_COUNT)
        self._learned = np.array(tree["learned"], dtype=np.float32).reshape(gains)
        self._trace = np.array(tree["trace"], dtype=np.float32).reshape(gains)
        self._noise = np.array(tree["noise"], dtype=np.float32).reshape(-1, brain.OUTPUTS)
        self._baseline = np.array(tree["baseline"], dtype=np.float32)
        self._meal_value = np.array(tree["meal_value"], dtype=np.float32)
        self._balance = np.array(tree["balance"], dtype=np.float32)
        self._competent_h = np.array(tree["competent_h"], dtype=np.float32)
        self._young_eaten = np.array(tree["young_eaten"], dtype=np.float32)
        self._young_burnt = np.array(tree["young_burnt"], dtype=np.float32)
        self._carrion = np.array(tree["carrion"], dtype=np.float32).reshape(self._shape)
        self._scent = np.array(tree["scent"], dtype=np.float32).reshape(self._shape)
        self._next_id = int(tree["next_id"])
        self._arrival_at_h = float(tree["arrival_at_h"])
        self.tally = Tally(**cast(dict[str, int], tree["tally"]))
        self._refresh()

    # -- a tick, step by step --

    def _live(self, rng: Generator, hours: float) -> None:
        """Sense, steer, move, burn energy, graze, age."""
        cfg, body = self._cfg, self._body
        land = self._terrain.land.astype(np.float32)
        biomass = self._flora.grazeable()
        is_low, is_woody = self._flora.form_masks()
        low = np.where(is_low, biomass, np.float32(0.0)).astype(np.float32)
        woody = np.where(is_woody, biomass, np.float32(0.0)).astype(np.float32)
        offsets, distance = self._separations()
        # Food at sea (M11): smelled by those at ease in water (swimmers, amphibians).
        algae = self._flora.grazeable_algae()
        sea, ease = None, None
        if algae.any():
            sea = algae
            ease = np.where(
                rare.waterproof(self._slots), np.float32(1.0), self._genes[:, Gene.AQUATIC]
            ).astype(np.float32)
        senses = creature.sense(
            cfg,
            self._positions,
            self._energy,
            body,
            self.adult,
            self.ready,
            self.hungry,
            self._compatible,
            self._kills,
            biomass,
            low,
            woody,
            np.maximum(self._scent, np.float32(0.0)),
            land,
            offsets,
            distance,
            rare.sight(cfg, self._slots, body.sense_range, self._daylight),
            sea,
            ease,
        )
        # Roaming: a heading that drifts slowly, so a creature with nothing to steer by
        # covers ground instead of jittering in place.
        turn = rng.normal(0.0, cfg.wander_turn * np.sqrt(hours), self.count)
        self._heading = (self._heading + turn).astype(np.float32)
        roam = np.stack([np.cos(self._heading), np.sin(self._heading)], axis=1)
        if cfg.learning:
            drive = brain.think(brain.with_learned(self._weights, self._learned), senses)
            # Exploration: slowly varying noise on the drive, remembered in the trace
            # (scaled to the largest exploration, so a creature that does not explore
            # does not learn).
            persist = np.float32(np.exp(-hours / cfg.exploration_hours))
            fresh = rng.normal(0.0, 1.0, drive.shape).astype(np.float32)
            self._noise = (persist * self._noise + np.sqrt(1.0 - persist**2) * fresh).astype(
                np.float32
            )
            spread = brain.exploring(
                body.exploration, self._age_h, cfg.exploration_fade_hours, cfg.exploration_floor
            )
            noise = self._noise * spread[:, None]
            fade = np.float32(np.exp(-hours / cfg.trace_hours))
            self._trace = fade * self._trace + brain.eligibility(
                senses, noise / np.float32(cfg.exploration_max)
            )
            drive = drive + noise
        else:
            drive = brain.think(self._weights, senses)
        steering = np.tanh(drive) + np.float32(cfg.wander_noise) * roam
        torpid = self._torpid
        steering[torpid] = 0.0  # the torpid lie still
        rows, columns = creature.cells_of(self._positions, self._shape)
        in_water = land[rows, columns] < 0.5
        self._positions, travelled = creature.move(
            self._positions, steering, body, in_water, hours, self._shape
        )
        self._apart = None
        burnt = creature.upkeep(
            cfg, self._genes, body, travelled, in_water, hours, rare.waterproof(self._slots)
        )
        torpor = np.float32(cfg.hibernation_burn_share)
        burnt = np.where(torpid, burnt * torpor, burnt).astype(np.float32)
        self._energy = self._energy - burnt
        self._in_water = in_water

        rows, columns = creature.cells_of(self._positions, self._shape)
        sun = rare.sunlight(
            cfg, self._slots, body.mass, self._daylight, self._flora.shade()[rows, columns],
            ~in_water, hours,
        )  # fmt: skip
        sun = np.minimum(sun, np.maximum(body.capacity - self._energy, 0.0))
        self._energy = (self._energy + sun).astype(np.float32)
        appetite = creature.appetite(cfg, self._energy, body, hours)
        appetite[torpid] = 0.0
        eaten = self._flora.graze(rows, columns, appetite)
        # Defended plants are not only harder to bite: what is eaten is worth less (toxins).
        # Rare plant genes change it again: fruit is richer, poison costs energy.
        toxic = np.float32(cfg.defence_toxicity) * self._flora.defence_at(rows, columns)
        quality = ((np.float32(1.0) - toxic) * self._flora.meal_factor(rows, columns)).astype(
            np.float32
        )
        value = np.float32(cfg.plant_energy) * body.plant_efficiency * quality
        meal = (eaten * value).astype(np.float32)
        self._energy = self._energy + meal
        self._meal = self._meal + meal
        if cfg.learning:
            # Learning from meals: was the plant form just eaten better than usual?
            forms = self._flora.forms()[rows, columns]
            gain_index = np.select(
                [np.isin(forms, LOW_FORMS), np.isin(forms, WOODY_FORMS)],
                [_LOW_GAIN, _WOODY_GAIN],
                -1,
            ).astype(np.intp)
            # Algae are no plant form: a meal of them teaches nothing about low or woody.
            gain_index[self._flora.on_algae(rows, columns)] = -1
            full_bite = body.graze_rate * np.float32(hours)
            bite = np.clip(eaten / np.maximum(full_bite, 1e-9), 0.0, 1.0).astype(np.float32)
            self._learned, self._meal_value = brain.taste(
                self._learned, gain_index, bite, quality,
                self._meal_value, body.learning_rate * np.float32(cfg.meal_learning_gain),
                hours, cfg.learned_max, cfg.meal_memory_hours,
            )  # fmt: skip
        self._scavenge(rows, columns, hours)
        ageing = np.where(torpid, np.float32(cfg.hibernation_ageing_share), np.float32(1.0))
        self._age_h = (self._age_h + np.float32(hours) * ageing).astype(np.float32)
        self._idle_h = self._idle_h + np.float32(hours)

    def _scavenge(self, rows: NDArray[np.intp], columns: NDArray[np.intp], hours: float) -> None:
        """Creatures that digest meat eat the carrion where they stand."""
        cfg, body = self._cfg, self._body
        eats_meat = (self._genes[:, Gene.DIET] >= cfg.attack_min_diet) & ~self._torpid
        on_carrion = self._carrion[rows, columns] > 0
        who = np.nonzero(eats_meat & on_carrion)[0]
        if who.size == 0:
            return
        value = np.float32(cfg.meat_energy) * body.meat_efficiency[who]
        room = np.maximum(body.capacity[who] - self._energy[who], 0.0) / value
        bite = np.float32(cfg.scavenge_rate * hours) * body.mass[who] ** np.float32(
            cfg.metabolic_exponent
        )
        got = creature.share_out(self._carrion, rows[who], columns[who], np.minimum(bite, room))
        creature.stamp(self._scent, rows[who], columns[who], -got, cfg.carrion_scent_cells)
        self._energy[who] += got * value
        self._meal[who] += got * value
        self._meat[who] += got * value

    def _hunt(self, rng: Generator, hours: float) -> NDArray[np.int8]:
        """Hunters attack the nearest prey in reach. Returns each creature's cause of
        death (-1: alive)."""
        cfg, body, n = self._cfg, self._body, self.count
        dead = np.full(n, -1, dtype=np.int8)
        attempt_roll = rng.random(n)
        kill_roll = rng.random(n)
        _, distance = self._separations()
        in_reach = self._kills & (distance <= cfg.reach_cells) & self.hungry[:, None]
        masked = np.where(in_reach, distance, np.inf)
        prey = np.argmin(masked, axis=1)
        has_prey = np.isfinite(masked[np.arange(n), prey])
        strikes = has_prey & (attempt_roll < 1.0 - np.exp(-cfg.attack_rate * hours))
        hunters = np.nonzero(strikes)[0]
        if hunters.size == 0:
            return dead
        chance = creature.kill_chance(cfg, body, hunters, prey[hunters], self._torpid)
        chance = chance * rare.kill_factor(cfg, self._slots)[prey[hunters]]
        self._energy[hunters] -= np.float32(cfg.attack_cost) * body.mass[hunters]
        for k, hunter in enumerate(hunters.tolist()):
            victim = int(prey[hunter])
            if dead[hunter] >= 0 or dead[victim] >= 0 or kill_roll[hunter] >= chance[k]:
                continue
            dead[victim] = Death.KILLED
            value = cfg.meat_energy * float(body.meat_efficiency[hunter])
            meal = value * float(body.mass[victim])
            room = float(body.capacity[hunter]) - float(self._energy[hunter])
            eaten = min(meal, max(room, 0.0))
            self._energy[hunter] += np.float32(eaten)
            self._meal[hunter] += np.float32(eaten)
            self._meat[hunter] += np.float32(eaten)
            # What the hunter could not eat is left for scavengers.
            self._leftover[victim] = np.float32(float(body.mass[victim]) - eaten / value)
        return dead

    def _learn(self, gained: Values, hours: float, t_ms: int) -> None:
        """Learn from the tick's energy balance, and follow how the young fend for
        themselves. ``gained`` is each creature's energy change from eating and moving."""
        cfg, body = self._cfg, self._body
        per_hour = gained / np.float32(hours)
        if cfg.learning:
            reward = per_hour / body.capacity
            advantage = (reward - self._baseline).astype(np.float32)
            self._learned = brain.learn(
                self._learned, self._trace, advantage,
                body.learning_rate * np.float32(cfg.perturbation_gain), hours,
                cfg.learned_max, cfg.forget_hours,
            )  # fmt: skip
            follow = np.float32(1.0 - np.exp(-hours / cfg.baseline_hours))
            self._baseline = (self._baseline + follow * advantage).astype(np.float32)

        follow = np.float32(1.0 - np.exp(-hours / cfg.competence_hours))
        self._balance = (self._balance + follow * (per_hour - self._balance)).astype(np.float32)
        becomes = (self._competent_h < 0) & (self._balance >= 0)
        self._competent_h[becomes] = self._age_h[becomes]
        young = self._age_h - np.float32(hours) < body.maturity_h
        self._young_eaten[young] += self._meal[young]
        self._young_burnt[young] += (self._meal - gained)[young]
        grown = young & (self._age_h >= body.maturity_h)
        self._grown += self._youth_ended(np.nonzero(grown)[0], t_ms, died=False)

    def _youth_ended(self, which: NDArray[np.intp], t_ms: int, *, died: bool) -> list[OutputEvent]:
        return [
            JuvenileGrown(
                t_ms,
                int(self._ids[i]),
                int(self._generation[i]),
                float(self._age_h[i]),
                float(self._young_eaten[i]),
                float(self._young_burnt[i]),
                float(self._competent_h[i]),
                died,
            )
            for i in which.tolist()
        ]

    def _burn(self, hours: float) -> NDArray[np.bool_]:
        """Creatures on land in a burning cell lose ``fire_damage_per_hour`` of their
        capacity an hour (R4): one that stays in the fire dies of it. Returns who is in it."""
        if self._fire is None or self.count == 0:
            return np.zeros(self.count, dtype=np.bool_)
        rows, columns = creature.cells_of(self._positions, self._shape)
        caught = self._fire.burning[rows, columns] & ~self._in_water
        if caught.any():
            damage = np.float32(self._cfg.fire_damage_per_hour * hours) * self._body.capacity
            self._energy = np.where(caught, self._energy - damage, self._energy).astype(np.float32)
        return caught

    def _expire(
        self, dead: NDArray[np.int8], in_fire: NDArray[np.bool_] | None = None
    ) -> NDArray[np.int8]:
        """Mark the burnt, the starved (or drowned) and the old."""
        alive = dead < 0
        starved = alive & (self._energy <= 0)
        if in_fire is not None:
            dead[starved & in_fire] = Death.BURNT
            starved &= ~in_fire
        dead[starved & self._in_water] = Death.DROWNED
        dead[starved & ~self._in_water] = Death.STARVED
        dead[(dead < 0) & (self._age_h >= self._body.lifespan_h)] = Death.OLD_AGE
        return dead

    def _breed(
        self, rng: Generator, dead: NDArray[np.int8]
    ) -> tuple[NDArray[np.float32], Values, NDArray[np.float32], NDArray[np.float32],
               NDArray[np.uint16], NDArray[np.int32], NDArray[np.int32],
               NDArray[np.float32]] | None:  # fmt: skip
        """Pair ready adults (or let the lonely clone). Returns the newborns' arrays."""
        cfg, body, n = self._cfg, self._body, self.count
        ready = (dead < 0) & self.ready
        if not ready.any():
            return None
        # Predators have their own cap, so a full herd cannot crowd them out.
        predator = self._genes[:, Gene.DIET] >= cfg.predator_min_diet
        living = dead < 0
        room_predators = cfg.predator_cap - int(np.count_nonzero(living & predator))
        room_others = cfg.population_cap - int(np.count_nonzero(living & ~predator))

        _, distance = self._separations()
        mates = self._compatible & ready[None, :] & (distance <= cfg.reach_cells)
        np.fill_diagonal(mates, False)
        masked = np.where(mates, distance, np.inf)
        partner = np.argmin(masked, axis=1)
        has_partner = np.isfinite(masked[np.arange(n), partner])
        lonely = self._idle_h >= cfg.asexual_after_days * _HOURS_PER_DAY

        first: list[int] = []
        second: list[int] = []
        taken = np.zeros(n, dtype=np.bool_)
        for i in np.nonzero(ready)[0].tolist():
            if taken[i]:
                continue
            j = int(partner[i])
            if has_partner[i] and not taken[j]:
                taken[i] = taken[j] = True
                first.append(i)
                second.append(j)
            elif lonely[i]:
                taken[i] = True
                first.append(i)
                second.append(i)  # itself: a clone
        if not first:
            return None

        a, b = np.array(first, dtype=np.intp), np.array(second, dtype=np.intp)
        cloned = a == b
        brood = np.where(cloned, 1.0, np.rint((body.brood[a] + body.brood[b]) / 2.0))
        share = np.float32(cfg.repro_investment_share)
        invest_a = share * body.capacity[a] * np.where(cloned, cfg.asexual_cost_factor, 1.0)
        invest_b = np.where(cloned, 0.0, share * body.capacity[b])
        # Parents pay in creature order until their kind's cap is reached.
        hunters = predator[a]
        allowed = np.where(
            hunters,
            np.cumsum(brood * hunters) <= room_predators,
            np.cumsum(brood * ~hunters) <= room_others,
        )
        # A young can fall on the other side of the predator line than its parents, so
        # the two caps together are also enforced as one hard limit.
        hard_room = cfg.population_cap + cfg.predator_cap - int(np.count_nonzero(living))
        allowed &= np.cumsum(brood * allowed) <= hard_room
        a, b, brood, cloned = a[allowed], b[allowed], brood[allowed], cloned[allowed]
        invest_a, invest_b = invest_a[allowed], invest_b[allowed]
        if a.size == 0:
            return None
        self._energy[a] -= invest_a.astype(np.float32)
        np.subtract.at(self._energy, b, invest_b.astype(np.float32))
        self._idle_h[a] = 0.0
        self._idle_h[b] = 0.0

        counts = brood.astype(np.intp)
        mother, father = np.repeat(a, counts), np.repeat(b, counts)
        total = int(counts.sum())
        genes = gn.mutate_genes(
            rng, gn.crossover(rng, self._genes[mother], self._genes[father]),
            cfg.mutation_sigma_body,
        )  # fmt: skip
        weights = gn.mutate_weights(
            rng, gn.crossover(rng, self._weights[mother], self._weights[father]),
            cfg.mutation_sigma_brain,
        )  # fmt: skip
        slots = gn.inherit_slots(rng, cfg, self._slots[mother], self._slots[father])
        scatter = rng.normal(0.0, _BIRTH_SCATTER, (total, 2)).astype(np.float32)
        positions = self._positions[mother] + scatter
        positions[:, 0] = np.clip(positions[:, 0], 0.0, self._shape[1] - 1.0)
        positions[:, 1] = np.clip(positions[:, 1], 0.0, self._shape[0] - 1.0)
        gift = np.repeat((invest_a + invest_b) * cfg.birth_efficiency / brood, counts)
        newborn = body_of(cfg, genes, slots)
        energy = np.minimum(gift, newborn.capacity).astype(np.float32)
        self.tally.births += total
        self.tally.clones += int(counts[cloned].sum())
        generation = np.maximum(self._generation[mother], self._generation[father]) + 1
        # Diet traditions: a newborn takes on part of its mother's learned plant
        # preferences (its SOCIAL gene); nothing else it learned is passed on.
        learned = np.zeros((total, brain.LEARNED_COUNT), dtype=np.float32)
        copied = newborn.social[:, None]
        forms = [_LOW_GAIN, _WOODY_GAIN]
        learned[:, forms] = (copied * self._learned[mother][:, forms]).astype(np.float32)
        return (
            positions, energy, genes, weights, slots, self._origin[mother], generation, learned,
        )  # fmt: skip

    def _separations(self) -> tuple[NDArray[np.float32], NDArray[np.float32]]:
        """Pairwise offsets and distances, computed once per set of positions."""
        if self._apart is None:
            self._apart = creature.separations(self._positions)
        return self._apart

    def _leave_remains(self, dead: NDArray[np.int8]) -> None:
        """The dead leave carrion on land: what a hunter left of its kill, and a share of
        the body of those that starved or died of age. The drowned are lost to the sea."""
        cfg = self._cfg
        remains = np.where(
            dead == Death.KILLED,
            self._leftover,
            np.where(
                (dead == Death.STARVED) | (dead == Death.OLD_AGE),
                np.float32(cfg.carcass_share) * self._body.mass,
                0.0,
            ),
        ).astype(np.float32)
        who = np.nonzero(remains > 0)[0]
        if who.size:
            rows, columns = creature.cells_of(self._positions[who], self._shape)
            on_land = self._terrain.land[rows, columns]
            np.add.at(self._carrion, (rows[on_land], columns[on_land]), remains[who][on_land])
            creature.stamp(
                self._scent, rows[on_land], columns[on_land], remains[who][on_land],
                cfg.carrion_scent_cells,
            )  # fmt: skip

    def _bury(self, dead: NDArray[np.int8], t_ms: int, *, blast: bool = False) -> None:
        """Remove the dead and count them by cause; tell who died of what (R5), the dead of
        a ``blast`` as such."""
        gone = dead >= 0
        if not gone.any():
            return
        which = np.nonzero(gone)[0]
        self._grown.append(
            CreaturesDied(
                t_ms,
                tuple(int(ident) for ident in self._ids[which]),
                tuple(
                    "blast" if blast else Death(int(cause)).name.lower() for cause in dead[which]
                ),
            )
        )
        died_young = gone & (self._age_h < self._body.maturity_h)
        self._grown += self._youth_ended(np.nonzero(died_young)[0], t_ms, died=True)
        self._leave_remains(dead)
        causes = np.bincount(dead[gone], minlength=len(Death))
        self.tally.starved += int(causes[Death.STARVED])
        self.tally.old_age += int(causes[Death.OLD_AGE])
        self.tally.killed += int(causes[Death.KILLED])
        self.tally.drowned += int(causes[Death.DROWNED])
        self.tally.burnt += int(causes[Death.BURNT])
        keep = ~gone
        self._positions, self._energy = self._positions[keep], self._energy[keep]
        self._age_h, self._idle_h = self._age_h[keep], self._idle_h[keep]
        self._heading = self._heading[keep]
        self._genes, self._weights = self._genes[keep], self._weights[keep]
        self._slots, self._ids, self._origin = (
            self._slots[keep],
            self._ids[keep],
            self._origin[keep],
        )
        self._in_water = self._in_water[keep]
        self._torpid = self._torpid[keep]
        self._generation = self._generation[keep]
        self._learned, self._trace = self._learned[keep], self._trace[keep]
        self._noise = self._noise[keep]
        self._baseline, self._balance = self._baseline[keep], self._balance[keep]
        self._meal_value = self._meal_value[keep]
        self._competent_h = self._competent_h[keep]
        self._young_eaten, self._young_burnt = self._young_eaten[keep], self._young_burnt[keep]
        # The tick's meals stay with their eaters, for what is read of them after the tick.
        if self._meal.size == keep.size:
            self._meal, self._meat = self._meal[keep], self._meat[keep]
        self._body = body_of(self._cfg, self._genes, self._slots)
        self._compatible = self._compatible[keep][:, keep]
        self._kills = self._kills[keep][:, keep]
        self._apart = None

    def _append(
        self,
        positions: NDArray[np.float32],
        energy: Values,
        genes: NDArray[np.float32],
        weights: NDArray[np.float32],
        slots: NDArray[np.uint16],
        origin: NDArray[np.int32],
        generation: NDArray[np.int32],
        learned: NDArray[np.float32] | None = None,
    ) -> None:
        cfg, count, old = self._cfg, int(energy.size), self.count
        ids = np.arange(self._next_id, self._next_id + count, dtype=np.int64)
        self._next_id += count
        self._positions = np.concatenate([self._positions, positions]).astype(np.float32)
        self._energy = np.concatenate([self._energy, energy]).astype(np.float32)
        self._age_h = np.concatenate([self._age_h, np.zeros(count, dtype=np.float32)])
        self._idle_h = np.concatenate([self._idle_h, np.zeros(count, dtype=np.float32)])
        # Newcomers start facing along the golden angle from one another: spread out,
        # and no random draw needed.
        facing = (ids % 1000).astype(np.float32) * np.float32(_GOLDEN_ANGLE)
        self._heading = np.concatenate([self._heading, facing]).astype(np.float32)
        self._genes = np.concatenate([self._genes, genes]).astype(np.float32)
        self._weights = np.concatenate([self._weights, weights]).astype(np.float32)
        self._slots = np.concatenate([self._slots, slots]).astype(np.uint16)
        self._ids = np.concatenate([self._ids, ids])
        self._origin = np.concatenate([self._origin, origin]).astype(np.int32)
        self._in_water = np.concatenate([self._in_water, np.zeros(count, dtype=np.bool_)])
        self._torpid = np.concatenate([self._torpid, np.zeros(count, dtype=np.bool_)])
        self._generation = np.concatenate([self._generation, generation]).astype(np.int32)
        self._body = body_of(cfg, self._genes, self._slots)
        self._apart = None
        # Newcomers have learned nothing of their own (newborns may carry a share of their
        # mother's plant preferences), and expect to burn their resting metabolism.
        nothing = np.zeros((count, brain.LEARNED_COUNT), dtype=np.float32)
        self._learned = np.concatenate([self._learned, nothing if learned is None else learned])
        self._trace = np.concatenate([self._trace, nothing])
        self._noise = np.concatenate([self._noise, np.zeros((count, brain.OUTPUTS), np.float32)])
        resting = -self._body.basal_burn[old:]
        self._baseline = np.concatenate([self._baseline, resting / self._body.capacity[old:]])
        self._balance = np.concatenate([self._balance, resting])
        self._meal_value = np.concatenate([self._meal_value, np.full(count, np.nan, np.float32)])
        self._competent_h = np.concatenate([self._competent_h, np.full(count, -1.0, np.float32)])
        zeros = np.zeros(count, dtype=np.float32)
        self._young_eaten = np.concatenate([self._young_eaten, zeros])
        self._young_burnt = np.concatenate([self._young_burnt, zeros])
        if self._meal.size == old:
            self._meal = np.concatenate([self._meal, zeros])
            self._meat = np.concatenate([self._meat, zeros])
        # Extend the pair matrices with the newcomers' rows and columns only.
        near = gn.distance(self._genes[old:, None, :], self._genes[None, :, :])
        compatible = np.zeros((old + count, old + count), dtype=np.bool_)
        compatible[:old, :old] = self._compatible
        compatible[old:, :] = near <= cfg.compat_distance
        compatible[:, old:] = compatible[old:, :].T
        np.fill_diagonal(compatible, False)
        self._compatible = compatible
        self._kills = creature.can_kill(self._genes, self._body, compatible, cfg)

    def _refresh(self) -> None:
        """Rebuild everything that derives from the genes (after loading a save)."""
        cfg = self._cfg
        self._body = body_of(cfg, self._genes, self._slots)
        self._compatible = gn.distance_matrix(self._genes) <= cfg.compat_distance
        np.fill_diagonal(self._compatible, False)
        self._kills = creature.can_kill(self._genes, self._body, self._compatible, cfg)
        self._in_water = np.zeros(self.count, dtype=np.bool_)
        self._torpid = np.zeros(self.count, dtype=np.bool_)
        self._meal = np.zeros(self.count, dtype=np.float32)
        self._meat = np.zeros(self.count, dtype=np.float32)
        self._leftover = np.zeros(self.count, dtype=np.float32)
        self._apart = None

    # -- god powers (M8) --

    def strike(self, x: float, y: float, radius: float, t_ms: int) -> list[OutputEvent]:
        """A meteor's blast kills every creature within ``radius`` cells of (x, y); it
        leaves nothing to scavenge."""
        if self.count == 0:
            return []
        offset = self._positions - np.array([x, y], dtype=np.float32)
        hit = np.hypot(offset[:, 0], offset[:, 1]) <= np.float32(radius)
        if not hit.any():
            return []
        dead = np.where(hit, np.int8(Death.KILLED), np.int8(-1)).astype(np.int8)
        self._leftover = np.zeros(self.count, dtype=np.float32)
        self._bury(dead, t_ms, blast=True)
        outputs, self._grown = self._grown, []
        if self.count == 0:
            self.tally.extinctions += 1
            self._arrival_at_h = -1.0
            outputs.append(PopulationExtinct(t_ms))
        return outputs

    def arrive(self, rng: Generator, t_ms: int, count: int) -> list[OutputEvent]:
        """The ark: ``count`` plant eaters land on a vegetated spot, as founders do."""
        return self._arrive(rng, t_ms, count, founders=True)

    # -- arrivals --

    def _await_founders(self, rng: Generator, now_h: float, t_ms: int) -> list[OutputEvent]:
        """On an empty world: schedule founders once plants have taken hold, then land them."""
        cfg = self._cfg
        if self._arrival_at_h < 0:
            if t_ms % MS_PER_DAY != 0:
                return []  # plants are surveyed once a day, at midnight
            land = self._terrain.land
            green = land & (self._flora.biomass >= _LANDING_BIOMASS)
            cover = np.count_nonzero(green) / max(1, int(np.count_nonzero(land)))
            if cover >= cfg.founder_min_plant_cover:
                self._arrival_at_h = now_h + cfg.arrival_delay_days * _HOURS_PER_DAY
            return []
        if now_h < self._arrival_at_h:
            return []
        self._arrival_at_h = -1.0
        return self._arrive(rng, t_ms, cfg.founder_count, founders=True)

    def _arrive(
        self, rng: Generator, t_ms: int, count: int, *, founders: bool
    ) -> list[OutputEvent]:
        """A group of one new species lands on a vegetated spot."""
        cfg = self._cfg
        spots_y, spots_x = np.nonzero(
            self._terrain.land & (self._flora.biomass >= _LANDING_BIOMASS)
        )
        if count <= 0 or spots_y.size == 0:
            return []
        spot = int(rng.integers(0, spots_y.size))
        base = gn.random_genes(rng, 1)
        low, high = _WALKER_LIMBS
        if founders:
            # Small to medium land-walking plant eaters.
            base[0, Gene.DIET] *= cfg.founder_diet_max
            base[0, Gene.SIZE] *= cfg.founder_size_max
            base[0, Gene.AQUATIC] *= _WALKER_AQUATIC_MAX
            base[0, Gene.LIMBS] = low + (high - low) * base[0, Gene.LIMBS]
        elif rng.random() < cfg.immigrant_hunter_share:
            # A hunter species, built for it: a land walker in the predator diet range,
            # at least medium-sized, with a real jaw, legs and senses.
            base[0, Gene.DIET] = (
                cfg.predator_min_diet + (1.0 - cfg.predator_min_diet) * base[0, Gene.DIET]
            )
            base[0, Gene.SIZE] = _HUNTER_MIN + (1.0 - _HUNTER_MIN) * base[0, Gene.SIZE]
            for gene in (Gene.JAW, Gene.SPEED, Gene.SENSE):
                base[0, gene] = _HUNTER_MIN + (1.0 - _HUNTER_MIN) * base[0, gene]
            base[0, Gene.AQUATIC] *= _WALKER_AQUATIC_MAX
            base[0, Gene.LIMBS] = low + (high - low) * base[0, Gene.LIMBS]
        predators = self._genes[:, Gene.DIET] >= cfg.predator_min_diet
        if base[0, Gene.DIET] >= cfg.predator_min_diet:
            count = min(count, cfg.predator_cap - int(np.count_nonzero(predators)))
        else:
            count = min(count, cfg.population_cap - int(np.count_nonzero(~predators)))
        count = min(count, cfg.population_cap + cfg.predator_cap - self.count)
        if count <= 0:
            return []
        genes = gn.mutate_genes(rng, np.repeat(base, count, axis=0), cfg.founder_spread)
        weights = brain.founder_weights(rng, cfg, genes)
        scatter = rng.normal(0.0, cfg.founder_radius_cells / 2.0, (count, 2)).astype(np.float32)
        positions = np.array([spots_x[spot], spots_y[spot]], dtype=np.float32) + scatter
        positions[:, 0] = np.clip(positions[:, 0], 0.0, self._shape[1] - 1.0)
        positions[:, 1] = np.clip(positions[:, 1], 0.0, self._shape[0] - 1.0)
        # Newcomers land on land: one scattered into the sea stands on the spot instead.
        rows, columns = creature.cells_of(positions, self._shape)
        at_sea = ~self._terrain.land[rows, columns]
        positions[at_sea] = np.array([spots_x[spot], spots_y[spot]], dtype=np.float32)
        body = body_of(cfg, genes, np.zeros(count, dtype=np.uint16))
        energy = (cfg.founder_energy_share * body.capacity).astype(np.float32)
        # Arrive at random ages so they do not all die of old age together.
        ages = (rng.random(count) * 0.5 * body.lifespan_h).astype(np.float32)
        origin = np.full(count, self._ancestors.shape[0], dtype=np.int32)
        self._ancestors = np.concatenate([self._ancestors, base]).astype(np.float32)
        first_id = self._next_id
        self._append(
            positions, energy, genes, weights, np.zeros(count, dtype=np.uint16), origin,
            np.zeros(count, dtype=np.int32),
        )  # fmt: skip
        self._age_h[-count:] = ages
        self.tally.arrivals += count
        return [
            CreaturesArrived(
                t_ms, count, founders, float(spots_x[spot]), float(spots_y[spot]), first_id
            )
        ]
