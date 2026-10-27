"""M4 — Fauna I: metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8): total extinction in < 20 % of seed-years; trait distributions
drift measurably from the ancestors (mean genetic distance rising); both herbivores and
predators present at year 3 in ≥ 60 % of seeds.

Readings used here: a seed-year counts as extinct when the last creature died at some
point during it (founders arrive again later); a diet class is present with at least
``PRESENT`` creatures; "rising" compares the mean genetic distance of the living from
the genome their lineage arrived with, at the end of the run and at two thirds of it.
"""

from __future__ import annotations

import html
from pathlib import Path

import numpy as np
from lineage_sim.config import parse_config
from lineage_sim.fauna.genome import Gene
from lineage_sim.flora import Cover
from matplotlib.figure import Figure

from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.viz import figures, pixelmap, style

PRESENT = 3
# A whole inhabited sim-day on this PC (shared: its load moves the reading). Raised from
# 400 ms in M11 to make room for its mechanisms (ADR 0019); on the device the sim stays
# far inside 25 % of a core (CLAUDE.md §4.8).
STEP_BUDGET_MS = 600.0
MAP_YEARS = (1.5, 2.5, 3.0)
REPRESENTATIVE_SEEDS = 3
ANIMATION_SCALE = 3
ANIMATION_FRAME_MS = 160
MONTH_YEARS = 1.0 / 12.0
REPORTED_TRAITS = (Gene.SIZE, Gene.DIET, Gene.LIMBS, Gene.SPEED, Gene.ARMOUR, Gene.SENSE)
DIETS = ("herbivores", "omnivores", "predators")
DIET_COLOURS = {
    "herbivores": style.CATEGORICAL[2],
    "omnivores": style.CATEGORICAL[3],
    "predators": style.CATEGORICAL[7],
}
DEATHS = {
    "starved": style.CATEGORICAL[0],
    "killed": style.CATEGORICAL[7],
    "old_age": style.CATEGORICAL[6],
    "drowned": style.CATEGORICAL[2],
}
HABITATS = (Cover.CONIFER, Cover.BROADLEAF, Cover.SHRUB, Cover.GRASS, Cover.LICHEN,
            Cover.BURNT, Cover.BARE, Cover.WATER)  # fmt: skip

SERIES_LABELS: dict[str, SeriesLabel] = {
    "population": SeriesLabel("Population", "creatures"),
    "herbivores": SeriesLabel("Herbivores", "creatures"),
    "omnivores": SeriesLabel("Omnivores", "creatures"),
    "predators": SeriesLabel("Predators", "creatures"),
    "births": SeriesLabel("Births", "cumulative count"),
    "clones": SeriesLabel("Births without a mate", "cumulative count"),
    "deaths": SeriesLabel("Deaths", "cumulative count"),
    "genetic_distance": SeriesLabel("Genetic distance from ancestors", "mean gene difference, 0–1"),
    "energy_share": SeriesLabel("Mean energy reserve", "share of capacity"),
    "extinctions": SeriesLabel("Extinctions", "cumulative count"),
    "arrivals": SeriesLabel("Arriving groups", "cumulative count"),
    **{
        f"gene_{gene.name.lower()}": SeriesLabel(f"{gene.name.capitalize()} gene", "mean, 0–1")
        for gene in Gene
    },
    **{
        f"deaths_{cause}": SeriesLabel(f"Deaths: {cause.replace('_', ' ')}", "cumulative count")
        for cause in DEATHS
    },
    **{
        f"habitat_{cover.name.lower()}": SeriesLabel(
            f"Creatures on {pixelmap.COVER_LABELS[cover]}", "share of creatures"
        )
        for cover in Cover
    },
}

CRITERIA: list[Criterion] = [
    Criterion(
        "M4.1",
        "Share of seed-years in which the population died out",
        "extinct_seed_years.share",
        high=0.2,
    ),
    Criterion(
        "M4.2",
        "Share of seeds whose genetic distance from the ancestors is still rising "
        "(end of run vs two thirds of it)",
        "genetic_distance.share_of_seeds_rising",
        low=0.8,
    ),
    Criterion(
        "M4.3",
        f"Share of seeds with ≥ {PRESENT} herbivores and ≥ {PRESENT} predators, mean over "
        "the final year",
        "both_diets.last_year.mean_share_of_seeds",
        low=0.6,
    ),
    Criterion(
        "M4.4",
        "Step of the whole world, median ms per sim-day",
        "step_ms.median",
        high=STEP_BUDGET_MS,
    ),
]


def _stack(run: Run, name: str) -> np.ndarray:
    return np.stack([run.series[seed][name] for seed in run.manifest.seeds])


def _times(run: Run) -> np.ndarray:
    return run.series[run.manifest.seeds[0]][TIME_KEY]


def _at(run: Run, year: float) -> int:
    return int(np.argmin(np.abs(_times(run) - year)))


def extinct_by_year(run: Run) -> np.ndarray:
    """Boolean [seed, year]: the population died out at some point in that year."""
    extinctions = _stack(run, "extinctions")
    years = max(1, round(run.manifest.sim_years))
    edges = [_at(run, float(y)) for y in range(years + 1)]
    return np.stack(
        [extinctions[:, edges[y + 1]] > extinctions[:, edges[y]] for y in range(years)], axis=1
    )


def _rate_per_month(run: Run, name: str) -> tuple[np.ndarray, np.ndarray]:
    """Monthly increments of a cumulative series: (month-end times, [seed, month])."""
    months = int(run.manifest.sim_years / MONTH_YEARS)
    edges = [_at(run, m * MONTH_YEARS) for m in range(months + 1)]
    values = _stack(run, name)
    return _times(run)[edges[1:]], np.diff(values[:, edges], axis=1)


def metrics(run: Run) -> dict[str, float]:
    end, earlier = -1, _at(run, run.manifest.sim_years * 2.0 / 3.0)
    distance = np.nan_to_num(_stack(run, "genetic_distance"), nan=0.0)
    herbivores, predators = _stack(run, "herbivores"), _stack(run, "predators")
    both = (herbivores >= PRESENT) & (predators >= PRESENT)
    last_year = _times(run) >= run.manifest.sim_years - 1.0
    extinct = extinct_by_year(run)
    population = _stack(run, "population")
    inhabited = population > 0
    out = {
        "extinct_seed_years.share": float(extinct.mean()),
        "extinct_seed_years.count": float(extinct.sum()),
        "extinctions.per_seed.max": float(_stack(run, "extinctions")[:, end].max()),
        "genetic_distance.share_of_seeds_rising": float(
            np.mean(distance[:, end] > distance[:, earlier])
        ),
        "genetic_distance.end.median": float(np.median(distance[:, end])),
        "genetic_distance.two_thirds.median": float(np.median(distance[:, earlier])),
        "both_diets.share_of_seeds": float(both[:, end].mean()),
        # Not a criterion: how the same share looks over the whole last year.
        "both_diets.last_year.mean_share_of_seeds": float(both[:, last_year].mean()),
        "both_diets.last_year.min_share_of_seeds": float(both[:, last_year].mean(axis=0).min()),
        "population.end.median": float(np.median(population[:, end])),
        "population.inhabited_share_of_time": float(inhabited[:, earlier // 2 :].mean()),
        "predators.end.median": float(np.median(predators[:, end])),
        "first_arrival.months.median": float(
            np.median(_times(run)[np.argmax(inhabited, axis=1)] * 12.0)
        ),
        "clones.share_of_births": float(
            _stack(run, "clones")[:, end].sum() / max(1.0, _stack(run, "births")[:, end].sum())
        ),
        "step_ms.median": float(np.median(_stack(run, "step_ms")[:, 1:])),
    }
    for cause in DEATHS:
        out[f"deaths_{cause}.per_seed.median"] = float(
            np.median(_stack(run, f"deaths_{cause}")[:, end])
        )
    for gene in REPORTED_TRAITS:
        name = f"gene_{gene.name.lower()}"
        out[f"{name}.end.median"] = float(np.nanmedian(_stack(run, name)[:, end]))
    return out


# --- Sections ---------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _band(run: Run, name: str, note: str) -> str:
    label = SERIES_LABELS[name]
    fig = figures.time_series_band(
        _times(run), _stack(run, name), title=label.title, xlabel="sim time (years)",
        ylabel=label.unit,
    )  # fmt: skip
    seeds = len(run.manifest.seeds)
    return _svg(f"{label.title}: median and 10–90 % band across {seeds} seeds. {note}", fig)


def _population_section(run: Run) -> Section:
    times = _times(run)
    body = _band(
        run,
        "population",
        "The world starts as bare rock; founders arrive once plants have taken hold.",
    )
    layers = {name: (_stack(run, name), DIET_COLOURS[name]) for name in DIETS}
    body += _svg(
        "Creatures by diet gene, median across seeds, stacked: herbivores eat plants, "
        "predators meat, omnivores both.",
        figures.stacked_area(
            times, layers, title="Diet classes", xlabel="sim time (years)", ylabel="creatures"
        ),
    )
    body += _band(run, "predators", "Predators are capped apart from the rest of the population.")
    return Section("Population", body)


def _turnover_section(run: Run) -> Section:
    months, births = _rate_per_month(run, "births")
    fig = figures.time_series_band(
        months, births, title="Births per sim-month", xlabel="sim time (years)", ylabel="births"
    )
    body = _svg("Births per sim-month: median and 10–90 % band across seeds.", fig)
    layers = {
        cause.replace("_", " "): (_rate_per_month(run, f"deaths_{cause}")[1], colour)
        for cause, colour in DEATHS.items()
    }
    body += _svg(
        "Deaths per sim-month by cause, median across seeds, stacked.",
        figures.stacked_area(
            months,
            layers,
            title="Deaths per sim-month",
            xlabel="sim time (years)",
            ylabel="deaths",
        ),
    )
    extinct = extinct_by_year(run)
    fig = figures.distribution(
        _stack(run, "extinctions")[:, -1],
        title="Extinctions per seed",
        xlabel=f"times the last creature died over {run.manifest.sim_years:g} sim-years (count)",
        bins=np.arange(-0.5, max(3.0, float(_stack(run, "extinctions").max()) + 1.5)).tolist(),
    )
    body += _svg(
        f"Extinction events per seed. {int(extinct.sum())} of {extinct.size} seed-years saw "
        "one; founders arrive again afterwards.",
        fig,
    )
    return Section("Births, deaths and extinctions", body)


def _trait_section(run: Run) -> Section:
    times = _times(run)
    panels = {
        gene.name.lower(): (_stack(run, f"gene_{gene.name.lower()}"), style.SERIES)
        for gene in REPORTED_TRAITS
    }
    body = _svg(
        "Mean of each body gene over the living population: median and 10–90 % band across seeds.",
        figures.band_panels(times, panels, xlabel="sim time (years)", ylabel="gene mean, 0–1"),
    )
    final = [run.series[s]["_final_genes"] for s in run.manifest.seeds]
    pooled = np.concatenate([g for g in final if g.size]) if any(g.size for g in final) else None
    if pooled is not None:
        body += _svg(
            f"Distribution of each gene among the {pooled.shape[0]} creatures alive at the "
            "end, all seeds pooled.",
            figures.histogram_panels(
                {gene.name.lower(): pooled[:, gene] for gene in REPORTED_TRAITS},
                xlabel="gene value, 0–1",
                ylabel="creatures",
            ),
        )
    body += _band(
        run,
        "genetic_distance",
        "Mean gene difference between the living and the genome their lineage arrived with.",
    )
    return Section("Traits and drift", body)


def _habitat_section(run: Run) -> Section:
    layers = {
        pixelmap.COVER_LABELS[cover]: (
            np.nan_to_num(_stack(run, f"habitat_{cover.name.lower()}"), nan=0.0),
            pixelmap.COVER_COLOURS[cover],
        )
        for cover in HABITATS
    }
    fig = figures.stacked_area(
        _times(run), layers, title="Habitat occupancy", xlabel="sim time (years)",
        ylabel="share of creatures",
    )  # fmt: skip
    return Section(
        "Habitat",
        _svg("Land cover under the creatures' feet, median across seeds, stacked.", fig),
    )


def _snapshots(run_dir: Path, seed: int) -> dict[str, np.ndarray] | None:
    path = run_dir / "snapshots" / f"{seed}.npz"
    if not path.exists():
        return None
    with np.load(path) as data:
        if "creatures" not in data.files:
            return None
        return {name: data[name] for name in data.files}


def _frame(
    snaps: dict[str, np.ndarray], k: int, diet_limits: tuple[float, float], scale: int
) -> np.ndarray:
    image = pixelmap.render(
        snaps["height_u8"][k] / 255.0,
        float(snaps["sea_level"][k]),
        snaps["cover_u8"][k],
        snaps["biomass_u8"][k] / 255.0,
        scale=scale,
    )
    return pixelmap.draw_creatures(image, snaps["creatures"][k], *diet_limits, scale=scale)


def _map_section(run: Run, run_dir: Path) -> Section | None:
    fauna = parse_config(run.config_text).fauna
    limits = (fauna.herbivore_max_diet, fauna.predator_min_diet)
    seeds = run.manifest.seeds
    # Worst case: the seed with the most extinctions, then the fewest predators at the end.
    order = np.lexsort((_stack(run, "predators")[:, -1], -_stack(run, "extinctions")[:, -1]))
    worst = seeds[int(order[0])]
    shown = [*[s for s in seeds if s != worst][:REPRESENTATIVE_SEEDS], worst]
    loaded = {seed: _snapshots(run_dir, seed) for seed in shown}
    if any(snaps is None for snaps in loaded.values()):
        return None
    snaps = {seed: s for seed, s in loaded.items() if s is not None}
    # A run shorter than the first map year still gets its final state.
    years = [y for y in MAP_YEARS if y <= run.manifest.sim_years + 0.01] or [run.manifest.sim_years]

    def tile(seed: int, year: float) -> np.ndarray:
        k = int(np.argmin(np.abs(snaps[seed]["day"] - year * 365.25)))
        return _frame(snaps[seed], k, limits, 1)

    legend = ", ".join(
        f'<span style="color:{colour}">■</span> {kind}'
        for kind, colour in pixelmap.DIET_COLOURS.items()
    )
    labels = [f"seed {s}" + (" (worst case)" if s == worst else "") for s in shown]
    grid = pixelmap.tile_grid(
        [[tile(seed, y) for y in years] for seed in shown], labels, [f"year {y:g}" for y in years]
    )
    body = figure_html(
        f"Where the creatures are, one pixel each: {legend}. Seeds "
        f"{', '.join(map(str, shown[:-1]))} are the first of the run; seed {worst} is the "
        "worst case (most extinctions, then fewest predators at the end).",
        pixelmap.png_data_uri(grid),
        pixel=True,
    )
    first = snaps[shown[0]]
    frames = [_frame(first, k, limits, ANIMATION_SCALE) for k in range(len(first["day"]))]
    step = float(np.median(np.diff(first["day"]))) if len(first["day"]) > 1 else 0.0
    body += figure_html(
        html.escape(
            f"Seed {shown[0]} over {run.manifest.sim_years:g} sim-years, one frame every "
            f"{step:g} sim-days: plants colonise the rock, then the founders land and spread."
        ),
        pixelmap.animation_data_uri(frames, ANIMATION_FRAME_MS),
        pixel=True,
    )
    return Section("Maps", body)


def sections(run: Run, run_dir: Path) -> list[Section]:
    style.apply_style()
    out = [_population_section(run), _turnover_section(run), _trait_section(run)]
    maps = _map_section(run, run_dir)
    if maps is not None:
        out.append(maps)
    out.append(_habitat_section(run))
    return out
