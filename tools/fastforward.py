"""Run N sim-years headless for M seeds and write ``runs/<id>/``.

Usage::

    uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/<id>
        [--start 2026-01-01] [--config sim/config/default.toml] [--power-cut-day N]

Each seed's world is stepped one sim-day at a time, exactly as the device would advance
it, and saved after every day to ``saves/<seed>.lzma`` (atomic replace). With
``--power-cut-day N`` the in-memory world is discarded half a day after the day-N save and
the run resumes from the file on disk; the final state hash must match an uninterrupted
run. Final state hashes are recorded in the manifest.
"""

from __future__ import annotations

import argparse
import datetime as dt
import time
from pathlib import Path

import numpy as np
from lineage_sim.config import Config, parse_config
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


def epoch_unix_ms(start: dt.date) -> int:
    return round(dt.datetime(start.year, start.month, start.day, tzinfo=dt.UTC).timestamp() * 1000)


def simulate_seed(
    seed: int,
    days: int,
    config: Config,
    start: dt.date,
    save_path: Path,
    power_cut_day: int | None = None,
) -> tuple[dict[str, np.ndarray], str]:
    """Fast-forward one seed; return its daily series and final state hash."""
    world, _ = World.create(config, seed, epoch_unix_ms(start))
    save_kib = np.zeros(days + 1)
    save = io.dumps(world.snapshot())
    atomic_write_bytes(save_path, save)
    save_kib[0] = len(save) / 1024
    day = 0
    while day < days:
        world.step(DAY_S)
        day += 1
        save = io.dumps(world.snapshot())
        atomic_write_bytes(save_path, save)
        save_kib[day] = len(save) / 1024
        if day == power_cut_day:
            world.step(DAY_S / 2)  # lost: the power fails before the next save
            world = World.restore(config, io.loads(save_path.read_bytes()))
    times = np.arange(days + 1) / DAYS_PER_YEAR
    return {TIME_KEY: times, "save_kib": save_kib}, world.state_hash()


def fastforward(
    years: float,
    seeds: list[int],
    out_dir: Path,
    config_path: Path = DEFAULT_CONFIG,
    start: dt.date = DEFAULT_START,
    power_cut_day: int | None = None,
) -> Run:
    if years <= 0:
        raise ValueError(f"years must be positive, got {years}")
    if not seeds:
        raise ValueError("at least one seed is required")
    days = max(1, round(years * DAYS_PER_YEAR))
    if power_cut_day is not None and not 0 < power_cut_day < days:
        raise ValueError(f"power cut day must be within 1..{days - 1}")
    config_text = config_path.read_text(encoding="utf-8")
    config = parse_config(config_text)
    started = time.perf_counter()
    series: dict[int, dict[str, np.ndarray]] = {}
    hashes: dict[str, str] = {}
    for seed in seeds:
        save_path = out_dir / "saves" / f"{seed}.lzma"
        series[seed], hashes[str(seed)] = simulate_seed(
            seed, days, config, start, save_path, power_cut_day
        )
    manifest = Manifest(
        run_id=out_dir.name,
        seeds=seeds,
        sim_years=years,
        config_hash=config_hash(config_text),
        git_commit=git_commit(),
        wall_time_s=round(time.perf_counter() - started, 3),
        created_utc=dt.datetime.now(dt.UTC).isoformat(timespec="seconds"),
        notes=f"start {start.isoformat()}"
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
    parser.add_argument(
        "--power-cut-day", type=int, help="simulate a power cut after this day's save"
    )
    parser.add_argument("--out", type=Path, required=True, help="output dir, e.g. runs/<id>")
    args = parser.parse_args(argv)
    seeds = list(range(args.seed_base, args.seed_base + args.seeds))
    run = fastforward(args.years, seeds, args.out, args.config, args.start, args.power_cut_day)
    print(
        f"wrote {args.out} ({len(seeds)} seeds × {args.years} sim-years, "
        f"{run.manifest.wall_time_s} s)"
    )


if __name__ == "__main__":
    main()
