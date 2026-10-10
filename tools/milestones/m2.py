"""M2 — Terrain generation and dynamics: metrics, acceptance criteria, report sections.

Acceptance (CLAUDE.md §8): land fraction stays in [0.25, 0.6]; at least one landmass
split or rejoin per 3 years in ≥ 50 % of seeds; no seed loses all land; terrain step
within budget.
"""

from __future__ import annotations

import html
from pathlib import Path

import numpy as np

from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import TIME_KEY, Run
from tools.viz import figures, pixelmap, style

LAND_FRACTION_BAND = (0.25, 0.6)
# A terrain tick (one per sim-day) may take this long on the reference machine; the
# device is roughly 10× slower and still far inside 25 % of a core (CLAUDE.md §4.8).
STEP_BUDGET_MS = 25.0
SNAPSHOT_YEARS = (0, 5, 10)
REPRESENTATIVE_SEEDS = 3
ANIMATION_FRAME_MS = 120
ANIMATION_SCALE = 3

SERIES_LABELS: dict[str, SeriesLabel] = {
    "land_fraction": SeriesLabel("Land fraction", "share of cells"),
    "sea_level": SeriesLabel("Sea level", "height units"),
    "landmass_count": SeriesLabel("Landmasses", "count"),
    "shore_change": SeriesLabel("Coastline change over one year", "share of cells"),
    "mean_height": SeriesLabel("Mean height of the whole map", "height units"),
    "mean_fertility": SeriesLabel("Mean fertility of land", "fertility, 0–1"),
    "fertility_p10": SeriesLabel("Fertility of the poorest tenth of land", "fertility, 0–1"),
    "fertility_p90": SeriesLabel("Fertility of the richest tenth of land", "fertility, 0–1"),
    "volcanoes": SeriesLabel("Volcanoes", "cumulative count"),
    "earthquakes": SeriesLabel("Earthquakes", "cumulative count"),
    "craters": SeriesLabel("Craters", "cumulative count"),
    "splits": SeriesLabel("Landmass splits", "cumulative count"),
    "rejoins": SeriesLabel("Landmass rejoins", "cumulative count"),
}

# What each over-time figure shows, for its caption.
EXPLANATIONS: dict[str, str] = {
    "land_fraction": "Share of cells above the current sea level.",
    "sea_level": "Each seed has its own cycle phases, so the band is the envelope of "
    "the cycles rather than a spread around a common curve.",
    "landmass_count": "Connected land areas of at least landmass_min_cells cells.",
    "shore_change": "Share of cells that are land where they were sea one year earlier, "
    "or the reverse; it starts after the first year.",
    "mean_height": "Mass balance of the ground: tectonics and erosion are zero-sum, so "
    "this should stay nearly flat.",
    "mean_fertility": "Mean fertility over land cells, with no plants yet: sediment, ash "
    "and deposits add fertility, leaching removes it, so it should settle.",
}

CRITERIA: list[Criterion] = [
    Criterion(
        "M2.1",
        "Land fraction never below the band (minimum over all seeds and samples)",
        "land_fraction.min",
        low=LAND_FRACTION_BAND[0],
    ),
    Criterion(
        "M2.2",
        "Land fraction never above the band (maximum over all seeds and samples)",
        "land_fraction.max",
        high=LAND_FRACTION_BAND[1],
    ),
    Criterion(
        "M2.3",
        "Share of seeds with ≥ 1 landmass split or rejoin per 3 years",
        "split_rejoin.share_of_seeds_at_rate",
        low=0.5,
    ),
    Criterion("M2.4", "Seeds that lost all their land at any time", "seeds_without_land", high=0),
    Criterion(
        "M2.5",
        "Terrain step, median ms per sim-day on the reference machine",
        "step_ms.median",
        high=STEP_BUDGET_MS,
    ),
]


def _stack(run: Run, name: str) -> np.ndarray:
    return np.stack([run.series[seed][name] for seed in run.manifest.seeds])


def _changes_per_seed(run: Run) -> np.ndarray:
    return _stack(run, "splits")[:, -1] + _stack(run, "rejoins")[:, -1]


def _band_margin(run: Run) -> np.ndarray:
    """Per seed: distance of its land fraction from the nearest edge of the band."""
    land = _stack(run, "land_fraction")
    return np.minimum(land.min(axis=1) - LAND_FRACTION_BAND[0], LAND_FRACTION_BAND[1] - land.max(1))


def metrics(run: Run) -> dict[str, float]:
    land = _stack(run, "land_fraction")
    changes = _changes_per_seed(run)
    per_3_years = changes / (run.manifest.sim_years / 3.0)
    decades = run.manifest.sim_years / 10.0
    shore = _stack(run, "shore_change")
    out = {
        "land_fraction.min": float(land.min()),
        "land_fraction.max": float(land.max()),
        "land_fraction.median": float(np.median(land)),
        "seeds_without_land": float(np.count_nonzero(land.min(axis=1) <= 0.0)),
        "split_rejoin.share_of_seeds_at_rate": float(np.mean(per_3_years >= 1.0)),
        "split_rejoin.per_3_years.median": float(np.median(per_3_years)),
        "split_rejoin.per_3_years.min": float(per_3_years.min()),
        "split_rejoin.per_3_years.max": float(per_3_years.max()),
        "landmass_count.median": float(np.median(_stack(run, "landmass_count"))),
        "landmass_count.max": float(_stack(run, "landmass_count").max()),
        "shore_change.median": float(np.nanmedian(shore)) if np.isfinite(shore).any() else 0.0,
        "step_ms.median": float(np.median(_stack(run, "step_ms")[:, 1:])),
        "mean_height.drift.max_abs": float(
            np.abs(_stack(run, "mean_height")[:, -1] - _stack(run, "mean_height")[:, 0]).max()
        ),
    }
    fertility = _stack(run, "mean_fertility")
    half = fertility.shape[1] // 2
    out |= {
        "mean_fertility.start.median": float(np.median(fertility[:, 0])),
        "mean_fertility.end.median": float(np.median(fertility[:, -1])),
        # Change of the median over the second half of the run: near zero when settled.
        "mean_fertility.second_half_change": float(
            np.median(fertility[:, -1]) - np.median(fertility[:, half])
        ),
        "fertility_p10.end.median": float(np.median(_stack(run, "fertility_p10")[:, -1])),
        "fertility_p90.end.median": float(np.median(_stack(run, "fertility_p90")[:, -1])),
    }
    for name in ("volcanoes", "earthquakes", "craters"):
        out[f"{name}.per_decade.mean"] = float(_stack(run, name)[:, -1].mean() / decades)
    return out


def _band_figure(run: Run, name: str) -> str:
    label = SERIES_LABELS[name]
    times = run.series[run.manifest.seeds[0]][TIME_KEY]
    fig = figures.time_series_band(
        times,
        _stack(run, name),
        title=label.title,
        xlabel="sim time (years)",
        ylabel=label.unit,
        integer_y=name == "landmass_count",
    )
    caption = (
        f"{label.title}: median and 10–90 % band across {len(run.manifest.seeds)} seeds. "
        f"{EXPLANATIONS[name]}"
    )
    return figure_html(html.escape(caption), figures.to_data_uri(fig))


def _snapshots(run_dir: Path, seed: int) -> tuple[np.ndarray, np.ndarray, np.ndarray] | None:
    path = run_dir / "snapshots" / f"{seed}.npz"
    if not path.exists():
        return None
    with np.load(path) as data:
        return data["height_u8"] / 255.0, data["sea_level"], data["day"]


def _map_section(run: Run, run_dir: Path) -> Section | None:
    """Pixel-art maps of the bare terrain (plants are the subject of the M3 report)."""
    margin = _band_margin(run)
    seeds = run.manifest.seeds
    worst = seeds[int(np.argmin(margin))]
    shown = [*[s for s in seeds if s != worst][:REPRESENTATIVE_SEEDS], worst]
    years = [y for y in SNAPSHOT_YEARS if y <= run.manifest.sim_years]
    rows: list[list[np.ndarray]] = []
    for seed in shown:
        snaps = _snapshots(run_dir, seed)
        if snaps is None:
            return None
        heights, sea, day = snaps
        picks = [int(np.argmin(np.abs(day - y * 365.25))) for y in years]
        rows.append([pixelmap.render(heights[k], float(sea[k])) for k in picks])
    labels = [f"seed {s}" + (" (worst case)" if s == worst else "") for s in shown]
    grid = pixelmap.tile_grid(rows, labels, [f"year {y}" for y in years])
    caption = (
        f"The ground at fixed sim-times, drawn without plants. Seeds "
        f"{', '.join(map(str, shown[:-1]))} are the first of the run; seed {worst} is the "
        f"worst case: its land fraction comes closest to the edge of the accepted band "
        f"(margin {margin.min():.3f}). Blue bands are sea depth; tan is lowland, grey is high "
        "rock, white is snow. One pixel is one cell."
    )
    body = figure_html(html.escape(caption), pixelmap.png_data_uri(grid), pixel=True)

    snaps = _snapshots(run_dir, shown[0])
    if snaps is not None:
        heights, sea, day = snaps
        frames = [
            pixelmap.render(h, float(s), scale=ANIMATION_SCALE)
            for h, s in zip(heights, sea, strict=True)
        ]
        step_days = float(np.median(np.diff(day))) if len(day) > 1 else 0.0
        caption = (
            f"Seed {shown[0]} over {run.manifest.sim_years:g} sim-years, one frame every "
            f"{step_days:g} sim-days: the coast breathes with the sea-level cycles while the "
            "continent drifts."
        )
        body += figure_html(
            html.escape(caption),
            pixelmap.animation_data_uri(frames, ANIMATION_FRAME_MS),
            pixel=True,
        )
    return Section("Maps", body)


def sections(run: Run, run_dir: Path) -> list[Section]:
    style.apply_style()
    seeds = len(run.manifest.seeds)
    years = run.manifest.sim_years

    over_time = "".join(
        _band_figure(run, name)
        for name in ("land_fraction", "sea_level", "landmass_count", "shore_change")
    )

    changes = _changes_per_seed(run)
    fig = figures.distribution(
        changes,
        title="Landmass splits and rejoins per seed",
        xlabel=f"splits + rejoins over {years:g} sim-years (count)",
        bins=min(20, max(5, seeds)),
    )
    needed = years / 3.0
    events = figure_html(
        html.escape(
            f"Per-seed count of landmass splits and rejoins. One per 3 years means at "
            f"least {needed:.1f} over this run."
        ),
        figures.to_data_uri(fig),
    )
    names = ("volcanoes", "earthquakes", "craters", "splits", "rejoins")
    fig = figures.bars_with_spread(
        [SERIES_LABELS[n].title for n in names],
        [_stack(run, n)[:, -1] for n in names],
        title=f"Events per seed over {years:g} sim-years",
        ylabel="events (count)",
    )
    events += figure_html(
        html.escape(f"Event frequency: median count per seed across {seeds} seeds."),
        figures.to_data_uri(fig),
    )

    extra = "".join(_band_figure(run, name) for name in ("mean_height", "mean_fertility"))
    fig = figures.median_lines(
        run.series[run.manifest.seeds[0]][TIME_KEY],
        {
            "richest tenth": _stack(run, "fertility_p90"),
            "mean": _stack(run, "mean_fertility"),
            "poorest tenth": _stack(run, "fertility_p10"),
        },
        title="Spread of land fertility",
        xlabel="sim time (years)",
        ylabel="fertility, 0–1",
    )
    extra += figure_html(
        html.escape(
            f"Spread of land fertility within a world, median across {seeds} seeds: the "
            "90th percentile, the mean and the 10th percentile of land cells. Poor and "
            "rich ground should both persist."
        ),
        figures.to_data_uri(fig),
    )
    out = [Section("Over time", over_time)]
    maps = _map_section(run, run_dir)
    if maps is not None:
        out.append(maps)
    out += [Section("Events", events), Section("Mass and fertility", extra)]
    return out
