"""On-disk format of a fast-forward run (``runs/<id>/``), shared by fastforward and report.

Layout::

    runs/<id>/
    ├── manifest.json        # what was run: seeds, sim-years, config hash, commit, wall time
    ├── config.toml          # exact config text used
    ├── seeds/<seed>.npz     # per-seed time series; key "t_years" is the shared time axis
    └── saves/<seed>.lzma    # latest world save per seed
"""

from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

RUN_FORMAT_VERSION = 1
TIME_KEY = "t_years"
REPO_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = REPO_ROOT / "sim" / "config" / "default.toml"


@dataclass(frozen=True)
class Manifest:
    run_id: str
    seeds: list[int]
    sim_years: float
    config_hash: str
    git_commit: str
    wall_time_s: float
    created_utc: str
    format_version: int = RUN_FORMAT_VERSION
    notes: str = ""
    # seed (as a string, JSON keys) -> SHA-256 of the final world state
    final_state_hashes: dict[str, str] = field(default_factory=dict[str, str])


@dataclass
class Run:
    manifest: Manifest
    config_text: str
    # seed -> {series name -> 1-D array}; every array aligns with series[TIME_KEY].
    series: dict[int, dict[str, np.ndarray]] = field(default_factory=dict)


def config_hash(config_text: str) -> str:
    """Stable identifier of a config: SHA-256 of its UTF-8 text, first 16 hex digits."""
    return hashlib.sha256(config_text.encode("utf-8")).hexdigest()[:16]


def git_commit(repo: Path = REPO_ROOT) -> str:
    """Current commit, suffixed ``-dirty`` with uncommitted changes outside ``reports/``;
    ``unknown`` outside git."""
    try:
        sha = subprocess.run(
            ["git", "rev-parse", "--short=12", "HEAD"],
            cwd=repo,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        dirty = subprocess.run(
            # Generated reports do not make the code dirty.
            ["git", "status", "--porcelain", "--", ".", ":(exclude)reports"],
            cwd=repo,
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"
    return f"{sha}-dirty" if dirty else sha


def atomic_write_bytes(path: Path, data: bytes) -> None:
    """Replace ``path`` with ``data`` so readers see the old or the new file, never half.

    No fsync: fast-forward runs are disposable. The device server (S1) adds fsync.
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_bytes(data)
    tmp.replace(path)


def write_run(run: Run, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "manifest.json").write_text(
        json.dumps(asdict(run.manifest), indent=2) + "\n", encoding="utf-8"
    )
    (out_dir / "config.toml").write_text(run.config_text, encoding="utf-8")
    seeds_dir = out_dir / "seeds"
    seeds_dir.mkdir(exist_ok=True)
    for seed, series in run.series.items():
        arrays: dict[str, Any] = dict(series)
        np.savez_compressed(seeds_dir / f"{seed}.npz", **arrays)


def read_run(run_dir: Path) -> Run:
    raw = json.loads((run_dir / "manifest.json").read_text(encoding="utf-8"))
    if raw.get("format_version") != RUN_FORMAT_VERSION:
        raise ValueError(f"{run_dir}: unsupported run format {raw.get('format_version')!r}")
    manifest = Manifest(**raw)
    series: dict[int, dict[str, np.ndarray]] = {}
    for seed in manifest.seeds:
        path = run_dir / "seeds" / f"{seed}.npz"
        if path.exists():
            with np.load(path) as data:
                series[seed] = {name: data[name] for name in data.files}
    return Run(manifest, (run_dir / "config.toml").read_text(encoding="utf-8"), series)
