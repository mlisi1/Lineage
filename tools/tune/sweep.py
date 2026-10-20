"""Run a sweep over config levers and score every point (M11, ADR 0019).

Usage::

    uv run python -m tools.tune.sweep tools/tune/sweeps/<name>.toml [--jobs 10]
        [--max-load 14] [--out runs]

A sweep file names the levers and how to sample them::

    [sweep]
    name = "predators"        # output goes to runs/sweep-<name>/
    seeds = 20                # seeds seed_base .. seed_base + seeds - 1
    seed_base = 0
    years = 3
    schedule = "office"
    samples = 40              # sampled points, besides the defaults (p000)
    sampler = "lhs"           # "lhs" (Latin hypercube) or "grid" (every combination)
    rng_seed = 1

    [levers]
    "fauna.meat_energy" = { low = 900, high = 2400, integer = true }
    "fauna.defence_toxicity" = { low = 0.25, high = 1.0 }
    "fauna.predator_cap" = { values = [12, 16, 24] }
    "fauna.scavenge_rate" = { low = 0.1, high = 1.0, log = true }

    [[points]]                # optional hand-picked points, run after p000
    set = ["fauna.meat_energy=1200"]

Point ``p000`` is always the defaults. Each point is a fast-forward run in
``runs/sweep-<name>/pNNN/``. A point whose ``manifest.json`` exists is not run again, so
a stopped sweep resumes where it stopped. Scores go to ``points.json`` beside them after
every point. Before each point the sweep waits until the machine's 1-minute load is at
most ``--max-load``, because the PC is shared.
"""

from __future__ import annotations

import argparse
import itertools
import json
import os
import time
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from tools.fastforward import fastforward
from tools.runs import REPO_ROOT, atomic_write_bytes, read_run
from tools.tune.score import score

DEFAULT_OUT = REPO_ROOT / "runs"
LOAD_POLL_S = 60.0


@dataclass(frozen=True)
class Lever:
    key: str  # section.key
    low: float = 0.0
    high: float = 0.0
    log: bool = False
    integer: bool = False
    values: tuple[Any, ...] = ()

    def at(self, u: float) -> Any:
        """The lever's value at ``u`` in [0, 1)."""
        if self.values:
            return self.values[min(int(u * len(self.values)), len(self.values) - 1)]
        if self.log:
            value = float(np.exp(np.log(self.low) + u * (np.log(self.high) - np.log(self.low))))
        else:
            value = self.low + u * (self.high - self.low)
        return round(value) if self.integer else round(value, 6)

    def grid(self) -> tuple[Any, ...]:
        if self.values:
            return self.values
        raise ValueError(f"{self.key}: a grid sweep needs explicit values")


@dataclass(frozen=True)
class Sweep:
    name: str
    seeds: list[int]
    years: float
    schedule: str
    levers: tuple[Lever, ...]
    points: list[dict[str, Any]]  # lever key -> value, one per sampled or listed point


def toml_value(value: Any) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, str):
        return json.dumps(value)
    return repr(value)


def parse_lever(key: str, spec: dict[str, Any]) -> Lever:
    if "values" in spec:
        return Lever(key, values=tuple(spec["values"]))
    lever = Lever(
        key, float(spec["low"]), float(spec["high"]), bool(spec.get("log", False)),
        bool(spec.get("integer", False)),
    )  # fmt: skip
    if not lever.low < lever.high or (lever.log and lever.low <= 0):
        raise ValueError(f"{key}: need 0 < low < high for log, low < high otherwise")
    return lever


def latin_hypercube(n: int, dims: int, rng: np.random.Generator) -> np.ndarray:
    """``n`` points in [0, 1)^dims, one in each of the ``n`` strata of every axis."""
    strata = np.stack([rng.permutation(n) for _ in range(dims)], axis=1)
    return (strata + rng.random((n, dims))) / n


def load_sweep(path: Path) -> Sweep:
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    head = raw["sweep"]
    levers = tuple(parse_lever(k, v) for k, v in raw.get("levers", {}).items())
    points: list[dict[str, Any]] = []
    sampler = head.get("sampler", "lhs")
    if levers and sampler == "lhs":
        rng = np.random.default_rng(int(head.get("rng_seed", 0)))
        for row in latin_hypercube(int(head["samples"]), len(levers), rng):
            points.append({lv.key: lv.at(float(u)) for lv, u in zip(levers, row, strict=True)})
    elif levers and sampler == "grid":
        for combo in itertools.product(*(lever.grid() for lever in levers)):
            points.append(dict(zip((lever.key for lever in levers), combo, strict=True)))
    elif levers:
        raise ValueError(f"unknown sampler {sampler!r}")
    for extra in raw.get("points", []):
        pairs = (assignment.partition("=") for assignment in extra["set"])
        points.append({k.strip(): tomllib.loads(f"v = {v}")["v"] for k, _, v in pairs})
    base = int(head.get("seed_base", 0))
    return Sweep(
        name=str(head["name"]),
        seeds=list(range(base, base + int(head["seeds"]))),
        years=float(head["years"]),
        schedule=str(head.get("schedule", "office")),
        levers=levers,
        points=[{}, *points],
    )


def wait_for_load(max_load: float) -> None:
    while (load := os.getloadavg()[0]) > max_load:
        print(f"  load {load:.1f} > {max_load:g}; waiting", flush=True)
        time.sleep(LOAD_POLL_S)


def run_sweep(
    sweep: Sweep, out_root: Path = DEFAULT_OUT, *, jobs: int = 10, max_load: float | None = None
) -> list[dict[str, Any]]:
    root = out_root / f"sweep-{sweep.name}"
    root.mkdir(parents=True, exist_ok=True)
    results: list[dict[str, Any]] = []
    for index, point in enumerate(sweep.points):
        point_dir = root / f"p{index:03d}"
        overrides = tuple(f"{k}={toml_value(v)}" for k, v in point.items())
        if not (point_dir / "manifest.json").exists():
            if max_load is not None:
                wait_for_load(max_load)
            print(f"p{index:03d}: {', '.join(overrides) or 'defaults'}", flush=True)
            fastforward(
                sweep.years, sweep.seeds, point_dir, jobs=min(jobs, len(sweep.seeds)),
                overrides=overrides, schedule=sweep.schedule, save_days=30, snapshot_days=0,
            )  # fmt: skip
        run = read_run(point_dir)
        card = score(run)
        results.append(
            {
                "point": f"p{index:03d}",
                "levers": point,
                "commit": run.manifest.git_commit,
                "config_hash": run.manifest.config_hash,
                "wall_time_s": run.manifest.wall_time_s,
                **card.to_json(),
            }
        )
        print(f"  p{index:03d}: {card.fails} failing, shortfall {card.shortfall:.3f}", flush=True)
        document = {
            "sweep": sweep.name,
            "seeds": sweep.seeds,
            "years": sweep.years,
            "schedule": sweep.schedule,
            "levers": [lever.__dict__ for lever in sweep.levers],
            "points": results,
        }
        atomic_write_bytes(
            root / "points.json", (json.dumps(document, indent=1) + "\n").encode("utf-8")
        )
    return results


def ranked(results: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Best first: fewest failing criteria, then the smallest shortfall."""
    return sorted(results, key=lambda r: (r["fails"], r["shortfall"]))


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Sweep config levers and score each point.")
    parser.add_argument("sweep", type=Path, help="sweep file, tools/tune/sweeps/<name>.toml")
    parser.add_argument("--jobs", type=int, default=10, help="worker processes per point")
    parser.add_argument(
        "--max-load", type=float, help="wait before each point until the 1-min load is this low"
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="runs root")
    parser.add_argument("--dry-run", action="store_true", help="list the points and stop")
    args = parser.parse_args(argv)
    sweep = load_sweep(args.sweep)
    if args.dry_run:
        for index, point in enumerate(sweep.points):
            print(f"p{index:03d}: {point or 'defaults'}")
        return
    results = run_sweep(sweep, args.out, jobs=args.jobs, max_load=args.max_load)
    for r in ranked(results)[:10]:
        print(f"{r['point']}: {r['fails']} failing, shortfall {r['shortfall']:.3f}, {r['levers']}")


if __name__ == "__main__":
    main()
