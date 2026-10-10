"""Run N sim-years headless for M seeds and write ``runs/<id>/``.

Usage::

    uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/<id>
        [--start 2026-01-01] [--config sim/config/default.toml] [--jobs N]
        [--save-days 1] [--sample-days 7] [--snapshot-days 30] [--power-cut-day N]

Each seed's world is stepped one sim-day at a time, exactly as the device would advance
it. Every ``--save-days`` it is saved to ``saves/<seed>.lzma`` (atomic replace); every
``--sample-days`` the probes record one sample of each series; every ``--snapshot-days``
the height grid is stored (8-bit) in ``snapshots/<seed>.npz`` for maps and animations.

With ``--power-cut-day N`` the in-memory world is discarded half a day after day N and the
run resumes from the last save on disk; the final state hash must match an uninterrupted
run. Final state hashes are recorded in the manifest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import time
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from lineage_sim.config import Config, parse_config
from lineage_sim.events import (
    CraterFormed,
    EarthquakeStruck,
    LandmassesRejoined,
    LandmassSplit,
    OutputEvent,
    VolcanoErupted,
)
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
}


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


def epoch_unix_ms(start: dt.date) -> int:
    return round(dt.datetime(start.year, start.month, start.day, tzinfo=dt.UTC).timestamp() * 1000)


class Probes:
    """Records one sample of every series each time `sample` is called."""

    def __init__(self) -> None:
        self.rows: dict[str, list[float]] = {}
        self.counts = dict.fromkeys(EVENT_SERIES, 0)
        self._land_history: list[np.ndarray] = []
        self._step_s = 0.0
        self._steps = 0

    def observe(self, outputs: list[OutputEvent], step_s: float) -> None:
        for name, kind in EVENT_SERIES.items():
            self.counts[name] += sum(isinstance(o, kind) for o in outputs)
        self._step_s += step_s
        self._steps += 1

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
            "step_ms": 1000 * self._step_s / max(1, self._steps),
        }
        # Share of cells whose land/sea state differs from one year earlier.
        if len(self._land_history) >= samples_per_year:
            row["shore_change"] = float(np.mean(land != self._land_history[-samples_per_year]))
        else:
            row["shore_change"] = np.nan
        self._land_history.append(land)
        row |= {name: float(count) for name, count in self.counts.items()}
        for name, value in row.items():
            self.rows.setdefault(name, []).append(value)
        self._step_s, self._steps = 0.0, 0

    def series(self) -> dict[str, np.ndarray]:
        return {name: np.array(values) for name, values in self.rows.items()}


def simulate_seed(job: SeedJob) -> tuple[dict[str, np.ndarray], str]:
    """Fast-forward one seed; return its series and final state hash."""
    config: Config = parse_config(job.config_text)
    save_path = job.out_dir / "saves" / f"{job.seed}.lzma"
    world, _ = World.create(config, job.seed, epoch_unix_ms(job.start))
    probes = Probes()
    samples_per_year = max(1, round(DAYS_PER_YEAR / job.sample_days))
    snapshots: list[np.ndarray] = []
    snapshot_sea: list[float] = []
    snapshot_days: list[int] = []

    def save() -> float:
        data = io.dumps(world.snapshot())
        atomic_write_bytes(save_path, data)
        return len(data) / 1024

    def record(day: int, save_kib: float) -> None:
        if day % job.sample_days == 0 or day == job.days:
            probes.sample(world, day, save_kib, samples_per_year)
        if job.snapshot_days and (day % job.snapshot_days == 0 or day == job.days):
            snapshots.append(np.round(world.terrain.height * 255).astype(np.uint8))
            snapshot_sea.append(world.terrain.sea_level)
            snapshot_days.append(day)

    save_kib = save()
    record(0, save_kib)
    day = 0
    while day < job.days:
        started = time.perf_counter()
        outputs = world.step(DAY_S)
        probes.observe(outputs, time.perf_counter() - started)
        day += 1
        if day % job.save_days == 0 or day == job.days:
            save_kib = save()
        record(day, save_kib)
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
            sea_level=np.array(snapshot_sea),
            day=np.array(snapshot_days),
        )
    return probes.series(), world.state_hash()


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
    config_text = config_path.read_text(encoding="utf-8")
    parse_config(config_text)  # fail early on a bad config
    started = time.perf_counter()
    todo = [
        SeedJob(
            seed, days, config_text, start, out_dir, save_days, sample_days, snapshot_days,
            power_cut_day,
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
        + (f"; power cut after day {power_cut_day}" if power_cut_day else ""),
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
    parser.add_argument("--out", type=Path, required=True, help="output dir, e.g. runs/<id>")
    args = parser.parse_args(argv)
    seeds = list(range(args.seed_base, args.seed_base + args.seeds))
    run = fastforward(
        args.years, seeds, args.out, args.config, args.start, args.power_cut_day,
        save_days=args.save_days, sample_days=args.sample_days,
        snapshot_days=args.snapshot_days, jobs=min(args.jobs, len(seeds)),
    )  # fmt: skip
    print(
        f"wrote {args.out} ({len(seeds)} seeds × {args.years} sim-years, "
        f"{run.manifest.wall_time_s} s)"
    )


if __name__ == "__main__":
    main()
