"""Score one fast-forward run on every M2–M10 criterion at once (M11, ADR 0019).

A sweep point is one office-schedule run (``fastforward --schedule office``). Every
milestone module that reads a single run contributes its metrics, prefixed by its id
(``M4:extinct_seed_years.share``), and its criteria are judged on them. Two need more
than one run and are judged only in the final check, not in sweeps: M5's fork gains and
learning-off baseline (its M5.1 diet fit is scored here from the run alone) and M8's
schedule comparison (M8.1–M8.3). M10's criteria are tests.

M11 adds its own criterion (mean genetic distance from the ancestors still rising at
year 3) and the engagement measures of ``docs/m11-plan.md`` §1, which are reported,
not judged.

A point is ranked by how many criteria fail, then by ``shortfall``: the sum over failing
criteria of how far the value lies outside its band, relative to the bound.
"""

from __future__ import annotations

import math
import warnings
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import Any

import numpy as np
from lineage_sim.chronicle import Kind
from lineage_sim.fauna.genome import Gene

from tools.fastforward import RARE_DAILY_COLUMNS
from tools.milestones import m2, m3, m4, m5, m6, m7, m9
from tools.milestones.base import Criterion
from tools.runs import TIME_KEY, Run

# Criteria a sweep cannot judge from one office run: the step-time budgets measure this
# shared PC's load as much as the island, and are checked in the final runs instead.
UNSWEPT = frozenset({"M2.5", "M4.4", "M5.3"})

CRITERIA: list[Criterion] = [
    Criterion(
        "M11.1",
        "Mean genetic distance from the ancestors still rising at year 3: mean over seeds at "
        "the end minus at two thirds of the run",
        "genetic_distance.mean.rise",
        low=0.0,
    ),
]

# A world's end rate the owner accepted (2026-10-20): about once a decade, at most.
WORLD_END_RATE_MAX = 0.1  # per seed-year

# Diversity and balance (owner, 2026-10-20). Reported with proposed bands; they become
# pass/fail criteria once the M11 mechanisms are in and their bands are set (ADR 0019).
NICHE_SHARE = 0.10  # D1: a group at one end of a gene's range holds this share of creatures
NICHE_MIN_CREATURES = 20  # D1: samples with fewer creatures do not count
NICHE_GENES = tuple(g for g in Gene if g not in (Gene.HUE, Gene.PATTERN))  # looks: neutral
THRIVE_SHARE, THRIVE_DAYS = 0.05, 30  # D2: a rare gene thrives at this share for this long
PREDATOR_SHARE_BAND = (0.03, 0.20)  # D3: predators' share of creatures
PREDATOR_PRESENT = 0.8  # D3: share of inhabited days after year 1 with ≥ 3 predators
SWEEP_SHARE, SWEEP_DAYS = 0.5, 30  # photosynthesis watch: majority of creatures for a month

PROPOSED: list[Criterion] = [
    Criterion(
        "D1",
        f"Every gene has a niche: lowest, over genes (looks aside), share of seeds where "
        f"both ends of its range each held ≥ {NICHE_SHARE:.0%} of creatures at some time",
        "niche.share_of_seeds.min",
        low=0.3,
    ),
    Criterion(
        "D2",
        f"Rare genes can thrive: lowest, over creature and plant genes, share of seeds where "
        f"it held ≥ {THRIVE_SHARE:.0%} of its population for ≥ {THRIVE_DAYS} days",
        "thrive.share_of_seeds.min",
        low=0.2,
    ),
    Criterion(
        "D3a",
        "Predators' share of creatures after year 1: median of seeds' median inhabited day",
        "predators.share_of_creatures.median",
        low=PREDATOR_SHARE_BAND[0],
        high=PREDATOR_SHARE_BAND[1],
    ),
    Criterion(
        "D3b",
        "Share of inhabited days after year 1 with ≥ 3 predators (all seeds)",
        "predators.present_after_year1.share",
        low=PREDATOR_PRESENT,
    ),
]
REPORTED = frozenset(c.cid for c in PROPOSED)

_M5_CRITERIA = [c for c in m5.CRITERIA if c.cid == "M5.1"]

# milestone id -> (metrics of one run, criteria judged on them)
SOURCES: dict[str, tuple[Callable[[Run], dict[str, float]], list[Criterion]]] = {
    "M2": (m2.metrics, m2.CRITERIA),
    "M3": (m3.metrics, m3.CRITERIA),
    "M4": (m4.metrics, m4.CRITERIA),
    "M5": (m5.diet_fit_metrics, _M5_CRITERIA),
    "M6": (m6.metrics, m6.CRITERIA),
    "M7": (m7.metrics, m7.CRITERIA),
    "M9": (m9.metrics, m9.CRITERIA),
}


@dataclass(frozen=True)
class Judged:
    cid: str
    metric: str
    value: float | None
    band: str
    status: str  # PASS, FAIL or MISSING
    shortfall: float  # 0 when passing; distance outside the band relative to the bound


@dataclass
class Scorecard:
    metrics: dict[str, float] = field(default_factory=dict[str, float])
    judged: list[Judged] = field(default_factory=list[Judged])

    @property
    def fails(self) -> int:
        return sum(j.status != "PASS" for j in self.judged if j.cid not in UNSWEPT | REPORTED)

    @property
    def shortfall(self) -> float:
        return float(sum(j.shortfall for j in self.judged if j.cid not in UNSWEPT | REPORTED))

    def to_json(self) -> dict[str, Any]:
        return {
            "fails": self.fails,
            "shortfall": self.shortfall,
            "judged": [j.__dict__ for j in self.judged],
            "metrics": {k: v for k, v in self.metrics.items() if math.isfinite(v)},
        }


def shortfall(c: Criterion, value: float | None) -> float:
    """How far ``value`` lies outside ``c``'s band, relative to the bound it misses (or
    absolute, for a bound of zero); a missing value counts as one whole bound."""
    if value is None:
        return 1.0
    if value < c.low:
        return (c.low - value) / (abs(c.low) or 1.0)
    if value > c.high:
        return (value - c.high) / (abs(c.high) or 1.0)
    return 0.0


def judge(c: Criterion, metrics: dict[str, float], prefix: str = "") -> Judged:
    value, status = c.evaluate({k.removeprefix(prefix): v for k, v in metrics.items()})
    return Judged(c.cid, prefix + c.metric, value, c.band(), status, shortfall(c, value))


def _stack(run: Run, name: str) -> np.ndarray:
    return np.stack([run.series[seed][name] for seed in run.manifest.seeds])


def m11_metrics(run: Run) -> dict[str, float]:
    """M11's criterion and the engagement measures (m11-plan §1)."""
    times = run.series[run.manifest.seeds[0]][TIME_KEY]
    earlier = int(np.argmin(np.abs(times - run.manifest.sim_years * 2.0 / 3.0)))
    distance = np.nan_to_num(_stack(run, "genetic_distance"), nan=0.0)
    seed_years = len(run.manifest.seeds) * run.manifest.sim_years
    population = _stack(run, "population")
    inhabited = population > 0
    out = {
        "genetic_distance.mean.end": float(distance[:, -1].mean()),
        "genetic_distance.mean.rise": float(distance[:, -1].mean() - distance[:, earlier].mean()),
        "inhabited.share_of_time": float(inhabited.mean()),
    }
    for diet in ("herbivores", "omnivores", "predators"):
        present = _stack(run, diet) >= m4.PRESENT
        out[f"{diet}.present.share_of_inhabited_time"] = float(
            present[inhabited].mean() if inhabited.any() else 0.0
        )
    if "worlds_ended" in run.series[run.manifest.seeds[0]]:
        ended = _stack(run, "worlds_ended")[:, -1]
        out["worlds_ended.total"] = float(ended.sum())
        out["worlds_ended.per_seed_year"] = float(ended.sum() / seed_years)
    kinds = {kind: i for i, kind in enumerate(Kind)}
    notable, _ = m9.thresholds(run)
    swings = 0
    for seed in run.manifest.seeds:
        rows = m9.table(run, seed)
        swing = np.isin(rows[:, 2], [kinds[Kind.BOOM], kinds[Kind.CRASH]])
        swings += int(np.count_nonzero(swing & (rows[:, 1] >= notable)))
    out["booms_crashes.notable.per_seed_year"] = swings / seed_years
    return out


def diversity_metrics(run: Run) -> dict[str, float]:
    """D1–D3 and the photosynthesis watch."""
    out: dict[str, float] = {}
    seeds = run.manifest.seeds
    first = run.series[seeds[0]]
    if f"gene_{Gene.SIZE.name.lower()}_high" in first:
        shares = []
        for gene in NICHE_GENES:
            name = f"gene_{gene.name.lower()}"
            both = []
            for seed in seeds:
                series = run.series[seed]
                counted = series["population"] >= NICHE_MIN_CREATURES
                high = np.nan_to_num(series[f"{name}_high"])[counted] >= NICHE_SHARE
                low = np.nan_to_num(series[f"{name}_low"])[counted] >= NICHE_SHARE
                both.append(bool(high.any() and low.any()))
            out[f"niche.{gene.name.lower()}.share_of_seeds"] = float(np.mean(both))
            shares.append(float(np.mean(both)))
        out["niche.share_of_seeds.min"] = min(shares)
    thrive = []
    sweeps = []
    for key in m7.GENE_KEYS:
        hits = []
        for seed in seeds:
            share = np.nan_to_num(m7.share(m7.daily(run, seed), key))
            hits.append(m7.longest_run(share >= THRIVE_SHARE) >= THRIVE_DAYS)
            if key == "photosynthesis":
                sweeps.append(m7.longest_run(share >= SWEEP_SHARE) >= SWEEP_DAYS)
        out[f"thrive.{key}.share_of_seeds"] = float(np.mean(hits))
        thrive.append(float(np.mean(hits)))
    out["thrive.share_of_seeds.min"] = min(thrive)
    out["photosynthesis.sweeps.share_of_seeds"] = float(np.mean(sweeps))
    column = {name: i for i, name in enumerate(RARE_DAILY_COLUMNS)}
    medians, present, days = [], 0, 0
    for seed in seeds:
        table = m7.daily(run, seed)[365:]
        creatures, predators = table[:, column["creatures"]], table[:, column["predators"]]
        inhabited = creatures > 0
        if inhabited.any():
            medians.append(float(np.median(predators[inhabited] / creatures[inhabited])))
        present += int(np.count_nonzero(predators[inhabited] >= m4.PRESENT))
        days += int(np.count_nonzero(inhabited))
    out["predators.share_of_creatures.median"] = float(np.median(medians)) if medians else 0.0
    out["predators.present_after_year1.share"] = present / days if days else 0.0
    return out


def score(run: Run) -> Scorecard:
    # A degenerate point (an island never inhabited) leaves empty slices: NaN, not noise.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return _score(run)


def _score(run: Run) -> Scorecard:
    card = Scorecard()
    for mid, (metrics, criteria) in SOURCES.items():
        prefix = f"{mid}:"
        values = metrics(run)
        card.metrics |= {prefix + k: v for k, v in values.items()}
        card.judged += [judge(c, card.metrics, prefix) for c in criteria]
    values = m11_metrics(run)
    card.metrics |= {f"M11:{k}": v for k, v in values.items()}
    card.judged += [judge(c, card.metrics, "M11:") for c in CRITERIA]
    values = diversity_metrics(run)
    card.metrics |= {f"D:{k}": v for k, v in values.items()}
    card.judged += [judge(c, card.metrics, "D:") for c in PROPOSED]
    return card
