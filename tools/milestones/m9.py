"""M9 — Chronicle and bestiary: metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8): 2–15 notable entries per sim-month, median (M9.1); no event
type above 30 % of all entries (M9.2).

Readings used here (ADR 0017):

- **Notable** entries have importance 3 or more on the 1–5 scale (the config's
  ``notable_importance``); entries at ``major_importance`` (4) and above would be pushed
  to the phone (S4), reported beside them.
- **Per sim-month**: each seed's run is cut into months of 365.25 / 12 days from the
  world's creation; a seed's rate is the median of its monthly counts. M9.1 is the median
  of the seeds' rates. The months before the first creatures land count too: the island
  has a history before life.
- **Event type** is the entry's kind (`lineage_sim.chronicle.Kind`). M9.2 pools every
  seed's entries and passes if the most frequent kind holds at most 30 % of them; the
  share in the worst seed is reported beside it.
"""

from __future__ import annotations

import datetime as dt
import html
from pathlib import Path

import numpy as np
from lineage_sim.chronicle import KINDS, BestiaryRecord, Kind, span
from lineage_sim.config import ConfigError, parse_config
from lineage_sim.fauna.genome import Gene
from lineage_sim.rare import CREATURE_GENES
from lineage_sim.state import io
from lineage_sim.world import World
from matplotlib import pyplot as plt
from matplotlib.figure import Figure

from tools.fastforward import CHRONICLE_COLUMNS, DAY_MS, DAYS_PER_YEAR, EXTRA_PREFIX
from tools.milestones import m8
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.viz import figures, style

MONTHLY_BAND = (2.0, 15.0)
TYPE_SHARE_MAX = 0.30
DAYS_PER_MONTH = DAYS_PER_YEAR / 12.0
IMPORTANCE_LEVELS = (1, 2, 3, 4, 5)
IMPORTANCE_NAMES = {1: "background", 2: "minor", 3: "notable", 4: "major", 5: "historic"}
# Used when the run's config cannot be read (an older config).
DEFAULT_NOTABLE, DEFAULT_MAJOR = 3, 4

_C = {name: i for i, name in enumerate(CHRONICLE_COLUMNS)}

SERIES_LABELS: dict[str, SeriesLabel] = {}

CRITERIA: list[Criterion] = [
    Criterion(
        "M9.1",
        f"Notable entries (importance ≥ {DEFAULT_NOTABLE}) per sim-month: median of the "
        "seeds' median months",
        "notable.per_month.median",
        low=MONTHLY_BAND[0],
        high=MONTHLY_BAND[1],
    ),
    Criterion(
        "M9.2",
        "Share of all entries (every seed) held by the most frequent event type",
        "type_share.max",
        high=TYPE_SHARE_MAX,
    ),
]


# --- Measurements -----------------------------------------------------------------------


def thresholds(run: Run) -> tuple[int, int]:
    """(notable, major) importance of the run's config."""
    try:
        cfg = parse_config(run.config_text).chronicle
    except (ConfigError, KeyError):
        return DEFAULT_NOTABLE, DEFAULT_MAJOR
    return cfg.notable_importance, cfg.major_importance


def table(run: Run, seed: int) -> np.ndarray:
    return run.series[seed][EXTRA_PREFIX + "chronicle"].reshape(-1, len(CHRONICLE_COLUMNS))


def texts(run: Run, seed: int) -> list[str]:
    return [str(t) for t in run.series[seed][EXTRA_PREFIX + "chronicle_text"]]


def run_days(run: Run, seed: int) -> float:
    return float(run.series[seed][TIME_KEY][-1]) * DAYS_PER_YEAR


def monthly(run: Run, seed: int, least: int) -> np.ndarray:
    """Entries of importance ``least`` or more in each whole sim-month of the run."""
    rows = table(run, seed)
    months = int(run_days(run, seed) // DAYS_PER_MONTH)
    month = (rows[:, _C["day"]] // DAYS_PER_MONTH).astype(np.int64)
    keep = (rows[:, _C["importance"]] >= least) & (month < months)
    return np.bincount(month[keep], minlength=months)[:months].astype(np.float64)


def kind_counts(run: Run, seed: int) -> np.ndarray:
    kinds = table(run, seed)[:, _C["kind"]].astype(np.int64)
    return np.bincount(kinds, minlength=len(KINDS)).astype(np.float64)


def metrics(run: Run) -> dict[str, float]:
    notable, major = thresholds(run)
    seeds = run.manifest.seeds
    out: dict[str, float] = {"notable_importance": float(notable)}
    rates = np.array([np.median(monthly(run, s, notable)) for s in seeds])
    means = np.array([monthly(run, s, notable).mean() for s in seeds])
    majors = np.array([monthly(run, s, major).mean() for s in seeds])
    out |= _spread("notable.per_month", rates)
    out["notable.per_month.mean.median"] = float(np.median(means))
    out |= _spread("major.per_month.mean", majors)
    out["entries.per_seed.median"] = float(np.median([table(run, s).shape[0] for s in seeds]))
    counts = np.stack([kind_counts(run, s) for s in seeds])
    pooled = counts.sum(axis=0)
    total = max(1.0, float(pooled.sum()))
    out["type_share.max"] = float(pooled.max() / total)
    out["type_share.max.kind"] = float(pooled.argmax())
    per_seed = counts.max(axis=1) / np.maximum(1.0, counts.sum(axis=1))
    out["type_share.max.worst_seed"] = float(per_seed.max())
    out["type_share.seeds_above"] = float(np.count_nonzero(per_seed > TYPE_SHARE_MAX))
    for kind, n in zip(KINDS, pooled, strict=True):
        out[f"type_share.{kind.value}"] = float(n / total)
    levels = np.stack(
        [np.bincount(table(run, s)[:, _C["importance"]].astype(np.int64), minlength=6)[1:6]
         for s in seeds]
    )  # fmt: skip
    for level, column in zip(IMPORTANCE_LEVELS, levels.T, strict=True):
        out[f"importance_{level}.per_seed.median"] = float(np.median(column))
    out["seeds_in_band"] = float(
        np.count_nonzero((rates >= MONTHLY_BAND[0]) & (rates <= MONTHLY_BAND[1]))
    )
    return out


def _spread(name: str, values: np.ndarray) -> dict[str, float]:
    p10, median, p90 = np.percentile(values, [10, 50, 90])
    return {
        f"{name}.median": float(median), f"{name}.p10": float(p10), f"{name}.p90": float(p90),
        f"{name}.min": float(values.min()), f"{name}.max": float(values.max()),
    }  # fmt: skip


# --- Sections ---------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def representative_seed(run: Run) -> int:
    """The seed whose notable rate is nearest the median (lowest seed on a tie)."""
    notable, _ = thresholds(run)
    seeds = run.manifest.seeds
    means = np.array([monthly(run, s, notable).mean() for s in seeds])
    return seeds[int(np.argmin(np.abs(means - np.median(means))))]


def _sample_section(run: Run) -> Section:
    seed = representative_seed(run)
    notable, major = thresholds(run)
    rows, lines = table(run, seed), texts(run, seed)
    start = m8.start_of(run)
    body = [
        f"<p>Seed {seed}, the seed whose mean rate of notable entries is nearest the median: "
        f"its whole chronicle, {len(lines)} entries. The date is the calendar day (UTC) of "
        f"a world created on {start.isoformat()}. Importance: "
        + ", ".join(f"{k} {v}" for k, v in IMPORTANCE_NAMES.items())
        + f"; notable from {notable}, pushed to the phone from {major}. Background and minor "
        "entries are greyed, major ones in bold.</p>",
        '<table class="chronicle"><thead><tr><th>Date</th><th>Importance</th><th>Type</th>'
        "<th>Entry</th></tr></thead><tbody>",
    ]
    for row, text in zip(rows, lines, strict=True):
        day = start + dt.timedelta(days=int(row[_C["day"]]))
        importance = int(row[_C["importance"]])
        kind = KINDS[int(row[_C["kind"]])].value
        muted = ' style="color:#8a8984"' if importance < notable else ""
        strong = "<strong>{}</strong>" if importance >= major else "{}"
        body.append(
            f"<tr{muted}><td>{day.isoformat()}</td><td>{importance}</td><td>{kind}</td>"
            f"<td>{strong.format(html.escape(text))}</td></tr>"
        )
    body.append("</tbody></table>")
    return Section("A sample chronicle", "\n".join(body))


def _monthly_section(run: Run, values: dict[str, float]) -> Section:
    notable, major = thresholds(run)
    seeds = run.manifest.seeds
    series = [monthly(run, s, notable) for s in seeds]
    length = min(s.size for s in series)
    times = (np.arange(length) + 0.5) / 12.0
    over_time = figures.time_series_band(
        times, np.stack([s[:length] for s in series]),
        title="Notable entries per sim-month", xlabel="sim time (years)",
        ylabel="entries per month", integer_y=True,
    )  # fmt: skip
    for ax in over_time.axes:
        for bound in MONTHLY_BAND:
            ax.axhline(bound, color=style.NEUTRAL, linewidth=1.0, linestyle=":")
    rates = [float(np.median(s)) for s in series]
    per_seed = figures.distribution(
        rates, title="Each seed's median month", xlabel="notable entries per sim-month",
        bins=np.arange(0, max(rates) + 2, 1.0).tolist(),
    )  # fmt: skip
    pooled = np.concatenate(series)
    months = figures.distribution(
        pooled, title="Every month of every seed", xlabel="notable entries in the month",
        bins=np.arange(0, pooled.max() + 2, 1.0).tolist(),
    )  # fmt: skip
    months.axes[0].set_ylabel("seed-months")
    majors = [monthly(run, s, major) for s in seeds]
    pushes = figures.time_series_band(
        times, np.stack([m[:length] for m in majors]),
        title=f"Major entries (importance ≥ {major}) per sim-month", xlabel="sim time (years)",
        ylabel="entries per month", integer_y=True, colour=style.categorical(3),
    )  # fmt: skip
    body = (
        _svg(
            "Notable entries in each sim-month, median and 10–90 % band across seeds; dotted "
            f"lines mark the target band {MONTHLY_BAND[0]:g}–{MONTHLY_BAND[1]:g}. The first "
            "year is the island before life (plants, fires, the land).",
            over_time,
        )
        + _svg(
            f"M9.1 per seed: the median of its monthly counts. Median of seeds "
            f"{values['notable.per_month.median']:g}.",
            per_seed,
        )
        + _svg("Monthly counts pooled over seeds and months.", months)
        + _svg(
            "What the phone would be told (S4): major and historic entries per sim-month. "
            f"Mean per seed, median {values['major.per_month.mean.median']:.2g}.",
            pushes,
        )
    )
    return Section("Entries per month", body)


def _types_section(run: Run, values: dict[str, float]) -> Section:
    seeds = run.manifest.seeds
    counts = np.stack([kind_counts(run, s) for s in seeds])
    shares = counts / np.maximum(1.0, counts.sum(axis=1, keepdims=True))
    order = np.argsort(-counts.sum(axis=0), kind="stable")
    fig, ax = plt.subplots(figsize=(7.0, 3.6))
    pooled = counts.sum(axis=0) / max(1.0, float(counts.sum()))
    positions = np.arange(len(KINDS))
    low, high = np.percentile(shares, [10, 90], axis=0)
    ax.bar(positions, pooled[order], width=0.6, color=style.SERIES, label="all seeds pooled")
    below = np.maximum(0, pooled[order] - low[order])
    above = np.maximum(0, high[order] - pooled[order])
    ax.errorbar(
        positions, pooled[order], yerr=[below, above],
        fmt="none", ecolor=style.TEXT_PRIMARY, elinewidth=1.0, capsize=3,
        label="10–90 % of seeds",
    )  # fmt: skip
    ax.axhline(TYPE_SHARE_MAX, color=style.EVENT_TYPE["extinction"], linestyle=":",
               linewidth=1.0, label=f"{TYPE_SHARE_MAX:.0%} limit")  # fmt: skip
    ax.set_xticks(positions, [KINDS[k].value.replace("_", " ") for k in order], rotation=60,
                  ha="right")  # fmt: skip
    ax.set_ylabel("share of all entries")
    ax.set_title("Entries by event type")
    ax.grid(axis="x", visible=False)
    ax.legend(loc="best")
    fig.tight_layout()
    top = KINDS[int(values["type_share.max.kind"])]
    caption = (
        f"Share of each event type among all entries. The largest, {top.value}, holds "
        f"{values['type_share.max']:.1%} pooled, {values['type_share.max.worst_seed']:.1%} in "
        f"the worst seed ({values['type_share.seeds_above']:g} seeds above "
        f"{TYPE_SHARE_MAX:.0%})."
    )
    return Section("Event types", _svg(caption, fig))


def _importance_section(run: Run) -> Section:
    seeds = run.manifest.seeds
    per_level = [
        np.array([np.count_nonzero(table(run, s)[:, _C["importance"]] == level) for s in seeds])
        for level in IMPORTANCE_LEVELS
    ]
    labels = [f"{level} {IMPORTANCE_NAMES[level]}" for level in IMPORTANCE_LEVELS]
    fig = figures.bars_with_spread(
        labels, per_level, title="Entries by importance", ylabel="entries per seed"
    )
    return Section(
        "Importance",
        _svg(
            "Entries of each importance over the whole run, median per seed with the 10–90 % band.",
            fig,
        ),
    )


def _firsts_section(run: Run) -> Section:
    """When the island's firsts came: days from the world's creation, per seed."""
    seeds = run.manifest.seeds
    first = KINDS.index(Kind.FIRST_LIFE)
    days = []
    for s in seeds:
        rows = table(run, s)
        hit = rows[rows[:, _C["kind"]] == first]
        if hit.size:
            days.append(float(hit[0, _C["day"]]))
    if not days:
        return Section("First life", "<p>No seed saw its first creatures land.</p>")
    fig = figures.distribution(days, title="First creatures land", xlabel="sim day")
    return Section(
        "First life",
        _svg(
            "The day each seed's chronicle opens its story of life (first_life). Months "
            "before it hold the land's and plants' history.",
            fig,
        ),
    )


def bestiary(run: Run, run_dir: Path, seed: int) -> tuple[list[BestiaryRecord], int]:
    """The bestiary of ``seed``'s world at the end of the run (its last save), and the
    sim time of that save."""
    config = parse_config(run.config_text)
    state = io.loads((run_dir / "saves" / f"{seed}.lzma").read_bytes())
    world = World.restore(config, state)
    return world.chronicle.bestiary(), world.t_ms


def _rare_names(record: BestiaryRecord) -> str:
    names = [(g.name or "").lower().replace("_", " ") for g in CREATURE_GENES if record.rare & g]
    return ", ".join(names) or "—"


def _bestiary_section(run: Run, run_dir: Path) -> Section:
    seed = representative_seed(run)
    path = run_dir / "saves" / f"{seed}.lzma"
    if not path.exists():
        return Section("Bestiary", f"<p>No save of seed {seed} in the run: no bestiary.</p>")
    records, now_ms = bestiary(run, run_dir, seed)
    if not records:
        return Section("Bestiary", f"<p>No species lived in seed {seed}.</p>")
    start = m8.start_of(run)

    def date(t_ms: int) -> str:
        return (start + dt.timedelta(days=int(t_ms // DAY_MS))).isoformat()

    alive = sum(r.species.alive for r in records)
    with_facts = sum(bool(r.facts) for r in records)
    rows = [
        f"<p>Seed {seed} (the sample chronicle's), at the end of the run: {len(records)} "
        f"species ever lived, {alive} alive. Each record is built from the species' census "
        f"record and what the chronicle kept about it; {with_facts} of {len(records)} have "
        "chronicle entries of their own (the others were born and died on days the rate "
        "limit had filled). Diet and habitat are read from the founding genome, the "
        "portrait's.</p>",
        '<table class="bestiary"><thead><tr><th>#</th><th>Name</th><th>Descends from</th>'
        "<th>Appeared</th><th>Lived</th><th>Peak</th><th>Diet</th><th>Habitat</th>"
        "<th>Rare genes carried</th><th>Daughters</th><th>Entries</th></tr></thead><tbody>",
    ]
    for r in records:
        sp = r.species
        end = "alive" if sp.alive else f"to {date(sp.extinct_t_ms)}"
        lineage = " ← ".join(r.ancestry) if r.ancestry else "arrived"
        rows.append(
            f"<tr><td>{sp.id}</td><td>{html.escape(sp.name)}</td><td>{html.escape(lineage)}"
            f"</td><td>{date(sp.born_t_ms)}</td><td>{span(sp.lived_days(now_ms))} ({end})</td>"
            f"<td>{sp.peak} ({date(r.peak_t_ms)})</td><td>{r.diet}</td><td>{r.habitat}</td>"
            f"<td>{_rare_names(r)}</td><td>{len(r.daughters)}</td><td>{len(r.facts)}</td></tr>"
        )
    rows.append("</tbody></table>")
    oldest = max(records, key=lambda r: (r.species.lived_days(now_ms), -r.species.id))
    rows.append(
        f"<h3>{html.escape(oldest.species.name)}, the longest-lived</h3><ul>"
        + "".join(f"<li>{html.escape(f)}</li>" for f in oldest.facts)
        + "</ul>"
    )
    genomes = np.stack([r.species.founding for r in records])
    fig, ax = plt.subplots(figsize=(7.0, max(2.4, 0.12 * len(records) + 1.2)))
    image = ax.imshow(genomes, aspect="auto", cmap="viridis", vmin=0, vmax=1,
                      interpolation="nearest")  # fmt: skip
    ax.set_xticks(range(len(Gene)), [g.name.lower() for g in Gene], rotation=60, ha="right")
    ax.set_ylabel("species (order of appearance)")
    ax.set_title("Founding genomes: the bestiary's portraits")
    ax.grid(visible=False)
    fig.colorbar(image, ax=ax, label="gene value")
    fig.tight_layout()
    rows.append(
        _svg(
            "Each species' mean genome when it appeared, row by row in order of appearance: "
            "what the renderer draws its portrait from.",
            fig,
        )
    )
    return Section("Bestiary", "\n".join(rows))


def sections(run: Run, run_dir: Path) -> list[Section]:
    style.apply_style()
    values = metrics(run)
    return [
        _monthly_section(run, values),
        _types_section(run, values),
        _importance_section(run),
        _firsts_section(run),
        _sample_section(run),
        _bestiary_section(run, run_dir),
    ]
