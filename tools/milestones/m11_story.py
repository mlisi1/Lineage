"""M11's story: the tuned island told in figures, ahead of the criteria (ADR 0019).

The owner asked for a report that shows the island rather than lists its numbers. These
sections read the ten-year run (the ``decade`` role) where there is one, the main run
otherwise, and the compared runs for the mechanisms and the owner's presence. Per-island
time series are shown as small multiples of several islands or with the median and the
10–90 % band over all of them, never one island alone (CLAUDE.md §7); maps are pixel art.
"""

from __future__ import annotations

import html
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np
from lineage_sim.chronicle import KINDS
from lineage_sim.fauna.genome import Gene
from matplotlib.colors import LinearSegmentedColormap
from matplotlib.figure import Figure

from tools.fastforward import CHRONICLE_COLUMNS, DAYS_PER_YEAR, EXTRA_PREFIX
from tools.milestones import m3, m4, m6
from tools.milestones.base import Section, figure_html
from tools.runs import TIME_KEY, Run
from tools.viz import figures, pixelmap, style

ISLANDS_SHOWN = 6  # small multiples of islands
TIMELINE_ISLANDS = 8  # islands on the chronicle timeline
MAP_SCALE = 2  # pixels per cell in the animated map
FRAME_MS = 220
NOTABLE = 3  # chronicle importance of a notable entry (default.toml [chronicle])
TRAITS = (Gene.SIZE, Gene.DIET, Gene.SPEED, Gene.ARMOUR, Gene.SENSE, Gene.LIMBS)
# Chronicle kinds drawn in their event colour; the rest are grey.
KIND_COLOURS = {
    "speciation": style.EVENT_TYPE["speciation"],
    "extinction": style.EVENT_TYPE["extinction"],
    "fire": style.EVENT_TYPE["fire"],
    "volcano": style.EVENT_TYPE["volcano"],
    "earthquake": style.EVENT_TYPE["volcano"],
    "god_power": style.EVENT_TYPE["god_power"],
    "migration": style.EVENT_TYPE["migration"],
    "split": style.EVENT_TYPE["split_rejoin"],
    "rejoin": style.EVENT_TYPE["split_rejoin"],
    "first": style.EVENT_TYPE["first"],
    "boom": style.CATEGORICAL[5],
    "crash": style.CATEGORICAL[4],
}
EVENTS = (  # yearly land and weather events: label, cumulative series
    ("fires", "fires"),
    ("eruptions", "volcanoes"),
    ("earthquakes", "earthquakes"),
    ("craters", "craters"),
    ("land splits", "splits"),
    ("land rejoins", "rejoins"),
)


def _svg(caption: str, fig: Figure) -> str:
    uri = figures.to_data_uri(fig)
    plt.close(fig)
    return figure_html(html.escape(caption), uri)


def _lede(text: str) -> str:
    return f'<p class="lede">{text}</p>'


def _stack(run: Run, name: str) -> np.ndarray:
    return np.stack([run.series[s][name] for s in run.manifest.seeds])


def _times(run: Run) -> np.ndarray:
    return run.series[run.manifest.seeds[0]][TIME_KEY]


def _present(run: Run) -> np.ndarray:
    """Share of samples after the first year with hunters (≥ m4.PRESENT), per island."""
    times = _times(run)
    return (_stack(run, "predators")[:, times >= 1.0] >= m4.PRESENT).mean(axis=1)


def typical_islands(run: Run, count: int) -> list[int]:
    """Islands spread over the range of hunter presence, from most to least: the typical
    ones and the extremes alike."""
    seeds = run.manifest.seeds
    order = np.argsort(-_present(run), kind="stable")
    picks = np.unique(np.linspace(0, len(seeds) - 1, min(count, len(seeds))).round().astype(int))
    return [seeds[int(order[i])] for i in picks]


def typical_island(run: Run) -> int:
    """The middle of the islands spread over hunter presence."""
    picks = typical_islands(run, 3)
    return picks[len(picks) // 2]


# --- At a glance ------------------------------------------------------------------------


def _tile(value: str, label: str) -> str:
    return f'<div class="tile"><b>{html.escape(value)}</b><span>{html.escape(label)}</span></div>'


def glance_section(
    values: dict[str, float], life: Run, life_dir: Path | None, passed: tuple[int, int]
) -> Section:
    d = lambda key: values.get(f"decade/{key}", np.nan)  # noqa: E731
    ended, island_years = d("worlds_ended.total"), d("island_years")
    if not np.isfinite(island_years):
        island_years = len(life.manifest.seeds) * life.manifest.sim_years
    every = f"1 in {island_years / ended:.0f} yrs" if ended > 0 else "none"
    tiles = [
        _tile(f"{passed[0]} / {passed[1]}", "criteria pass"),
        _tile(f"{island_years:.0f}", "island-years simulated"),
        _tile(every, "worlds ending"),
        _tile(
            f"{d('hunters.present.share_of_time.median'):.0%}",
            "of the time with hunters, typical island",
        ),
        _tile(f"{d('species_alive.median.median'):.0f}", "species alive at once"),
        _tile(f"{d('species.new_per_year.median'):.0f}", "new species a year"),
        _tile(f"{12 * d('chronicle.major_per_month.median'):.0f}", "phone pushes a year"),
        _tile(f"{12 * d('chronicle.notable_per_month.median'):.0f}", "chronicle entries a year"),
    ]
    body = _lede(
        "A closed island that evolves for years on its own. Grazers fill it within a year; "
        "a pack of hunters follows and, resting between kills, mostly stays. Species branch "
        "and die by the dozen, bodies drift away from the founders' and the coast keeps "
        "moving. Below, one island seen from above, then everything in pictures; the "
        "criteria and the numbers come at the end."
    )
    body += '<div class="tiles">' + "".join(tiles) + "</div>"
    if life_dir is not None:
        movie = _island_movie(life, life_dir)
        if movie:
            body += movie
    return Section("The island at a glance", body)


def _island_movie(run: Run, run_dir: Path) -> str:
    seed = typical_island(run)
    snaps = m3._snapshots(run_dir, seed)  # pyright: ignore[reportPrivateUsage]
    if snaps is None or "creatures" not in snaps:
        return ""
    cfg = _diet_lines(run)
    frames = []
    for k in range(len(snaps["day"])):
        image = pixelmap.render(
            snaps["height_u8"][k] / 255.0, float(snaps["sea_level"][k]), snaps["cover_u8"][k],
            snaps["biomass_u8"][k] / 255.0, scale=MAP_SCALE,
        )  # fmt: skip
        frames.append(pixelmap.draw_creatures(image, snaps["creatures"][k], *cfg, scale=MAP_SCALE))
    step = float(np.median(np.diff(snaps["day"]))) if len(snaps["day"]) > 1 else 0.0
    dots = ", ".join(
        f'<span style="color:{c}">■</span> {n}' for n, c in pixelmap.DIET_COLOURS.items()
    )
    caption = (
        f"Island {seed} over {run.manifest.sim_years:g} years, one frame every {step:.0f} days, "
        f"from bare rock: the land greens, the founders land, the forest closes and the coast "
        f"moves. Creatures: {dots}."
    )
    return figure_html(caption, pixelmap.animation_data_uri(frames, FRAME_MS), pixel=True)


def _diet_lines(run: Run) -> tuple[float, float]:
    """The diet classes' bounds from the run's config text."""
    import tomllib

    fauna = tomllib.loads(run.config_text)["fauna"]
    return float(fauna["herbivore_max_diet"]), float(fauna["predator_min_diet"])


# --- Lives of islands -------------------------------------------------------------------


def lives_section(life: Run) -> Section:
    times, shown = _times(life), typical_islands(life, ISLANDS_SHOWN)
    fig, axes = plt.subplots(2, 3, figsize=(7.2, 4.2), sharex=True, sharey=True)
    for ax, seed in zip(axes.flat, shown, strict=False):
        s = life.series[seed]
        layers = [s[name] for name in m4.DIETS]
        ax.stackplot(times, layers, colors=[m4.DIET_COLOURS[n] for n in m4.DIETS], linewidth=0)
        ax.set_title(f"island {seed}", fontsize=9)
        ax.margins(x=0)
    for name in m4.DIETS:
        axes.flat[0].plot([], [], color=m4.DIET_COLOURS[name], linewidth=6, label=name)
    axes.flat[0].legend(fontsize=7, loc="upper left")
    fig.supxlabel("sim time (years)", fontsize=9, color=style.TEXT_SECONDARY)
    fig.supylabel("creatures alive", fontsize=9, color=style.TEXT_SECONDARY)
    fig.tight_layout()
    body = _lede(
        "Every island is its own story. The herd fills the island in its first year; the "
        "red band is the hunters, the yellow one the omnivores in between. Some islands hold "
        "their hunters for a decade, others lose them and win them back."
    )
    body += _svg(
        f"Creatures alive by diet on {len(shown)} islands, from the one that kept its hunters "
        "best to the one that kept them least.",
        fig,
    )
    return Section("Ten years on six islands", body)


# --- Hunters ----------------------------------------------------------------------------


def hunters_section(life: Run) -> Section:
    times = _times(life)
    seeds = life.manifest.seeds
    predators = _stack(life, "predators")
    order = np.argsort(-_present(life), kind="stable")
    cmap = LinearSegmentedColormap.from_list("hunters", ["#f0efec", *style.SEQUENTIAL[2:]])
    fig, ax = plt.subplots(figsize=(7.2, 0.6 + 0.16 * len(seeds)))
    shown = np.ma.masked_less(predators[order], 0.5)
    ax.set_facecolor("#f0efec")
    image = ax.imshow(
        shown, aspect="auto", cmap=cmap, interpolation="nearest",
        extent=(float(times[0]), float(times[-1]), len(seeds) - 0.5, -0.5),
    )  # fmt: skip
    ax.set_yticks(range(len(seeds)), [str(seeds[i]) for i in order], fontsize=6)
    ax.set_xlabel("sim time (years)")
    ax.set_ylabel("island")
    ax.grid(visible=False)
    ax.set_title("Hunters alive, island by island (blank: none)")
    fig.colorbar(image, ax=ax, label="hunters", fraction=0.03, pad=0.01)
    fig.tight_layout()
    body = _lede(
        "Hunters were the hard part of M11. Each row is one island; colour shows how many "
        "hunters are alive, blank means none. Blank stretches are the times they vanished; "
        "most come back, from the herd itself or with an ark."
    )
    body += _svg(f"Hunters alive over {life.manifest.sim_years:g} years on every island, "
                 "sorted by how often they were there.", fig)  # fmt: skip
    gaps = _absences(life)
    if gaps.size:
        fig = figures.log_histogram(gaps, title="How long the hunters stay away",
                                    xlabel="days without hunters (log scale)")  # fmt: skip
        fig.axes[0].set_ylabel("absences (count)")
        body += _svg(
            f"Every time hunters vanished after the first year, on every island ({gaps.size} "
            f"absences): half were back within {np.median(gaps):.0f} days.",
            fig,
        )
    return Section("Hunters come and go", body)


def _absences(run: Run) -> np.ndarray:
    """Lengths, in days, of every spell without hunters after the first year, all islands.
    A spell still running at the end of the run counts at its length so far."""
    times = _times(run)
    after = times >= 1.0
    step = DAYS_PER_YEAR * float(times[1] - times[0]) if times.size > 1 else 0.0
    lengths: list[float] = []
    for seed in run.manifest.seeds:
        gone = run.series[seed]["predators"][after] < m4.PRESENT
        run_length = 0
        for flag in [*gone.tolist(), False]:
            if flag:
                run_length += 1
            elif run_length:
                lengths.append(run_length * step)
                run_length = 0
    return np.array(lengths)


# --- Species ----------------------------------------------------------------------------


def species_section(life: Run) -> Section:
    times = _times(life)
    alive = _stack(life, "species_alive")
    fig, ax = plt.subplots()
    for row in alive:
        ax.plot(times, row, color=style.NEUTRAL, linewidth=0.5, alpha=0.5)
    median, low, high = figures.band_over_seeds(alive)
    ax.fill_between(times, low, high, color=style.SERIES, alpha=0.2, linewidth=0)
    ax.plot(times, median, color=style.SERIES, linewidth=2.0)
    ax.set_xlabel("sim time (years)")
    ax.set_ylabel("species alive")
    ax.set_title("Species alive at once: every island (grey), median and 10–90 %")
    ax.margins(x=0)
    fig.tight_layout()
    body = _lede(
        "Species here are groups of similar genomes, so they branch often and most branches "
        "are short. A few lineages last for years and keep splitting."
    )
    body += _svg(f"How many species live at once, over {life.manifest.sim_years:g} years.", fig)
    seed = typical_island(life)
    table, labels = _lasting(m6.phylogeny(life, seed), m6.names(life, seed))
    if table.size:
        limits = m6._diet_limits(life)  # pyright: ignore[reportPrivateUsage]
        total = m6.phylogeny(life, seed).shape[0]
        title = (
            f"Island {seed}: the {table.shape[0]} largest of {total} species, and their ancestors"
        )
        tree = m6.tree_figure(table, labels, life.manifest.sim_years, limits, title)
        body += _svg(
            f"The family tree of island {seed}: one line per species, thicker the larger it "
            "grew, coloured by diet; grey ticks join a daughter species to its parent.",
            tree,
        )
    return Section("Species branch and die", body)


TREE_PEAK = 40  # species drawn on the family tree reached this many members (or are ancestors)


def _lasting(table: np.ndarray, labels: list[str]) -> tuple[np.ndarray, list[str]]:
    """The species that grew large, with their ancestors, renumbered for the tree."""
    col = {name: i for i, name in enumerate(m6.PHYLOGENY_COLUMNS)}
    ids = table[:, col["id"]].astype(int)
    row_of = {int(i): r for r, i in enumerate(ids)}
    keep: set[int] = set()
    for r in np.nonzero(table[:, col["peak"]] >= TREE_PEAK)[0].tolist():
        while r not in keep:
            keep.add(r)
            parent = int(table[r, col["parent"]])
            if parent == 0 or parent not in row_of:
                break
            r = row_of[parent]
    rows = sorted(keep)
    return table[rows], [labels[r] for r in rows]


# --- Bodies -----------------------------------------------------------------------------


def bodies_section(life: Run) -> Section:
    times = _times(life)
    panels = {
        gene.name.lower(): (np.nan_to_num(_stack(life, f"gene_{gene.name.lower()}"), nan=np.nan),
                            style.categorical(i))
        for i, gene in enumerate(TRAITS)
    }  # fmt: skip
    trend = figures.band_panels(times, panels, xlabel="sim time (years)",
                                ylabel="mean gene (0–1)")  # fmt: skip
    body = _lede(
        "Bodies drift away from the founders' and do not settle: the genes for size, diet, "
        "speed, armour, senses and legs are still moving ten years in, and by then most "
        "spread over much of their range."
    )
    body += _svg(f"Mean body genes over {life.manifest.sim_years:g} years: median island "
                 "and 10–90 % band.", trend)  # fmt: skip
    finals = [life.series[s][f"{EXTRA_PREFIX}final_genes"] for s in life.manifest.seeds]
    filled = [f for f in finals if f.size]
    pooled = np.concatenate(filled, axis=0) if filled else np.empty((0,))
    if pooled.size:
        fig, ax = plt.subplots(figsize=(7.0, 2.8))
        data = [pooled[:, int(g)] for g in TRAITS]
        parts = ax.violinplot(data, showmedians=True, showextrema=False, widths=0.8)
        for i, body_part in enumerate(parts["bodies"]):  # type: ignore[index]
            body_part.set_facecolor(style.categorical(i))
            body_part.set_alpha(0.7)
        parts["cmedians"].set_color(style.TEXT_PRIMARY)  # type: ignore[index]
        ax.set_xticks(range(1, len(TRAITS) + 1), [g.name.lower() for g in TRAITS])
        ax.set_ylabel("gene value (0–1)")
        ax.set_title("Where the creatures ended up: every creature alive at the end")
        fig.tight_layout()
        body += _svg("The spread of body genes at the end, pooled over every island: a wide "
                     "violin is a gene with niches at both ends.", fig)  # fmt: skip
    return Section("Bodies evolve", body)


# --- Land -------------------------------------------------------------------------------


def land_section(life: Run, life_dir: Path | None) -> Section:
    body = _lede(
        "The land is alive too: grass first, then shrubs and forest; storms start fires, "
        "volcanoes and quakes reshape the coast, and the sea splits the island and joins it "
        "again."
    )
    if life_dir is not None:
        shown = typical_islands(life, 3)
        snaps = {s: m3._snapshots(life_dir, s) for s in shown}  # pyright: ignore[reportPrivateUsage]
        if all(v is not None for v in snaps.values()):
            years = [y for y in (1, 3, 5, 10) if y <= life.manifest.sim_years + 0.01]
            grid = pixelmap.tile_grid(
                [[m3._tile(snaps[s], y) for y in years] for s in shown],  # type: ignore[arg-type]  # pyright: ignore[reportPrivateUsage, reportArgumentType]
                [f"island {s}" for s in shown],
                [f"year {y}" for y in years],
            )
            body += figure_html(
                html.escape(f"Three islands at the start of years {', '.join(map(str, years))}."),
                pixelmap.png_data_uri(grid),
                pixel=True,
            )
    years = life.manifest.sim_years
    rates = [_stack(life, series)[:, -1] / years for _, series in EVENTS]
    labels = [label for label, _ in EVENTS]
    fig = figures.bars_with_spread(
        labels, rates, title="A year on the island", ylabel="events per year"
    )
    body += _svg("Land and weather events in a year: median island, whisker over 10–90 %.", fig)
    return Section("The land lives", body)


# --- Chronicle --------------------------------------------------------------------------


CHRONICLE_KINDS = 9  # rows of the chronicle heatmap: the most frequent notable kinds


def chronicle_section(life: Run) -> Section:
    kind_col = CHRONICLE_COLUMNS.index("kind")
    day_col = CHRONICLE_COLUMNS.index("day")
    imp_col = CHRONICLE_COLUMNS.index("importance")
    months = int(np.ceil(life.manifest.sim_years * 12))
    counts: dict[str, np.ndarray] = {}
    for seed in life.manifest.seeds:
        entries = life.series[seed][f"{EXTRA_PREFIX}chronicle"]
        for entry in entries[entries[:, imp_col] >= NOTABLE]:
            name = KINDS[int(entry[kind_col])].value
            month = min(int(entry[day_col] / (DAYS_PER_YEAR / 12)), months - 1)
            counts.setdefault(name, np.zeros(months))[month] += 1
    islands = len(life.manifest.seeds)
    top = sorted(counts, key=lambda k: -counts[k].sum())[:CHRONICLE_KINDS]
    if not top:
        return Section("The chronicle", '<p class="empty">No notable entries yet.</p>')
    grid = np.array([counts[k] / islands for k in top])
    cmap = LinearSegmentedColormap.from_list("entries", ["#f0efec", *style.SEQUENTIAL[1:]])
    fig, ax = plt.subplots(figsize=(7.2, 0.9 + 0.32 * len(top)))
    image = ax.imshow(grid, aspect="auto", cmap=cmap, interpolation="nearest",
                      extent=(0, months / 12, len(top) - 0.5, -0.5))  # fmt: skip
    ax.set_yticks(range(len(top)), [k.replace("_", " ") for k in top], fontsize=8)
    ax.set_xlabel("sim time (years)")
    ax.grid(visible=False)
    ax.set_title("What the chronicle writes about, month by month")
    fig.colorbar(image, ax=ax, label="per island", fraction=0.03, pad=0.01)
    fig.tight_layout()
    per_year = [(k, counts[k].sum() / islands / life.manifest.sim_years) for k in top[:4]]
    listed = ", ".join(f"{k.replace('_', ' ')} ({v:.0f} a year)" for k, v in per_year)
    body = _lede(
        "The island writes its own history: a speciation, an extinction, a herd that booms "
        f"or crashes, a fire, a first. Most often: {listed}. The island's firsts crowd into "
        "its first year; speciations start once the founders have spread."
    )
    body += _svg("Notable chronicle entries per month by kind, averaged over every island.", fig)
    return Section("The chronicle", body)


# --- What makes it work -----------------------------------------------------------------

MEASURES = (  # label, metric in a scored run, band shown as a line
    ("M4.3 both diets", "M4:both_diets.last_year.mean_share_of_seeds", 0.6),
    ("D1 niches", "D:niche.genes_with_niche", 9.0),
    ("D3a hunters' share", "D:predators.share_of_creatures.median", 0.03),
    ("M6.2 splits / month", "M6:speciation.per_month.median", 1.0),
)


def mechanisms_section(values: dict[str, float], mechanisms: tuple[str, ...]) -> Section | None:
    present = [m for m in mechanisms if any(k.startswith(f"off:{m}/") for k in values)]
    if not present:
        return None
    labels = ["all on", *(f"no {m}" for m in present)]
    fig, axes = plt.subplots(1, len(MEASURES), figsize=(7.4, 1.2 + 0.3 * len(labels)),
                             sharey=True)  # fmt: skip
    for ax, (title, key, band) in zip(axes, MEASURES, strict=True):
        found = [values.get(f"tuning/{key}"), *(values.get(f"off:{m}/{key}") for m in present)]
        vals = [np.nan if v is None else v for v in found]
        colours = [style.SERIES if i == 0 else
                   (style.CATEGORICAL[7] if np.isfinite(v) and v < band else style.NEUTRAL)
                   for i, v in enumerate(vals)]  # fmt: skip
        ax.barh(range(len(labels)), vals, color=colours)
        ax.axvline(band, color=style.TEXT_SECONDARY, linewidth=0.8, linestyle="--")
        ax.set_title(title, fontsize=8)
        ax.tick_params(axis="x", labelsize=7)
    axes[0].set_yticks(range(len(labels)), labels, fontsize=7)
    axes[0].invert_yaxis()
    fig.tight_layout()
    body = _lede(
        "Nine mechanisms were added in M11, each with an off switch. Turned off one at a "
        "time over three years, most change little alone; without resting hunters the "
        "hunters vanish, and most of the niches with them. Red bars fall short of the "
        "criterion's band (dashed)."
    )
    body += _svg("The tuned island against the same seeds with one mechanism off.", fig)
    return Section("What makes it work", body)


# --- Presence ---------------------------------------------------------------------------


def presence_section(values: dict[str, float]) -> Section | None:
    schedules = ("always", "office", "office-august", "conference")
    night = [values.get(f"M8/{s}.night_traits.per_mille.median") for s in schedules]
    photo = [values.get(f"M8/{s}.photosynthesis.per_mille.median") for s in schedules]
    if any(v is None for v in night + photo):
        return None
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 2.6))
    x = np.arange(len(schedules))
    axes[0].bar(x, [float(v) for v in night if v is not None], color=style.CATEGORICAL[6])
    axes[0].set_title("night traits (glow, hibernation)", fontsize=9)
    axes[1].bar(x, [float(v) for v in photo if v is not None], color=style.CATEGORICAL[3])
    axes[1].set_title("photosynthesis", fontsize=9)
    for ax in axes:
        ax.set_xticks(x, schedules, fontsize=7)
        ax.set_ylabel("carriers per 1000 creatures", fontsize=8)
    fig.tight_layout()
    body = _lede(
        "You are the sun: the desk lights the island while you are there, evenings are dusk "
        "and weekends a long night. The island answers through photosynthesis, rarer when "
        "the light comes only in office hours; glow and hibernation do not answer at all. "
        "Holidays and a three-week absence were survived on every island."
    )
    body += _svg("Light traits under four presence schedules (median island).", fig)
    forest = values.get("weekly presses/M3:closed_forest.months.median")
    calm = values.get("tuning/M3:closed_forest.months.median")
    if forest is not None and calm is not None:
        fig, ax = plt.subplots(figsize=(7.2, 1.7))
        ax.barh([0, 1], [calm, forest], color=[style.SERIES, style.CATEGORICAL[3]])
        ax.set_yticks([0, 1], ["nobody presses", "pressed weekly"])
        ax.set_xlabel("months to the first closed forest")
        ax.invert_yaxis()
        fig.tight_layout()
        body += _svg("The button gardens: the forest closes far sooner when it is pressed "
                     "every week.", fig)  # fmt: skip
    return Section("Your presence", body)
