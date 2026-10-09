"""Run N sim-years headless for M seeds and write ``runs/<id>/``.

Usage::

    uv run python -m tools.fastforward --years 3 --seeds 20 --out runs/<id>

M0: the World does not exist yet (M1), so a run records its manifest, config and the
shared time axis only. Later milestones add their series to ``simulate_seed``.
"""

from __future__ import annotations

import argparse
import time
from datetime import UTC, datetime
from pathlib import Path

import numpy as np

from tools.runs import DEFAULT_CONFIG, TIME_KEY, Manifest, Run, config_hash, git_commit, write_run

SAMPLES_PER_YEAR = 52  # one sample per sim-week in the recorded series


def simulate_seed(seed: int, years: float, config_text: str) -> dict[str, np.ndarray]:
    """Fast-forward one seed and return its recorded series (M0: time axis only)."""
    del seed, config_text  # consumed once World exists (M1)
    samples = max(1, round(years * SAMPLES_PER_YEAR)) + 1
    return {TIME_KEY: np.linspace(0.0, years, samples)}


def fastforward(
    years: float,
    seeds: list[int],
    out_dir: Path,
    config_path: Path = DEFAULT_CONFIG,
) -> Run:
    if years <= 0:
        raise ValueError(f"years must be positive, got {years}")
    if not seeds:
        raise ValueError("at least one seed is required")
    config_text = config_path.read_text(encoding="utf-8")
    started = time.perf_counter()
    series = {seed: simulate_seed(seed, years, config_text) for seed in seeds}
    manifest = Manifest(
        run_id=out_dir.name,
        seeds=seeds,
        sim_years=years,
        config_hash=config_hash(config_text),
        git_commit=git_commit(),
        wall_time_s=round(time.perf_counter() - started, 3),
        created_utc=datetime.now(UTC).isoformat(timespec="seconds"),
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
    parser.add_argument("--out", type=Path, required=True, help="output dir, e.g. runs/<id>")
    args = parser.parse_args(argv)
    seeds = list(range(args.seed_base, args.seed_base + args.seeds))
    run = fastforward(args.years, seeds, args.out, args.config)
    print(
        f"wrote {args.out} ({len(seeds)} seeds × {args.years} sim-years, "
        f"{run.manifest.wall_time_s} s)"
    )


if __name__ == "__main__":
    main()
