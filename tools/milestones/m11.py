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
  the notes), for the ablation table.

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
from lineage_sim.fauna.genome import Gene
from matplotlib.figure import Figure

from tools.milestones import m3, m5, m7, m8
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.tune import score as sc
from tools.tune import sensitivity
from tools.viz import figures, style

NEEDS_BASELINE = True
MIXED_RUNS = True  # compared runs may have other seeds or lengths (held-out, five-year)
TAKES_SWEEPS = True

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
    single += [("M11", c) for c in sc.CRITERIA] + [("D", c) for c in sc.PROPOSED]
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
    for path in sweeps:
        document = json.loads((path / "points.json").read_text(encoding="utf-8"))
        out[f"sweep:{document['sweep']}/points"] = float(len(document["points"]))
    return {k: v for k, v in out.items() if isinstance(v, float) and math.isfinite(v)}


# --- Sections ----------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _value(values: dict[str, float], key: str) -> str:
    v = values.get(key)
    return "—" if v is None else f"{v:.3g}"


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
    return Section(
        "Runs", note + _table(["role", "run", "seeds", "years", "commit", "notes"], rows)
    )


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
                reference=(0.3, "proposed band ≥ 0.3"),
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
                reference=(0.2, "proposed band ≥ 0.2"),
            ),
        ),
    ]
    return Section("Diversity and balance (D1–D3)", "".join(parts))


def _balance_section(run: Run) -> Section:
    times = run.series[run.manifest.seeds[0]][TIME_KEY]
    population = np.stack([run.series[s]["population"] for s in run.manifest.seeds])
    predators = np.stack([run.series[s]["predators"] for s in run.manifest.seeds])
    with np.errstate(invalid="ignore", divide="ignore"):
        share = np.where(population > 0, predators / population, np.nan)
    fig = figures.time_series_band(
        times, share, title="Predators' share of creatures (D3)", xlabel="sim time (years)",
        ylabel="share of creatures",
    )  # fmt: skip
    distance = np.nan_to_num(
        np.stack([run.series[s]["genetic_distance"] for s in run.manifest.seeds])
    )
    fig2 = figures.time_series_band(
        times, distance, title="Mean genetic distance from the ancestors (M11.1)",
        xlabel="sim time (years)", ylabel="mean gene difference",
    )  # fmt: skip
    return Section(
        "Hunters, grazers and change",
        _svg("Predators' share of the creatures alive, tuning seeds", fig)
        + _svg("Genetic distance from the ancestors, tuning seeds: still rising at year 3?", fig2),
    )


ABLATION_KEYS = (
    ("M3.2 months to closed forest", "M3:closed_forest.months.median"),
    ("M3.5 seeds without succession", "M3:seeds_without_succession.share"),
    ("M4.3 both diets present", "M4:both_diets.last_year.mean_share_of_seeds"),
    ("M6.1 species in band", "M6:species_alive.in_band_after_founding.share_of_time.median"),
    ("D1 lowest gene", "D:niche.share_of_seeds.min"),
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
    return Section("Mechanisms on and off", note + _table(head, rows))


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
    return Section("Engagement", note + _table(["measure", "tuning seeds", "held-out seeds"], rows))


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
        return _sections(run, roles, values, sweeps)


def _sections(
    run: Run, roles: dict[str, Run], values: dict[str, float], sweeps: tuple[Path, ...]
) -> list[Section]:
    return [
        _runs_section(run, roles),
        _diversity_section(values),
        _balance_section(run),
        _ablation_section(values),
        _engagement_section(values),
        _sensitivity_section(sweeps),
    ]
