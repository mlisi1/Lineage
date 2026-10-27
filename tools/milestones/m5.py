"""M5 — Fauna II: lifetime learning. Metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8, revised 2026-10-17 and 2026-10-18, ADR 0009): learning tracks
the local environment (final-year diet fit positive in ≥ 80 % of seeds, M5.1); step cost
within budget (M5.3). M5.2, time to competence trending down over generations, is
reported without a band, with shielding versus genetic assimilation, as is early-life
feeding success (the original M5.1, ≥ 15 %).

Two runs make this report: the main run has learning on and was forked
(``fastforward --fork-days``); the baseline is the same seeds with
``--set fauna.learning=false``. Readings used here (ADR 0009):

- **Diet fit** is the correlation, over plant eaters among both plant forms, between
  what each has learned (low over woody growth) and how much more defended the woody
  plants around it are (``fastforward.diet_fit``); its final-year mean per seed.
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
from lineage_sim.config import ConfigError, parse_config
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
ON, OFF, LEARNED = style.CATEGORICAL[0], style.CATEGORICAL[3], style.CATEGORICAL[2]
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
        "Learning tracks the local environment: share of seeds whose final-year diet fit "
        "(learned plant preference against the local plant defence) is positive",
        "diet_fit.last_year.share_of_seeds_positive",
        low=0.8,
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
    out |= diet_fit_metrics(run)
    for gene in ("learning", "exploration", "social"):
        values = _stack(run, f"gene_{gene}")
        out[f"gene_{gene}.end.median"] = float(np.nanmedian(values[:, -1]))
        out[f"gene_{gene}.off.end.median"] = float(
            np.nanmedian(_stack(baseline, f"gene_{gene}")[:, -1])
        )
    for name in FOLLOWED_NAMES:
        out[f"learned_{name}.mean.median"] = float(np.nanmedian(_stack(run, f"learned_{name}")))
    for arm, which in (("", run), ("off.", baseline)):
        inherited = (
            _stack(which, "form_bias_inherited")
            if "form_bias_inherited" in which.series[which.manifest.seeds[0]]
            else None
        )
        if inherited is not None:
            out[f"{arm}form_bias_inherited.end.median"] = float(np.nanmedian(inherited[:, -1]))
            out[f"{arm}form_bias_inherited.end.share_positive"] = float(
                np.mean(inherited[:, -1] > 0)
            )
    if "form_bias_learned" in run.series[run.manifest.seeds[0]]:
        learned = _stack(run, "form_bias_learned")
        out["form_bias_learned.end.median"] = float(np.nanmedian(learned[:, -1]))
        out["form_bias_learned.end.share_positive"] = float(np.mean(learned[:, -1] > 0))
    out["first_landing.months.median"] = float(np.median(first_landing_years(run)) * 12.0)
    for arm, which in (("", run), ("off.", baseline)):
        minima = yearly_minimum(which)
        for year in range(minima.shape[1]):
            out[f"{arm}population_min.year{year + 1}.median"] = float(np.nanmedian(minima[:, year]))
            out[f"{arm}population_min.year{year + 1}.p10"] = float(
                np.nanpercentile(minima[:, year], 10)
            )
        out[f"{arm}population_min.winter_share"] = winter_share_of_minima(which)
    return out


def diet_fit_metrics(run: Run) -> dict[str, float]:
    """M5.1 from one run, without the fork or the baseline (M11 sweeps score it alone)."""
    fit = _stack(run, "diet_fit")
    last_year = _times(run) >= run.manifest.sim_years - 1.0
    per_seed = np.nanmean(fit[:, last_year], axis=1)
    return {
        "diet_fit.last_year.median": float(np.nanmedian(per_seed)),
        "diet_fit.last_year.share_of_seeds_positive": float(np.mean(per_seed > 0)),
    }


def first_landing_years(run: Run) -> np.ndarray:
    """Per seed: sim-years until the first creatures lived on the island."""
    times = _times(run)
    return np.array([times[np.argmax(p > 0)] for p in _stack(run, "population")])


def yearly_minimum(run: Run) -> np.ndarray:
    """[seed, year]: lowest population in each sim-year, counted from the first landing
    (NaN for a year before it)."""
    times, first = _times(run), first_landing_years(run)
    population = _stack(run, "population")
    years = max(1, round(run.manifest.sim_years))
    out = np.full((population.shape[0], years), np.nan)
    for row, (values, landed) in enumerate(zip(population, first, strict=True)):
        for year in range(years):
            inside = (times > year) & (times <= year + 1) & (times >= landed)
            if inside.any():
                out[row, year] = values[inside].min()
    return out


def winter_share_of_minima(run: Run) -> float:
    """Share of seed-years after the first whose lowest population falls in December to
    February (worlds start on 1 January)."""
    times = _times(run)
    population = _stack(run, "population")
    winters = total = 0
    for values in population:
        for year in range(1, max(1, round(run.manifest.sim_years))):
            inside = (times > year) & (times <= year + 1)
            if not inside.any():
                continue
            month = (_times(run)[inside][np.argmin(values[inside])] % 1.0) * 12.0
            winters += int(month < 2.0 or month >= 11.0)
            total += 1
    return winters / total if total else np.nan


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


def _bottleneck_section(run: Run, baseline: Run) -> Section:
    minima_on, minima_off = yearly_minimum(run), yearly_minimum(baseline)
    years = minima_on.shape[1]
    labels = [f"year {y + 1}, {arm}" for y in range(years) for arm in ("on", "off")]
    values = [m[:, y][np.isfinite(m[:, y])] for y in range(years) for m in (minima_on, minima_off)]
    landed = float(np.median(first_landing_years(run)) * 12.0)
    winter = winter_share_of_minima(run)
    body = _svg(
        f"Lowest population in each sim-year, per seed (counted from the first landing), "
        f"learning on and off: median and 10–90 % band across seeds. Founders land after "
        f"a median of {landed:.1f} months, once plants cover half the land, which leaves "
        f"them a few months before their first winter: year 1 is the bottleneck of the founders. "
        f"Later dips are winter dips (the lowest point of the year falls in December to "
        f"February in {winter:.0%} of later seed-years, learning on): larger herds and "
        f"arriving strangers carry the island through them.",
        figures.bars_with_spread(
            labels, values, title="Population bottlenecks", ylabel="lowest population (creatures)"
        ),
    )
    return Section("Population bottlenecks", body)


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
    if "form_bias_inherited" in run.series[run.manifest.seeds[0]]:
        body += _svg(
            "How much more the plant eaters follow low growth than woody growth: the bias "
            "they are born with (inherited weights), with learning on and off, and what "
            "the learners add during life. If the inherited bias rises with learning on, "
            "what is learned is becoming innate (genetic assimilation); if it stays lower "
            "than with learning off, learning makes the genes unnecessary (shielding).",
            figures.compare_bands(
                times,
                {
                    "inherited, learning on": (_stack(run, "form_bias_inherited"), ON),
                    "inherited, learning off": (_stack(baseline, "form_bias_inherited"), OFF),
                    "learned, learning on": (_stack(run, "form_bias_learned"), LEARNED),
                },
                title="Diet bias: born with, or learned", xlabel="sim time (years)",
                ylabel="bias toward low growth (weight)",
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


def _share(value: float) -> str:
    return f"{value:.0%}"


def _interpretation_section(run: Run, baseline: Run) -> Section:
    """What the plots show, in words. Every number is computed from these runs; where a
    reading depends on the data, the wording follows it."""
    m = metrics(run, baseline)
    times = _times(run)
    late = times >= run.manifest.sim_years - 0.5
    pred_on = float(np.median(_stack(run, "predators")[:, late]))
    pred_off = float(np.median(_stack(baseline, "predators")[:, late]))
    kills_on = float(np.median(_stack(run, "deaths_killed")[:, -1]))
    kills_off = float(np.median(_stack(baseline, "deaths_killed")[:, -1]))
    present = lambda r: float((_stack(r, "predators")[:, times >= 1.0] >= 3).mean())  # noqa: E731
    fit, fit_seeds = m["diet_fit.last_year.median"], m["diet_fit.last_year.share_of_seeds_positive"]
    gain, gain_seeds = (
        m["fork.intake_rate.gain.median"],
        m["fork.intake_rate.gain.share_of_seeds_positive"],
    )
    falling, falling_off = (
        m["competence.share_of_seeds_falling"],
        m["competence_off.share_of_seeds_falling"],
    )
    learning, learning_off = m["gene_learning.end.median"], m["gene_learning.off.end.median"]
    social, social_off = m["gene_social.end.median"], m["gene_social.off.end.median"]
    exploring, exploring_off = (
        m["gene_exploration.end.median"],
        m["gene_exploration.off.end.median"],
    )
    step, step_off = m["step_ms.median"], m["off.step_ms.median"]
    generations = m["generation.end.median"]
    born_on = m.get("form_bias_inherited.end.median", np.nan)
    born_off = m.get("off.form_bias_inherited.end.median", np.nan)
    learned_bias = m.get("form_bias_learned.end.median", np.nan)
    if not np.isfinite(born_on) or not np.isfinite(born_off):
        shielding_head, shielding_text = (
            "Born with, or learned?",
            "These runs did not record the inherited and learned diet bias.",
        )
    elif born_on < born_off - 0.03:
        shielding_head = "Learning shields the genes."
        shielding_text = (
            f"Plant eaters' inherited bias toward low growth ends at {born_on:+.3f} with "
            f"learning on and {born_off:+.3f} with it off (positive in "
            f"{_share(m['form_bias_inherited.end.share_positive'])} and "
            f"{_share(m['off.form_bias_inherited.end.share_positive'])} of seeds), while "
            f"the learners' learned bias is {learned_bias:+.3f}. Without learning, "
            "selection writes the diet rule into the genes; with learning, creatures pick "
            "it up during life, so selection on the genes relaxes: the opposite of a "
            "Baldwin effect, which Ackley &amp; Littman call shielding."
        )
    else:
        shielding_head = (
            "What is learned becomes innate."
            if born_on > born_off + 0.03
            else "Learning neither shields nor speeds the genes."
        )
        shielding_text = (
            f"Plant eaters' inherited bias toward low growth ends at {born_on:+.3f} with "
            f"learning on and {born_off:+.3f} with it off; the learned bias is "
            f"{learned_bias:+.3f}."
        )

    def gene_reading(on: float, off: float) -> str:
        if on < off - 0.1:
            return f"selected down ({on:.2f} against {off:.2f} drifting with learning off)"
        if on > off + 0.1:
            return f"selected up ({on:.2f} against {off:.2f} drifting with learning off)"
        return f"neither favoured nor disfavoured ({on:.2f} against {off:.2f} drifting)"

    baldwin = (
        "That is no better than the learning-off run, so it is not evidence of a Baldwin "
        "effect: neither curve clearly falls. A Baldwin effect needs learning to pay first "
        "and then many generations (in Ackley &amp; Littman's world, millions of steps); "
        f"{run.manifest.sim_years:g} years give about {generations:.0f}."
        if falling <= falling_off + 0.15
        else "That is clearly more than the learning-off run: a sign that inherited "
        "behaviour is catching up with what is learned (a Baldwin effect)."
    )
    years = max(1, round(run.manifest.sim_years))
    first_min = m["population_min.year1.median"]
    later_min = [m[f"population_min.year{y}.median"] for y in range(2, years + 1)]
    later_p10 = [m[f"population_min.year{y}.p10"] for y in range(2, years + 1)]
    try:
        founders = f"{parse_config(run.config_text).fauna.founder_count}"
    except ConfigError:
        founders = "the founding"

    def span(values: list[float]) -> str:
        low, high = min(values), max(values)
        return f"{low:.0f}" if round(low) == round(high) else f"{low:.0f}–{high:.0f}"

    riskiest = bool(later_min) and first_min < min(later_min)
    items = [
        (
            "Year 1 is the riskiest year." if riskiest else "The first year.",
            f"The lowest population of a seed's first year has a median of "
            f"{first_min:.0f} creatures"
            + (f", against {span(later_min)} in later years. " if later_min else ". ")
            + "Plants need months to cover half the land, so founders land only after a "
            f"median of {m['first_landing.months.median']:.1f} months, a few months before "
            f"their first winter: {founders} animals of one species, at random ages, meet "
            "the winter dieback of the plants with no time to grow.",
        ),
    ]
    if later_p10:
        items.append(
            (
                "Later dips are winter dips, and they rarely reach zero.",
                f"In later years the lowest point falls in December to February in "
                f"{_share(m['population_min.winter_share'])} of seed-years. Herds go into "
                "winter larger, and strangers keep arriving with other genomes, a rescue "
                f"effect; the 10th percentile of yearly minima is {span(later_p10)} "
                f"creatures, and {_share(m['extinct_seed_years.share'])} of seed-years see "
                "an extinction.",
            )
        )
    items += [
        (
            "Learning works, but buys little food.",
            f"The diet fit (learned plant preference against the local plants) has a "
            f"final-year median of {fit:+.2f}, positive in {_share(fit_seeds)} of seeds: "
            "each grazer learns which plant form is safe where it lives. Yet newborns in "
            f"the forked worlds eat only {gain:+.1%} more per hour of youth (positive in "
            f"{_share(gain_seeds)} of seeds). On a balanced island the local difference "
            "between plant forms is worth a few percent of a bite; stronger toxins would "
            "make it larger but starve the predators. Eaten ÷ burnt barely moves "
            f"({m['fork.eaten_per_burnt.gain.median']:+.1%}): learners eat more and also "
            "live longer, so they burn more.",
        ),
        (
            "Evolution keeps learning cheap.",
            f"The learning-rate gene is {gene_reading(learning, learning_off)}; exploration "
            f"is {gene_reading(exploring, exploring_off)}; copying the mother's diet "
            f"(SOCIAL) is {gene_reading(social, social_off)}. Exploration pays by itself "
            "(it spreads grazers over more pasture); a high learning rate costs more than "
            "the little food it wins. As Ackley &amp; Littman found, once inherited "
            "behaviour is good enough, genes for learning lose value (shielding).",
        ),
        (
            shielding_head,
            shielding_text,
        ),
        (
            f"No Baldwin trend in {run.manifest.sim_years:g} years.",
            f"Time to competence falls over generations in {_share(falling)} of seeds "
            f"with learning on, {_share(falling_off)} with it off. {baldwin}",
        ),
        (
            "Predators boom and bust.",
            f"Predator numbers cycle in both runs: hunters arrive, multiply on the herds, "
            f"and crash. Seeds have at least three predators in {_share(present(run))} of "
            f"the time after year 1 with learning on, {_share(present(baseline))} off; in "
            f"the last half year the median is {pred_on:.0f} with learning on against "
            f"{pred_off:.0f} off, and kills per seed are {kills_on:.0f} against "
            f"{kills_off:.0f}. Learning prey are not harder to catch: in 30-day forks from "
            "the same worlds, kills and the movement and spacing of grazers do not change "
            "(ADR 0009). The gap builds over months at the level of populations, and the "
            "richer meat of this configuration only partly offsets it.",
        ),
        (
            "Learning has a modest running cost.",
            f"A whole sim-day takes {step:.0f} ms with learning on and {step_off:.0f} ms "
            "off; most of the cost of M5 is the plant-form senses, which every creature "
            "computes either way.",
        ),
    ]
    body = (
        '<p class="note">Written by the report tool from the numbers of these two runs; '
        "the discussion behind it is in docs/decisions/0009-lifetime-learning.md.</p><ul>"
        + "".join(f"<li><strong>{head}</strong> {text}</li>" for head, text in items)
        + "</ul>"
    )
    return Section("What the plots show", body)


def sections(run: Run, run_dir: Path, baseline: Run) -> list[Section]:
    style.apply_style()
    return [
        _interpretation_section(run, baseline),
        _fork_section(run),
        _ablation_section(run, baseline),
        _bottleneck_section(run, baseline),
        _baldwin_section(run, baseline),
        _gene_section(run, baseline),
        _cost_section(run, baseline),
    ]
