"""M6 — Species, names, phylogeny: metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8): species alive in [3–12] for ≥ 90 % of sim-time (M6.1);
speciation ≥ 1 per sim-month, median (M6.2).

Readings used here (agreed with the owner at the start of M6):

- **Sim-time** is inhabited time: from the day the founders land (the first census with a
  species) to the end of the run. Days after a total extinction count, with no species
  alive. M6.1 takes, per seed, the share of those days with 3 to 12 species alive after
  the daily census, and passes if the median seed is at 90 % or more.
- **Speciation** counts splits only: a species born on the island from a parent species.
  Groups of strangers landing found species too (arrivals); they are reported apart.
  M6.2 is splits per inhabited sim-month per seed, median across seeds.
"""

from __future__ import annotations

import html
from pathlib import Path

import numpy as np
from lineage_sim.config import ConfigError, parse_config
from matplotlib import pyplot as plt
from matplotlib.figure import Figure

from tools.fastforward import DAYS_PER_YEAR, EXTRA_PREFIX, PHYLOGENY_COLUMNS
from tools.milestones import m4
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.viz import figures, style

ALIVE_BAND = (3, 12)
SHARE_TARGET = 0.9
SPLITS_PER_MONTH_TARGET = 1.0
DAYS_PER_MONTH = DAYS_PER_YEAR / 12.0
TREE_SEEDS = 3  # representative seeds drawn as trees, plus the worst one
LABELLED_PEAK = 10  # species with at least this many members at their peak are named
NAME_SAMPLES = 12  # names listed per tree seed
BURST_DAYS = 30.0  # window in which the daughters of one species count as one burst
# Founding diet classes (herbivore up to, predator from), when the config cannot be read.
DIET_LIMITS = (0.35, 0.65)

_P = {name: i for i, name in enumerate(PHYLOGENY_COLUMNS)}

SERIES_LABELS: dict[str, SeriesLabel] = {
    "species_alive": SeriesLabel("Species alive", "species"),
    "species_ever": SeriesLabel("Species that ever lived", "cumulative count"),
    "species_splits": SeriesLabel("Speciations (splits)", "cumulative count"),
    "species_arrivals": SeriesLabel("Species arrived", "cumulative count"),
    "species_extinctions": SeriesLabel("Species extinctions", "cumulative count"),
}

CRITERIA: list[Criterion] = [
    Criterion(
        "M6.1",
        f"Median seed's share of inhabited sim-time with {ALIVE_BAND[0]}–{ALIVE_BAND[1]} "
        "species alive",
        "species_alive.in_band.share_of_time.median",
        low=SHARE_TARGET,
    ),
    Criterion(
        "M6.2",
        "Speciations (splits on the island) per inhabited sim-month, median of seeds",
        "speciation.per_month.median",
        low=SPLITS_PER_MONTH_TARGET,
    ),
]


# --- Measurements -----------------------------------------------------------------------


def _stack(run: Run, name: str) -> np.ndarray:
    return np.stack([run.series[seed][name] for seed in run.manifest.seeds])


def _times(run: Run) -> np.ndarray:
    return run.series[run.manifest.seeds[0]][TIME_KEY]


def _rate_per_month(run: Run, name: str) -> tuple[np.ndarray, np.ndarray]:
    """Monthly increments of a cumulative series: (month-end times, [seed, month])."""
    times = _times(run)
    months = int(run.manifest.sim_years * 12)
    edges = [int(np.argmin(np.abs(times - m / 12.0))) for m in range(months + 1)]
    return times[edges[1:]], np.diff(_stack(run, name)[:, edges], axis=1)


def daily(run: Run, seed: int) -> np.ndarray:
    """Species alive after each day's census of ``seed``."""
    return run.series[seed][EXTRA_PREFIX + "species_daily"].astype(np.int64)


def phylogeny(run: Run, seed: int) -> np.ndarray:
    return run.series[seed][EXTRA_PREFIX + "phylogeny"].reshape(-1, len(PHYLOGENY_COLUMNS))


def names(run: Run, seed: int) -> list[str]:
    return [str(n) for n in run.series[seed][EXTRA_PREFIX + "species_names"]]


def inhabited_days(alive: np.ndarray) -> np.ndarray:
    """Days from the first census with a species alive to the end; empty if none."""
    first = np.flatnonzero(alive > 0)
    return alive[first[0] :] if first.size else alive[:0]


def in_band_share(alive: np.ndarray) -> float:
    """Share of inhabited days with ``ALIVE_BAND`` species alive (NaN if never inhabited)."""
    days = inhabited_days(alive)
    if days.size == 0:
        return np.nan
    low, high = ALIVE_BAND
    return float(np.mean((days >= low) & (days <= high)))


def per_seed(run: Run) -> dict[str, np.ndarray]:
    """One value per seed of each outcome, in seed order."""
    seeds = run.manifest.seeds
    shares, splits, arrivals, losses, months, ever, below, above = ([] for _ in range(8))
    for seed in seeds:
        alive = daily(run, seed)
        days = inhabited_days(alive)
        month_count = days.size / DAYS_PER_MONTH
        table = phylogeny(run, seed)
        split = int(np.count_nonzero(table[:, _P["parent"]] > 0))
        arrived = table.shape[0] - split
        extinct = int(np.count_nonzero(table[:, _P["extinct_day"]] >= 0))
        shares.append(in_band_share(alive))
        months.append(month_count)
        splits.append(split / month_count if month_count else np.nan)
        arrivals.append(arrived / month_count if month_count else np.nan)
        losses.append(extinct / month_count if month_count else np.nan)
        ever.append(float(table.shape[0]))
        below.append(float(np.mean(days < ALIVE_BAND[0])) if days.size else np.nan)
        above.append(float(np.mean(days > ALIVE_BAND[1])) if days.size else np.nan)
    return {
        "in_band": np.array(shares),
        "below": np.array(below),
        "above": np.array(above),
        "months": np.array(months),
        "splits": np.array(splits),
        "arrivals": np.array(arrivals),
        "extinctions": np.array(losses),
        "ever": np.array(ever),
    }


def lifespans(run: Run) -> dict[str, np.ndarray]:
    """Days each species lived (to the end of the run if still alive), pooled over seeds:
    species that split off on the island and species that arrived."""
    end_day = run.manifest.sim_years * DAYS_PER_YEAR
    split: list[float] = []
    arrived: list[float] = []
    for seed in run.manifest.seeds:
        table = phylogeny(run, seed)
        extinct = table[:, _P["extinct_day"]]
        lived = np.where(extinct >= 0, extinct, end_day) - table[:, _P["born_day"]]
        split += lived[table[:, _P["parent"]] > 0].tolist()
        arrived += lived[table[:, _P["parent"]] == 0].tolist()
    return {"split": np.array(split), "arrived": np.array(arrived)}


def largest_burst(table: np.ndarray, days: float = BURST_DAYS) -> int:
    """Most daughters one species gave rise to within ``days`` (0 without splits)."""
    best = 0
    split = table[table[:, _P["parent"]] > 0]
    for parent in np.unique(split[:, _P["parent"]]).tolist():
        born = np.sort(split[split[:, _P["parent"]] == parent, _P["born_day"]])
        within = np.searchsorted(born, born + days, side="left") - np.arange(born.size)
        best = max(best, int(within.max()))
    return best


def metrics(run: Run) -> dict[str, float]:
    seeds = per_seed(run)
    alive = np.concatenate([inhabited_days(daily(run, s)) for s in run.manifest.seeds])
    lived = lifespans(run)
    out: dict[str, float] = {
        "species_alive.in_band.share_of_time.median": float(np.nanmedian(seeds["in_band"])),
        "species_alive.in_band.share_of_time.p10": float(np.nanpercentile(seeds["in_band"], 10)),
        "species_alive.in_band.share_of_time.min": float(np.nanmin(seeds["in_band"])),
        "species_alive.in_band.share_of_seeds_at_target": float(
            np.mean(seeds["in_band"] >= SHARE_TARGET)
        ),
        "species_alive.below_band.share_of_time.median": float(np.nanmedian(seeds["below"])),
        "species_alive.above_band.share_of_time.median": float(np.nanmedian(seeds["above"])),
        "species_alive.median": float(np.median(alive)) if alive.size else np.nan,
        "species_alive.p10": float(np.percentile(alive, 10)) if alive.size else np.nan,
        "species_alive.p90": float(np.percentile(alive, 90)) if alive.size else np.nan,
        "speciation.per_month.median": float(np.nanmedian(seeds["splits"])),
        "speciation.per_month.p10": float(np.nanpercentile(seeds["splits"], 10)),
        "speciation.per_month.p90": float(np.nanpercentile(seeds["splits"], 90)),
        "speciation.share_of_seeds_with_any": float(np.mean(seeds["splits"] > 0)),
        "arrivals.per_month.median": float(np.nanmedian(seeds["arrivals"])),
        "extinctions.per_month.median": float(np.nanmedian(seeds["extinctions"])),
        "species_ever.per_seed.median": float(np.median(seeds["ever"])),
        "speciation.largest_burst.median": float(
            np.median([largest_burst(phylogeny(run, s)) for s in run.manifest.seeds])
        ),
        "speciation.largest_burst.max": float(
            max(largest_burst(phylogeny(run, s)) for s in run.manifest.seeds)
        ),
        "inhabited.months.median": float(np.median(seeds["months"])),
    }
    for kind, values in by_diet(run).items():
        out[f"{kind}.splits"] = values["split"]
        out[f"{kind}.seeds_with_splits"] = values["seeds_with_splits"]
    for kind, values in lived.items():
        if values.size:
            out[f"lifespan_days.{kind}.median"] = float(np.median(values))
            out[f"lifespan_days.{kind}.p90"] = float(np.percentile(values, 90))
            out[f"lifespan_days.{kind}.count"] = float(values.size)
    return out


# --- Sections ---------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _diet_limits(run: Run) -> tuple[float, float]:
    try:
        fauna = parse_config(run.config_text).fauna
    except ConfigError:
        return DIET_LIMITS
    return fauna.herbivore_max_diet, fauna.predator_min_diet


def _diet_class(diet: float, limits: tuple[float, float]) -> str:
    if diet <= limits[0]:
        return "herbivores"
    return "predators" if diet >= limits[1] else "omnivores"


def _count_section(run: Run) -> Section:
    seeds = run.manifest.seeds
    length = min(daily(run, s).size for s in seeds)
    alive = np.stack([daily(run, s)[:length] for s in seeds]).astype(float)
    days = (np.arange(length) + 1) / DAYS_PER_YEAR
    fig = figures.time_series_band(
        days, alive, title="Species alive", xlabel="sim time (years)", ylabel="species",
        integer_y=True,
    )  # fmt: skip
    ax = fig.axes[0]
    for bound in ALIVE_BAND:
        ax.axhline(bound, color=style.TEXT_SECONDARY, linewidth=0.8, linestyle=":")
    body = _svg(
        f"Species alive after each daily census: median and 10–90 % band across {len(seeds)} "
        f"seeds; dotted lines mark the target band ({ALIVE_BAND[0]}–{ALIVE_BAND[1]}). The "
        "island is empty until the founders land.",
        fig,
    )
    shares = per_seed(run)["in_band"]
    fig = figures.distribution(
        shares[np.isfinite(shares)],
        title="Inhabited time with 3–12 species alive",
        xlabel="share of inhabited days, per seed",
        bins=np.linspace(0.0, 1.0, 21).tolist(),
    )
    body += _svg("Per seed: share of inhabited days in the target band (M6.1).", fig)
    return Section("Species count", body)


def _rates_section(run: Run) -> Section:
    body = ""
    for name, note in (
        ("species_splits", "Splits: a species born on the island from a parent species."),
        ("species_arrivals", "Arrivals: a group of strangers (or the founders) landing."),
        ("species_extinctions", "Extinctions: the last member of a species died."),
    ):
        months, rate = _rate_per_month(run, name)
        label = SERIES_LABELS[name]
        fig = figures.time_series_band(
            months, rate, title=f"{label.title} per sim-month", xlabel="sim time (years)",
            ylabel="per sim-month",
        )  # fmt: skip
        body += _svg(f"{label.title} per sim-month: median and 10–90 % band. {note}", fig)
    seeds = per_seed(run)
    fig = figures.bars_with_spread(
        ["splits", "arrivals", "extinctions"],
        [seeds["splits"], seeds["arrivals"], seeds["extinctions"]],
        title="Species births and deaths per inhabited sim-month",
        ylabel="per sim-month",
    )
    body += _svg(
        "Per seed, averaged over its inhabited months: bars at the median, whiskers over "
        "the 10–90 % band. M6.2 is the splits bar.",
        fig,
    )
    lived = lifespans(run)
    pooled = [v for v in lived.values() if v.size]
    if pooled:
        fig, ax = plt.subplots()
        top = max(float(np.concatenate(pooled).max()), 1.0)
        bins = np.geomspace(1.0, top + 1.0, 25).tolist()
        for slot, (kind, values) in enumerate(lived.items()):
            if values.size:
                ax.hist(values + 1.0, bins=bins, histtype="step", linewidth=1.5,
                        color=style.categorical(slot), label=f"{kind} ({values.size})")  # fmt: skip
        ax.set_xscale("log")
        ax.set_title("How long species last")
        ax.set_xlabel("days lived + 1 (to the end of the run if alive)")
        ax.set_ylabel("species")
        ax.legend(loc="best")
        fig.tight_layout()
        body += _svg("Lifespans of species, pooled over all seeds, log scale.", fig)
    return Section("Speciation and extinction", body)


def by_diet(run: Run) -> dict[str, dict[str, float]]:
    """Per founding diet class, pooled over seeds: species, how they began, size, depth."""
    limits = _diet_limits(run)
    out: dict[str, dict[str, float]] = {}
    for kind in m4.DIETS:
        species = arrived = split = depth = 0
        peaks: list[float] = []
        seeds_split = 0
        for seed in run.manifest.seeds:
            table = phylogeny(run, seed)
            parent = {int(r[_P["id"]]): int(r[_P["parent"]]) for r in table}
            mine = [r for r in table if _diet_class(float(r[_P["diet"]]), limits) == kind]
            species += len(mine)
            splits_here = sum(1 for r in mine if r[_P["parent"]] > 0)
            split += splits_here
            seeds_split += splits_here > 0
            arrived += len(mine) - splits_here
            peaks += [float(r[_P["peak"]]) for r in mine]
            for r in mine:
                k, up = 0, int(r[_P["parent"]])
                while up:
                    k, up = k + 1, parent[up]
                depth = max(depth, k)
        out[kind] = {
            "species": float(species),
            "arrived": float(arrived),
            "split": float(split),
            "seeds_with_splits": float(seeds_split),
            "peak.median": float(np.median(peaks)) if peaks else np.nan,
            "depth.max": float(depth),
        }
    return out


def _diet_section(run: Run) -> Section:
    rows = "".join(
        f"<tr><td>{kind}</td><td>{v['species']:.0f}</td><td>{v['arrived']:.0f}</td>"
        f"<td>{v['split']:.0f}</td><td>{v['seeds_with_splits']:.0f}</td>"
        f"<td>{v['peak.median']:.0f}</td><td>{v['depth.max']:.0f}</td></tr>"
        for kind, v in by_diet(run).items()
    )
    body = (
        '<p class="note">Every species of every seed, by the diet class of its founding mean '
        "genome. Depth is how many splits separate a species from its root. Predator "
        "species split from smaller groups (<code>predator_min_members</code>) because "
        "their numbers have their own cap.</p>"
        '<div class="wrap"><table><tr><th>Founding diet</th><th>Species</th><th>Arrived</th>'
        "<th>Born by a split</th><th>Seeds with a split</th><th>Median peak members</th>"
        f"<th>Deepest descent</th></tr>{rows}</table></div>"
    )
    return Section("By diet class", body)


def _tree_order(table: np.ndarray) -> list[int]:
    """Rows in depth-first order (roots and children by birth), so a daughter sits under
    its parent."""
    children: dict[int, list[int]] = {}
    for row in range(table.shape[0]):
        children.setdefault(int(table[row, _P["parent"]]), []).append(row)
    order: list[int] = []
    stack = list(reversed(children.get(0, [])))
    while stack:
        row = stack.pop()
        order.append(row)
        stack += reversed(children.get(int(table[row, _P["id"]]), []))
    return order


def tree_figure(
    table: np.ndarray, labels: list[str], years: float, limits: tuple[float, float], title: str
) -> Figure:
    """A phylogeny: one line per species over its life, coloured by founding diet, with a
    connector from its parent at its birth."""
    order = _tree_order(table)
    y_of = {int(table[row, _P["id"]]): y for y, row in enumerate(order)}
    fig, ax = plt.subplots(figsize=(7.0, max(2.4, 0.5 + 0.16 * len(order))))
    for row in order:
        species = int(table[row, _P["id"]])
        born = table[row, _P["born_day"]] / DAYS_PER_YEAR
        extinct = table[row, _P["extinct_day"]]
        end = extinct / DAYS_PER_YEAR if extinct >= 0 else years
        peak = table[row, _P["peak"]]
        colour = m4.DIET_COLOURS[_diet_class(float(table[row, _P["diet"]]), limits)]
        y = y_of[species]
        ax.plot([born, max(end, born + 2.0 / DAYS_PER_YEAR)], [y, y], color=colour,
                linewidth=0.8 + 1.2 * np.log10(max(peak, 1.0)), solid_capstyle="butt")  # fmt: skip
        parent = int(table[row, _P["parent"]])
        if parent:
            ax.plot([born, born], [y_of[parent], y], color=style.NEUTRAL, linewidth=0.8)
        if peak >= LABELLED_PEAK:
            ax.annotate(labels[row], (born, y), xytext=(2, 3), textcoords="offset points",
                        fontsize=7, color=style.TEXT_SECONDARY)  # fmt: skip
    for name, colour in m4.DIET_COLOURS.items():
        ax.plot([], [], color=colour, linewidth=2.0, label=name)
    ax.set_xlim(0.0, years)
    ax.set_ylim(len(order) - 0.5 + 1.0, -1.0)
    ax.set_yticks([])
    ax.grid(axis="y", visible=False)
    ax.set_title(title)
    ax.set_xlabel("sim time (years)")
    ax.legend(loc="lower left", fontsize=7)
    fig.tight_layout()
    return fig


def tree_seeds(run: Run) -> tuple[list[int], int]:
    """Representative seeds (in-band share nearest the median) and the worst seed."""
    seeds = run.manifest.seeds
    shares = np.nan_to_num(per_seed(run)["in_band"], nan=-1.0)
    worst = seeds[int(np.argmin(shares))]
    median = float(np.median(shares))
    ranked = sorted(
        (s for s in seeds if s != worst), key=lambda s: (abs(shares[seeds.index(s)] - median), s)
    )
    return ranked[:TREE_SEEDS], worst


def _tree_section(run: Run) -> Section:
    limits = _diet_limits(run)
    chosen, worst = tree_seeds(run)
    body = (
        '<p class="note">One line per species, from its appearance to its extinction, '
        "thicker for species that grew larger; the colour is its founding diet class. "
        "A grey connector joins a daughter to its parent at the split. Roots are arrivals "
        f"(founders or strangers). Species that reached {LABELLED_PEAK} members are "
        "named.</p>"
    )
    shares = dict(zip(run.manifest.seeds, per_seed(run)["in_band"], strict=True))
    rows: list[str] = []
    for seed in [*chosen, worst]:
        table, labels = phylogeny(run, seed), names(run, seed)
        kind = "worst seed" if seed == worst else "representative seed"
        title = f"Seed {seed} ({kind}): {table.shape[0]} species"
        fig = tree_figure(table, labels, run.manifest.sim_years, limits, title)
        body += _svg(
            f"Phylogeny of seed {seed}, the {kind}: {shares[seed]:.0%} of inhabited days "
            "in the target band.",
            fig,
        )
        biggest = np.argsort(-table[:, _P["peak"]], kind="stable")[:NAME_SAMPLES]
        for row in sorted(biggest.tolist()):
            parent = int(table[row, _P["parent"]])
            extinct = table[row, _P["extinct_day"]]
            rows.append(
                "<tr>"
                f"<td>{seed}</td><td>{html.escape(labels[row])}</td>"
                f"<td>{html.escape(labels[parent - 1]) if parent else 'arrived'}</td>"
                f"<td>{table[row, _P['born_day']]:.0f}</td>"
                f"<td>{'alive' if extinct < 0 else f'{extinct:.0f}'}</td>"
                f"<td>{table[row, _P['peak']]:.0f}</td>"
                f"<td>{_diet_class(float(table[row, _P['diet']]), limits)}</td>"
                "</tr>"
            )
    body += (
        f'<h3>Name samples</h3><p class="note">The {NAME_SAMPLES} largest species of each '
        "seed above, in order of appearance. A daughter keeps the first two syllables of "
        "its parent's name.</p>"
        '<div class="wrap"><table><tr><th>Seed</th><th>Species</th><th>Parent</th>'
        "<th>Born (day)</th><th>Extinct (day)</th><th>Peak members</th>"
        "<th>Founding diet</th></tr>" + "".join(rows) + "</table></div>"
    )
    return Section("Phylogeny", body)


def _interpretation_section(run: Run) -> Section:
    """What the plots show, in words; every number is computed from this run."""
    m = metrics(run)
    share = m["species_alive.in_band.share_of_time.median"]
    below = m["species_alive.below_band.share_of_time.median"]
    above = m["species_alive.above_band.share_of_time.median"]
    splits = m["speciation.per_month.median"]
    arrivals = m["arrivals.per_month.median"]
    lost = m["extinctions.per_month.median"]
    with_splits = m["speciation.share_of_seeds_with_any"]
    count_text = (
        f"The median seed spends {share:.0%} of its inhabited days with "
        f"{ALIVE_BAND[0]}–{ALIVE_BAND[1]} species alive; {below:.0%} below the band and "
        f"{above:.0%} above it. Across all inhabited days the number alive has a median "
        f"of {m['species_alive.median']:.0f} (10–90 %: {m['species_alive.p10']:.0f}–"
        f"{m['species_alive.p90']:.0f})."
    )
    split_life = m.get("lifespan_days.split.median", np.nan)
    arrived_life = m.get("lifespan_days.arrived.median", np.nan)
    items = [
        ("How many species live at once.", count_text),
        (
            "Where species come from.",
            f"Per inhabited sim-month the median seed sees {splits:.2f} splits and "
            f"{arrivals:.2f} arrivals, and loses {lost:.2f} species. "
            f"{with_splits:.0%} of seeds saw at least one split. "
            + (
                "Most new species are strangers landing, not divergence on the island."
                if arrivals > splits
                else "Divergence on the island makes more species than arrivals do."
            ),
        ),
        (
            "Splits come in bursts.",
            f"The largest burst of a seed (daughters of one species born within "
            f"{BURST_DAYS:.0f} days) has a median of "
            f"{m['speciation.largest_burst.median']:.0f} and reaches "
            f"{m['speciation.largest_burst.max']:.0f}: when a herd has spread wide enough, "
            "it breaks into several clusters within weeks rather than one at a time. Species are "
            "clusters a little coarser than parent and young differ (ADR 0012), so their "
            "number follows how widely the herd has spread genetically.",
        ),
        (
            "How long they last.",
            (
                f"Arrived species live a median of {arrived_life:.0f} days"
                if np.isfinite(arrived_life)
                else "No species arrived"
            )
            + (
                f", species born by a split {split_life:.0f} days."
                if np.isfinite(split_life)
                else "; no species was born by a split."
            ),
        ),
    ]
    body = (
        '<p class="note">Written by the report tool from the numbers of this run; the design '
        "is in docs/design/creatures.md (Species) and ADR 0012.</p><ul>"
        + "".join(f"<li><strong>{head}</strong> {text}</li>" for head, text in items)
        + "</ul>"
    )
    return Section("What the plots show", body)


def sections(run: Run, run_dir: Path) -> list[Section]:
    del run_dir  # M6 draws no maps
    style.apply_style()
    return [
        _interpretation_section(run),
        _count_section(run),
        _rates_section(run),
        _diet_section(run),
        _tree_section(run),
    ]
