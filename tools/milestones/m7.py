"""M7 — Rare genes (creatures and plants): metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8): every rare gene appears in ≥ 30 % of 3-year seeds (M7.1); none
reaches fixation (> 90 % of the population) for more than 3 sim-months in ≥ 90 % of seeds
(M7.2).

Readings used here:

- **Appears**: at least one carrier (creatures) or one vegetated cell carrying it (plants)
  on some day of the run. M7.1 takes, per gene, the share of seeds where it appeared, and
  passes if the gene with the lowest share is at 30 % or more.
- **Population**: for a creature gene, the living creatures of that day; for a plant gene,
  the vegetated cells. A day with nobody alive has no share. Fixation is a run of
  consecutive days with the carriers' share above 90 %; a seed fails M7.2 if any gene has
  such a run longer than 3 sim-months (91 days). M7.2 is the share of seeds that do not.
- **Persistence** (of a gene in the lineages that carry it): an episode runs from a day
  with carriers after a day without to the last day with carriers. Each episode starts
  with gains (mutations) and lasts as long as inheritance keeps it.
- **Carrier lifespan**: days between the first and the last daily census a creature was
  seen in, for creatures born on the island whose death was seen.
"""

from __future__ import annotations

import html
from pathlib import Path

import numpy as np
from lineage_sim.flora import Rare as PlantRare
from lineage_sim.rare import CREATURE_GENES, PLANT_GENES, CreatureRare
from matplotlib.figure import Figure

from tools.fastforward import DAYS_PER_YEAR, EXTRA_PREFIX, LIVES_COLUMNS, RARE_DAILY_COLUMNS
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import Run
from tools.viz import figures, style

APPEAR_TARGET = 0.3
FIXATION_SHARE = 0.9
FIXATION_DAYS = 91  # three sim-months
NO_FIXATION_TARGET = 0.9
PLOT_EVERY_DAYS = 7  # daily shares are thinned to weekly points for the time plots

_C = {name: i for i, name in enumerate(RARE_DAILY_COLUMNS)}
_L = {name: i for i, name in enumerate(LIVES_COLUMNS)}

SERIES_LABELS: dict[str, SeriesLabel] = {}

CRITERIA: list[Criterion] = [
    Criterion(
        "M7.1",
        "Share of seeds in which the rarest-appearing rare gene appears (lowest over all "
        "creature and plant genes)",
        "appearance.share_of_seeds.min",
        low=APPEAR_TARGET,
    ),
    Criterion(
        "M7.2",
        f"Share of seeds where no rare gene stays above {FIXATION_SHARE:.0%} of its population "
        f"for more than {FIXATION_DAYS} days",
        "fixation.share_of_seeds_without_long_fixation",
        low=NO_FIXATION_TARGET,
    ),
]


def gene_name(gene: CreatureRare | PlantRare) -> str:
    return (gene.name or "").lower()


def plant_key(gene: PlantRare) -> str:
    return f"plant_{gene_name(gene)}"


GENE_KEYS: list[str] = [gene_name(g) for g in CREATURE_GENES] + [plant_key(g) for g in PLANT_GENES]


def label(key: str) -> str:
    """Display name of a gene key: 'venom', 'poisonous (plant)'."""
    return f"{key.removeprefix('plant_')} (plant)" if key.startswith("plant_") else key


def colour(key: str) -> str:
    """One colour per gene within its kingdom (creature and plant panels are apart)."""
    plants = [plant_key(g) for g in PLANT_GENES]
    return style.categorical(plants.index(key) if key in plants else GENE_KEYS.index(key))


# --- Measurements -----------------------------------------------------------------------


def daily(run: Run, seed: int) -> np.ndarray:
    """The `RARE_DAILY_COLUMNS` table of ``seed``: one row per day."""
    return run.series[seed][EXTRA_PREFIX + "rare_daily"].reshape(-1, len(RARE_DAILY_COLUMNS))


def lives(run: Run, seed: int) -> np.ndarray:
    return run.series[seed][EXTRA_PREFIX + "lives"].reshape(-1, len(LIVES_COLUMNS))


def carriers(table: np.ndarray, key: str) -> np.ndarray:
    return table[:, _C[key]]


def population(table: np.ndarray, key: str) -> np.ndarray:
    return table[:, _C["vegetated" if key.startswith("plant_") else "creatures"]]


def share(table: np.ndarray, key: str) -> np.ndarray:
    """Carriers' share of their population each day; NaN on days with nobody."""
    total = population(table, key)
    with np.errstate(invalid="ignore", divide="ignore"):
        return np.where(total > 0, carriers(table, key) / total, np.nan)


def longest_run(flags: np.ndarray) -> int:
    """Length of the longest run of consecutive True values."""
    best = current = 0
    for flag in flags.tolist():
        current = current + 1 if flag else 0
        best = max(best, current)
    return best


def episodes(present: np.ndarray) -> np.ndarray:
    """Lengths (days) of the runs of consecutive days with carriers."""
    lengths: list[int] = []
    current = 0
    for flag in present.tolist():
        if flag:
            current += 1
        elif current:
            lengths.append(current)
            current = 0
    if current:
        lengths.append(current)
    return np.array(lengths, dtype=np.int64)


def per_gene(run: Run) -> dict[str, dict[str, np.ndarray]]:
    """Per gene, one value per seed: appeared (0/1), peak share, longest fixation run
    (days), episodes, median episode length, mean share over inhabited days."""
    out: dict[str, dict[str, list[float]]] = {key: {} for key in GENE_KEYS}
    for seed in run.manifest.seeds:
        table = daily(run, seed)
        for key in GENE_KEYS:
            shares = share(table, key)
            present = carriers(table, key) > 0
            runs = episodes(present)
            values = {
                "appeared": float(present.any()),
                "peak": float(np.nanmax(shares)) if np.isfinite(shares).any() else 0.0,
                "fixation_days": float(longest_run(np.nan_to_num(shares) > FIXATION_SHARE)),
                "episodes": float(runs.size),
                "episode_days": float(np.median(runs)) if runs.size else 0.0,
                "mean_share": float(np.nanmean(shares)) if np.isfinite(shares).any() else 0.0,
            }
            for name, value in values.items():
                out[key].setdefault(name, []).append(value)
    # Rounded so that bar labels stay short.
    return {k: {n: np.round(np.array(v), 3) for n, v in d.items()} for k, d in out.items()}


def fixation_free(run: Run) -> np.ndarray:
    """Per seed: True if no gene stayed above the fixation share for too long."""
    genes = per_gene(run)
    worst = np.max(np.stack([genes[key]["fixation_days"] for key in GENE_KEYS]), axis=0)
    return worst <= FIXATION_DAYS


def lifespans(run: Run) -> dict[str, np.ndarray]:
    """Days lived by creatures born on the island, pooled over seeds: 'none' (no rare
    gene) and each creature gene's carriers."""
    rows = np.concatenate([lives(run, s) for s in run.manifest.seeds])
    born_here = rows[rows[:, _L["arrived"]] == 0]
    lived = born_here[:, _L["last_day"]] - born_here[:, _L["first_day"]] + 1
    slots = born_here[:, _L["slots"]].astype(np.int64)
    out = {"none": lived[slots == 0]}
    for gene in CREATURE_GENES:
        out[gene_name(gene)] = lived[(slots & int(gene)) != 0]
    return out


def by_diet(run: Run) -> dict[str, dict[str, float]]:
    """Per creature gene: carriers' share among herbivores and among predators, pooled
    over all days of a seed, median of seeds."""
    out: dict[str, dict[str, float]] = {}
    for gene in CREATURE_GENES:
        key = gene_name(gene)
        values: dict[str, list[float]] = {"herbivores": [], "predators": []}
        for seed in run.manifest.seeds:
            table = daily(run, seed)
            for kind in values:
                total = float(table[:, _C[kind]].sum())
                if total > 0:
                    values[kind].append(float(table[:, _C[f"{key}_{kind}"]].sum()) / total)
        out[key] = {k: float(np.median(v)) if v else np.nan for k, v in values.items()}
    return out


def metrics(run: Run) -> dict[str, float]:
    genes = per_gene(run)
    appeared = {key: float(genes[key]["appeared"].mean()) for key in GENE_KEYS}
    rarest = min(appeared, key=lambda k: appeared[k])
    out: dict[str, float] = {
        "appearance.share_of_seeds.min": appeared[rarest],
        "appearance.genes_below_target": float(
            sum(value < APPEAR_TARGET for value in appeared.values())
        ),
        "fixation.share_of_seeds_without_long_fixation": float(fixation_free(run).mean()),
    }
    for key in GENE_KEYS:
        g = genes[key]
        out[f"{key}.appeared.share_of_seeds"] = appeared[key]
        out[f"{key}.peak_share.median"] = float(np.median(g["peak"]))
        out[f"{key}.peak_share.max"] = float(np.max(g["peak"]))
        out[f"{key}.mean_share.median"] = float(np.median(g["mean_share"]))
        out[f"{key}.fixation_days.max"] = float(np.max(g["fixation_days"]))
        out[f"{key}.seeds_with_long_fixation"] = float(np.sum(g["fixation_days"] > FIXATION_DAYS))
        out[f"{key}.episodes.median"] = float(np.median(g["episodes"]))
        out[f"{key}.episode_days.median"] = float(np.median(g["episode_days"]))
    for kind, lived in lifespans(run).items():
        out[f"lifespan_days.{kind}.count"] = float(lived.size)
        if lived.size:
            out[f"lifespan_days.{kind}.median"] = float(np.median(lived))
    for key, values in by_diet(run).items():
        for kind, value in values.items():
            if np.isfinite(value):
                out[f"{key}.share_among_{kind}.median"] = value
    return out


# --- Sections ---------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _weekly(run: Run, key: str) -> tuple[np.ndarray, np.ndarray]:
    """Weekly shares of ``key``: (times in years, [seed, week])."""
    tables = [daily(run, s) for s in run.manifest.seeds]
    length = min(t.shape[0] for t in tables)
    picks = np.arange(0, length, PLOT_EVERY_DAYS)
    values = np.stack([share(t[:length], key)[picks] for t in tables])
    return (picks + 1) / DAYS_PER_YEAR, values


def _appearance_section(run: Run) -> Section:
    genes = per_gene(run)
    shares = [float(genes[key]["appeared"].mean()) for key in GENE_KEYS]
    fig = figures.grouped_bars(
        [label(k) for k in GENE_KEYS],
        {"seeds where it appeared": shares},
        {"seeds where it appeared": style.SERIES},
        title="Where each rare gene appeared",
        ylabel="share of seeds",
        reference=(APPEAR_TARGET, "M7.1 target"),
    )
    body = _svg(
        f"Share of the {len(run.manifest.seeds)} seeds in which each gene had a carrier on "
        "some day (M7.1 passes if every bar reaches the dashed line).",
        fig,
    )
    return Section("Appearance", body)


def _trajectory_section(run: Run) -> Section:
    body = ""
    for kingdom, keys, population_name in (
        ("Creature", [gene_name(g) for g in CREATURE_GENES], "living creatures"),
        ("Plant", [plant_key(g) for g in PLANT_GENES], "vegetated cells"),
    ):
        times = np.array([])
        panels: dict[str, tuple[np.ndarray, str]] = {}
        for key in keys:
            times, values = _weekly(run, key)
            panels[label(key)] = (values, colour(key))
        fig = figures.band_panels(
            times, panels, xlabel="sim time (years)", ylabel=f"share of {population_name}",
            columns=4 if kingdom == "Creature" else 3,
        )  # fmt: skip
        body += _svg(
            f"{kingdom} rare genes: carriers' share of the {population_name}, weekly, median "
            "and 10–90 % band across seeds (shared axes).",
            fig,
        )
    return Section("Frequency trajectories", body)


def _fixation_section(run: Run) -> Section:
    genes = per_gene(run)
    fig = figures.bars_with_spread(
        [label(k) for k in GENE_KEYS],
        [genes[key]["fixation_days"] for key in GENE_KEYS],
        title=f"Longest stay above {FIXATION_SHARE:.0%} of the population",
        ylabel="days",
    )
    fig.axes[0].axhline(FIXATION_DAYS, color=style.TEXT_PRIMARY, linewidth=1.0, linestyle="--")
    fig.axes[0].tick_params(axis="x", labelrotation=35)
    fig.tight_layout()
    body = _svg(
        f"Per seed, the longest run of days in which a gene's carriers made up more than "
        f"{FIXATION_SHARE:.0%} of its population: bars at the median, whiskers over the "
        f"10–90 % band; the dashed line is {FIXATION_DAYS} days (M7.2).",
        fig,
    )
    peaks = [genes[key]["peak"] for key in GENE_KEYS]
    fig = figures.bars_with_spread(
        [label(k) for k in GENE_KEYS], peaks, title="Highest share reached", ylabel="share"
    )
    fig.axes[0].tick_params(axis="x", labelrotation=35)
    fig.tight_layout()
    body += _svg("Per seed, the highest daily share each gene reached.", fig)
    return Section("Fixation", body)


def _persistence_section(run: Run) -> Section:
    genes = per_gene(run)
    fig = figures.bars_with_spread(
        [label(k) for k in GENE_KEYS],
        [genes[key]["episode_days"] for key in GENE_KEYS],
        title="How long a gene stays once it appears",
        ylabel="days (median episode of a seed)",
    )
    fig.axes[0].tick_params(axis="x", labelrotation=35)
    fig.tight_layout()
    body = _svg(
        "Episodes: runs of days with at least one carrier, from the gains that start them to "
        "the death of the last carrier. Per seed the median episode; bars at the median of "
        "seeds, whiskers over the 10–90 % band.",
        fig,
    )
    lived = lifespans(run)
    keys = list(lived)
    fig = figures.grouped_bars(
        keys,
        {
            "median days lived": [
                float(np.median(lived[k])) if lived[k].size else None for k in keys
            ]
        },
        {"median days lived": style.SERIES},
        title="Lifespan of carriers",
        ylabel="days",
    )
    counts = ", ".join(f"{k} {lived[k].size}" for k in keys)
    body += _svg(
        "Median days lived by creatures born on the island, pooled over seeds: without rare "
        f"genes ('none') and carriers of each gene (deaths seen: {counts}).",
        fig,
    )
    return Section("Persistence and carrier lifespan", body)


def _diet_section(run: Run) -> Section:
    diet = by_diet(run)
    keys = list(diet)
    fig = figures.grouped_bars(
        keys,
        {
            kind: [None if np.isnan(diet[k][kind]) else diet[k][kind] for k in keys]
            for kind in ("herbivores", "predators")
        },
        {"herbivores": style.categorical(0), "predators": style.categorical(3)},
        title="Where each creature gene is carried",
        ylabel="share of carriers",
    )
    body = _svg(
        "Carriers' share among herbivores and among predators, pooled over the days of a "
        "seed, median of seeds: which genes pay in which way of life.",
        fig,
    )
    return Section("Which genes dominate where", body)


def _interpretation_section(run: Run) -> Section:
    """What the plots show, in words; every number is computed from this run."""
    m = metrics(run)
    genes = per_gene(run)
    appeared = {key: m[f"{key}.appeared.share_of_seeds"] for key in GENE_KEYS}
    rarest = min(appeared, key=lambda k: appeared[k])
    common = sorted(GENE_KEYS, key=lambda k: -m[f"{k}.mean_share.median"])[:3]
    fixers = [k for k in GENE_KEYS if m[f"{k}.seeds_with_long_fixation"] > 0]
    lived = lifespans(run)
    plain = float(np.median(lived["none"])) if lived["none"].size else np.nan
    longer = [
        k for k in lived if k != "none" and lived[k].size >= 20 and np.median(lived[k]) > plain
    ]
    diet = by_diet(run)
    hunters = [k for k, v in diet.items() if v["predators"] > 2 * max(v["herbivores"], 1e-9)]
    items = [
        (
            "Every gene turns up.",
            f"The least common, {label(rarest)}, appeared in {appeared[rarest]:.0%} of seeds; "
            f"{int(m['appearance.genes_below_target'])} gene(s) stay below the "
            f"{APPEAR_TARGET:.0%} target.",
        ),
        (
            "The commonest.",
            "Averaged over a seed's days, the most widespread genes are "
            + ", ".join(f"{label(k)} ({m[f'{k}.mean_share.median']:.1%})" for k in common)
            + " (median of seeds).",
        ),
        (
            "Fixation.",
            (
                "No gene held more than "
                f"{FIXATION_SHARE:.0%} of its population for over {FIXATION_DAYS} days."
                if not fixers
                else "Genes that held more than "
                f"{FIXATION_SHARE:.0%} for over {FIXATION_DAYS} days in some seed: "
                + ", ".join(
                    f"{label(k)} ({int(m[f'{k}.seeds_with_long_fixation'])} seeds, longest "
                    f"{m[f'{k}.fixation_days.max']:.0f} days)"
                    for k in fixers
                )
                + "."
            )
            + f" {m['fixation.share_of_seeds_without_long_fixation']:.0%} of seeds are free of "
            "long fixation (M7.2).",
        ),
        (
            "Persistence.",
            "Median episode lengths (days): "
            + ", ".join(
                f"{label(k)} {float(np.median(genes[k]['episode_days'])):.0f}" for k in GENE_KEYS
            )
            + ".",
        ),
        (
            "Carrier lifespans.",
            f"Creatures without rare genes live a median of {plain:.0f} days; "
            + (
                "carriers that live longer (at least 20 deaths seen): "
                + ", ".join(f"{k} {float(np.median(lived[k])):.0f}" for k in longer)
                if longer
                else "no gene's carriers live longer"
            )
            + ".",
        ),
        (
            "Ways of life.",
            (
                "Carried mostly by predators: " + ", ".join(hunters) + "."
                if hunters
                else "No creature gene is concentrated among predators."
            )
            + " Darkness does not fall before M8: glow brings only its cost here, and "
            "photosynthesis only its benefit (nights will starve it); hibernators sleep "
            "through winter only.",
        ),
    ]
    body = (
        '<p class="note">Written by the report tool from the numbers of this run; the gene '
        "tables are in docs/design/creatures.md and plants.md, decisions in ADR 0015.</p><ul>"
        + "".join(f"<li><strong>{head}</strong> {text}</li>" for head, text in items)
        + "</ul>"
    )
    return Section("What the plots show", body)


def sections(run: Run, run_dir: Path) -> list[Section]:
    del run_dir  # M7 draws no maps
    style.apply_style()
    return [
        _interpretation_section(run),
        _appearance_section(run),
        _trajectory_section(run),
        _fixation_section(run),
        _persistence_section(run),
        _diet_section(run),
    ]
