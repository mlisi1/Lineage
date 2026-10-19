"""M8 — Presence, calendar, god powers: metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8): the office schedule produces measurable selection on night
traits compared with always-present (M8.1); a 3-week absence leaves life alive in ≥ 80 %
of seeds (M8.2). The owner asked that holidays be tested too: the August holiday leaves
life alive in ≥ 80 % of seeds (M8.3, ADR 0016). M7.2 is judged again in the office's light
(ADR 0015 deferred it to M8).

M8 compares runs of the same seeds under different presence schedules
(`tools.schedules`): the main run is ``office``; the others (``--baseline``, repeatable)
are ``always`` and the holiday schedules. A run's schedule is read from its manifest.

Readings used here:

- **Night traits**: the rare genes whose bonus is in the dark, glow and hibernation. A
  seed's night-trait share is their carriers per creature-day over its inhabited days
  (photosynthesis, whose cost is the dark, is reported beside them). M8.1 is a one-sided
  rank test across seeds (office above always; exact permutations of the rank sum,
  drawn with a fixed seed): it passes at p ≤ 0.05.
- **Absence**: the days the schedule keeps the owner away (1–21 October; August). An
  absence counts if creatures were alive on its first day; it is survived if they never
  all died before its last. A seed passes if it survived every absence it had.
"""

from __future__ import annotations

import datetime as dt
import html
import re
from pathlib import Path

import numpy as np
from lineage_sim.rare import CreatureRare
from matplotlib.figure import Figure

from tools.fastforward import (
    DAYS_PER_YEAR,
    DEFAULT_START,
    EXTRA_PREFIX,
    PRESENCE_DAILY_COLUMNS,
    RARE_DAILY_COLUMNS,
)
from tools.milestones import m7
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import Run
from tools.schedules import CONFERENCE_DAYS, CONFERENCE_START, SCHEDULES
from tools.viz import figures, style

NEEDS_BASELINE = True
SELECTION_P = 0.05
SURVIVAL_TARGET = 0.8
PERMUTATIONS = 20_000
PLOT_EVERY_DAYS = 7
NIGHT_GENES = (CreatureRare.GLOW, CreatureRare.HIBERNATION)
WATCHED_GENES = (*NIGHT_GENES, CreatureRare.PHOTOSYNTHESIS)
# Absences to judge: schedule -> (label, criterion id).
ABSENCES = {"conference": ("3-week absence", "M8.2"), "office-august": ("August", "M8.3")}

_C = {name: i for i, name in enumerate(RARE_DAILY_COLUMNS)}
_P = {name: i for i, name in enumerate(PRESENCE_DAILY_COLUMNS)}

SERIES_LABELS: dict[str, SeriesLabel] = {}

CRITERIA: list[Criterion] = [
    Criterion(
        "M8.1",
        "Night traits (glow, hibernation) are more frequent under the office schedule than "
        "always-present: one-sided rank test across seeds, p-value",
        "night_selection.p_value",
        high=SELECTION_P,
    ),
    Criterion(
        "M8.2",
        "Share of seeds whose creatures survive every 3-week absence (1–21 October)",
        "conference.absence_survival.share_of_seeds",
        low=SURVIVAL_TARGET,
    ),
    Criterion(
        "M8.3",
        "Share of seeds whose creatures survive every August holiday (asked by the owner)",
        "office-august.absence_survival.share_of_seeds",
        low=SURVIVAL_TARGET,
    ),
    Criterion(
        "M7.2",
        f"Re-judged in the office's light: share of seeds where no rare gene stays above "
        f"{m7.FIXATION_SHARE:.0%} of its population for more than {m7.FIXATION_DAYS} days",
        "office.fixation.share_of_seeds_without_long_fixation",
        low=m7.NO_FIXATION_TARGET,
    ),
]

SCHEDULE_COLOURS = {name: style.categorical(i) for i, name in enumerate(SCHEDULES)}


def schedule_of(run: Run) -> str:
    """The presence schedule a run was made with (``always`` if none is noted)."""
    found = re.search(r"schedule ([a-z-]+)", run.manifest.notes)
    return found.group(1) if found else "always"


def start_of(run: Run) -> dt.date:
    found = re.search(r"start (\d{4}-\d\d-\d\d)", run.manifest.notes)
    return dt.date.fromisoformat(found.group(1)) if found else DEFAULT_START


def by_schedule(run: Run, *others: Run) -> dict[str, Run]:
    runs: dict[str, Run] = {}
    for r in (run, *others):
        name = schedule_of(r)
        if name in runs:
            raise ValueError(f"two runs with schedule {name!r}")
        if r.manifest.seeds != run.manifest.seeds:
            raise ValueError("every compared run must use the same seeds")
        runs[name] = r
    if schedule_of(run) != "office" or "always" not in runs:
        raise ValueError("M8 needs the office run, and the always-present run as --baseline")
    return {name: runs[name] for name in SCHEDULES if name in runs}


def daily(run: Run, seed: int) -> np.ndarray:
    return run.series[seed][EXTRA_PREFIX + "rare_daily"]


def light(run: Run, seed: int) -> np.ndarray:
    return run.series[seed][EXTRA_PREFIX + "presence_daily"]


def creatures(run: Run, seed: int) -> np.ndarray:
    return daily(run, seed)[:, _C["creatures"]]


def carrier_share(run: Run, seed: int, genes: tuple[CreatureRare, ...]) -> float:
    """Carriers of ``genes`` per creature-day over the inhabited days (NaN: never)."""
    table = daily(run, seed)
    total = float(table[:, _C["creatures"]].sum())
    if total == 0:
        return np.nan
    carried = sum(float(table[:, _C[m7.gene_name(g)]].sum()) for g in genes)
    return carried / total


def rank_test(higher: np.ndarray, lower: np.ndarray, seed: int = 8) -> float:
    """One-sided p-value that ``higher`` tends above ``lower`` (rank sum, permutations)."""
    a, b = higher[np.isfinite(higher)], lower[np.isfinite(lower)]
    if a.size == 0 or b.size == 0:
        return np.nan
    pooled = np.concatenate([a, b])
    ranks = np.argsort(np.argsort(pooled, kind="stable"), kind="stable").astype(float)
    for value in np.unique(pooled):  # ties share their mean rank
        tied = pooled == value
        ranks[tied] = ranks[tied].mean()
    observed = ranks[: a.size].sum()
    rng = np.random.Generator(np.random.PCG64(seed))
    draws = np.array([rng.permutation(ranks)[: a.size].sum() for _ in range(PERMUTATIONS)])
    return float((np.count_nonzero(draws >= observed - 1e-9) + 1) / (PERMUTATIONS + 1))


def absence_days(schedule: str, start: dt.date, days: int) -> list[tuple[int, int]]:
    """(first, last) day index of every absence of ``schedule`` within the run."""
    out: list[tuple[int, int]] = []
    for year in range(start.year, start.year + days // 365 + 2):
        if schedule == "conference":
            first = dt.date(year, *CONFERENCE_START)
            last = first + dt.timedelta(days=CONFERENCE_DAYS - 1)
        elif schedule == "office-august":
            first, last = dt.date(year, 8, 1), dt.date(year, 8, 31)
        else:
            return []
        a, b = (first - start).days, (last - start).days
        if a >= 0 and b < days:
            out.append((a, b))
    return out


def absences(run: Run, schedule: str) -> list[dict[str, float]]:
    """One row per absence that found creatures alive: seed, days, populations."""
    rows: list[dict[str, float]] = []
    for seed in run.manifest.seeds:
        n = creatures(run, seed)
        for a, b in absence_days(schedule, start_of(run), n.size):
            if n[a] <= 0:
                continue
            low = float(n[a : b + 1].min())
            rows.append(
                {
                    "seed": float(seed), "first_day": float(a), "start": float(n[a]),
                    "low": low, "end": float(n[b]), "survived": float(low > 0),
                }
            )  # fmt: skip
    return rows


def survival_by_seed(rows: list[dict[str, float]]) -> dict[int, bool]:
    out: dict[int, bool] = {}
    for row in rows:
        seed = int(row["seed"])
        out[seed] = out.get(seed, True) and bool(row["survived"])
    return out


def metrics(run: Run, *others: Run) -> dict[str, float]:
    runs = by_schedule(run, *others)
    out: dict[str, float] = {}
    night: dict[str, np.ndarray] = {}
    for name, r in runs.items():
        seeds = r.manifest.seeds
        night[name] = np.array([carrier_share(r, s, NIGHT_GENES) for s in seeds])
        inhabited = np.array([np.count_nonzero(creatures(r, s) > 0) for s in seeds])
        out[f"{name}.inhabited_days.median"] = float(np.median(inhabited))
        out[f"{name}.extinctions.share_of_seeds"] = float(
            np.mean([r.series[s]["extinctions"][-1] > 0 for s in seeds])
        )
        out[f"{name}.light.mean.median"] = float(
            np.median([light(r, s)[:, 0].mean() for s in seeds])
        )
        out[f"{name}.night_traits.per_mille.median"] = float(1000 * np.nanmedian(night[name]))
        for gene in WATCHED_GENES:
            key = m7.gene_name(gene)
            shares = np.array([carrier_share(r, s, (gene,)) for s in seeds])
            out[f"{name}.{key}.per_mille.median"] = float(1000 * np.nanmedian(shares))
            out[f"{name}.{key}.per_mille.mean"] = float(1000 * np.nanmean(shares))
        torpid = [
            float(daily(r, s)[:, _C["torpid"]].sum()) / max(1.0, float(creatures(r, s).sum()))
            for s in seeds
        ]
        out[f"{name}.torpid_share.median"] = float(np.median(torpid))
        sense = [r.series[s]["gene_sense"][-1] for s in seeds]
        sense = [v for v in sense if np.isfinite(v)]
        if sense:
            out[f"{name}.gene_sense.final.median"] = float(np.median(sense))
        out[f"{name}.fixation.share_of_seeds_without_long_fixation"] = float(
            m7.fixation_free(r).mean()
        )
        out[f"{name}.fixation.share_of_seeds_without_long_fixation.excluding_photosynthesis"] = (
            float(m7.fixation_free(r, m7.WITHOUT_NIGHT_GENES).mean())
        )
    out["night_selection.p_value"] = rank_test(night["office"], night["always"])
    always = float(np.nanmedian(night["always"]))
    if always > 0:
        out["night_selection.ratio_of_medians"] = float(np.nanmedian(night["office"])) / always
    photo = {
        name: np.array([carrier_share(runs[name], s, (CreatureRare.PHOTOSYNTHESIS,))
                        for s in run.manifest.seeds])
        for name in ("office", "always")
    }  # fmt: skip
    out["photosynthesis_selection.p_value"] = rank_test(photo["always"], photo["office"])
    for name in ABSENCES:
        if name not in runs:
            continue
        rows = absences(runs[name], name)
        seeds = survival_by_seed(rows)
        if seeds:
            out[f"{name}.absence_survival.share_of_seeds"] = float(np.mean(list(seeds.values())))
            out[f"{name}.absence_survival.seeds_judged"] = float(len(seeds))
        if rows:
            out[f"{name}.absence_survival.share_of_absences"] = float(
                np.mean([row["survived"] for row in rows])
            )
            out[f"{name}.absences_judged"] = float(len(rows))
            kept = [row["end"] / row["start"] for row in rows if row["survived"]]
            if kept:
                out[f"{name}.absence_population_kept.median"] = float(np.median(kept))
    return out


# --- Sections ---------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _weekly(run: Run, values_of: str) -> tuple[np.ndarray, np.ndarray]:
    """Weekly samples of a daily per-seed series: (times in years, [seed, week])."""
    if values_of == "light":
        tables = [light(run, s)[:, _P["light"]] for s in run.manifest.seeds]
    else:
        tables = [creatures(run, s) for s in run.manifest.seeds]
    length = min(t.size for t in tables)
    picks = np.arange(0, length, PLOT_EVERY_DAYS)
    return (picks + 1) / DAYS_PER_YEAR, np.stack([t[:length][picks] for t in tables])


def _light_section(runs: dict[str, Run]) -> Section:
    panels: dict[str, tuple[np.ndarray, str]] = {}
    times = np.array([])
    for name, r in runs.items():
        times, values = _weekly(r, "light")
        panels[name] = (values, SCHEDULE_COLOURS[name])
    fig = figures.band_panels(
        times, panels, xlabel="sim time (years)", ylabel="mean light of the day", columns=2
    )
    office = runs["office"]
    days = light(office, office.manifest.seeds[0])[:28, _P["light"]]
    week = figures.time_series_band(
        np.arange(1, days.size + 1, dtype=float), days[None, :],
        title="Office schedule, first four weeks (one seed)", xlabel="sim day",
        ylabel="mean light of the day", colour=SCHEDULE_COLOURS["office"],
    )  # fmt: skip
    body = _svg(
        "The light each schedule gives: each day's mean light (sampled hourly), one point a "
        "week, median and 10–90 % band across seeds. Weekly points fall on varying weekdays.",
        fig,
    ) + _svg(
        "Day by day: workdays lit from about 9:00 to 18:00, weekends dark (the Long Night). "
        "2026-01-01 is a Thursday.",
        week,
    )
    return Section("Light", body)


def _population_section(runs: dict[str, Run]) -> Section:
    panels: dict[str, tuple[np.ndarray, str]] = {}
    times = np.array([])
    for name, r in runs.items():
        times, values = _weekly(r, "creatures")
        panels[name] = (values, SCHEDULE_COLOURS[name])
    fig = figures.band_panels(
        times, panels, xlabel="sim time (years)", ylabel="living creatures", columns=2
    )
    return Section(
        "Population",
        _svg("Living creatures per schedule, weekly, median and 10–90 % band across seeds.", fig),
    )


def _traits_section(runs: dict[str, Run], values: dict[str, float]) -> Section:
    keys = [m7.gene_name(g) for g in WATCHED_GENES]
    series: dict[str, list[float | None]] = {
        name: [values.get(f"{name}.{k}.per_mille.median") for k in keys] for name in runs
    }
    fig = figures.grouped_bars(
        [m7.label(k) for k in keys], series, SCHEDULE_COLOURS,
        title="Night genes by schedule", ylabel="carriers per 1000 creature-days (median)",
    )  # fmt: skip
    per_seed = [
        1000 * np.array([carrier_share(r, s, NIGHT_GENES) for s in r.manifest.seeds])
        for r in runs.values()
    ]
    spread = figures.bars_with_spread(
        list(runs), [v[np.isfinite(v)] for v in per_seed],
        title="Glow and hibernation carriers per seed", ylabel="per 1000 creature-days",
    )  # fmt: skip
    rows = "".join(
        f"<tr><td>{html.escape(name)}</td>"
        f"<td>{values.get(f'{name}.night_traits.per_mille.median', np.nan):.2f}</td>"
        f"<td>{values.get(f'{name}.photosynthesis.per_mille.median', np.nan):.2f}</td>"
        f"<td>{values.get(f'{name}.torpid_share.median', np.nan):.4f}</td>"
        f"<td>{values.get(f'{name}.gene_sense.final.median', np.nan):.3f}</td></tr>"
        for name in runs
    )
    table = (
        "<table><tr><th>schedule</th><th>glow + hibernation (‰, median)</th>"
        "<th>photosynthesis (‰, median)</th><th>torpid share of creature-days</th>"
        "<th>sense gene, end (median)</th></tr>" + rows + "</table>"
        f"<p>Rank test, office above always (M8.1): p = "
        f"{values.get('night_selection.p_value', np.nan):.4f}. Photosynthesis, always above "
        f"office: p = {values.get('photosynthesis_selection.p_value', np.nan):.4f}.</p>"
    )
    body = (
        _svg("Carriers of each night gene per 1000 creature-days, median across seeds.", fig)
        + _svg("Glow and hibernation together, per seed: median and 10–90 % band.", spread)
        + table
    )
    return Section("Night traits", body)


def _absence_section(runs: dict[str, Run], values: dict[str, float]) -> Section:
    body = ""
    for name, (title, cid) in ABSENCES.items():
        if name not in runs:
            body += f"<p>No {html.escape(name)} run was given: {cid} is not measured.</p>"
            continue
        r = runs[name]
        rows = absences(r, name)
        if not rows:
            body += f"<p>No {html.escape(title)} found creatures alive.</p>"
            continue
        before, after = 14, 56
        x = np.arange(-before, after, dtype=float)
        curves: list[np.ndarray] = []
        for row in rows:
            n = creatures(r, int(row["seed"]))
            a = int(row["first_day"])
            window = np.full(x.size, np.nan)
            lo, hi = max(0, a - before), min(n.size, a + after)
            window[lo - (a - before) : hi - (a - before)] = n[lo:hi] / row["start"]
            curves.append(window)
        span = absence_days(name, start_of(r), 10_000)[0]
        fig = figures.compare_bands(
            x, {title: (np.stack(curves), SCHEDULE_COLOURS[name])},
            title=f"Creatures through the {title}",
            xlabel=f"days since the owner left (away for {span[1] - span[0] + 1} days)",
            ylabel="creatures / creatures on day 0",
        )  # fmt: skip
        lines = "".join(
            f"<tr><td>{int(row['seed'])}</td><td>{int(row['first_day'])}</td>"
            f"<td>{int(row['start'])}</td><td>{int(row['low'])}</td><td>{int(row['end'])}</td>"
            f"<td>{'yes' if row['survived'] else '<b>no</b>'}</td></tr>"
            for row in rows
        )
        body += (
            _svg(
                f"{title}: creatures relative to the day the owner left, median and 10–90 % "
                f"band over the {len(rows)} absences that found creatures alive.",
                fig,
            )
            + f"<p>{cid}: seeds surviving every {html.escape(title)}: "
            f"{values.get(f'{name}.absence_survival.share_of_seeds', np.nan):.0%} "
            f"of {int(values.get(f'{name}.absence_survival.seeds_judged', 0))} seeds.</p>"
            "<table><tr><th>seed</th><th>first day</th><th>creatures then</th><th>lowest</th>"
            "<th>at the end</th><th>survived</th></tr>" + lines + "</table>"
        )
    return Section("Holidays", body)


def _fixation_section(runs: dict[str, Run], values: dict[str, float]) -> Section:
    rows = ""
    for name, r in runs.items():
        genes = m7.per_gene(r)
        worst = {k: int(np.max(genes[k]["fixation_days"])) for k in m7.GENE_KEYS}
        longest = max(worst, key=lambda k: worst[k])
        rows += (
            f"<tr><td>{html.escape(name)}</td>"
            f"<td>{values[f'{name}.fixation.share_of_seeds_without_long_fixation']:.0%}</td>"
            f"<td>{html.escape(m7.label(longest))} ({worst[longest]} days)</td>"
            f"<td>{worst['photosynthesis']} days</td></tr>"
        )
    body = (
        f"<p>M7.2 asks that no rare gene stay above {m7.FIXATION_SHARE:.0%} of its population "
        f"for more than {m7.FIXATION_DAYS} days in ≥ {m7.NO_FIXATION_TARGET:.0%} of seeds. In "
        "M7's constant daylight photosynthesis swept herds; nights are its cost.</p>"
        "<table><tr><th>schedule</th><th>seeds without long fixation</th>"
        "<th>longest fixation (gene)</th><th>longest photosynthesis fixation</th></tr>"
        + rows
        + "</table>"
    )
    return Section("Rare genes in the light (M7.2)", body)


def sections(run: Run, run_dir: Path, *others: Run) -> list[Section]:
    del run_dir  # M8 draws no maps
    style.apply_style()
    runs = by_schedule(run, *others)
    values = metrics(run, *others)
    return [
        _light_section(runs),
        _population_section(runs),
        _traits_section(runs, values),
        _absence_section(runs, values),
        _fixation_section(runs, values),
    ]
