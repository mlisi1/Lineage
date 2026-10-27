"""M11 — Long-run tuning and stability. The dashboard over every criterion (ADR 0019).

Acceptance (CLAUDE.md §8): every M2–M10 criterion passes at once, and the mean genetic
distance from the ancestors is still rising at year 3 (M11.1); the owner added D1–D3
(diversity and balance, ``tools/tune/score.py``). The report reads several runs, each
recognised by its manifest, and judges each criterion on the run it belongs to:

- the main run: the tuned config, tuning seeds (0–19), office schedule, 3 years: every
  single-run criterion (``tools.tune.score``);
- ``held-out``: the same on other seeds (20–39), judged again;
- ``five-year``: M3 is specified over 5 years;
- ``fork`` and ``learning-off``: M5 (``fastforward --fork-days``; ``--set
  fauna.learning=false``);
- ``always``, ``office-august``, ``conference``: M8's schedules;
- ``off:<mechanism>``: the main run with one M11 mechanism turned off (its off switch in
  the notes), for the ablation table;
- ``decade``: the tuned config over 10 years or more, for "What to expect over the
  years": the island as the owner will live with it, island by island.

Sweeps (``--sweep runs/sweep-<name>``) add the sensitivity of the key metrics to the
levers. Step-time criteria read a shared PC and are reported for the record.
"""

from __future__ import annotations

import html
import json
import math
import warnings
from pathlib import Path
from typing import Any

import numpy as np
from lineage_sim.chronicle import KINDS
from lineage_sim.fauna.genome import Gene
from matplotlib.figure import Figure

from tools.fastforward import CHRONICLE_COLUMNS, DAYS_PER_YEAR, EXTRA_PREFIX
from tools.milestones import m3, m4, m5, m7, m8, m11_story
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.tune import score as sc
from tools.tune import sensitivity
from tools.viz import figures, style

NEEDS_BASELINE = True
MIXED_RUNS = True  # compared runs may have other seeds or lengths (held-out, five-year)
TAKES_SWEEPS = True
STORY_FIRST = True  # the island in figures before the header and the criteria (the owner)

# Each M11 mechanism's off switch, as fast-forward notes write it (``--set``).
MECHANISMS: dict[str, tuple[str, ...]] = {
    "food at sea": ("flora.algae_capacity=0.0",),
    "wading": ("fauna.wading_depth=0.0",),
    "reach": ("fauna.browse_floor=1.0",),
    "cover": ("fauna.cover_protection=0.0",),
    "nutrients": ("fauna.dung_fertility=0.0", "fauna.carrion_fertility=0.0"),
    # Off, fruit goes far by the stand-in it had before (as if wind-borne).
    "gut seeds": ("fauna.gut_seeds_per_hour=0.0", "flora.fruit_by_wind=true"),
    "hunters from the herd": ("fauna.prey_diet_gap=1.0",),
    "soft caps": ("fauna.crowding_wait_days=0.0",),
    "resting hunters": ("fauna.hunter_rest_share=1.0",),
}
# The tuned island with the owner pressing the god-power button weekly (2026-10-21).
PRESSES = "weekly presses"
ROLES = (
    "held-out",
    PRESSES,
    "five-year",
    "fork",
    "learning-off",
    *(s for s in m8.SCHEDULES if s != "office"),
)
TUNING, HELD_OUT = "tuning", "held-out"
DECADE = "decade"  # a run of at least DECADE_YEARS: what to expect over the years
DECADE_YEARS = 10.0
# Chronicle importance (default.toml [chronicle]): notable entries, and major ones, which
# reach the owner's phone (ADR 0017).
NOTABLE, MAJOR = 3, 4
SET_COLOURS = {TUNING: style.categorical(0), HELD_OUT: style.categorical(1)}

SERIES_LABELS: dict[str, SeriesLabel] = {
    "algae": SeriesLabel("Algae", "mean biomass where they grow, 0–0.4"),
    **{
        f"gene_{gene.name.lower()}_{end}": SeriesLabel(
            f"{gene.name.capitalize()} gene, {end} third", "share of creatures"
        )
        for gene in Gene
        for end in ("high", "low")
    },
}


def _criteria() -> list[Criterion]:
    """Every criterion, on the run and metric it is judged from."""
    out: list[Criterion] = []
    single = [
        (mid, c) for mid, (_, criteria) in sc.SOURCES.items() for c in criteria if mid != "M3"
    ]
    single += [("M11", c) for c in sc.CRITERIA] + [("D", c) for c in sc.DIVERSITY]
    for label, where in ((TUNING, "tuning seeds"), (HELD_OUT, "held-out seeds")):
        for mid, c in single:
            out.append(
                Criterion(
                    f"{c.cid} ({where})", c.description, f"{label}/{mid}:{c.metric}", c.low,
                    c.high,
                )
            )  # fmt: skip
    out += [
        Criterion(f"{c.cid} (5 years)", c.description, f"five-year/{c.metric}", c.low, c.high)
        for c in m3.CRITERIA
    ]
    out += [
        Criterion(c.cid, c.description, f"M5/{c.metric}", c.low, c.high)
        for c in m5.CRITERIA
        if c.cid != "M5.1"  # judged on the main run above
    ]
    out += [Criterion(c.cid, c.description, f"M8/{c.metric}", c.low, c.high) for c in m8.CRITERIA]
    return out


CRITERIA: list[Criterion] = _criteria()


# --- Runs --------------------------------------------------------------------------------


def role_of(run: Run, main: Run) -> str:
    """Which part of the dashboard a compared run feeds (see the module docstring)."""
    notes = run.manifest.notes
    if "presses every" in notes:
        return PRESSES
    if "forks every" in notes:
        return "fork"
    if "fauna.learning=false" in notes:
        return "learning-off"
    for name, switches in MECHANISMS.items():
        if all(switch in notes for switch in switches):
            return f"off:{name}"
    if run.manifest.sim_years >= DECADE_YEARS:
        return DECADE
    if run.manifest.sim_years >= 5:
        return "five-year"
    schedule = m8.schedule_of(run)
    if schedule != "office":
        return schedule
    if run.manifest.seeds != main.manifest.seeds:
        return HELD_OUT
    raise ValueError(f"run {run.manifest.run_id}: cannot tell what it is for ({notes})")


def by_role(run: Run, *others: Run) -> dict[str, Run]:
    if m8.schedule_of(run) != "office":
        raise ValueError("M11's main run must use the office schedule")
    roles: dict[str, Run] = {}
    for other in others:
        name = role_of(other, run)
        if name in roles:
            raise ValueError(f"two runs for {name!r}")
        roles[name] = other
    return roles


# --- Metrics -----------------------------------------------------------------------------


def metrics(run: Run, *others: Run, sweeps: tuple[Path, ...] = ()) -> dict[str, float]:
    # Short or empty runs leave empty slices: NaN, which the acceptance shows as MISSING.
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        return _metrics(run, *others, sweeps=sweeps)


def _metrics(run: Run, *others: Run, sweeps: tuple[Path, ...] = ()) -> dict[str, float]:
    roles = by_role(run, *others)
    out: dict[str, float] = {}
    out |= {f"{TUNING}/{k}": v for k, v in sc.score(run).metrics.items()}
    if HELD_OUT in roles:
        out |= {f"{HELD_OUT}/{k}": v for k, v in sc.score(roles[HELD_OUT]).metrics.items()}
    if PRESSES in roles:
        out |= {f"{PRESSES}/{k}": v for k, v in sc.score(roles[PRESSES]).metrics.items()}
    if "five-year" in roles:
        out |= {f"five-year/{k}": v for k, v in m3.metrics(roles["five-year"]).items()}
    if "fork" in roles and "learning-off" in roles:
        out |= {f"M5/{k}": v for k, v in m5.metrics(roles["fork"], roles["learning-off"]).items()}
    schedules = [roles[s] for s in m8.SCHEDULES if s in roles]
    if any(m8.schedule_of(r) == "always" for r in schedules):
        out |= {f"M8/{k}": v for k, v in m8.metrics(run, *schedules).items()}
    for name in MECHANISMS:
        off = roles.get(f"off:{name}")
        if off is not None:
            out |= {f"off:{name}/{k}": v for k, v in sc.score(off).metrics.items()}
    if DECADE in roles:
        out |= {f"{DECADE}/{k}": v for k, v in decade_metrics(roles[DECADE]).items()}
    for path in sweeps:
        document = json.loads((path / "points.json").read_text(encoding="utf-8"))
        out[f"sweep:{document['sweep']}/points"] = float(len(document["points"]))
    return {k: v for k, v in out.items() if isinstance(v, float) and math.isfinite(v)}


def _first_year(times: np.ndarray, hit: np.ndarray) -> float:
    """Sim time (years) of the first sample where ``hit`` holds; NaN if never."""
    return float(times[hit][0]) if hit.any() else np.nan


def _spells(flags: np.ndarray) -> list[int]:
    """Lengths, in samples, of each run of True in ``flags``."""
    lengths, current = [], 0
    for flag in flags.tolist():
        if flag:
            current += 1
        elif current:
            lengths.append(current)
            current = 0
    if current:
        lengths.append(current)
    return lengths


def _at_year(times: np.ndarray, values: np.ndarray, year: float) -> float:
    return float(values[int(np.argmin(np.abs(times - year)))])


def decade_metrics(run: Run) -> dict[str, float]:
    """What living with the island looks like, per island (seed): the founding, life once
    settled, evolution, hunters, the land and the chronicle. Each per-island number is
    reported as the median island and the 10–90 % range across islands."""
    years = run.manifest.sim_years
    per: dict[str, list[float]] = {}

    def add(key: str, value: float) -> None:
        per.setdefault(key, []).append(float(value))

    kind = CHRONICLE_COLUMNS.index("kind")
    importance = CHRONICLE_COLUMNS.index("importance")
    kinds: dict[str, float] = {}
    for seed in run.manifest.seeds:
        s = run.series[seed]
        t = s[TIME_KEY]
        population, predators, herbivores = s["population"], s["predators"], s["herbivores"]
        settled = (t >= 1.0) & (population > 0)
        add("worlds_ended", s["worlds_ended"][-1])
        add("founders.months", 12 * _first_year(t, population > 0))
        add("hunters_land.months", 12 * _first_year(t, predators >= m4.PRESENT))
        add("forest.months", 12 * _first_year(t, s["closed_forest"] >= m3.FOREST_SHARE))
        if settled.any():
            add("creatures.median", np.median(population[settled]))
            add("grazers.share", np.median(herbivores[settled] / population[settled]))
            add("hunters.share", np.median(predators[settled] / population[settled]))
            add("species_alive.median", np.median(s["species_alive"][settled]))
        after = t >= 1.0
        present = predators[after] >= m4.PRESENT
        add("hunters.present.share_of_time", present.mean() if present.size else np.nan)
        gone = _spells(~present)
        step_days = DAYS_PER_YEAR * float(t[1] - t[0]) if t.size > 1 else np.nan
        add("hunters.gone.spells_per_decade", len(gone) * 10.0 / max(years - 1.0, 1.0))
        add("hunters.gone.longest_days", max(gone) * step_days if gone else 0.0)
        add("species.new_per_year", s["species_splits"][-1] / years)
        add("species.lost_per_year", s["species_extinctions"][-1] / years)
        for name in ("fires", "volcanoes", "earthquakes", "craters", "splits", "rejoins"):
            add(f"{name}.per_year", s[name][-1] / years)
        for year in (1.0, years / 2, years):
            add(f"genetic_distance.year_{year:g}", _at_year(t, s["genetic_distance"], year))
        entries = s[f"{EXTRA_PREFIX}chronicle"]
        add("chronicle.notable_per_month", np.sum(entries[:, importance] >= NOTABLE) / (years * 12))
        add("chronicle.major_per_month", np.sum(entries[:, importance] >= MAJOR) / (years * 12))
        for row in entries[entries[:, importance] >= NOTABLE]:
            name = KINDS[int(row[kind])].value
            kinds[name] = kinds.get(name, 0.0) + 1.0
    out: dict[str, float] = {}
    for key, values in per.items():
        a = np.array(values, dtype=float)
        if np.isfinite(a).any():
            out[f"{key}.median"] = float(np.nanmedian(a))
            out[f"{key}.p10"] = float(np.nanpercentile(a, 10))
            out[f"{key}.p90"] = float(np.nanpercentile(a, 90))
    present = np.array(per.get("hunters.present.share_of_time", []), dtype=float)
    out["hunters.present_most.share_of_islands"] = float(np.mean(present >= 0.5))
    out["islands"] = float(len(run.manifest.seeds))
    out["island_years"] = years * len(run.manifest.seeds)
    out["worlds_ended.total"] = float(sum(per.get("worlds_ended", [])))
    out["worlds_ended.islands"] = float(sum(e > 0 for e in per.get("worlds_ended", [])))
    island_years = out["island_years"]
    for name, count in kinds.items():
        out[f"chronicle.kind.{name}.per_year"] = count / island_years
    return out


# --- Sections ----------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _value(values: dict[str, float], key: str) -> str:
    v = values.get(key)
    return "—" if v is None else f"{v:.3g}"


def _fold(summary: str, inner: str) -> str:
    """Numbers the reader may open; the report leads with pictures."""
    return f"<details><summary>{html.escape(summary)}</summary>{inner}</details>"


def _table(head: list[str], rows: list[list[str]]) -> str:
    cells = "".join(f"<th>{html.escape(h)}</th>" for h in head)
    body = "".join(
        "<tr>" + "".join(f"<td>{c}</td>" for c in row) + "</tr>" for row in rows
    )  # fmt: skip
    return f'<div class="wrap"><table><tr>{cells}</tr>{body}</table></div>'


def _runs_section(run: Run, roles: dict[str, Run]) -> Section:
    rows = []
    for name, r in (("main (tuning)", run), *roles.items()):
        m = r.manifest
        seeds = f"{m.seeds[0]}–{m.seeds[-1]}" if m.seeds else "—"
        rows.append([html.escape(name), html.escape(m.run_id), seeds, f"{m.sim_years:g}",
                     html.escape(m.git_commit), html.escape(m.notes)])  # fmt: skip
    note = (
        '<p class="note">Each criterion is judged on the run it belongs to. The tuning '
        "seeds were used to choose the config; the held-out seeds never were.</p>"
    )
    table = _table(["role", "run", "seeds", "years", "commit", "notes"], rows)
    return Section("Runs", _fold(f"The {len(rows)} runs behind this report", note + table))


def _diversity_section(values: dict[str, float]) -> Section:
    genes = [g for g in sc.NICHE_GENES]
    d1 = {
        label: [values.get(f"{label}/D:niche.{g.name.lower()}.share_of_seeds") for g in genes]
        for label in (TUNING, HELD_OUT)
    }
    keys = list(m7.GENE_KEYS)
    d2 = {
        label: [values.get(f"{label}/D:thrive.{k}.share_of_seeds") for k in keys]
        for label in (TUNING, HELD_OUT)
    }
    parts = [
        _svg(
            "D1: share of seeds in which both ends of each gene's range held at least "
            f"{sc.NICHE_SHARE:.0%} of the creatures at some time (looks aside)",
            figures.grouped_bars(
                [g.name.lower() for g in genes],
                d1,
                SET_COLOURS,
                title="Every gene has a niche (D1)",
                ylabel="share of seeds",
                reference=(sc.NICHE_SEEDS, f"a niche: ≥ {sc.NICHE_SEEDS:.0%} of seeds"),
            ),
        ),
        _svg(
            f"D2: share of seeds in which each rare gene held at least {sc.THRIVE_SHARE:.0%} "
            f"of its population for {sc.THRIVE_DAYS} days or more",
            figures.grouped_bars(
                [
                    k.removeprefix("plant_") + (" (plant)" if k.startswith("plant_") else "")
                    for k in keys
                ],
                d2,
                SET_COLOURS,
                title="Rare genes can thrive (D2)",
                ylabel="share of seeds",
                reference=(sc.THRIVE_SEEDS, f"thriving: ≥ {sc.THRIVE_SEEDS:.0%} of seeds"),
            ),
        ),
    ]
    return Section("Diversity and balance (D1–D3)", "".join(parts))


ABLATION_KEYS = (
    ("M3.2 months to closed forest", "M3:closed_forest.months.median"),
    ("M3.5 seeds without succession", "M3:seeds_without_succession.share"),
    ("M4.3 both diets present", "M4:both_diets.last_year.mean_share_of_seeds"),
    ("M6.1 species in band", "M6:species_alive.in_band_after_founding.share_of_time.median"),
    ("D1 genes with a niche", "D:niche.genes_with_niche"),
    ("D2 rare genes thriving", "D:thrive.genes_thriving"),
    ("D1 size", "D:niche.size.share_of_seeds"),
    ("D1 swimming", "D:niche.aquatic.share_of_seeds"),
    ("D3 predators' share", "D:predators.share_of_creatures.median"),
    ("median size gene", "M4:gene_size.end.median"),
)


def _ablation_section(values: dict[str, float]) -> Section:
    present = [n for n in MECHANISMS if any(k.startswith(f"off:{n}/") for k in values)]
    if not present:
        body = '<p class="empty">No run with a mechanism turned off was given.</p>'
        return Section("Mechanisms on and off", body)
    head = ["measure", "all on (tuning)", *(f"without {n}" for n in present)]
    rows = [
        [html.escape(label), _value(values, f"{TUNING}/{key}"),
         *(_value(values, f"off:{n}/{key}") for n in present)]
        for label, key in ABLATION_KEYS
    ]  # fmt: skip
    note = (
        '<p class="note">The tuned config, then the same seeds with one mechanism turned '
        "off by its switch (ADR 0019). One 20-seed run cannot resolve a share's change "
        "below about 0.2.</p>"
    )
    return Section(
        "Mechanisms on and off, in numbers", _fold("Open the table", note + _table(head, rows))
    )


ENGAGEMENT = (
    ("worlds ended per seed-year (≤ 0.1)", "M11:worlds_ended.per_seed_year"),
    ("inhabited share of time", "M11:inhabited.share_of_time"),
    (
        "predators present (share of inhabited time)",
        "M11:predators.present.share_of_inhabited_time",
    ),
    (
        "omnivores present (share of inhabited time)",
        "M11:omnivores.present.share_of_inhabited_time",
    ),
    ("notable booms and crashes per seed-year", "M11:booms_crashes.notable.per_seed_year"),
    ("notable chronicle entries per month", "M9:notable.per_month.median"),
    ("photosynthesis sweeps (share of seeds)", "D:photosynthesis.sweeps.share_of_seeds"),
)


def _engagement_section(values: dict[str, float]) -> Section:
    rows = [
        [html.escape(label), _value(values, f"{TUNING}/{key}"), _value(values, f"{HELD_OUT}/{key}")]
        for label, key in ENGAGEMENT
    ]  # fmt: skip
    note = '<p class="note">The engagement targets of docs/m11-plan.md §1, reported.</p>'
    table = _table(["measure", "tuning seeds", "held-out seeds"], rows)
    return Section("Engagement", _fold("Open the table", note + table))


# Rows of "A typical year": label, decade metric, format of the numbers.
TYPICAL_YEAR = (
    ("creatures alive (after the first year)", "creatures.median", "{:.0f}"),
    ("grazers among them", "grazers.share", "{:.0%}"),
    ("hunters among them", "hunters.share", "{:.0%}"),
    ("species alive at once", "species_alive.median", "{:.0f}"),
    ("new species per year", "species.new_per_year", "{:.1f}"),
    ("species lost per year", "species.lost_per_year", "{:.1f}"),
    ("hunters present (share of time after year 1)", "hunters.present.share_of_time", "{:.0%}"),
    ("times the hunters vanish, per decade", "hunters.gone.spells_per_decade", "{:.1f}"),
    ("longest time without hunters (days)", "hunters.gone.longest_days", "{:.0f}"),
    ("fires per year", "fires.per_year", "{:.1f}"),
    ("volcanic eruptions per year", "volcanoes.per_year", "{:.1f}"),
    ("earthquakes per year", "earthquakes.per_year", "{:.1f}"),
    ("craters per year", "craters.per_year", "{:.1f}"),
    ("the land splitting, per year", "splits.per_year", "{:.1f}"),
    ("the land rejoining, per year", "rejoins.per_year", "{:.1f}"),
    ("notable chronicle entries per month", "chronicle.notable_per_month", "{:.1f}"),
    ("major entries per month (pushed to the phone)", "chronicle.major_per_month", "{:.1f}"),
)


def _fmt(values: dict[str, float], key: str, form: str = "{:.1f}") -> str:
    v = values.get(f"{DECADE}/{key}")
    return "—" if v is None or not math.isfinite(v) else form.format(v)


def _spread(values: dict[str, float], key: str, form: str) -> str:
    """Median island, then the 10–90 % range across islands."""
    mid = _fmt(values, f"{key}.median", form)
    low, high = _fmt(values, f"{key}.p10", form), _fmt(values, f"{key}.p90", form)
    return mid if low == high else f"{mid} ({low}–{high})"


def _decade_section(values: dict[str, float], decade: Run | None) -> Section:
    title = "What to expect over the years"
    if decade is None:
        return Section(title, '<p class="empty">No ten-year run was given.</p>')
    v = lambda key: values.get(f"{DECADE}/{key}", np.nan)  # noqa: E731
    islands, island_years, ended = v("islands"), v("island_years"), v("worlds_ended.total")
    note = (
        f'<p class="note">From run {html.escape(decade.manifest.run_id)}: {islands:.0f} '
        f"islands (seeds), each lived for {decade.manifest.sim_years:g} years under the office "
        "schedule with nobody pressing the button: one island per seed, as the gadget will "
        "live it. Numbers are the median island, with the range from the 10th to the 90th "
        "percentile island in brackets.</p>"
    )
    if ended > 0:
        on = v("worlds_ended.islands")
        worlds = (
            f"<b>Worlds end rarely.</b> {ended:.0f} worlds ended in {island_years:.0f} "
            f"island-years, on {on:.0f} of the {islands:.0f} islands: about one every "
            f"{island_years / ended:.0f} years for one island. When one does, the apocalypse "
            "plays and a new continent rises."
        )
    else:
        worlds = f"<b>Worlds end rarely.</b> No world ended in {island_years:.0f} island-years."
    founding = (
        "<b>The first year is a founding.</b> The bare island greens first; the founders, "
        f"plant eaters of one species, land after {_spread(values, 'founders.months', '{:.0f}')} "
        f"months, the hunter pack after {_spread(values, 'hunters_land.months', '{:.0f}')}, "
        "and the first closed forest stands after "
        f"{_spread(values, 'forest.months', '{:.0f}')} months."
    )
    life = (
        f"<b>Then life settles.</b> The island holds about "
        f"{_spread(values, 'creatures.median', '{:.0f}')} creatures, "
        f"{_spread(values, 'grazers.share', '{:.0%}')} of them grazers and "
        f"{_spread(values, 'hunters.share', '{:.0%}')} hunters, in "
        f"{_spread(values, 'species_alive.median', '{:.0f}')} species at once."
    )
    years = decade.manifest.sim_years
    half = _fmt(values, f"genetic_distance.year_{years / 2:g}.median", "{:.3f}")
    end = _fmt(values, f"genetic_distance.year_{years:g}.median", "{:.3f}")
    change = (
        "<b>Evolution does not stop.</b> About "
        f"{_spread(values, 'species.new_per_year', '{:.1f}')} new species arise each year and "
        f"{_spread(values, 'species.lost_per_year', '{:.1f}')} die out. Species here are "
        "groups of similar genomes (ADR 0012), finer than who can mate, so most are "
        "short-lived branches of a few lasting lineages. The creatures drift "
        "ever further from the founders (mean gene difference "
        f"{_fmt(values, 'genetic_distance.year_1.median', '{:.3f}')} after a year, "
        f"{half} halfway, {end} at the end)."
    )
    most = v("hunters.present_most.share_of_islands")
    hunters = (
        "<b>Hunters come and go.</b> After the first year hunters are present "
        f"{_spread(values, 'hunters.present.share_of_time', '{:.0%}')} of the time; they "
        f"vanish {_spread(values, 'hunters.gone.spells_per_decade', '{:.1f}')} times a decade "
        "(they can arise again from the herd, or the ark brings them back), the longest "
        f"absence lasting {_spread(values, 'hunters.gone.longest_days', '{:.0f}')} days. "
        f"On {most:.0%} of the islands they are present most of the time."
    )
    land = (
        "<b>The land moves too.</b> A year brings about "
        f"{_fmt(values, 'fires.per_year.median')} fires (lightning in thunderstorms), "
        f"{_fmt(values, 'volcanoes.per_year.median')} eruptions, "
        f"{_fmt(values, 'earthquakes.per_year.median')} earthquakes and "
        f"{_fmt(values, 'craters.per_year.median')} craters; the shifting coasts split "
        f"the land {_fmt(values, 'splits.per_year.median')} times a year and join it again "
        f"{_fmt(values, 'rejoins.per_year.median')} times."
    )
    common = sorted(
        ((k.split(".")[2], val) for k, val in values.items()
         if k.startswith(f"{DECADE}/chronicle.kind.")),
        key=lambda kv: -kv[1],
    )[:5]  # fmt: skip
    listed = ", ".join(f"{html.escape(name.replace('_', ' '))} ({val:.0f} a year)"
                       for name, val in common)  # fmt: skip
    chronicle = (
        "<b>The chronicle.</b> It writes "
        f"{_spread(values, 'chronicle.notable_per_month', '{:.1f}')} notable entries a month, "
        f"of which {_spread(values, 'chronicle.major_per_month', '{:.1f}')} are major and "
        f"reach the phone: about {12 * v('chronicle.major_per_month.median'):.0f} pushes a "
        f"year without the button. The most common notable entries: {listed or '—'}."
    )
    bullets = "".join(
        f"<li>{b}</li>" for b in (worlds, founding, life, change, hunters, land, chronicle)
    )
    table = _fold(
        "A typical year in numbers",
        _table(
            ["a typical year", "median island (10–90 % of islands)"],
            [[html.escape(label), _spread(values, key, form)] for label, key, form in TYPICAL_YEAR],
        ),
    )
    return Section(title, note + f"<ul>{bullets}</ul>" + table + _considerations(values))


def _considerations(values: dict[str, float]) -> str:
    """Higher-level notes on living with the island, from the other runs where given."""
    items = [
        "<b>The island is closed.</b> No strangers land: every species descends from the "
        "founders, the hunter pack that lands once, or what an ark brings (ADR 0019). What "
        "the island becomes, it becomes by itself.",
        "<b>No two islands are alike.</b> The ranges above are wide on purpose: some islands "
        "keep a steady pack of hunters for years, others lose it and turn into grazing "
        "lands until hunters arise again. The criteria judge the spread, not one island.",
    ]
    forest = values.get(f"{PRESSES}/M3:closed_forest.months.median")
    if forest is not None:
        items.append(
            "<b>The button helps, gently.</b> Pressed weekly, it ended no world and caused no "
            f"extinction in the press run; the island greened faster (first closed forest after "
            f"{forest:.0f} months) and god powers fill much of the chronicle."
        )
    holiday = values.get("M8/office-august.absence_survival.share_of_seeds")
    away = values.get("M8/conference.absence_survival.share_of_seeds")
    if holiday is not None and away is not None:
        items.append(
            "<b>Your absences are its long nights.</b> Life survived the August holiday on "
            f"{holiday:.0%} of the islands and a three-week absence on {away:.0%}."
        )
    swim = values.get(f"{TUNING}/D:niche.aquatic.share_of_seeds")
    if swim is not None and swim == 0:
        items.append(
            "<b>Some things will not happen.</b> No island raised a lineage of swimmers: the "
            "founders walk, and on a closed island swimming never pays enough. Glow and "
            "hibernation stay rare whatever the schedule (M8.1)."
        )
    return "<h3>Considerations</h3><ul>" + "".join(f"<li>{i}</li>" for i in items) + "</ul>"


# What each mechanism does (ADR 0019): read beside what fails when it is off.
MECHANISM_ROLES = {
    "food at sea": "algae on the shallow shelf feed creatures off the shore",
    "wading": "any creature crosses the shallow shelf without struggling",
    "reach": "tall plants feed only tall bodies: a niche for size",
    "cover": "prey hide in dense woody growth",
    "nutrients": "dung and carcasses feed the soil",
    "gut seeds": "grazers carry the seeds of fruiting plants",
    "hunters from the herd": "hunters may prey on kin that eat far more plants",
    "soft caps": "births wait longer the nearer a kind is to its cap",
    "resting hunters": "hunters burn a fifth of their resting energy between kills",
}

# Criteria revised during M11 with the owner (ADR 0019): criterion, before, now, why.
REVISIONS = (
    ("M2.5", "terrain step within its budget", "retired",
     "the whole world's step is what the device pays for; M4.4 budgets it"),
    ("M4.4, M5.3", "400 ms per sim-day", "600 ms per sim-day on the PC",
     "five mechanisms cost step time; the sim still needs well under 1 % of the board"),
    ("M3.5", "no seed without succession", "at most a tenth of the seeds",
     "the failing seeds were open woodland kept open by big browsers, a real landscape"),
    ("M6.1", "3–12 species, from the first day", "3–16 species, after the founding",
     "the founders are one species and need time to diverge; hunters that last bring "
     "their own species"),
    ("M8.1", "selection on night traits", "selection on light traits, night or day",
     "glow and hibernation never respond to any schedule; photosynthesis does"),
    ("D1", "every body gene has a niche", "at least 9 of 12 genes",
     "on a closed island of walking founders swimming never finds a niche"),
    ("D2", "every rare gene thrives", "at least 5 of 14 rare genes",
     "some rare genes are situational and almost never thrive (listed below)"),
)  # fmt: skip

# Why a run judged only for harm, or a mechanism switched off, fails what it fails.
_ROLE_NOTES = {
    PRESSES: "The owner gardening: powers green the island faster and fill the chronicle. "
    "This run is judged for harm only (no world ended, no extinction), as the owner decided.",
    "off:resting hunters": "Hunters starve between kills and none last; with them go most "
    "of the niches (D1 counts 3 genes instead of 10): the body genes reach their ends "
    "mostly where there are hunters.",
    "off:soft caps": "Over ten years it mattered: alone it did little, but with resting "
    "hunters it lets the pack grow and the herd answer to its losses (ADR 0019).",
}
_NOTHING_FAILS = (
    "the mechanism's effect over three years is smaller than one 20-seed run resolves, or "
    "it shows over longer times (see What makes it work)."
)


def _judged_for(values: dict[str, float], role: str) -> list[sc.Judged]:
    """Every swept criterion judged again on a compared run's metrics."""
    metrics = {k.removeprefix(f"{role}/"): v for k, v in values.items() if k.startswith(f"{role}/")}
    groups = [(f"{mid}:", criteria) for mid, (_, criteria) in sc.SOURCES.items()]
    groups += [("M11:", sc.CRITERIA), ("D:", sc.DIVERSITY)]
    return [
        sc.judge(c, metrics, prefix)
        for prefix, criteria in groups
        for c in criteria
        if c.cid not in sc.UNSWEPT
    ]


def _shortfalls_section(values: dict[str, float]) -> Section:
    title = "Why some criteria are not met"
    intro = (
        '<p class="note">Every criterion passes on the main runs (the acceptance table). '
        "This section says where criteria do fail, in the runs that change one thing, and "
        "why; which criteria were revised during M11 and why; and what the passing criteria "
        "still leave out.</p>"
    )
    rows: list[list[str]] = []
    for role in (PRESSES, *(f"off:{name}" for name in MECHANISMS)):
        if not any(k.startswith(f"{role}/") for k in values):
            continue
        failed = [j for j in _judged_for(values, role) if j.status == "FAIL"]
        listed = "; ".join(
            f"{html.escape(j.cid)} {j.value:.3g} ({html.escape(j.band)})"
            for j in failed if j.value is not None
        ) or "none"  # fmt: skip
        name = role.removeprefix("off:")
        does = MECHANISM_ROLES.get(name)
        why = _ROLE_NOTES.get(role, "")
        what = html.escape(f"It makes: {does}. {why}".strip() if does else why)
        label = "weekly presses" if role == PRESSES else f"without {name}"
        rows.append([html.escape(label), listed, what])
    runs = (
        "<h3>Where criteria fail</h3>"
        + f'<p class="note">Where nothing fails: {html.escape(_NOTHING_FAILS)}</p>'
        + _table(["run", "criteria that fail (value, band)", "why"], rows)
        if rows
        else ""
    )
    revised = "<h3>Criteria revised during M11</h3>" + _table(
        ["criterion", "before", "now", "why"],
        [[html.escape(c) for c in row] for row in REVISIONS],
    )
    gaps = _gaps(values)
    return Section(title, intro + runs + revised + gaps)


def _gaps(values: dict[str, float]) -> str:
    """What passes with room to spare, and what does not happen at all."""
    items: list[str] = []
    niche = sorted(
        (k.split("/D:niche.")[1].removesuffix(".share_of_seeds"), v)
        for k, v in values.items()
        if k.startswith(f"{TUNING}/D:niche.") and k.endswith(".share_of_seeds")
        and not k.endswith("share_of_seeds.min")
    )  # fmt: skip
    without = [f"{g} ({v:.0%})" for g, v in niche if v < sc.NICHE_SEEDS]
    if without:
        items.append(
            "<b>Body genes without a niche</b> (share of tuning seeds where both ends held "
            f"{sc.NICHE_SHARE:.0%} of the creatures): {html.escape(', '.join(without))}. "
            "The founders walk, so swimmers could only come from slow drift; size finds a "
            "niche in a few seeds only."
        )
    thrive = sorted(
        (k.split("/D:thrive.")[1].removesuffix(".share_of_seeds"), v)
        for k, v in values.items()
        if k.startswith(f"{TUNING}/D:thrive.") and k.endswith(".share_of_seeds")
        and not k.endswith("share_of_seeds.min")
    )  # fmt: skip
    rare = [f"{g.replace('_', ' ')} ({v:.0%})" for g, v in thrive if v < sc.THRIVE_SEEDS]
    if rare:
        items.append(
            "<b>Rare genes that do not thrive</b> (share of tuning seeds where they held "
            f"{sc.THRIVE_SHARE:.0%} of their population for {sc.THRIVE_DAYS} days): "
            f"{html.escape(', '.join(rare))}. Several are made to pay only in particular "
            "places or seasons (fire-pine after fires, hibernation in long dark, amphibious "
            "on the shore), so they stay rare."
        )
    night = [
        (schedule, values.get(f"M8/{schedule}.night_traits.per_mille.median"))
        for schedule in m8.SCHEDULES
    ]
    shown = [f"{s} {v:.1f} ‰" for s, v in night if v is not None]
    if shown:
        items.append(
            "<b>Night traits do not respond to the owner's absence.</b> Glow and hibernation "
            f"carriers per creature, median seed: {html.escape(', '.join(shown))}. M8.1 passes "
            "through photosynthesis, which the office's light holds back."
        )
    if not items:
        return ""
    return (
        "<h3>What the passing criteria leave out</h3><ul>"
        + "".join(f"<li>{i}</li>" for i in items)
        + "</ul>"
    )


def _sensitivity_section(sweeps: tuple[Path, ...]) -> Section:
    if not sweeps:
        return Section("Sensitivity", '<p class="empty">No sweep was given (--sweep).</p>')
    parts: list[str] = []
    for path in sweeps:
        document: dict[str, Any] = json.loads((path / "points.json").read_text(encoding="utf-8"))
        levers, names, rho = sensitivity.table(document)
        keep = [i for i, name in enumerate(names) if np.isfinite(rho[i]).any()]
        n = sum(1 for p in document["points"] if p["levers"])
        fig = figures.heatmap(
            [names[i] for i in keep], [k.split(".", 1)[1] for k in levers], rho[keep],
            title=f"Sweep {document['sweep']}: rank correlation of each metric with each lever",
        )  # fmt: skip
        parts.append(
            _svg(
                f"Sweep {document['sweep']}, {n} sampled points ({len(document['seeds'])} seeds × "
                f"{document['years']:g} years, {document['schedule']}): Spearman rho; |rho| below "
                f"{2 / math.sqrt(max(n, 1)):.2f} is noise",
                fig,
            )
        )
    return Section("Sensitivity of the key metrics to the levers", "".join(parts))


def sections(run: Run, run_dir: Path, *others: Run, sweeps: tuple[Path, ...] = ()) -> list[Section]:
    style.apply_style()
    roles = by_role(run, *others)
    values = metrics(run, *others, sweeps=sweeps)
    with warnings.catch_warnings():
        # Flat or empty series (a short run) make matplotlib widen a zero-height axis.
        warnings.simplefilter("ignore", RuntimeWarning)
        warnings.simplefilter("ignore", UserWarning)
        return _sections(run, run_dir, roles, values, sweeps)


def _sections(
    run: Run,
    run_dir: Path,
    roles: dict[str, Run],
    values: dict[str, float],
    sweeps: tuple[Path, ...],
) -> list[Section]:
    life = roles.get(DECADE, run)
    # Snapshots (maps) live in the run's directory; compared runs sit beside the main one.
    life_dir = run_dir if life is run else run_dir.parent / life.manifest.run_id
    maps = life_dir if (life_dir / "snapshots").is_dir() else None
    judged = [c.evaluate(values)[1] for c in CRITERIA]
    passed = (sum(status == "PASS" for status in judged), len(judged))
    story = [
        m11_story.glance_section(values, life, maps, passed),
        m11_story.lives_section(life),
        m11_story.hunters_section(life),
        m11_story.species_section(life),
        m11_story.bodies_section(life),
        m11_story.land_section(life, maps),
        m11_story.chronicle_section(life),
        m11_story.mechanisms_section(values, tuple(MECHANISMS)),
        m11_story.presence_section(values),
    ]
    rest = [
        _decade_section(values, roles.get(DECADE)),
        _shortfalls_section(values),
        _diversity_section(values),
        _ablation_section(values),
        _engagement_section(values),
        _runs_section(run, roles),
    ]
    if sweeps:
        rest.append(_sensitivity_section(sweeps))
    return [section for section in (*story, *rest) if section is not None]
