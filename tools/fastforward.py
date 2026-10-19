"""Run N sim-years headless for M seeds and write ``runs/<id>/``.

Usage::

    uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/<id>
        [--start 2026-01-01] [--config sim/config/default.toml] [--jobs N]
        [--save-days 1] [--sample-days 7] [--snapshot-days 30] [--power-cut-day N]
        [--set fauna.learning=false] [--fork-days 60 --fork-length 28]

Each seed's world is stepped one sim-day at a time, exactly as the device would advance
it. Every ``--save-days`` it is saved to ``saves/<seed>.lzma`` (atomic replace); every
``--sample-days`` the probes record one sample of each series; every ``--snapshot-days``
the height grid is stored (8-bit) in ``snapshots/<seed>.npz`` for maps and animations.

With ``--power-cut-day N`` the in-memory world is discarded half a day after day N and the
run resumes from the last save on disk; the final state hash must match an uninterrupted
run. Final state hashes are recorded in the manifest.

``--set section.key=value`` changes one key of the config (a TOML value), for ablations
such as ``--set fauna.learning=false``; the run's ``config.toml`` records the change.

With ``--fork-days N`` the inhabited world is forked every N days: the same state is run
on for ``--fork-length`` days twice, with lifetime learning on and off, and the youths of
creatures born in the first half of that time are recorded per arm (``_fork``). Forks
leave the main world untouched.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from lineage_sim.config import Config, parse_config
from lineage_sim.events import (
    CraterFormed,
    CreaturesArrived,
    EarthquakeStruck,
    FireEnded,
    JuvenileGrown,
    LandmassesRejoined,
    LandmassSplit,
    OutputEvent,
    PopulationExtinct,
    SpeciesBorn,
    SpeciesExtinct,
    VolcanoErupted,
)
from lineage_sim.fauna import brain
from lineage_sim.fauna.brain import Sense
from lineage_sim.fauna.genome import Gene
from lineage_sim.flora import LOW_FORMS, WOODY_FORMS, Cover, Rare
from lineage_sim.flora import Gene as PlantGene
from lineage_sim.rare import CREATURE_GENES, PLANT_GENES, carries
from lineage_sim.state import io
from lineage_sim.world import World

from tools.runs import (
    DEFAULT_CONFIG,
    TIME_KEY,
    Manifest,
    Run,
    atomic_write_bytes,
    config_hash,
    git_commit,
    write_run,
)

DAY_S = 86_400
DAYS_PER_YEAR = 365.25
DEFAULT_START = dt.date(2026, 1, 1)

# Cumulative event counters recorded as series: name -> event type.
EVENT_SERIES: dict[str, type[OutputEvent]] = {
    "volcanoes": VolcanoErupted,
    "earthquakes": EarthquakeStruck,
    "craters": CraterFormed,
    "splits": LandmassSplit,
    "rejoins": LandmassesRejoined,
    "fires": FireEnded,
    "extinctions": PopulationExtinct,
    "arrivals": CreaturesArrived,
}
# Arrays that are not sampled series (their length differs from the time axis) carry
# this prefix; reports read them by name.
EXTRA_PREFIX = "_"
# Columns of the youth table (``_youth``): one row per creature born on the island whose
# youth ended, from its JuvenileGrown event. ``competent_h`` is -1 if it never was.
YOUTH_COLUMNS = ("day", "generation", "age_h", "eaten", "burnt", "competent_h", "died")
# Columns of the fork table (``_fork``): one row per youth of a forked world; ``learning``
# is 1 for the arm with lifetime learning on.
FORK_COLUMNS = ("fork_day", "learning", *YOUTH_COLUMNS[1:])
# Columns of the phylogeny table (``_phylogeny``): one row per species that ever lived,
# at the end of the run, in id order (M6). ``parent`` is 0 for an arrival;
# ``extinct_day`` is -1 if it is still alive; the genes are its founding mean genome.
# Names are in ``_species_names``, row for row; ``_species_daily`` is the number of
# species alive after each day's census.
PHYLOGENY_COLUMNS = (
    "id", "parent", "lineage", "born_day", "extinct_day", "peak", "diet", "size", "hue",
)  # fmt: skip
# Columns of the daily rare-gene table (``_rare_daily``, M7): one row per day. Totals
# first (creatures, herbivores, predators, torpid creatures, vegetated cells), then per
# creature rare gene its carriers, carriers among herbivores and among predators, then
# per plant rare gene the vegetated cells carrying it.
RARE_DAILY_COLUMNS = (
    "creatures", "herbivores", "predators", "torpid", "vegetated",
    *(f"{(g.name or '').lower()}{suffix}" for g in CREATURE_GENES
      for suffix in ("", "_herbivores", "_predators")),
    *(f"plant_{(g.name or '').lower()}" for g in PLANT_GENES),
)  # fmt: skip
# Columns of the lives table (``_lives``, M7): one row per creature whose death was seen,
# from the daily census: the days it was first and last seen alive, its rare genes, and
# whether it arrived from elsewhere (its true age is then unknown).
LIVES_COLUMNS = ("first_day", "last_day", "slots", "arrived")
DAY_MS = DAY_S * 1000
_LOW_GAIN = brain.FOLLOWED.index(Sense.LOW_X)
_WOODY_GAIN = brain.FOLLOWED.index(Sense.WOODY_X)


def override_config(text: str, assignment: str) -> str:
    """Config text with one key replaced: ``assignment`` is ``section.key=value`` and the
    value is TOML (``false``, ``0.5``). The key must already exist in its section."""
    target, sep, value = assignment.partition("=")
    section, dot, key = target.strip().partition(".")
    if not (sep and dot and section and key and value.strip()):
        raise ValueError(f"expected section.key=value, got {assignment!r}")
    out: list[str] = []
    current, replaced = "", False
    for line in text.splitlines(keepends=True):
        header = re.match(r"\s*\[([^\]]+)\]", line)
        if header:
            current = header.group(1).strip()
        elif current == section and re.match(rf"\s*{re.escape(key)}\s*=", line):
            line = f"{key} = {value.strip()}\n"
            replaced = True
        out.append(line)
    if not replaced:
        raise ValueError(f"no key {key!r} in section [{section}]")
    changed = "".join(out)
    parse_config(changed)  # fail early on a bad value
    return changed


# Diet fit (M5): half-width, in cells, of the neighbourhood whose plants a grazer is
# compared with; and how many cells of each form it must hold to count.
FIT_RADIUS = 8
FIT_MIN_CELLS = 5


def _box_sum(grid: np.ndarray, radius: int) -> np.ndarray:
    """Sum of ``grid`` over the (2 radius + 1)² box around every cell (clipped at edges)."""
    padded = np.pad(grid.astype(np.float64), ((1, 0), (1, 0))).cumsum(0).cumsum(1)
    h, w = grid.shape
    y0 = np.clip(np.arange(h) - radius, 0, h)
    y1 = np.clip(np.arange(h) + radius + 1, 0, h)
    x0 = np.clip(np.arange(w) - radius, 0, w)
    x1 = np.clip(np.arange(w) + radius + 1, 0, w)
    return padded[y1][:, x1] - padded[y0][:, x1] - padded[y1][:, x0] + padded[y0][:, x0]


def diet_fit(world: World) -> float:
    """Correlation, over plant eaters living among both plant forms, between what each has
    learned (gain on low growth minus gain on woody growth) and how much more defended the
    woody plants are than the low ones around it. Positive: they learned their place."""
    fauna, flora = world.fauna, world.flora
    grazer = fauna.genes[:, Gene.DIET] <= fauna.config.herbivore_max_diet
    if np.count_nonzero(grazer) < 10:
        return np.nan
    food = flora.grazeable() > 0.05
    forms = flora.forms()
    defence = flora.genes()[PlantGene.DEFENCE]
    low = food & np.isin(forms, LOW_FORMS)
    woody = food & np.isin(forms, WOODY_FORMS)
    n_low, n_woody = _box_sum(low, FIT_RADIUS), _box_sum(woody, FIT_RADIUS)
    d_low = _box_sum(defence * low, FIT_RADIUS) / np.maximum(n_low, 1)
    d_woody = _box_sum(defence * woody, FIT_RADIUS) / np.maximum(n_woody, 1)
    ys = np.clip(np.rint(fauna.positions[:, 1]), 0, defence.shape[0] - 1).astype(np.intp)
    xs = np.clip(np.rint(fauna.positions[:, 0]), 0, defence.shape[1] - 1).astype(np.intp)
    mixed = grazer & (n_low[ys, xs] >= FIT_MIN_CELLS) & (n_woody[ys, xs] >= FIT_MIN_CELLS)
    if np.count_nonzero(mixed) < 10:
        return np.nan
    difference = (d_woody - d_low)[ys, xs][mixed]
    learned = fauna.learned[mixed]
    preference = learned[:, _LOW_GAIN] - learned[:, _WOODY_GAIN]
    if difference.std() == 0 or preference.std() == 0:
        return np.nan
    return float(np.corrcoef(difference, preference)[0, 1])


def form_bias(world: World) -> tuple[float, float]:
    """Mean plant-form bias of the plant eaters, (inherited, learned): how much more they
    follow low growth than woody growth, from the inherited direct weights and from what
    they have learned. Shows whether what is learned becomes innate (genetic
    assimilation) or makes the genes unnecessary (shielding)."""
    fauna = world.fauna
    grazer = fauna.genes[:, Gene.DIET] <= fauna.config.herbivore_max_diet
    if not grazer.any():
        return np.nan, np.nan
    weights = fauna.weights[grazer]

    def innate(sense_x: int) -> np.ndarray:
        # Mean of the two direct weights a gain on this sense adds to (x from x, y from y).
        return (weights[:, sense_x] + weights[:, brain.SENSE_COUNT + sense_x + 1]) / 2.0

    inherited = innate(int(Sense.LOW_X)) - innate(int(Sense.WOODY_X))
    learned = fauna.learned[grazer, _LOW_GAIN] - fauna.learned[grazer, _WOODY_GAIN]
    return float(inherited.mean()), float(learned.mean())


def youth_row(event: JuvenileGrown) -> list[float]:
    return [event.t_ms / DAY_MS, event.generation, event.age_h, event.eaten, event.burnt,
            event.competent_h, float(event.died)]  # fmt: skip


@dataclass(frozen=True)
class SeedJob:
    seed: int
    days: int
    config_text: str
    start: dt.date
    out_dir: Path
    save_days: int
    sample_days: int
    snapshot_days: int
    power_cut_day: int | None
    fork_days: int = 0
    fork_length: int = 28


def epoch_unix_ms(start: dt.date) -> int:
    return round(dt.datetime(start.year, start.month, start.day, tzinfo=dt.UTC).timestamp() * 1000)


def _quantile(values: np.ndarray, q: float) -> float:
    return float(np.quantile(values, q)) if values.size else np.nan


class Probes:
    """Records one sample of every series each time `sample` is called."""

    def __init__(self) -> None:
        self.rows: dict[str, list[float]] = {}
        self.counts = dict.fromkeys(EVENT_SERIES, 0)
        self._land_history: list[np.ndarray] = []
        self._step_s = 0.0
        self._steps = 0
        self.fire_sizes: list[int] = []
        self.burnt_cells = 0
        self.youths: list[list[float]] = []
        self.species_daily: list[int] = []
        self.rare_daily: list[list[float]] = []
        # Living creatures by id: (first day seen, rare genes, arrived from elsewhere).
        self._alive: dict[int, tuple[int, int, bool]] = {}
        self.lives: list[list[float]] = []
        self.counts |= {"species_splits": 0, "species_arrivals": 0, "species_extinctions": 0}

    def observe(self, outputs: list[OutputEvent], step_s: float) -> None:
        for name, kind in EVENT_SERIES.items():
            self.counts[name] += sum(isinstance(o, kind) for o in outputs)
        for output in outputs:
            if isinstance(output, SpeciesBorn):
                self.counts["species_splits" if output.parent else "species_arrivals"] += 1
            elif isinstance(output, SpeciesExtinct):
                self.counts["species_extinctions"] += 1
            elif isinstance(output, FireEnded):
                self.fire_sizes.append(output.cells)
                self.burnt_cells += output.cells
            elif isinstance(output, JuvenileGrown) and output.generation > 0:
                self.youths.append(youth_row(output))
        self._step_s += step_s
        self._steps += 1

    def census(self, world: World, day: int) -> None:
        """Once a day: rare-gene carriers (`RARE_DAILY_COLUMNS`) and who died (`_lives`)."""
        fauna, flora = world.fauna, world.flora
        cfg = fauna.config
        diet = fauna.genes[:, Gene.DIET]
        herbivore, predator = diet <= cfg.herbivore_max_diet, diet >= cfg.predator_min_diet
        vegetated = flora.biomass > 0
        row = [
            float(fauna.count), float(herbivore.sum()), float(predator.sum()),
            float(fauna.torpid.sum()), float(vegetated.sum()),
        ]  # fmt: skip
        for gene in CREATURE_GENES:
            has = carries(fauna.slots, gene)
            row += [float(has.sum()), float((has & herbivore).sum()), float((has & predator).sum())]
        for plant_gene in PLANT_GENES:
            row.append(float(np.count_nonzero(vegetated & ((flora.rare & plant_gene) != 0))))
        self.rare_daily.append(row)

        ids = fauna.ids.tolist()
        now = set(ids)
        for gone in sorted(set(self._alive) - now):
            first, slots, arrived = self._alive.pop(gone)
            self.lives.append([first, day - 1, slots, float(arrived)])
        for i, creature_id in enumerate(ids):
            if creature_id not in self._alive:
                arrived = bool(fauna.generation[i] == 0)
                self._alive[creature_id] = (day, int(fauna.slots[i]), arrived)

    def sample(self, world: World, day: int, save_kib: float, samples_per_year: int) -> None:
        terrain = world.terrain
        land = terrain.land
        row: dict[str, float] = {
            TIME_KEY: day / DAYS_PER_YEAR,
            "save_kib": save_kib,
            "land_fraction": terrain.land_fraction,
            "sea_level": terrain.sea_level,
            "landmass_count": float(terrain.landmass_count),
            "mean_height": float(terrain.height.mean()),
            "mean_fertility": float(terrain.fertility[land].mean()) if land.any() else np.nan,
            "fertility_p10": _quantile(terrain.fertility[land], 0.1),
            "fertility_p90": _quantile(terrain.fertility[land], 0.9),
            "step_ms": 1000 * self._step_s / max(1, self._steps),
        }
        # Share of cells whose land/sea state differs from one year earlier.
        if len(self._land_history) >= samples_per_year:
            row["shore_change"] = float(np.mean(land != self._land_history[-samples_per_year]))
        else:
            row["shore_change"] = np.nan
        self._land_history.append(land)
        flora = world.flora
        shares = flora.cover_shares()
        row |= {f"cover_{cover.name.lower()}": share for cover, share in shares.items()}
        row["closed_forest"] = flora.closed_forest_share()
        row["plant_species"] = float(flora.species_count())
        row["burnt_cells"] = float(self.burnt_cells)
        alive = flora.biomass > 0
        for gene in Rare:
            name = (gene.name or "").lower()
            row[f"rare_{name}"] = float(np.count_nonzero(alive & ((flora.rare & gene) != 0)))
        row |= self._fauna_row(world)
        row["species_alive"] = float(world.species.alive_count)
        row["species_ever"] = float(world.species.count)
        row |= {name: float(count) for name, count in self.counts.items()}
        for name, value in row.items():
            self.rows.setdefault(name, []).append(value)
        self._step_s, self._steps = 0.0, 0

    @staticmethod
    def _fauna_row(world: World) -> dict[str, float]:
        fauna, flora = world.fauna, world.flora
        n = fauna.count
        herbivores, omnivores, predators = fauna.diet_counts()
        tally = fauna.tally
        row: dict[str, float] = {
            "population": float(n),
            "herbivores": float(herbivores),
            "omnivores": float(omnivores),
            "predators": float(predators),
            "births": float(tally.births),
            "clones": float(tally.clones),
            "deaths": float(tally.deaths),
            "deaths_starved": float(tally.starved),
            "deaths_old_age": float(tally.old_age),
            "deaths_killed": float(tally.killed),
            "deaths_drowned": float(tally.drowned),
            "genetic_distance": float(fauna.distance_from_ancestors().mean()) if n else np.nan,
            "energy_share": float((fauna.energy / fauna.body.capacity).mean()) if n else np.nan,
            "generation": float(fauna.generation.mean()) if n else np.nan,
            "diet_fit": diet_fit(world) if n else np.nan,
        }
        row["form_bias_inherited"], row["form_bias_learned"] = (
            form_bias(world) if n else (np.nan, np.nan)
        )
        for k, sense in enumerate(brain.FOLLOWED):
            name = (sense.name or "").removesuffix("_X").lower()
            row[f"learned_{name}"] = float(fauna.learned[:, k].mean()) if n else np.nan
        for gene in Gene:
            mean = float(fauna.genes[:, gene].mean()) if n else np.nan
            row[f"gene_{gene.name.lower()}"] = mean
        # Habitat: share of creatures standing on each land-cover class.
        if n:
            xs = np.clip(np.rint(fauna.positions[:, 0]), 0, flora.biomass.shape[1] - 1)
            ys = np.clip(np.rint(fauna.positions[:, 1]), 0, flora.biomass.shape[0] - 1)
            under = flora.cover()[ys.astype(np.intp), xs.astype(np.intp)]
            counts = np.bincount(under, minlength=len(Cover))
        else:
            counts = np.zeros(len(Cover))
        for cover in Cover:
            row[f"habitat_{cover.name.lower()}"] = float(counts[cover]) / n if n else np.nan
        return row

    def series(self) -> dict[str, np.ndarray]:
        series = {name: np.array(values) for name, values in self.rows.items()}
        series[EXTRA_PREFIX + "fire_sizes"] = np.array(self.fire_sizes, dtype=np.int64)
        series[EXTRA_PREFIX + "youth"] = np.array(self.youths, dtype=np.float64).reshape(
            -1, len(YOUTH_COLUMNS)
        )
        series[EXTRA_PREFIX + "rare_daily"] = np.array(self.rare_daily, dtype=np.float32).reshape(
            -1, len(RARE_DAILY_COLUMNS)
        )
        series[EXTRA_PREFIX + "lives"] = np.array(self.lives, dtype=np.float64).reshape(
            -1, len(LIVES_COLUMNS)
        )
        return series

    def final_genes(self, world: World) -> np.ndarray:
        return world.fauna.genes.copy()

    def phylogeny(self, world: World) -> dict[str, np.ndarray]:
        """The species tables at the end of the run (`PHYLOGENY_COLUMNS`)."""
        records = world.species.records()
        table = np.array(
            [
                [
                    r.id, r.parent, r.lineage, r.born_t_ms / DAY_MS,
                    r.extinct_t_ms / DAY_MS if r.extinct_t_ms >= 0 else -1.0, r.peak,
                    r.founding[Gene.DIET], r.founding[Gene.SIZE], r.founding[Gene.HUE],
                ]
                for r in records
            ],
            dtype=np.float64,
        ).reshape(-1, len(PHYLOGENY_COLUMNS))  # fmt: skip
        return {
            EXTRA_PREFIX + "phylogeny": table,
            EXTRA_PREFIX + "species_names": np.array([r.name for r in records], dtype=np.str_),
            EXTRA_PREFIX + "species_daily": np.array(self.species_daily, dtype=np.int16),
        }


def fork(config_text: str, world: World, days: int) -> list[list[float]]:
    """Run copies of ``world`` on for ``days`` with lifetime learning on and off. Returns
    a `FORK_COLUMNS` row for every youth of a creature born in the first half of that
    time (so that each had time to grow up)."""
    snapshot = world.snapshot()
    start_day = world.t_ms / DAY_MS
    rows: list[list[float]] = []
    for learning in (True, False):
        text = override_config(config_text, f"fauna.learning={'true' if learning else 'false'}")
        arm = World.restore(parse_config(text), snapshot)
        for _ in range(days):
            for output in arm.step(DAY_S):
                if not isinstance(output, JuvenileGrown) or output.generation == 0:
                    continue
                born = output.t_ms / DAY_MS - output.age_h / 24.0
                if start_day <= born < start_day + days / 2:
                    rows.append([round(start_day), float(learning), *youth_row(output)[1:]])
    return rows


def simulate_seed(job: SeedJob) -> tuple[dict[str, np.ndarray], str]:
    """Fast-forward one seed; return its series and final state hash."""
    config: Config = parse_config(job.config_text)
    save_path = job.out_dir / "saves" / f"{job.seed}.lzma"
    world, _ = World.create(config, job.seed, epoch_unix_ms(job.start))
    probes = Probes()
    samples_per_year = max(1, round(DAYS_PER_YEAR / job.sample_days))
    snapshots: list[np.ndarray] = []
    snapshot_cover: list[np.ndarray] = []
    snapshot_biomass: list[np.ndarray] = []
    snapshot_creatures: list[np.ndarray] = []
    cap = config.fauna.population_cap + config.fauna.predator_cap
    snapshot_sea: list[float] = []
    snapshot_days: list[int] = []
    forks: list[list[float]] = []
    can_fork = job.fork_days > 0 and config.fauna.learning

    def save() -> float:
        data = io.dumps(world.snapshot())
        atomic_write_bytes(save_path, data)
        return len(data) / 1024

    def record(day: int, save_kib: float) -> None:
        if day % job.sample_days == 0 or day == job.days:
            probes.sample(world, day, save_kib, samples_per_year)
        if job.snapshot_days and (day % job.snapshot_days == 0 or day == job.days):
            snapshots.append(np.round(world.terrain.height * 255).astype(np.uint8))
            snapshot_cover.append(world.flora.cover())
            snapshot_biomass.append(np.round(world.flora.biomass * 255).astype(np.uint8))
            # x, y, diet gene, size gene per creature; NaN rows pad up to the cap.
            who = np.full((cap, 4), np.nan, dtype=np.float32)
            fauna = world.fauna
            who[: fauna.count, :2] = fauna.positions
            who[: fauna.count, 2] = fauna.genes[:, Gene.DIET]
            who[: fauna.count, 3] = fauna.genes[:, Gene.SIZE]
            snapshot_creatures.append(who)
            snapshot_sea.append(world.terrain.sea_level)
            snapshot_days.append(day)

    save_kib = save()
    record(0, save_kib)
    day = 0
    while day < job.days:
        started = time.perf_counter()
        outputs = world.step(DAY_S)
        probes.observe(outputs, time.perf_counter() - started)
        probes.species_daily.append(world.species.alive_count)
        probes.census(world, day)
        day += 1
        if day % job.save_days == 0 or day == job.days:
            save_kib = save()
        record(day, save_kib)
        if (
            can_fork
            and day % job.fork_days == 0
            and day + job.fork_length <= job.days
            and world.fauna.count > 0
        ):
            forks += fork(job.config_text, world, job.fork_length)
        if day == job.power_cut_day:
            world.step(DAY_S / 2)  # lost: the power fails before the next save
            world = World.restore(config, io.loads(save_path.read_bytes()))
            # Replay the days since the last save; their samples were already recorded.
            for _ in range(day - round(world.t_ms / 1000 / DAY_S)):
                world.step(DAY_S)

    if snapshots:
        path = job.out_dir / "snapshots" / f"{job.seed}.npz"
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(
            path,
            height_u8=np.stack(snapshots),
            cover_u8=np.stack(snapshot_cover),
            biomass_u8=np.stack(snapshot_biomass),
            creatures=np.stack(snapshot_creatures),
            sea_level=np.array(snapshot_sea),
            day=np.array(snapshot_days),
        )
    series = probes.series()
    series[EXTRA_PREFIX + "final_genes"] = probes.final_genes(world)
    series |= probes.phylogeny(world)
    series[EXTRA_PREFIX + "fork"] = np.array(forks, dtype=np.float64).reshape(-1, len(FORK_COLUMNS))
    return series, world.state_hash()


def fastforward(
    years: float,
    seeds: list[int],
    out_dir: Path,
    config_path: Path = DEFAULT_CONFIG,
    start: dt.date = DEFAULT_START,
    power_cut_day: int | None = None,
    *,
    save_days: int = 1,
    sample_days: int = 7,
    snapshot_days: int = 30,
    jobs: int = 1,
    overrides: tuple[str, ...] = (),
    fork_days: int = 0,
    fork_length: int = 28,
) -> Run:
    if years <= 0:
        raise ValueError(f"years must be positive, got {years}")
    if not seeds:
        raise ValueError("at least one seed is required")
    if min(save_days, sample_days) < 1 or snapshot_days < 0:
        raise ValueError("save and sample intervals must be at least one day")
    days = max(1, round(years * DAYS_PER_YEAR))
    if power_cut_day is not None and not 0 < power_cut_day < days:
        raise ValueError(f"power cut day must be within 1..{days - 1}")
    if fork_days < 0 or fork_length < 2:
        raise ValueError("fork days must not be negative, and a fork must last two days")
    config_text = config_path.read_text(encoding="utf-8")
    for assignment in overrides:
        config_text = override_config(config_text, assignment)
    parse_config(config_text)  # fail early on a bad config
    started = time.perf_counter()
    todo = [
        SeedJob(
            seed, days, config_text, start, out_dir, save_days, sample_days, snapshot_days,
            power_cut_day, fork_days, fork_length,
        )
        for seed in seeds
    ]  # fmt: skip
    if jobs > 1:
        with ProcessPoolExecutor(max_workers=jobs) as pool:
            results = list(pool.map(simulate_seed, todo))
    else:
        results = [simulate_seed(job) for job in todo]
    series = {seed: result[0] for seed, result in zip(seeds, results, strict=True)}
    hashes = {str(seed): result[1] for seed, result in zip(seeds, results, strict=True)}
    manifest = Manifest(
        run_id=out_dir.name,
        seeds=seeds,
        sim_years=years,
        config_hash=config_hash(config_text),
        git_commit=git_commit(),
        wall_time_s=round(time.perf_counter() - started, 3),
        created_utc=dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        notes=f"start {start.isoformat()}; {jobs} job(s)"
        + (f"; power cut after day {power_cut_day}" if power_cut_day else "")
        + "".join(f"; {assignment}" for assignment in overrides)
        + (f"; forks every {fork_days} days for {fork_length}" if fork_days else ""),
        final_state_hashes=hashes,
    )
    run = Run(manifest, config_text, series)
    write_run(run, out_dir)
    return run


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Fast-forward the sim headless for several seeds.")
    parser.add_argument("--years", type=float, required=True, help="sim-years per seed")
    parser.add_argument("--seeds", type=int, required=True, help="number of seeds")
    parser.add_argument("--seed-base", type=int, default=0, help="first seed (default 0)")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument(
        "--start",
        type=dt.date.fromisoformat,
        default=DEFAULT_START,
        help="UTC date the worlds are created (default 2026-01-01)",
    )
    parser.add_argument("--save-days", type=int, default=1, help="days between saves")
    parser.add_argument("--sample-days", type=int, default=7, help="days between samples")
    parser.add_argument(
        "--snapshot-days", type=int, default=30, help="days between map snapshots (0: none)"
    )
    parser.add_argument(
        "--jobs", type=int, default=os.cpu_count() or 1, help="worker processes (default: all)"
    )
    parser.add_argument(
        "--power-cut-day", type=int, help="simulate a power cut half a day after this day"
    )
    parser.add_argument(
        "--set",
        dest="overrides",
        action="append",
        default=[],
        metavar="SECTION.KEY=VALUE",
        help="change one config key (TOML value), e.g. fauna.learning=false; repeatable",
    )
    parser.add_argument(
        "--fork-days", type=int, default=0, help="fork learning on/off every N days (0: never)"
    )
    parser.add_argument("--fork-length", type=int, default=28, help="days each fork runs")
    parser.add_argument("--out", type=Path, required=True, help="output dir, e.g. runs/<id>")
    args = parser.parse_args(argv)
    seeds = list(range(args.seed_base, args.seed_base + args.seeds))
    run = fastforward(
        args.years, seeds, args.out, args.config, args.start, args.power_cut_day,
        save_days=args.save_days, sample_days=args.sample_days,
        snapshot_days=args.snapshot_days, jobs=min(args.jobs, len(seeds)),
        overrides=tuple(args.overrides), fork_days=args.fork_days, fork_length=args.fork_length,
    )  # fmt: skip
    print(
        f"wrote {args.out} ({len(seeds)} seeds × {args.years} sim-years, "
        f"{run.manifest.wall_time_s} s)"
    )


if __name__ == "__main__":
    main()
