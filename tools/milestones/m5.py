"""M5 — Fauna II: lifetime learning. Metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8): learning ON improves early-life feeding success by ≥ 15 %;
time to competence trends down over generations in ≥ 60 % of seeds; step cost within
budget.

Two runs make this report: the main run has learning on and was forked
(``fastforward --fork-days``); the baseline is the same seeds with
``--set fauna.learning=false``. Readings used here (ADR 0009):

- **Early-life feeding success** is the energy a youth eats per hour of youth (from
  birth to maturity, or to death before it), pooled over the youths of every fork of a
  seed. It is compared between the fork's two arms, which start from the same state, for
  creatures born in the first half of each fork. Eaten ÷ burnt was tried first and is
  still shown: it measures efficiency, and youths that learn survive longer and so also
  burn more.
- **Time to competence** is the age at which a youth's day-averaged energy balance first
  stops being negative; a youth that never got there counts as never (+∞), so the median
  per generation is used. A seed "trends down" when the least-squares slope of that
  median over generations (weighted by youths, generations with at least
  ``MIN_YOUTHS``) is negative.
"""

from __future__ import annotations

import html
from pathlib import Path

import numpy as np
from lineage_sim.fauna import brain
from matplotlib.figure import Figure

from tools.fastforward import FORK_COLUMNS, YOUTH_COLUMNS
from tools.milestones import m4
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.viz import figures, style

NEEDS_BASELINE = True
STEP_BUDGET_MS = m4.STEP_BUDGET_MS
MIN_YOUTHS = 20  # youths a generation needs for its median competence time to count
MIN_GENERATIONS = 5  # counted generations a seed needs for a trend
MAX_GENERATION_SHOWN = 60
ON, OFF = style.CATEGORICAL[0], style.CATEGORICAL[3]
FOLLOWED_NAMES = tuple(
    (sense.name or "").removesuffix("_X").lower() for sense in brain.FOLLOWED
)  # fmt: skip

_Y = {name: i for i, name in enumerate(YOUTH_COLUMNS)}
_F = {name: i for i, name in enumerate(FORK_COLUMNS)}

SERIES_LABELS: dict[str, SeriesLabel] = {
    "generation": SeriesLabel("Mean generation", "generations since arrival"),
    "diet_fit": SeriesLabel(
        "Diet fit", "correlation of learned plant preference with local plant defence"
    ),
    **{
        f"learned_{name}": SeriesLabel(f"Learned gain: {name}", "mean gain")
        for name in FOLLOWED_NAMES
    },
}

CRITERIA: list[Criterion] = [
    Criterion(
        "M5.1",
        "Early-life feeding success, learning on vs off in the same forked worlds: energy "
        "eaten per hour of youth, median gain across seeds",
        "fork.intake_rate.gain.median",
        low=0.15,
    ),
    Criterion(
        "M5.2",
        "Share of seeds whose median time to competence falls over generations (learning on)",
        "competence.share_of_seeds_falling",
        low=0.6,
    ),
    Criterion(
        "M5.3",
        "Step of the whole world with learning on, median ms per sim-day",
        "step_ms.median",
        high=STEP_BUDGET_MS,
    ),
]


# --- Measurements -----------------------------------------------------------------------


def _stack(run: Run, name: str) -> np.ndarray:
    return np.stack([run.series[seed][name] for seed in run.manifest.seeds])


def _times(run: Run) -> np.ndarray:
    return run.series[run.manifest.seeds[0]][TIME_KEY]


def youth_outcomes(rows: np.ndarray) -> dict[str, float]:
    """How a group of youths fed (rows in `YOUTH_COLUMNS` order, or the same columns
    shifted by a leading fork column)."""
    offset = 1 if rows.shape[1] == len(FORK_COLUMNS) else 0
    age = rows[:, _Y["age_h"] + offset]
    eaten = rows[:, _Y["eaten"] + offset]
    burnt = rows[:, _Y["burnt"] + offset]
    competent = rows[:, _Y["competent_h"] + offset] >= 0
    died = rows[:, _Y["died"] + offset] > 0
    if rows.shape[0] == 0:
        return dict.fromkeys(("intake_rate", "eaten_per_burnt", "survival", "competent"), np.nan)
    return {
        "intake_rate": float(eaten.sum() / max(age.sum(), 1e-9)),
        "eaten_per_burnt": float(eaten.sum() / max(burnt.sum(), 1e-9)),
        "survival": float(1.0 - died.mean()),
        "competent": float(competent.mean()),
    }


def fork_gains(run: Run) -> dict[str, np.ndarray]:
    """Per seed and per measure: learning-on value ÷ learning-off value, minus 1."""
    out: dict[str, list[float]] = {}
    for seed in run.manifest.seeds:
        rows = run.series[seed]["_fork"]
        on = youth_outcomes(rows[rows[:, _F["learning"]] == 1])
        off = youth_outcomes(rows[rows[:, _F["learning"]] == 0])
        for name in on:
            out.setdefault(name, []).append(on[name] / off[name] - 1.0 if off[name] else np.nan)
    return {name: np.array(values) for name, values in out.items()}


def competence_by_generation(youth: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Generations with at least ``MIN_YOUTHS`` youths: (generation, median hours to
    competence with never = +∞, youths)."""
    generation = youth[:, _Y["generation"]].astype(np.int64)
    hours = np.where(youth[:, _Y["competent_h"]] >= 0, youth[:, _Y["competent_h"]], np.inf)
    gens, counts = np.unique(generation, return_counts=True)
    keep = counts >= MIN_YOUTHS
    medians = np.array([np.median(hours[generation == g]) for g in gens[keep]])
    return gens[keep], medians, counts[keep]


def competence_slope(youth: np.ndarray) -> float:
    """Weighted least-squares slope of median hours to competence over generations
    (hours per generation); NaN when too few generations count."""
    gens, medians, counts = competence_by_generation(youth)
    finite = np.isfinite(medians)
    if np.count_nonzero(finite) < MIN_GENERATIONS:
        return np.nan
    slope, _ = np.polyfit(gens[finite], medians[finite], 1, w=np.sqrt(counts[finite]))
    return float(slope)


def _competence_matrix(run: Run) -> tuple[np.ndarray, np.ndarray]:
    """(generations 1..MAX_GENERATION_SHOWN, [seed, generation] median hours, NaN where a
    generation has too few youths or most never became competent)."""
    shown = np.arange(1, MAX_GENERATION_SHOWN + 1)
    out = np.full((len(run.manifest.seeds), shown.size), np.nan)
    for row, seed in enumerate(run.manifest.seeds):
        gens, medians, _ = competence_by_generation(run.series[seed]["_youth"])
        for g, median in zip(gens.tolist(), medians.tolist(), strict=True):
            if 1 <= g <= MAX_GENERATION_SHOWN and np.isfinite(median):
                out[row, g - 1] = median
    return shown, out


def metrics(run: Run, baseline: Run) -> dict[str, float]:
    gains = fork_gains(run)
    out: dict[str, float] = {}
    for name, values in gains.items():
        out[f"fork.{name}.gain.median"] = float(np.nanmedian(values))
        out[f"fork.{name}.gain.share_of_seeds_positive"] = float(np.mean(values > 0))
    forks = [run.series[s]["_fork"] for s in run.manifest.seeds]
    out["fork.youths.per_arm.median"] = float(np.median([f.shape[0] / 2 for f in forks]))
    for arm, flag in (("on", 1), ("off", 0)):
        pooled = np.concatenate([f[f[:, _F["learning"]] == flag] for f in forks])
        for name, value in youth_outcomes(pooled).items():
            out[f"fork.{arm}.{name}"] = value

    for arm, which in (("on", run), ("off", baseline)):
        slopes = np.array(
            [competence_slope(which.series[s]["_youth"]) for s in which.manifest.seeds]
        )
        counted = slopes[np.isfinite(slopes)]
        label = "competence" if arm == "on" else "competence_off"
        # A seed with too few generations for a trend counts as not falling.
        out[f"{label}.share_of_seeds_falling"] = float(np.count_nonzero(counted < 0) / slopes.size)
        out[f"{label}.seeds_with_a_trend"] = float(counted.size)
        out[f"{label}.slope.median_h_per_generation"] = (
            float(np.median(counted)) if counted.size else np.nan
        )

    for arm, which in (("", run), ("off.", baseline)):
        population = _stack(which, "population")
        extinct = m4.extinct_by_year(which)
        out[f"{arm}population.end.median"] = float(np.median(population[:, -1]))
        out[f"{arm}extinct_seed_years.share"] = float(extinct.mean())
        out[f"{arm}energy_share.mean"] = float(np.nanmean(_stack(which, "energy_share")))
        out[f"{arm}step_ms.median"] = float(np.median(_stack(which, "step_ms")[:, 1:]))
        out[f"{arm}generation.end.median"] = float(np.nanmedian(_stack(which, "generation")[:, -1]))
    fit = _stack(run, "diet_fit")
    last_year = _times(run) >= run.manifest.sim_years - 1.0
    out["diet_fit.last_year.median"] = float(np.nanmedian(np.nanmean(fit[:, last_year], axis=1)))
    out["diet_fit.last_year.share_of_seeds_positive"] = float(
        np.mean(np.nanmean(fit[:, last_year], axis=1) > 0)
    )
    for gene in ("learning", "exploration", "social"):
        values = _stack(run, f"gene_{gene}")
        out[f"gene_{gene}.end.median"] = float(np.nanmedian(values[:, -1]))
        out[f"gene_{gene}.off.end.median"] = float(
            np.nanmedian(_stack(baseline, f"gene_{gene}")[:, -1])
        )
    for name in FOLLOWED_NAMES:
        out[f"learned_{name}.mean.median"] = float(np.nanmedian(_stack(run, f"learned_{name}")))
    return out


# --- Sections ---------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _fork_section(run: Run) -> Section:
    gains = fork_gains(run)
    labels = {
        "intake_rate": "eaten per hour",
        "eaten_per_burnt": "eaten ÷ burnt",
        "survival": "survived youth",
        "competent": "became competent",
    }
    body = _svg(
        "Gain from learning for each seed (learning on ÷ off, minus 1), energy eaten per hour of "
        "youth: the M5.1 measure. Both arms of a fork start from the same world.",
        figures.distribution(
            gains["intake_rate"] * 100.0,
            title="Early-life feeding: gain from learning",
            xlabel="gain in energy eaten per hour of youth (%)",
        ),
    )
    body += _svg(
        "Gain from learning in four measures of how youths fare, median and 10–90 % band "
        "across seeds. Eaten ÷ burnt (tried first) barely moves: youths that learn eat more "
        "and live longer, so they also burn more.",
        figures.bars_with_spread(
            list(labels.values()),
            [np.round(gains[name] * 100.0, 1) for name in labels],
            title="Youths with learning on vs off",
            ylabel="gain (%)",
        ),
    )
    return Section("Forked worlds: learning on vs off", body)


def _ablation_section(run: Run, baseline: Run) -> Section:
    times = _times(run)
    body = ""
    for name, title, unit in (
        ("population", "Population", "creatures"),
        ("energy_share", "Mean energy reserve", "share of capacity"),
        ("predators", "Predators", "creatures"),
    ):
        body += _svg(
            f"{title}, whole worlds with learning on and off (same seeds).",
            figures.compare_bands(
                times,
                {
                    "learning on": (_stack(run, name), ON),
                    "learning off": (_stack(baseline, name), OFF),
                },
                title=title, xlabel="sim time (years)", ylabel=unit,
            ),
        )  # fmt: skip
    return Section("Whole worlds: survival and energy", body)


def _baldwin_section(run: Run, baseline: Run) -> Section:
    shown, on = _competence_matrix(run)
    _, off = _competence_matrix(baseline)
    body = _svg(
        f"Median hours from birth to competence by generation (generations with at least "
        f"{MIN_YOUTHS} youths), median and 10–90 % band across seeds. If learning drives a "
        "Baldwin effect the 'on' curve falls; a fall in the 'off' curve too would come from "
        "the ecology rather than from learning.",
        figures.compare_bands(
            shown.astype(float),
            {"learning on": (on, ON), "learning off": (off, OFF)},
            title="Time to competence across generations",
            xlabel="generation since arrival",
            ylabel="hours to competence (median)",
        ),
    )
    return Section("Time to competence across generations", body)


def _gene_section(run: Run, baseline: Run) -> Section:
    times = _times(run)
    body = ""
    for gene, what in (
        ("learning", "learning rate"),
        ("exploration", "exploration"),
        ("social", "social (diet traditions)"),
    ):
        body += _svg(
            f"Mean {what} gene of the living. With learning off the gene does nothing and "
            "drifts.",
            figures.compare_bands(
                times,
                {
                    "learning on": (_stack(run, f"gene_{gene}"), ON),
                    "learning off": (_stack(baseline, f"gene_{gene}"), OFF),
                },
                title=f"{what.capitalize()} gene", xlabel="sim time (years)",
                ylabel="gene mean, 0–1",
            ),
        )  # fmt: skip
    body += _svg(
        "Diet fit: how closely the plant eaters' learned preference (low over woody growth) "
        "follows how much more defended the woody plants are than the low ones around "
        "each of them. Positive: they have learned where they live.",
        figures.time_series_band(
            times, _stack(run, "diet_fit"), title="Diet fit", xlabel="sim time (years)",
            ylabel="correlation",
        ),
    )  # fmt: skip
    body += _svg(
        "What the living have learned: mean learned gain on each followed sense, median "
        "across seeds. A positive gain means following that sense more than instinct says.",
        figures.median_lines(
            times,
            {name: _stack(run, f"learned_{name}") for name in FOLLOWED_NAMES},
            title="Learned gains", xlabel="sim time (years)", ylabel="mean learned gain",
        ),
    )  # fmt: skip
    return Section("Learning genes and what is learned", body)


def _cost_section(run: Run, baseline: Run) -> Section:
    return Section(
        "Step cost",
        _svg(
            "Time to step a whole sim-day on the reference machine "
            f"(budget {STEP_BUDGET_MS:g} ms).",
            figures.compare_bands(
                _times(run)[1:],
                {
                    "learning on": (_stack(run, "step_ms")[:, 1:], ON),
                    "learning off": (_stack(baseline, "step_ms")[:, 1:], OFF),
                },
                title="Step cost",
                xlabel="sim time (years)",
                ylabel="ms per sim-day",
            ),
        ),
    )


def sections(run: Run, run_dir: Path, baseline: Run) -> list[Section]:
    style.apply_style()
    return [
        _fork_section(run),
        _ablation_section(run, baseline),
        _baldwin_section(run, baseline),
        _gene_section(run, baseline),
        _cost_section(run, baseline),
    ]
