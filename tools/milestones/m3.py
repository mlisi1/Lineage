"""M3 — Flora: metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8), from bare rock: grass covers ≥ 50 % of the land within 3–9
sim-months; first closed forest within 12–24 sim-months; ≥ 4 distinct plant forms coexist
at year 3 in ≥ 80 % of seeds; no seed ends at 100 % one class.

Readings used here: the timing criteria are checked on the median seed (the report also
gives the share of seeds inside each band); "closed forest" means closed tree canopy on
at least ``FOREST_SHARE`` of the land; a form "coexists" when it holds at least
``FORM_SHARE`` of the land.
"""

from __future__ import annotations

import html
from pathlib import Path

import numpy as np
from lineage_sim.flora import PLANT_FORMS, Cover
from matplotlib.figure import Figure

from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.viz import figures, pixelmap, style

GRASS_SHARE = 0.5
GRASS_MONTHS = (3.0, 9.0)
FOREST_SHARE = 0.02
SHRUB_SHARE = 0.02
FOREST_MONTHS = (12.0, 24.0)
FORM_SHARE = 0.01
FORMS_YEAR = 3.0
MIN_FORMS = 4
MAP_YEARS = (1, 3, 5)
SEASON_YEAR = 1  # index of the year shown season by season (0 is the first)
REPRESENTATIVE_SEEDS = 3
ANIMATION_SCALE = 3
ANIMATION_FRAME_MS = 160
# Mid-season dates as a fraction of the year (the run starts on 1 January).
SEASONS = (("winter", 0.10), ("spring", 0.35), ("summer", 0.60), ("autumn", 0.85))

LAND_CLASSES = (
    Cover.CONIFER,
    Cover.BROADLEAF,
    Cover.SHRUB,
    Cover.GRASS,
    Cover.LICHEN,
    Cover.BURNT,
    Cover.BARE,
)


def _key(cover: Cover) -> str:
    return f"cover_{cover.name.lower()}"


SERIES_LABELS: dict[str, SeriesLabel] = {
    **{
        _key(c): SeriesLabel(pixelmap.COVER_LABELS[c].capitalize(), "share of land")
        for c in LAND_CLASSES
    },
    "closed_forest": SeriesLabel("Closed forest", "share of land"),
    "plant_species": SeriesLabel("Plant species", "count"),
    "burnt_cells": SeriesLabel("Burnt cells", "cumulative count"),
    "fires": SeriesLabel("Fires", "cumulative count"),
    "rare_fire_pine": SeriesLabel("Fire-pine carriers", "cells"),
    "rare_nitrogen_fixer": SeriesLabel("Nitrogen-fixer carriers", "cells"),
    "rare_mangrove": SeriesLabel("Mangrove carriers", "cells"),
    "fertility_p10": SeriesLabel("Fertility of the poorest tenth of land", "fertility, 0–1"),
    "fertility_p90": SeriesLabel("Fertility of the richest tenth of land", "fertility, 0–1"),
}

CRITERIA: list[Criterion] = [
    Criterion(
        "M3.1",
        f"Months until grass covers ≥ {GRASS_SHARE:.0%} of the land (median seed)",
        "grass_half.months.median",
        *GRASS_MONTHS,
    ),
    Criterion(
        "M3.2",
        f"Months until closed forest on ≥ {FOREST_SHARE:.0%} of the land (median seed)",
        "closed_forest.months.median",
        *FOREST_MONTHS,
    ),
    Criterion(
        "M3.3",
        f"Share of seeds with ≥ {MIN_FORMS} plant forms (each ≥ {FORM_SHARE:.0%} of land) "
        f"at year {FORMS_YEAR:g}",
        "forms.share_of_seeds_with_four",
        low=0.8,
    ),
    Criterion("M3.4", "Seeds that end as a single land-cover class", "seeds_single_class", high=0),
    Criterion(
        "M3.5",
        "Seeds where grass never reached half the land or no forest closed",
        "seeds_without_succession",
        high=0,
    ),
]


def _stack(run: Run, name: str) -> np.ndarray:
    return np.stack([run.series[seed][name] for seed in run.manifest.seeds])


def _times(run: Run) -> np.ndarray:
    return run.series[run.manifest.seeds[0]][TIME_KEY]


def first_months(run: Run, name: str, threshold: float) -> np.ndarray:
    """Per seed: sim-months until series ``name`` first reaches ``threshold`` (NaN: never)."""
    times = _times(run)
    values = _stack(run, name) >= threshold
    first = np.argmax(values, axis=1)
    return np.where(values.any(axis=1), times[first] * 12.0, np.nan)


def forms_at(run: Run, year: float) -> np.ndarray:
    """Per seed: number of plant forms holding at least ``FORM_SHARE`` of the land."""
    k = int(np.argmin(np.abs(_times(run) - year)))
    shares = np.stack([_stack(run, _key(form))[:, k] for form in PLANT_FORMS], axis=1)
    return (shares >= FORM_SHARE).sum(axis=1)


def _in_band(values: np.ndarray, band: tuple[float, float]) -> float:
    return float(np.mean((values >= band[0]) & (values <= band[1])))


def metrics(run: Run) -> dict[str, float]:
    grass = first_months(run, _key(Cover.GRASS), GRASS_SHARE)
    forest = first_months(run, "closed_forest", FOREST_SHARE)
    shrub = first_months(run, _key(Cover.SHRUB), SHRUB_SHARE)
    year = min(FORMS_YEAR, run.manifest.sim_years)
    forms = forms_at(run, year)
    final = np.stack([_stack(run, _key(c))[:, -1] for c in LAND_CLASSES], axis=1)
    sizes = np.concatenate([run.series[s]["_fire_sizes"] for s in run.manifest.seeds])
    fertility = _stack(run, "mean_fertility")
    out = {
        "seeds_single_class": float(np.count_nonzero(final.max(axis=1) >= 1.0)),
        "seeds_without_succession": float(np.count_nonzero(np.isnan(grass) | np.isnan(forest))),
        "forms.share_of_seeds_with_four": float(np.mean(forms >= MIN_FORMS)),
        "forms.median": float(np.median(forms)),
        "forms.min": float(forms.min()),
        "forms.end.share_of_seeds_with_four": float(
            np.mean(forms_at(run, run.manifest.sim_years) >= MIN_FORMS)
        ),
        "grass_half.share_of_seeds_in_band": _in_band(grass, GRASS_MONTHS),
        "closed_forest.share_of_seeds_in_band": _in_band(forest, FOREST_MONTHS),
        "plant_species.end.median": float(np.median(_stack(run, "plant_species")[:, -1])),
        "fires.per_seed.median": float(np.median(_stack(run, "fires")[:, -1])),
        "burnt_cells.per_seed.median": float(np.median(_stack(run, "burnt_cells")[:, -1])),
        "mean_fertility.start.median": float(np.median(fertility[:, 0])),
        "mean_fertility.end.median": float(np.median(fertility[:, -1])),
        "step_ms.median": float(np.median(_stack(run, "step_ms")[:, 1:])),
    }
    for name, months in (("grass_half", grass), ("closed_forest", forest), ("shrubland", shrub)):
        if np.isfinite(months).any():
            out |= {
                f"{name}.months.median": float(np.nanmedian(months)),
                f"{name}.months.min": float(np.nanmin(months)),
                f"{name}.months.max": float(np.nanmax(months)),
            }
    if sizes.size:
        out |= {
            "fire_size.median": float(np.median(sizes)),
            "fire_size.p90": float(np.quantile(sizes, 0.9)),
            "fire_size.max": float(sizes.max()),
        }
    for cover in LAND_CLASSES:
        out[f"{_key(cover)}.end.median"] = float(np.median(_stack(run, _key(cover))[:, -1]))
    return out


# --- Sections ---------------------------------------------------------------------------


def _svg(caption: str, fig: Figure) -> str:
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _cover_section(run: Run) -> Section:
    times, seeds = _times(run), len(run.manifest.seeds)
    layers = {
        pixelmap.COVER_LABELS[c]: (_stack(run, _key(c)), pixelmap.COVER_COLOURS[c])
        for c in LAND_CLASSES
    }
    body = _svg(
        f"Land cover from bare rock, median across {seeds} seeds, as a share of the land "
        "(cells above the sea). The dips each winter are low plants dying back to their roots.",
        figures.stacked_area(
            times,
            layers,
            title="Land cover",
            xlabel="sim time (years)",
            ylabel="share of land",
        ),
    )
    body += _svg(
        f"The same classes one by one: median and 10–90 % band across {seeds} seeds.",
        figures.band_panels(times, layers, xlabel="sim time (years)", ylabel="share of land"),
    )
    return Section("Land cover", body)


def _succession_section(run: Run) -> Section:
    body = ""
    for name, threshold, title in (
        (_key(Cover.GRASS), GRASS_SHARE, f"grass on {GRASS_SHARE:.0%} of the land"),
        (_key(Cover.SHRUB), SHRUB_SHARE, f"first shrubland ({SHRUB_SHARE:.0%} of the land)"),
        ("closed_forest", FOREST_SHARE, f"first closed forest ({FOREST_SHARE:.0%} of the land)"),
    ):
        months = first_months(run, name, threshold)
        reached = months[np.isfinite(months)]
        if reached.size == 0:
            continue
        fig = figures.distribution(
            reached, title=f"Time to {title}", xlabel="sim time (months)", bins=12
        )
        body += _svg(
            f"Per-seed time to {title}; {reached.size} of {months.size} seeds got there.", fig
        )
    year = min(FORMS_YEAR, run.manifest.sim_years)
    forms = forms_at(run, year)
    fig = figures.distribution(
        forms,
        title=f"Plant forms coexisting at year {year:g}",
        xlabel=f"forms holding ≥ {FORM_SHARE:.0%} of the land (count, of {len(PLANT_FORMS)})",
        bins=np.arange(-0.5, len(PLANT_FORMS) + 1.5).tolist(),
    )
    body += _svg(
        "Per-seed number of coexisting forms: lichen, grass, shrub, broadleaf, conifer.", fig
    )
    return Section("Succession", body)


def _band(run: Run, name: str, note: str, *, integer_y: bool = False) -> str:
    label = SERIES_LABELS.get(name, SeriesLabel(name, ""))
    fig = figures.time_series_band(
        _times(run),
        _stack(run, name),
        title=label.title,
        xlabel="sim time (years)",
        ylabel=label.unit,
        integer_y=integer_y,
    )
    seeds = len(run.manifest.seeds)
    return _svg(f"{label.title}: median and 10–90 % band across {seeds} seeds. {note}", fig)


def _diversity_section(run: Run) -> Section:
    body = _band(
        run,
        "plant_species",
        "A species here is a coarse genome cluster (each gene above or below its midpoint, "
        "plus rare genes) on at least species_min_cells cells.",
        integer_y=True,
    )
    fig = figures.median_lines(
        _times(run),
        {
            "mangrove": _stack(run, "rare_mangrove"),
            "fire-pine": _stack(run, "rare_fire_pine"),
            "nitrogen-fixer": _stack(run, "rare_nitrogen_fixer"),
        },
        title="Rare-gene carriers",
        xlabel="sim time (years)",
        ylabel="cells",
    )
    body += _svg("Cells whose plants carry each rare gene, median across seeds.", fig)
    return Section("Species and rare genes", body)


def _soil_section(run: Run) -> Section:
    fig = figures.median_lines(
        _times(run),
        {
            "richest tenth": _stack(run, "fertility_p90"),
            "mean": _stack(run, "mean_fertility"),
            "poorest tenth": _stack(run, "fertility_p10"),
        },
        title="Soil fertility of the land",
        xlabel="sim time (years)",
        ylabel="fertility, 0–1",
    )
    body = _svg(
        "Fertility of land cells, median across seeds: the 90th percentile, the mean and "
        "the 10th percentile. Plants build soil up to a cap set by their stature; leaching "
        "and fire remove it.",
        fig,
    )
    return Section("Soil", body)


def _fire_section(run: Run) -> Section:
    sizes = np.concatenate([run.series[s]["_fire_sizes"] for s in run.manifest.seeds])
    body = _svg(
        f"Sizes of all {sizes.size} fires of the run, on logarithmic axes: most stay small, "
        "a few sweep whole grasslands.",
        figures.log_histogram(sizes, title="Fire sizes", xlabel="cells burnt (count)"),
    )
    body += _band(run, "burnt_cells", "Fires are a summer event, hence the steps.")
    return Section("Fire", body)


def _snapshots(run_dir: Path, seed: int) -> dict[str, np.ndarray] | None:
    path = run_dir / "snapshots" / f"{seed}.npz"
    if not path.exists():
        return None
    with np.load(path) as data:
        if "cover_u8" not in data.files:
            return None
        return {name: data[name] for name in data.files}


def _tile(snaps: dict[str, np.ndarray], year: float, scale: int = 1) -> np.ndarray:
    k = int(np.argmin(np.abs(snaps["day"] - year * 365.25)))
    return pixelmap.render(
        snaps["height_u8"][k] / 255.0,
        float(snaps["sea_level"][k]),
        snaps["cover_u8"][k],
        snaps["biomass_u8"][k] / 255.0,
        scale=scale,
    )


def _map_section(run: Run, run_dir: Path) -> Section | None:
    seeds = run.manifest.seeds
    year = min(FORMS_YEAR, run.manifest.sim_years)
    forms = forms_at(run, year)
    forest = np.nan_to_num(first_months(run, "closed_forest", FOREST_SHARE), nan=np.inf)
    # Worst case: fewest forms, then the latest forest.
    worst = seeds[int(np.lexsort((-forest, forms))[0])]
    shown = [*[s for s in seeds if s != worst][:REPRESENTATIVE_SEEDS], worst]
    loaded = {seed: _snapshots(run_dir, seed) for seed in shown}
    if any(snaps is None for snaps in loaded.values()):
        return None
    snaps = {seed: s for seed, s in loaded.items() if s is not None}
    years = [y for y in MAP_YEARS if y <= run.manifest.sim_years + 0.01]

    legend = ", ".join(
        f'<span style="color:{pixelmap.COVER_COLOURS[c]}">■</span> {pixelmap.COVER_LABELS[c]}'
        for c in (Cover.BARE, Cover.LICHEN, Cover.GRASS, Cover.SHRUB, Cover.BROADLEAF,
                  Cover.CONIFER, Cover.BURNT)
    )  # fmt: skip
    first = snaps[shown[0]]
    season_year = max(0, min(SEASON_YEAR, int(run.manifest.sim_years) - 1))
    seasons = pixelmap.tile_grid(
        [
            [_tile(first, season_year + phase) for _, phase in SEASONS[:2]],
            [_tile(first, season_year + phase) for _, phase in SEASONS[2:]],
        ],
        [f"seed {shown[0]}, year {season_year + 1}: winter, spring", "summer, autumn"],
        ["", ""],
    )
    body = figure_html(
        f"One world through the seasons of its year {season_year + 1}. {legend}; straw "
        "yellow is low vegetation that has died back to its roots. One pixel is one cell.",
        pixelmap.png_data_uri(seasons),
        pixel=True,
    )

    labels = [f"seed {s}" + (" (worst case)" if s == worst else "") for s in shown]
    grid = pixelmap.tile_grid(
        [[_tile(snaps[seed], y) for y in years] for seed in shown],
        labels,
        [f"year {y}" for y in years],
    )
    body += figure_html(
        html.escape(
            f"Land cover at the start of years {', '.join(map(str, years))} (mid-winter). "
            f"Seeds {', '.join(map(str, shown[:-1]))} are the first of the run; seed {worst} "
            f"is the worst case, with the fewest forms at year {year:g} "
            f"({int(forms[seeds.index(worst)])})."
        ),
        pixelmap.png_data_uri(grid),
        pixel=True,
    )

    frames = [
        pixelmap.render(h / 255.0, float(s), c, b / 255.0, scale=ANIMATION_SCALE)
        for h, s, c, b in zip(
            first["height_u8"],
            first["sea_level"],
            first["cover_u8"],
            first["biomass_u8"],
            strict=True,
        )
    ]
    step = float(np.median(np.diff(first["day"]))) if len(first["day"]) > 1 else 0.0
    body += figure_html(
        html.escape(
            f"Seed {shown[0]} from bare rock over {run.manifest.sim_years:g} sim-years, one "
            f"frame every {step:g} sim-days."
        ),
        pixelmap.animation_data_uri(frames, ANIMATION_FRAME_MS),
        pixel=True,
    )
    return Section("Maps", body)


def sections(run: Run, run_dir: Path) -> list[Section]:
    style.apply_style()
    out = [_cover_section(run), _succession_section(run)]
    maps = _map_section(run, run_dir)
    if maps is not None:
        out.append(maps)
    out += [_diversity_section(run), _soil_section(run), _fire_section(run)]
    return out
