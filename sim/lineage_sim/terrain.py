"""Terrain: height and fertility grids that change slowly and never reset.

Each tick, in order:

1. **Tectonics** — hotspots drift, lift or sink the ground around them (zero-sum), die
   and reappear elsewhere.
2. **Plate drift** — the large-scale shape relaxes toward a continent template that
   morphs slowly and never repeats; small-scale detail is left alone.
3. **Events** — volcano, earthquake, crater, at low random rates.
4. **Erosion** — mass-conserving creep and landslides between neighbouring cells,
   slowed by vegetation cover; sediment carries fertility.
5. **Sea level** — two superposed cycles; submerged ground slowly gains fertility.
6. **Landmasses** — connected land is labelled; splits and rejoins become output events.

Grids are ``float32`` arrays of shape (grid_height, grid_width), indexed ``[y, x]``.
All functions here are pure; `Terrain` wires them into the world loop.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import cast

import numpy as np
from numpy.random import PCG64, Generator
from numpy.typing import NDArray

from lineage_sim.clock import MS_PER_SECOND, SECONDS_PER_YEAR
from lineage_sim.config import TerrainConfig
from lineage_sim.events import (
    CraterFormed,
    EarthquakeStruck,
    InputEvent,
    LandmassesRejoined,
    LandmassSplit,
    OutputEvent,
    VolcanoErupted,
)
from lineage_sim.rng import TERRAIN
from lineage_sim.state.schema import Tree
from lineage_sim.subsystem import Context

Grid = NDArray[np.float32]
Mask = NDArray[np.bool_]
Labels = NDArray[np.int32]

_F = np.float32
# Largest share of a height difference exchanged with one neighbour per erosion substep;
# with four neighbours this keeps the explicit scheme stable.
_MAX_EXCHANGE = 0.2
# Hotspot table columns.
_X, _Y, _VX, _VY, _RADIUS, _RATE, _LIFE = range(7)

# Shape constants: they define the form of a feature, not a rate or threshold to tune.
# Width, in cells, of the smooth step across an earthquake fault.
_FAULT_WIDTH_CELLS = 1.5
# Volcano profile: cone exponent (>1 is concave), lava and ash reach as cone radii.
_CONE_EXPONENT = 1.5
_LAVA_REACH = 0.5
_ASH_REACH = 1.5
# Crater rim extends from 1 to this many bowl radii.
_RIM_REACH = 1.5
# Weakest hotspot as a share of hotspot_rate_max_per_year.
_HOTSPOT_MIN_SHARE = 0.3
# Ratio between the two rotation rates of the drifting template: irrational, so the
# mix of continent fields never repeats.
_GOLDEN_RATIO = (1.0 + math.sqrt(5.0)) / 2.0
# Noise synthesis: waves per octave, wavelength jitter within an octave, and the standard
# deviation of the result (values beyond 0.5 ± 0.5 are clipped: 2.5 standard deviations).
_WAVES_PER_OCTAVE = 12
_WAVELENGTH_JITTER = (0.75, 1.5)
_NOISE_STD = 0.2
# Shortest wavelength synthesised (cells); shorter waves alias into a checkerboard.
_MIN_WAVELENGTH_CELLS = 5.0
# Octaves of the fertility and roughness noise (coarse fields; the detail comes from height).
_COARSE_OCTAVES = 3


# --- Geometry ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Geometry:
    """Static grids derived from the config."""

    xx: Grid  # x coordinate of every cell
    yy: Grid  # y coordinate of every cell
    radial: Grid  # 0 at the map centre, 1 at the middle of each edge
    edge_mask: Grid  # 0 on the border, rising smoothly to 1 past edge_margin_cells


def geometry(cfg: TerrainConfig) -> Geometry:
    h, w = cfg.grid_height, cfg.grid_width
    yy, xx = np.mgrid[0:h, 0:w].astype(_F)
    cy, cx = (h - 1) / 2, (w - 1) / 2
    radial = np.sqrt(((xx - cx) / (w / 2)) ** 2 + ((yy - cy) / (h / 2)) ** 2)
    border = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    t = np.clip(border / cfg.edge_margin_cells, 0.0, 1.0)
    edge_mask = t * t * (3.0 - 2.0 * t)
    return Geometry(xx, yy, radial.astype(_F), edge_mask.astype(_F))


# --- Generation -------------------------------------------------------------------------


def wave_noise(
    rng: Generator, height: int, width: int, wavelength: float, octaves: int, persistence: float
) -> Grid:
    """Fractal noise in [0, 1] (mean 0.5) built from randomly oriented plane waves.

    Each octave sums ``_WAVES_PER_OCTAVE`` cosines with random direction, phase and a
    wavelength jittered around the octave's. Unlike lattice noise it has no preferred
    axes, so coasts never follow the grid.
    """
    yy, xx = np.mgrid[0:height, 0:width].astype(np.float64)
    total = np.zeros((height, width), dtype=np.float64)
    amplitude, variance = 1.0, 0.0
    for octave in range(octaves):
        scale = wavelength / 2**octave
        if scale < _MIN_WAVELENGTH_CELLS:
            break
        for _ in range(_WAVES_PER_OCTAVE):
            angle = rng.uniform(0.0, math.pi)
            k = 2.0 * math.pi / (scale * rng.uniform(*_WAVELENGTH_JITTER))
            phase = rng.uniform(0.0, 2.0 * math.pi)
            total += amplitude * np.cos(k * (math.cos(angle) * xx + math.sin(angle) * yy) + phase)
        variance += _WAVES_PER_OCTAVE * amplitude * amplitude / 2.0
        amplitude *= persistence
    return np.clip(0.5 + _NOISE_STD * total / math.sqrt(variance), 0.0, 1.0).astype(_F)


def _shape(cfg: TerrainConfig, geo: Geometry, noise: Grid, offset: float) -> Grid:
    """Heights from a noise field: radial falloff, relief scaling, deep map border."""
    raw = noise - cfg.falloff_strength * geo.radial**cfg.falloff_exponent - offset
    height = cfg.sea_base + raw * cfg.relief_scale - cfg.edge_depth * (1.0 - geo.edge_mask)
    return np.clip(height, 0.0, 1.0).astype(_F)


def shape_island(cfg: TerrainConfig, geo: Geometry, noise: Grid) -> Grid:
    """Heights from a noise field in [0, 1], shifted so ``initial_land_fraction`` of the
    cells lie above ``sea_base``."""
    unshifted = _shape(cfg, geo, noise, 0.0)
    surplus = float(np.quantile(unshifted, 1.0 - cfg.initial_land_fraction)) - cfg.sea_base
    return _shape(cfg, geo, noise, surplus / cfg.relief_scale)


def continent_fields(cfg: TerrainConfig, seeds: tuple[int, int, int]) -> tuple[Grid, Grid, Grid]:
    """Three independent large-scale noise fields, centred on zero, one per seed."""
    fields = [
        wave_noise(
            Generator(PCG64(seed)),
            cfg.grid_height,
            cfg.grid_width,
            cfg.noise_wavelength_cells,
            cfg.noise_large_octaves,
            cfg.noise_persistence,
        )
        - _F(0.5)
        for seed in seeds
    ]
    return fields[0], fields[1], fields[2]


def continent_noise(
    cfg: TerrainConfig, fields: tuple[Grid, Grid, Grid], t_years: float, detail: Grid | None
) -> Grid:
    """Large-scale noise in [0, 1] at time ``t_years``: the "plate drift".

    The three fields are mixed with weights that rotate slowly (constant total variance),
    so the continent morphs continuously and never repeats exactly. ``detail`` (noise in
    [0, 1]) is blended in for generation; the drifting template uses none.
    """
    a, b, c = fields
    turn = 2.0 * math.pi * t_years / cfg.drift_period_years
    second = turn / _GOLDEN_RATIO
    large = (
        _F(math.cos(turn)) * a
        + _F(math.sin(turn) * math.cos(second)) * b
        + _F(math.sin(turn) * math.sin(second)) * c
    )
    share = _F(cfg.noise_detail_share)
    fine = _F(0.0) if detail is None else detail - _F(0.5)
    return (_F(0.5) + (1.0 - share) * large + share * fine).astype(_F)


def generate(
    cfg: TerrainConfig,
    geo: Geometry,
    fields: tuple[Grid, Grid, Grid],
    rng: Generator,
    t_years: float = 0.0,
) -> tuple[Grid, Grid]:
    """A new island: (height, fertility). Its large-scale shape is the drifting continent
    at ``t_years``, with fine detail on top."""
    h, w = cfg.grid_height, cfg.grid_width
    detail = wave_noise(
        rng,
        h,
        w,
        cfg.noise_wavelength_cells / 2**cfg.noise_large_octaves,
        cfg.noise_detail_octaves,
        cfg.noise_persistence,
    )
    height = shape_island(cfg, geo, continent_noise(cfg, fields, t_years, detail))

    richness = wave_noise(rng, h, w, cfg.fertility_wavelength_cells, _COARSE_OCTAVES, 0.5)
    above = np.maximum(height - cfg.sea_base, 0.0)
    lowland = np.exp(-cfg.fertility_elevation_decay * above)
    fertility = cfg.fertility_min + (cfg.fertility_max - cfg.fertility_min) * richness * lowland
    return height, fertility.astype(_F)


# --- Sea level --------------------------------------------------------------------------


def sea_level(cfg: TerrainConfig, t_years: float, phases: tuple[float, float]) -> float:
    return (
        cfg.sea_base
        + cfg.sea_cycle_amplitude
        * math.sin(2.0 * math.pi * t_years / cfg.sea_cycle_period_years + phases[0])
        + cfg.sea_slow_amplitude
        * math.sin(2.0 * math.pi * t_years / cfg.sea_slow_period_years + phases[1])
    )


# --- Tectonics --------------------------------------------------------------------------


def spawn_hotspot(cfg: TerrainConfig, rng: Generator, index: int) -> NDArray[np.float64]:
    """A new hotspot row. Even indices lift, odd ones sink."""
    margin = cfg.edge_margin_cells
    speed = rng.uniform(0.0, cfg.hotspot_speed_max_cells_per_year)
    angle = rng.uniform(0.0, 2.0 * math.pi)
    sign = 1.0 if index % 2 == 0 else -1.0
    return np.array(
        [
            rng.uniform(margin, cfg.grid_width - 1 - margin),
            rng.uniform(margin, cfg.grid_height - 1 - margin),
            speed * math.cos(angle),
            speed * math.sin(angle),
            rng.uniform(cfg.hotspot_radius_min_cells, cfg.hotspot_radius_max_cells),
            sign * rng.uniform(_HOTSPOT_MIN_SHARE, 1.0) * cfg.hotspot_rate_max_per_year,
            rng.uniform(cfg.hotspot_lifetime_min_years, cfg.hotspot_lifetime_max_years),
        ]
    )


def advance_hotspots(
    cfg: TerrainConfig, hotspots: NDArray[np.float64], rng: Generator, dt_years: float
) -> None:
    """Move hotspots (bouncing off the margin), age them, replace the dead. In place."""
    margin = cfg.edge_margin_cells
    limits = ((_X, _VX, cfg.grid_width - 1 - margin), (_Y, _VY, cfg.grid_height - 1 - margin))
    for k in range(hotspots.shape[0]):
        spot = hotspots[k]
        spot[_LIFE] -= dt_years
        if spot[_LIFE] <= 0.0:
            hotspots[k] = spawn_hotspot(cfg, rng, k)
            continue
        for pos, vel, high in limits:
            spot[pos] += spot[vel] * dt_years
            if spot[pos] < margin:
                spot[pos], spot[vel] = 2.0 * margin - spot[pos], -spot[vel]
            elif spot[pos] > high:
                spot[pos], spot[vel] = 2.0 * high - spot[pos], -spot[vel]


def uplift_rate(
    cfg: TerrainConfig, geo: Geometry, hotspots: NDArray[np.float64], roughness: Grid
) -> Grid:
    """Vertical rate field (height units per year): zero-sum and zero on the border."""
    field = np.zeros_like(geo.xx)
    for x, y, _vx, _vy, radius, rate, _life in hotspots.tolist():
        r2 = (geo.xx - _F(x)) ** 2 + (geo.yy - _F(y)) ** 2
        field += _F(rate) * np.exp(r2 * _F(-0.5 / (radius * radius)))
    rugged = 1.0 + cfg.hotspot_ruggedness * (2.0 * roughness - 1.0)
    field *= rugged * geo.edge_mask
    field -= geo.edge_mask * (field.sum(dtype=np.float64) / geo.edge_mask.sum(dtype=np.float64))
    return field.astype(_F)


def box_blur(grid: Grid, radius: int) -> Grid:
    """Mean over a (2·radius+1)² window, edges replicated."""
    rows = _blur_along_x(grid.astype(np.float64), radius)
    return _blur_along_x(rows.T, radius).T.astype(_F)


def _blur_along_x(grid: NDArray[np.float64], radius: int) -> NDArray[np.float64]:
    window = 2 * radius + 1
    padded = np.concatenate(
        [
            np.repeat(grid[:, :1], radius + 1, axis=1),
            grid,
            np.repeat(grid[:, -1:], radius, axis=1),
        ],
        axis=1,
    )
    sums = np.cumsum(padded, axis=1)
    return (sums[:, window:] - sums[:, :-window]) / window


def relax(cfg: TerrainConfig, height: Grid, target: Grid, dt_years: float) -> Grid:
    """Pull the large-scale shape of ``height`` toward ``target``."""
    large = box_blur(box_blur(height, cfg.relax_blur_cells), cfg.relax_blur_cells)
    share = _F(1.0 - math.exp(-dt_years / cfg.relax_time_years))
    return (height - share * (large - target)).astype(_F)


# --- Erosion ----------------------------------------------------------------------------


def erode(cfg: TerrainConfig, height: Grid, cover: Grid | None, dt_years: float) -> Grid:
    """Creep and landslides. Returns the new height; total mass is conserved.

    ``cover`` is vegetation cover in [0, 1]; an exchange between two cells is slowed by
    the mean protection of both.
    """
    creep = cfg.creep_rate_per_year * dt_years
    thermal = cfg.thermal_rate_per_year * dt_years
    # Enough substeps to stay stable, so a long span erodes like many short ticks.
    substeps = max(1, math.ceil((creep + thermal) / _MAX_EXCHANGE))
    creep_f, thermal_f, talus = _F(creep / substeps), _F(thermal / substeps), _F(cfg.talus_slope)
    if cover is None:
        keep_x = keep_y = _F(1.0)
    else:
        keep = 1.0 - cfg.vegetation_protection * cover
        keep_x = (0.5 * (keep[:, :-1] + keep[:, 1:])).astype(_F)
        keep_y = (0.5 * (keep[:-1, :] + keep[1:, :])).astype(_F)

    out = height.copy()
    for _ in range(substeps):
        dx = out[:, :-1] - out[:, 1:]
        dy = out[:-1, :] - out[1:, :]
        # Flux from the first cell of each pair to the second (negative: the other way).
        # A landslide moves at most a quarter of the excess over talus to each neighbour.
        flux_x = (creep_f * dx + thermal_f * 0.25 * _excess(dx, talus)) * keep_x
        flux_y = (creep_f * dy + thermal_f * 0.25 * _excess(dy, talus)) * keep_y
        out[:, :-1] -= flux_x
        out[:, 1:] += flux_x
        out[:-1, :] -= flux_y
        out[1:, :] += flux_y
    return out


def _excess(diff: Grid, talus: np.float32) -> Grid:
    """Signed part of a height difference beyond the stable slope."""
    return np.sign(diff) * np.maximum(np.abs(diff) - talus, _F(0.0))


def move_fertility(cfg: TerrainConfig, fertility: Grid, height_change: Grid) -> Grid:
    """Sediment carries soil: deposits enrich toward 1, stripped ground loses fertility."""
    amount = (cfg.erosion_fertility_exchange / cfg.talus_slope) * height_change
    gain = np.clip(amount, 0.0, 1.0)
    loss = np.clip(-amount, 0.0, 1.0)
    return (fertility + gain * (1.0 - fertility) - loss * fertility).astype(_F)


# --- Events -----------------------------------------------------------------------------


def _distance(geo: Geometry, x: float, y: float) -> Grid:
    return np.sqrt((geo.xx - _F(x)) ** 2 + (geo.yy - _F(y)) ** 2)


def apply_volcano(
    cfg: TerrainConfig,
    geo: Geometry,
    height: Grid,
    fertility: Grid,
    x: float,
    y: float,
    radius: float,
    cone_height: float,
) -> tuple[Grid, Grid]:
    """Add a cone; lava sterilises the centre, ash enriches the surroundings."""
    r = _distance(geo, x, y)
    cone = _F(cone_height) * np.clip(1.0 - r / _F(radius), 0.0, 1.0) ** _F(_CONE_EXPONENT)
    new_height = np.clip(height + cone, 0.0, 1.0).astype(_F)
    ash = _F(cfg.volcano_ash_fertility) * np.exp(-((r / _F(_ASH_REACH * radius)) ** 2))
    new_fertility = fertility + ash * (1.0 - fertility)
    new_fertility = np.where(
        r < _LAVA_REACH * radius, _F(cfg.volcano_lava_fertility), new_fertility
    )
    return new_height, new_fertility.astype(_F)


def apply_earthquake(
    geo: Geometry, height: Grid, x: float, y: float, radius: float, throw: float, angle: float
) -> Grid:
    """Slip a fault through (x, y): one side rises, the other sinks, fading with distance."""
    across = (geo.xx - _F(x)) * _F(math.cos(angle)) + (geo.yy - _F(y)) * _F(math.sin(angle))
    step = np.tanh(across / _F(_FAULT_WIDTH_CELLS))
    reach = np.exp(_distance(geo, x, y) ** 2 * _F(-0.5 / (radius * radius)))
    shift = _F(0.5 * throw) * step * reach * geo.edge_mask
    return np.clip(height + shift, 0.0, 1.0).astype(_F)


def apply_crater(
    cfg: TerrainConfig,
    geo: Geometry,
    height: Grid,
    fertility: Grid,
    x: float,
    y: float,
    radius: float,
    depth: float,
) -> tuple[Grid, Grid]:
    """Dig a bowl with a raised rim; the bowl loses most of its fertility."""
    q = _distance(geo, x, y) / _F(radius)
    bowl = np.where(q < 1.0, -_F(depth) * (1.0 - q * q), 0.0)
    rim_height = _F(cfg.crater_rim_fraction * depth)
    rim_slope = (q - 1.0) / _F(_RIM_REACH - 1.0)
    rim = np.where((q >= 1.0) & (q < _RIM_REACH), rim_height * (1.0 - rim_slope), 0.0)
    new_height = np.clip(height + bowl + rim, 0.0, 1.0).astype(_F)
    new_fertility = np.where(q < 1.0, fertility * _F(cfg.crater_fertility_factor), fertility)
    return new_height, new_fertility.astype(_F)


# --- Landmasses -------------------------------------------------------------------------


def label_landmasses(land: Mask) -> tuple[Labels, NDArray[np.int64]]:
    """Label 4-connected land. Returns (labels, sizes): label 0 is sea, sizes[0] is 0.

    Rows are cut into horizontal runs of land; runs touching vertically are merged with a
    union-find over runs (hundreds of runs, not thousands of cells).
    """
    h, w = land.shape
    starts = land.copy()
    starts[:, 1:] &= ~land[:, :-1]
    run_of_cell = np.cumsum(starts.ravel(), dtype=np.int64).reshape(h, w)
    n_runs = int(run_of_cell[-1, -1])
    if n_runs == 0:
        return np.zeros((h, w), dtype=np.int32), np.zeros(1, dtype=np.int64)

    touching = land[:-1] & land[1:]
    base = n_runs + 1
    pairs = np.unique(run_of_cell[:-1][touching] * base + run_of_cell[1:][touching])
    parent = list(range(base))

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for code in cast(list[int], pairs.tolist()):
        a, b = find(code // base), find(code % base)
        if a != b:
            parent[max(a, b)] = min(a, b)

    roots = np.array([find(i) for i in range(1, base)], dtype=np.int64)
    _, component = np.unique(roots, return_inverse=True)
    label_of_run = np.concatenate([[0], component + 1])
    labels = np.where(land, label_of_run[run_of_cell], 0).astype(np.int32)
    sizes = np.bincount(labels.ravel()).astype(np.int64)
    sizes[0] = 0
    return labels, sizes


def landmass_changes(
    before: tuple[Labels, NDArray[np.int64]],
    after: tuple[Labels, NDArray[np.int64]],
    min_cells: int,
) -> tuple[list[int], list[int]]:
    """Compare two labellings. Returns (splits, rejoins) among landmasses ≥ ``min_cells``.

    ``splits`` holds, for each old landmass now in several pieces, the number of pieces;
    ``rejoins`` holds, for each new landmass made of several old ones, how many merged.
    """
    (old, old_sizes), (new, new_sizes) = before, after
    shared = (old > 0) & (new > 0)
    o, n = old[shared].astype(np.int64), new[shared].astype(np.int64)
    big = (old_sizes[o] >= min_cells) & (new_sizes[n] >= min_cells)
    base = len(new_sizes)
    links = np.unique(o[big] * base + n[big])
    pieces = np.bincount(links // base)
    sources = np.bincount(links % base)
    return (
        cast(list[int], pieces[pieces >= 2].tolist()),
        cast(list[int], sources[sources >= 2].tolist()),
    )


# --- Subsystem --------------------------------------------------------------------------


class Terrain:
    """The terrain subsystem. Read its grids through the properties; never mutate them."""

    def __init__(self, cfg: TerrainConfig) -> None:
        self._cfg = cfg
        self._geo = geometry(cfg)
        shape = (cfg.grid_height, cfg.grid_width)
        self._height: Grid = np.zeros(shape, dtype=_F)
        self._fertility: Grid = np.zeros(shape, dtype=_F)
        self._hotspots = np.zeros((cfg.hotspot_count, 7), dtype=np.float64)
        self._sea_phases = (0.0, 0.0)
        self._sea_level = cfg.sea_base
        self._continent_seeds = (0, 0, 0)
        self._roughness_seed = 0
        # Derived from the persisted fields by _refresh().
        self._continents = (self._height, self._height, self._height)
        self._roughness: Grid = np.zeros(shape, dtype=_F)
        self._labels: tuple[Labels, NDArray[np.int64]] = label_landmasses(self._height > 1.0)
        # Vegetation cover in [0, 1], set by flora before terrain ticks; None = bare.
        self._cover: Grid | None = None

    @property
    def name(self) -> str:
        return TERRAIN

    # -- views --

    @property
    def height(self) -> Grid:
        return self._height

    @property
    def fertility(self) -> Grid:
        return self._fertility

    @property
    def sea_level(self) -> float:
        return self._sea_level

    @property
    def land(self) -> Mask:
        return self._height > self._sea_level

    @property
    def land_fraction(self) -> float:
        return float(np.count_nonzero(self.land)) / self._height.size

    @property
    def landmass_labels(self) -> Labels:
        """0 for sea, 1…n for each 4-connected land area (of any size)."""
        return self._labels[0]

    @property
    def landmass_count(self) -> int:
        """Number of landmasses of at least ``landmass_min_cells`` cells."""
        return int(np.count_nonzero(self._labels[1] >= self._cfg.landmass_min_cells))

    @property
    def hotspots(self) -> NDArray[np.float64]:
        """Rows of (x, y, vx, vy, radius, rate per year, remaining years)."""
        return self._hotspots

    def set_vegetation_cover(self, cover: Grid | None) -> None:
        """Erosion hook for flora: cover in [0, 1] per cell, or None for bare ground."""
        self._cover = cover

    # -- subsystem interface --

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        cfg, rng = self._cfg, ctx.rng
        seeds = cast(list[int], rng.integers(0, 2**63, size=3).tolist())
        self._continent_seeds = (seeds[0], seeds[1], seeds[2])
        self._continents = continent_fields(cfg, self._continent_seeds)
        self._height, self._fertility = generate(
            cfg, self._geo, self._continents, rng, _years(ctx.t_ms)
        )
        self._sea_phases = (rng.uniform(0.0, 2.0 * math.pi), rng.uniform(0.0, 2.0 * math.pi))
        self._hotspots = np.array(
            [spawn_hotspot(cfg, rng, k) for k in range(cfg.hotspot_count)], dtype=np.float64
        ).reshape(cfg.hotspot_count, 7)
        self._roughness_seed = int(rng.integers(0, 2**63))
        self._sea_level = sea_level(cfg, _years(ctx.t_ms), self._sea_phases)
        self._refresh()
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        cfg, geo, rng = self._cfg, self._geo, ctx.rng
        dt_years = ctx.dt_s / SECONDS_PER_YEAR
        outputs: list[OutputEvent] = []

        advance_hotspots(cfg, self._hotspots, rng, dt_years)
        uplift = uplift_rate(cfg, geo, self._hotspots, self._roughness)
        height = (self._height + _F(dt_years) * uplift).astype(_F, copy=False)
        template = shape_island(
            cfg, geo, continent_noise(cfg, self._continents, _years(ctx.t_ms), None)
        )
        height = relax(cfg, height, template, dt_years)
        height, fertility, events = self._random_events(ctx, height, self._fertility, dt_years)
        outputs += events

        eroded = erode(cfg, height, self._cover, dt_years)
        fertility = move_fertility(cfg, fertility, eroded - height)
        height = np.clip(eroded, 0.0, 1.0).astype(_F)

        self._sea_level = sea_level(cfg, _years(ctx.t_ms), self._sea_phases)
        settle = _F(1.0 - math.exp(-cfg.marine_sediment_rate_per_year * dt_years))
        underwater = height <= self._sea_level
        richer = np.maximum(fertility, _F(cfg.fertility_max))
        fertility = np.where(underwater, fertility + settle * (richer - fertility), fertility)

        self._height, self._fertility = height, fertility.astype(_F)
        outputs += self._relabel(ctx.t_ms)
        return outputs

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {
            "height": self._height.copy(),
            "fertility": self._fertility.copy(),
            "hotspots": self._hotspots.copy(),
            "sea_phases": list(self._sea_phases),
            "sea_level": self._sea_level,
            "continent_seeds": list(self._continent_seeds),
            "roughness_seed": self._roughness_seed,
        }

    def set_state(self, tree: Tree) -> None:
        shape = (self._cfg.grid_height, self._cfg.grid_width)
        height = np.array(tree["height"], dtype=_F)
        fertility = np.array(tree["fertility"], dtype=_F)
        if height.shape != shape or fertility.shape != shape:
            raise ValueError(f"saved terrain is {height.shape}, config expects {shape}")
        self._height, self._fertility = height, fertility
        self._hotspots = np.array(tree["hotspots"], dtype=np.float64).reshape(-1, 7)
        phases = cast(list[float], tree["sea_phases"])
        self._sea_phases = (float(phases[0]), float(phases[1]))
        self._sea_level = float(tree["sea_level"])
        seeds = cast(list[int], tree["continent_seeds"])
        self._continent_seeds = (int(seeds[0]), int(seeds[1]), int(seeds[2]))
        self._roughness_seed = int(tree["roughness_seed"])
        self._refresh()

    # -- internals --

    def _refresh(self) -> None:
        """Rebuild everything derived from the persisted fields."""
        cfg = self._cfg
        self._continents = continent_fields(cfg, self._continent_seeds)
        self._roughness = wave_noise(
            Generator(PCG64(self._roughness_seed)),
            cfg.grid_height,
            cfg.grid_width,
            2.0 * cfg.hotspot_radius_min_cells,
            _COARSE_OCTAVES,
            0.5,
        )
        self._labels = label_landmasses(self.land)

    def _relabel(self, t_ms: int) -> list[OutputEvent]:
        before, after = self._labels, label_landmasses(self.land)
        self._labels = after
        splits, rejoins = landmass_changes(before, after, self._cfg.landmass_min_cells)
        count = self.landmass_count
        outputs: list[OutputEvent] = [LandmassSplit(t_ms, parts, count) for parts in splits]
        outputs += [LandmassesRejoined(t_ms, parts, count) for parts in rejoins]
        return outputs

    def _event_site(self, rng: Generator, lifting_only: bool) -> tuple[float, float]:
        """A point near a hotspot (tectonic events), or anywhere inside the margin."""
        cfg, spots = self._cfg, self._hotspots
        if lifting_only:
            spots = spots[spots[:, _RATE] > 0.0]
        margin = cfg.edge_margin_cells
        if spots.shape[0] == 0:
            return (
                float(rng.uniform(margin, cfg.grid_width - 1 - margin)),
                float(rng.uniform(margin, cfg.grid_height - 1 - margin)),
            )
        spot = spots[int(rng.integers(0, spots.shape[0]))]
        sx, sy, spread = float(spot[_X]), float(spot[_Y]), 0.5 * float(spot[_RADIUS])
        x = sx + float(rng.normal(0.0, spread))
        y = sy + float(rng.normal(0.0, spread))
        return (
            min(max(x, margin), cfg.grid_width - 1 - margin),
            min(max(y, margin), cfg.grid_height - 1 - margin),
        )

    def _random_events(
        self, ctx: Context, height: Grid, fertility: Grid, dt_years: float
    ) -> tuple[Grid, Grid, list[OutputEvent]]:
        cfg, geo, rng, t_ms = self._cfg, self._geo, ctx.rng, ctx.t_ms
        outputs: list[OutputEvent] = []
        # One uniform draw per event kind per tick, whether or not it fires.
        if rng.random() < cfg.volcano_rate_per_year * dt_years:
            x, y = self._event_site(rng, lifting_only=True)
            radius = float(rng.uniform(cfg.volcano_radius_min_cells, cfg.volcano_radius_max_cells))
            cone = float(rng.uniform(cfg.volcano_height_min, cfg.volcano_height_max))
            height, fertility = apply_volcano(cfg, geo, height, fertility, x, y, radius, cone)
            outputs.append(VolcanoErupted(t_ms, x, y, radius, cone))
        if rng.random() < cfg.earthquake_rate_per_year * dt_years:
            x, y = self._event_site(rng, lifting_only=False)
            radius = float(
                rng.uniform(cfg.earthquake_radius_min_cells, cfg.earthquake_radius_max_cells)
            )
            throw = float(rng.uniform(cfg.earthquake_throw_min, cfg.earthquake_throw_max))
            angle = float(rng.uniform(0.0, math.pi))
            height = apply_earthquake(geo, height, x, y, radius, throw, angle)
            outputs.append(EarthquakeStruck(t_ms, x, y, radius, throw))
        if rng.random() < cfg.crater_rate_per_year * dt_years:
            margin = cfg.edge_margin_cells
            x = float(rng.uniform(margin, cfg.grid_width - 1 - margin))
            y = float(rng.uniform(margin, cfg.grid_height - 1 - margin))
            radius = float(rng.uniform(cfg.crater_radius_min_cells, cfg.crater_radius_max_cells))
            depth = float(rng.uniform(cfg.crater_depth_min, cfg.crater_depth_max))
            height, fertility = apply_crater(cfg, geo, height, fertility, x, y, radius, depth)
            outputs.append(CraterFormed(t_ms, x, y, radius, depth))
        return height, fertility, outputs


def _years(t_ms: int) -> float:
    return t_ms / MS_PER_SECOND / SECONDS_PER_YEAR
