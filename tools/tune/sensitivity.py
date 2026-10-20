"""Which levers move which metrics: rank correlations over a sweep's points (M11).

Usage::

    uv run python -m tools.tune.sensitivity runs/sweep-<name>

Reads ``points.json`` and prints, for every judged criterion's metric and every M11
engagement measure, the Spearman rank correlation with each lever across the points.
A Latin-hypercube sweep samples the levers independently, so a lever's correlation is
its own effect plus noise; with n points, |rho| below about 2/√n is indistinguishable
from none. The M11 report draws the same table as a heat map.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path
from typing import Any

import numpy as np


def ranks(values: np.ndarray) -> np.ndarray:
    """Ranks 0..n-1, ties sharing their mean rank."""
    order = np.argsort(values, kind="stable")
    out = np.empty(values.size)
    out[order] = np.arange(values.size, dtype=float)
    for value in np.unique(values):
        tied = values == value
        out[tied] = out[tied].mean()
    return out


def spearman(x: np.ndarray, y: np.ndarray) -> float:
    keep = np.isfinite(x) & np.isfinite(y)
    if np.count_nonzero(keep) < 3:
        return math.nan
    rx, ry = ranks(x[keep]), ranks(y[keep])
    if rx.std() == 0 or ry.std() == 0:
        return math.nan
    return float(np.corrcoef(rx, ry)[0, 1])


def metric_names(points: list[dict[str, Any]]) -> list[str]:
    """Judged metrics in criterion order, then the M11 engagement measures."""
    names = [j["metric"] for j in points[0]["judged"]]
    engagement = sorted({k for p in points for k in p["metrics"] if k.startswith("M11:")})
    return list(dict.fromkeys([*names, *engagement]))


def table(document: dict[str, Any]) -> tuple[list[str], list[str], np.ndarray]:
    """(lever keys, metric names, rho[metric, lever]) over the sampled points (p000, the
    defaults, included when it lies inside the levers' ranges)."""
    points = document["points"]
    levers = [lever["key"] for lever in document["levers"]]
    names = metric_names(points)
    rho = np.full((len(names), len(levers)), math.nan)
    for j, key in enumerate(levers):
        used = [p for p in points if key in p["levers"]]
        x = np.array([float(p["levers"][key]) for p in used])
        for i, name in enumerate(names):
            y = np.array([p["metrics"].get(name, math.nan) for p in used], dtype=float)
            rho[i, j] = spearman(x, y)
    return levers, names, rho


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Lever-to-metric rank correlations.")
    parser.add_argument("sweep_dir", type=Path, help="runs/sweep-<name>")
    args = parser.parse_args(argv)
    document = json.loads((args.sweep_dir / "points.json").read_text(encoding="utf-8"))
    levers, names, rho = table(document)
    n = sum(1 for p in document["points"] if p["levers"])
    print(f"{n} sampled points; |rho| < {2 / math.sqrt(max(n, 1)):.2f} is noise\n")
    width = max(len(name) for name in names)
    short = [key.split(".", 1)[1][:14] for key in levers]
    print(" " * width + "  " + " ".join(f"{s:>14}" for s in short))
    for i, name in enumerate(names):
        cells = " ".join("           nan" if math.isnan(v) else f"{v:>+14.2f}" for v in rho[i])
        print(f"{name:<{width}}  {cells}")


if __name__ == "__main__":
    main()
