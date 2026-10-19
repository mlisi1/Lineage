"""Flora: a vegetation grid with evolving plant populations, and wildfire.

Each cell holds at most one plant population: a biomass in [0, 1], an 8-gene genome and
a set of rare genes. Once per sim-day (`Flora.tick`):

1. **Flooding** — plants under the sea die (mangroves survive shallow water).
2. **Growth** — logistic, scaled by suitability (temperature and fertility) and by the
   plant's trade-offs; mortality and winter dieback remove biomass.
3. **Soil building** — plants raise the terrain's fertility toward a cap set by their
   stature.
4. **Dispersal** — plants seed into neighbouring cells and, by wind, into far ones.
   A seed establishes if the site suits it, it finds light under the resident's canopy,
   and it out-competes the resident: this is what drives succession.
5. **Seed rain** — a few seeds with random genomes arrive from outside.
6. **Feedback** — vegetation cover is handed to the terrain (erosion and leaching).

`Wildfire` runs once per sim-hour: lightning ignites dry vegetation, fire spreads between
neighbouring cells that carry fuel (so it stops at water and bare ground) and burns out.

Grids are indexed ``[y, x]``; the genome grid is ``uint8`` of shape (8, height, width),
gene value = byte / 255.
"""

from __future__ import annotations

import math
from enum import IntEnum, IntFlag
from typing import Any, cast

import numpy as np
from numpy.random import Generator
from numpy.typing import NDArray

from lineage_sim.clock import SECONDS_PER_YEAR, Instant, Season
from lineage_sim.config import FloraConfig
from lineage_sim.events import FireEnded, FireStarted, InputEvent, OutputEvent
from lineage_sim.rng import FIRE, FLORA
from lineage_sim.state.schema import Tree
from lineage_sim.subsystem import Context
from lineage_sim.terrain import Terrain

Grid = NDArray[np.float32]
Mask = NDArray[np.bool_]
Bytes = NDArray[np.uint8]
Index = NDArray[np.intp]

_F = np.float32
_GENE_MAX = 255.0
_HOURS_PER_YEAR = SECONDS_PER_YEAR / 3600.0
_DAYS_PER_YEAR = SECONDS_PER_YEAR / 86_400.0
# Share of the seedling biomass below which a population is gone.
_DEATH_SHARE = 0.25
# Shortest wind-dispersal jump, in cells (shorter jumps are the neighbour offsets).
_MIN_FAR_JUMP = 2.0
_NEIGHBOURS = ((0, 1), (0, -1), (1, 0), (-1, 0))
# Middle of each season as a phase of the year starting at spring; summer peaks warmth.
_SEASON_INDEX = {Season.SPRING: 0, Season.SUMMER: 1, Season.AUTUMN: 2, Season.WINTER: 3}
_SUMMER_PEAK_PHASE = 1.5 / 4.0


class Gene(IntEnum):
    """The eight plant genes. Each is in [0, 1] and has a benefit and a cost."""

    HEIGHT = 0  # stature: taller shades others, but grows slower and needs richer soil
    GROWTH = 1  # growth speed; fast growers die young
    COLD = 2  # 0 warm-lowland specialist … 1 cold-highland specialist
    FRUGALITY = 3  # tolerance of poor soil, paid in growth rate
    SHADE = 4  # seedlings establish under a canopy, paid in growth rate
    SEED = 5  # 0 light wind-borne seed (far) … 1 heavy fruit (near, establishes better)
    EVERGREEN = 6  # keeps its biomass through winter, paid in growth rate
    DEFENCE = 7  # refuses grazers, paid in growth rate


GENE_COUNT = len(Gene)


class Rare(IntFlag):
    """Rare plant genes: an extreme bonus at a real cost. Stored as a bit mask per cell."""

    FIRE_PINE = 1  # survives fire
    NITROGEN_FIXER = 2  # grows on poor ground and builds soil fast
    MANGROVE = 4  # lives in shallow water
    POISONOUS = 8  # grazers refuse much of it, and what they eat costs them energy
    FRUITING = 16  # fruit carried far by animals; grazers relish it
    EMERGENT = 32  # a crown above the canopy: shades all, but needs rich soil and breaks in wind


RARE_GENES = tuple(Rare)


class Cover(IntEnum):
    """Land-cover class of a cell, for maps, statistics and (later) the renderer."""

    WATER = 0
    BARE = 1
    LICHEN = 2
    GRASS = 3
    SHRUB = 4
    BROADLEAF = 5
    CONIFER = 6
    BURNT = 7


PLANT_FORMS = (Cover.LICHEN, Cover.GRASS, Cover.SHRUB, Cover.BROADLEAF, Cover.CONIFER)
# What grazers can tell apart by sight (M5): low growth and woody growth.
LOW_FORMS = (Cover.LICHEN, Cover.GRASS)
WOODY_FORMS = (Cover.SHRUB, Cover.BROADLEAF, Cover.CONIFER)
TREE_FORMS = (Cover.BROADLEAF, Cover.CONIFER)


# --- Climate ----------------------------------------------------------------------------


def warmth(instant: Instant) -> float:
    """Seasonal warmth in [-1, 1]: +1 in mid-summer, -1 in mid-winter (either hemisphere)."""
    phase = (_SEASON_INDEX[instant.season] + instant.season_progress) / 4.0
    return math.cos(2.0 * math.pi * (phase - _SUMMER_PEAK_PHASE))


def lowland_temperature(cfg: FloraConfig, season_warmth: float) -> float:
    return cfg.temperature_mean + cfg.temperature_season_amplitude * season_warmth


def temperature(cfg: FloraConfig, season_warmth: float, elevation: Grid) -> Grid:
    """Temperature index per cell; ``elevation`` is height above the sea (≤ 0 is sea)."""
    cooling = _F(cfg.temperature_lapse_per_height) * np.maximum(elevation, _F(0.0))
    return (_F(lowland_temperature(cfg, season_warmth)) - cooling).astype(_F)


def snow_cover(cfg: FloraConfig, season_warmth: float, elevation: Grid) -> Grid:
    """Depth of lying snow per cell in [0, 1]: none where the temperature index is at or
    above ``snow_below_temperature``, full ``snow_depth_span`` below it; none on the sea.

    Derived from the season and the height, never stored. The renderer draws it (R1);
    nothing in the simulation depends on it yet.
    """
    cold = _F(cfg.snow_below_temperature) - temperature(cfg, season_warmth, elevation)
    depth = np.clip(cold / _F(cfg.snow_depth_span), 0.0, 1.0)
    return np.where(elevation > 0, depth, _F(0.0)).astype(_F)


# --- Traits derived from the genome -----------------------------------------------------
# ``genes`` is a float array of shape (8, …) in [0, 1]; ``rare`` a uint8 mask of shape (…).


def has(rare: Bytes, gene: Rare) -> Mask:
    return (rare & np.uint8(gene)) != 0


def optimum_temperature(cfg: FloraConfig, genes: Grid) -> Grid:
    span = _F(cfg.optimum_warm - cfg.optimum_cold)
    return _F(cfg.optimum_warm) - span * genes[Gene.COLD]


def fertility_need(cfg: FloraConfig, genes: Grid, rare: Bytes) -> Grid:
    """Fertility at which the plant grows at full rate."""
    need = (
        _F(cfg.need_base)
        + _F(cfg.need_height) * genes[Gene.HEIGHT]
        - _F(cfg.need_frugality) * genes[Gene.FRUGALITY]
    )
    relief = np.where(has(rare, Rare.NITROGEN_FIXER), _F(1.0 - cfg.nitrogen_fixer_need_relief), 1)
    greed = np.where(has(rare, Rare.EMERGENT), _F(1.0 + cfg.emergent_need_factor), _F(1.0))
    return np.maximum(need * relief * greed, _F(cfg.need_floor)).astype(_F)


def stature(cfg: FloraConfig, genes: Grid, rare: Bytes) -> Grid:
    """Height that counts for light: the height gene, raised by a crown above it for
    emergents (in proportion to their height: an emergent grass stays low)."""
    crown = np.where(has(rare, Rare.EMERGENT), _F(1.0 + cfg.emergent_height_bonus), _F(1.0))
    return (genes[Gene.HEIGHT] * crown).astype(_F)


def suitability(cfg: FloraConfig, genes: Grid, rare: Bytes, temp: Grid, fertility: Grid) -> Grid:
    """How well a plant does at a site, in [0, 1]: temperature fit × fertility supply."""
    offset = (temp - optimum_temperature(cfg, genes)) / _F(cfg.temperature_tolerance)
    fit = np.exp(_F(-0.5) * offset * offset)
    supply = np.clip(fertility / fertility_need(cfg, genes, rare), 0.0, 1.0) ** _F(
        cfg.need_sharpness
    )
    return (fit * supply).astype(_F)


def growth_rate(cfg: FloraConfig, genes: Grid, rare: Bytes) -> Grid:
    """Logistic growth rate per year in ideal conditions, after every trade-off."""
    low = cfg.growth_rate_min_share
    rate = _F(cfg.growth_rate_max_per_year) * (_F(low) + _F(1.0 - low) * genes[Gene.GROWTH])
    rate = rate / (_F(1.0) + _F(cfg.stature_slowdown) * genes[Gene.HEIGHT])
    rate = rate * (_F(1.0) - _F(cfg.cost_frugality) * genes[Gene.FRUGALITY])
    rate = rate * (_F(1.0) - _F(cfg.cost_shade) * genes[Gene.SHADE])
    rate = rate * (_F(1.0) - _F(cfg.cost_defence) * genes[Gene.DEFENCE])
    rate = rate * (_F(1.0) - _F(cfg.cost_evergreen) * genes[Gene.EVERGREEN])
    for gene, cost in (
        (Rare.FIRE_PINE, cfg.fire_pine_growth_cost),
        (Rare.NITROGEN_FIXER, cfg.nitrogen_fixer_growth_cost),
        (Rare.MANGROVE, cfg.mangrove_growth_cost),
        (Rare.POISONOUS, cfg.poisonous_growth_cost),
        (Rare.FRUITING, cfg.fruiting_growth_cost),
        (Rare.EMERGENT, cfg.emergent_growth_cost),
    ):
        factor: Grid = np.where(has(rare, gene), _F(1.0 - cost), _F(1.0))
        rate = rate * factor
    return rate.astype(_F)


def exposure(cfg: FloraConfig, elevation: Grid) -> Grid:
    """Wind exposure of a site in [0, 1]: full on the wave-swept shore and on summits,
    none in the sheltered ground between."""
    shore = _F(1.0) - elevation / _F(cfg.shore_span)
    summit = (elevation - _F(cfg.treeline_height)) / _F(cfg.treeline_span)
    return np.clip(np.maximum(shore, summit), 0.0, 1.0).astype(_F)


def mortality(cfg: FloraConfig, genes: Grid, rare: Bytes, elevation: Grid) -> Grid:
    """Biomass loss rate per year: fast growers die young, tall plants are long-lived,
    but wind breaks tall plants where the site is exposed. Mangroves are built for the
    shore: in the water and on the beach they feel no exposure. Emergent crowns catch
    emergent_wind_factor times more wind."""
    rate = _F(cfg.mortality_base_per_year) + _F(cfg.mortality_growth_per_year) * genes[Gene.GROWTH]
    rate = rate * (_F(1.0) - _F(cfg.mortality_stature_relief) * genes[Gene.HEIGHT])
    exposed = exposure(cfg, elevation)
    at_shore = elevation < _F(cfg.shore_span)
    exposed = np.where(has(rare, Rare.MANGROVE) & at_shore, _F(0.0), exposed)
    exposed = np.where(has(rare, Rare.EMERGENT), exposed * _F(cfg.emergent_wind_factor), exposed)
    return (rate + _F(cfg.exposure_per_year) * exposed * genes[Gene.HEIGHT]).astype(_F)


def viability(cfg: FloraConfig, genes: Grid, rare: Bytes, fit: Grid, elevation: Grid) -> Grid:
    """Equilibrium biomass in [0, 1] a plant would reach at a site: 0 where its mortality
    there (exposure included) exceeds its growth."""
    growth = growth_rate(cfg, genes, rare) * fit
    return np.clip(
        _F(1.0) - mortality(cfg, genes, rare, elevation) / np.maximum(growth, _F(1e-6)),
        0.0,
        1.0,
    ).astype(_F)


def winter_dieback(cfg: FloraConfig, genes: Grid, temp: Grid) -> Grid:
    """Loss rate per year of the biomass above the root reserve when it is colder than
    the plant tolerates.

    Low, non-evergreen plants die back; evergreens and woody plants keep their biomass.
    """
    tolerance = _F(cfg.temperature_tolerance)
    stress = np.clip((optimum_temperature(cfg, genes) - tolerance - temp) / tolerance, 0.0, 1.0)
    exposed = (_F(1.0) - genes[Gene.EVERGREEN]) * (_F(1.0) - genes[Gene.HEIGHT])
    return (_F(cfg.winter_dieback_per_year) * stress * exposed).astype(_F)


def canopy(cfg: FloraConfig, biomass: Grid, height: Grid) -> Grid:
    """Share of light a population intercepts, in [0, 1]. ``height`` is its `stature`."""
    base = _F(cfg.canopy_base)
    return np.minimum(biomass * (base + (_F(1.0) - base) * height), _F(1.0)).astype(_F)


def soil_cap(cfg: FloraConfig, genes: Grid) -> Grid:
    return (_F(cfg.soil_cap_base) + _F(cfg.soil_cap_height) * genes[Gene.HEIGHT]).astype(_F)


def classify_form(cfg: FloraConfig, genes: Grid) -> Bytes:
    """Plant form (a `Cover` value among `PLANT_FORMS`) of a genome."""
    height = genes[Gene.HEIGHT]
    form = np.full(height.shape, Cover.GRASS, dtype=np.uint8)
    lichen = (height < cfg.form_lichen_max_height) & (
        genes[Gene.FRUGALITY] >= cfg.form_lichen_min_frugality
    )
    form[lichen] = Cover.LICHEN
    form[height >= cfg.form_grass_max_height] = Cover.SHRUB
    tree = height >= cfg.form_shrub_max_height
    form[tree] = Cover.BROADLEAF
    form[tree & (genes[Gene.EVERGREEN] >= cfg.form_conifer_min_evergreen)] = Cover.CONIFER
    return form


def classify_cover(cfg: FloraConfig, biomass: Grid, genes: Grid, scorch: Grid, land: Mask) -> Bytes:
    """Land-cover class of every cell."""
    cover = np.where(land, np.uint8(Cover.BARE), np.uint8(Cover.WATER))
    cover = np.where(land & (scorch > 0), np.uint8(Cover.BURNT), cover)
    return np.where(biomass >= cfg.cover_min_biomass, classify_form(cfg, genes), cover).astype(
        np.uint8
    )


def species_keys(genome: Bytes, rare: Bytes) -> NDArray[np.int64]:
    """A coarse species key per cell: each gene cut at its midpoint, plus the rare mask.

    A placeholder for real clustering (M6): plants with the same key play the same role.
    """
    key = rare.astype(np.int64)
    for gene in range(GENE_COUNT):
        key = key * 2 + (genome[gene] >= 128)
    return key


# --- Flora subsystem --------------------------------------------------------------------


class Flora:
    """The vegetation subsystem. Read its grids through the properties."""

    def __init__(self, cfg: FloraConfig, terrain: Terrain) -> None:
        self._cfg = cfg
        self._terrain = terrain
        shape = terrain.height.shape
        self._biomass: Grid = np.zeros(shape, dtype=_F)
        self._genome: Bytes = np.zeros((GENE_COUNT, *shape), dtype=np.uint8)
        # Plant form of every cell, derived from the genome; None when the genome changed.
        self._forms: Bytes | None = None
        self._form_masks: tuple[Mask, Mask] | None = None
        self._rare: Bytes = np.zeros(shape, dtype=np.uint8)
        self._scorch: Grid = np.zeros(shape, dtype=_F)
        # Daylight in [0, 1], set by the presence model (M8); scales growth.
        self._daylight = 1.0

    @property
    def name(self) -> str:
        return FLORA

    # -- views --

    @property
    def config(self) -> FloraConfig:
        return self._cfg

    @property
    def biomass(self) -> Grid:
        return self._biomass

    @property
    def genome(self) -> Bytes:
        """uint8 genes of shape (8, height, width); meaningful where biomass > 0."""
        return self._genome

    @property
    def rare(self) -> Bytes:
        return self._rare

    @property
    def scorch(self) -> Grid:
        """1 just after a fire, decaying to 0 over ``scorch_days``."""
        return self._scorch

    def genes(self) -> Grid:
        """The genome as floats in [0, 1], shape (8, height, width)."""
        return self._genome.astype(_F) / _F(_GENE_MAX)

    def cover(self) -> Bytes:
        """`Cover` class of every cell."""
        return classify_cover(
            self._cfg, self._biomass, self.genes(), self._scorch, self._terrain.land
        )

    def cover_shares(self) -> dict[Cover, float]:
        """Share of the land (cells above the sea) in each class except water."""
        land = self._terrain.land
        cells = max(1, int(np.count_nonzero(land)))
        counts = np.bincount(self.cover()[land], minlength=len(Cover))
        return {c: float(counts[c]) / cells for c in Cover if c is not Cover.WATER}

    def closed_forest_share(self) -> float:
        """Share of the land under closed tree canopy."""
        land = self._terrain.land
        form = classify_form(self._cfg, self.genes())
        closed = (
            land
            & (self._biomass >= self._cfg.closed_canopy_biomass)
            & ((form == Cover.BROADLEAF) | (form == Cover.CONIFER))
        )
        return float(np.count_nonzero(closed)) / max(1, int(np.count_nonzero(land)))

    def species_count(self) -> int:
        """Number of genome clusters holding at least ``species_min_cells`` cells."""
        alive = self._biomass >= self._cfg.cover_min_biomass
        if not alive.any():
            return 0
        _, counts = np.unique(
            species_keys(self._genome[:, alive], self._rare[alive]), return_counts=True
        )
        return int(np.count_nonzero(counts >= self._cfg.species_min_cells))

    def snow(self, instant: Instant) -> Grid:
        """Depth of lying snow per cell at ``instant`` (`snow_cover`)."""
        elevation = (self._terrain.height - _F(self._terrain.sea_level)).astype(_F)
        return snow_cover(self._cfg, warmth(instant), elevation)

    def set_daylight(self, level: float) -> None:
        """Hook for the presence model: daylight in [0, 1] scales growth."""
        self._daylight = min(max(level, 0.0), 1.0)

    # -- hooks for other subsystems --

    def graze(self, ys: Index, xs: Index, demand: Grid) -> Grid:
        """Grazers ask for ``demand`` biomass at cells (ys, xs); returns what each gets.

        Defended and poisonous plants refuse part of every bite; several grazers on one
        cell share what is there in proportion to their demand. Roots are out of reach:
        biomass up to ``grazing_reserve_biomass`` is never eaten, so grazed plants regrow.
        Only the grazed cells are touched.
        """
        cfg = self._cfg
        defence = self._genome[Gene.DEFENCE, ys, xs].astype(_F) / _F(_GENE_MAX)
        wanted = demand.astype(_F) * (_F(1.0) - _F(cfg.defence_strength) * defence)
        poisonous = has(self._rare[ys, xs], Rare.POISONOUS)
        wanted = np.where(poisonous, wanted * _F(1.0 - cfg.poisonous_refusal), wanted).astype(_F)
        width = self._biomass.shape[1]
        cells, group = np.unique(ys * width + xs, return_inverse=True)
        cell_y, cell_x = cells // width, cells % width
        asked = np.bincount(group, weights=wanted, minlength=cells.size)
        there = self._biomass[cell_y, cell_x].astype(np.float64)
        reachable = np.maximum(there - cfg.grazing_reserve_biomass, 0.0)
        share = np.minimum(1.0, reachable / np.maximum(asked, 1e-12))
        eaten = (wanted * share[group]).astype(_F)
        left = there - np.bincount(group, weights=eaten, minlength=cells.size)
        self._biomass[cell_y, cell_x] = np.maximum(left, 0.0).astype(_F)
        return eaten

    def forms(self) -> Bytes:
        """Plant form (a `Cover` value among `PLANT_FORMS`) of every cell's genome,
        whether or not anything grows there. Cached until the genome changes."""
        if self._forms is None:
            self._forms = classify_form(self._cfg, self.genes())
        return self._forms

    def form_masks(self) -> tuple[Mask, Mask]:
        """Cells whose genome is low growth (lichen, grass) and woody growth (shrub,
        trees). Cached with `forms`."""
        if self._form_masks is None:
            forms = self.forms()
            self._form_masks = (np.isin(forms, LOW_FORMS), np.isin(forms, WOODY_FORMS))
        return self._form_masks

    def defence_at(self, ys: Index, xs: Index) -> Grid:
        """Defence gene, in [0, 1], of the plants at cells (ys, xs)."""
        return self._genome[Gene.DEFENCE, ys, xs].astype(_F) / _F(_GENE_MAX)

    def meal_factor(self, ys: Index, xs: Index) -> Grid:
        """Multiplier on the energy grazers get from the plants at cells (ys, xs), from
        their rare genes: fruit is richer, poison costs more than it gives (negative)."""
        cfg, rare = self._cfg, self._rare[ys, xs]
        fruit = np.where(has(rare, Rare.FRUITING), _F(1.0 + cfg.fruiting_meal_bonus), _F(1.0))
        poison = np.where(has(rare, Rare.POISONOUS), _F(1.0 - cfg.poisonous_toxicity), _F(1.0))
        return (fruit * poison).astype(_F)

    def shade(self) -> Grid:
        """Share of sunlight the plants intercept on every cell, in [0, 1]."""
        return canopy(self._cfg, self._biomass, stature(self._cfg, self.genes(), self._rare))

    def grazeable(self) -> Grid:
        """Biomass grazers can reach in each cell (what they see as food)."""
        return np.maximum(self._biomass - _F(self._cfg.grazing_reserve_biomass), _F(0.0))

    def burn(self, ys: Index, xs: Index) -> None:
        """Cells (ys, xs) have burnt out: remove biomass, scorch the ground."""
        cfg = self._cfg
        genes = self._genome[:, ys, xs].astype(_F) / _F(_GENE_MAX)
        tree = genes[Gene.HEIGHT] >= cfg.form_shrub_max_height
        loss = np.where(tree, _F(cfg.fire_loss_tree), _F(cfg.fire_loss_low))
        resistant = has(self._rare[ys, xs], Rare.FIRE_PINE)
        loss = np.where(resistant, _F(1.0 - cfg.fire_pine_survival), loss)
        self._biomass[ys, xs] *= _F(1.0) - loss
        self._scorch[ys, xs] = _F(1.0)
        relative = np.zeros_like(self._biomass)
        relative[ys, xs] = _F(-cfg.fire_fertility_loss)
        self._terrain.adjust_fertility(relative * self._terrain.fertility)
        self._clear_dead()

    # -- subsystem interface --

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        return []  # bare rock: seed rain starts the succession

    def tick(self, ctx: Context) -> list[OutputEvent]:
        cfg, terrain, rng = self._cfg, self._terrain, ctx.rng
        dt_years = ctx.dt_s / SECONDS_PER_YEAR
        elevation = terrain.height - _F(terrain.sea_level)
        temp = temperature(cfg, warmth(ctx.instant), elevation)
        genes = self.genes()

        # 1. Flooding.
        shallow = elevation > _F(-cfg.mangrove_max_depth)
        habitable = terrain.land | (shallow & has(self._rare, Rare.MANGROVE))
        self._biomass[~habitable] = 0.0
        self._clear_dead()

        # 2. Growth, mortality, winter dieback.
        biomass = self._biomass
        fit = suitability(cfg, genes, self._rare, temp, terrain.fertility)
        gain = growth_rate(cfg, genes, self._rare) * fit * _F(self._daylight)
        above_reserve = np.maximum(biomass - _F(cfg.winter_reserve_biomass), _F(0.0))
        change = (
            gain * biomass * (_F(1.0) - biomass)
            - mortality(cfg, genes, self._rare, elevation) * biomass
            - winter_dieback(cfg, genes, temp) * above_reserve
        )
        self._biomass = np.clip(biomass + _F(dt_years) * change, 0.0, 1.0).astype(_F)
        self._clear_dead()

        # 3. Soil building.
        boost = np.where(
            has(self._rare, Rare.NITROGEN_FIXER), _F(cfg.nitrogen_fixer_soil_boost), _F(1.0)
        )
        room = np.maximum(soil_cap(cfg, genes) - terrain.fertility, _F(0.0))
        build = _F(1.0 - math.exp(-cfg.soil_build_rate_per_year * dt_years))
        terrain.adjust_fertility(build * boost * self._biomass * room)

        # 4–5. Dispersal and seed rain.
        self._scorch = np.maximum(
            self._scorch - _F(dt_years * _DAYS_PER_YEAR / cfg.scorch_days), _F(0.0)
        )
        self._disperse(rng, temp, elevation, dt_years)
        self._seed_rain(rng, temp, elevation, dt_years)

        # 6. Feedback to the terrain.
        terrain.set_vegetation_cover(self._biomass)
        return []

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {
            "biomass": self._biomass.copy(),
            "genome": self._genome.copy(),
            "rare": self._rare.copy(),
            "scorch": self._scorch.copy(),
        }

    def set_state(self, tree: Tree) -> None:
        shape = self._terrain.height.shape
        biomass = np.array(tree["biomass"], dtype=_F)
        genome = np.array(tree["genome"], dtype=np.uint8)
        if biomass.shape != shape or genome.shape != (GENE_COUNT, *shape):
            raise ValueError(f"saved flora is {biomass.shape}, terrain is {shape}")
        self._biomass, self._genome = biomass, genome
        self._forms = None
        self._form_masks = None
        self._rare = np.array(tree["rare"], dtype=np.uint8)
        self._scorch = np.array(tree["scorch"], dtype=_F)
        self._terrain.set_vegetation_cover(self._biomass)

    # -- internals --

    def _clear_dead(self) -> None:
        """Populations below the death threshold vanish; their genome is reset."""
        dead = self._biomass < _F(_DEATH_SHARE * self._cfg.seedling_biomass)
        self._biomass[dead] = 0.0
        self._genome[:, dead] = 0
        self._forms = None
        self._form_masks = None
        self._rare[dead] = 0

    def _disperse(self, rng: Generator, temp: Grid, elevation: Grid, dt_years: float) -> None:
        """Every plant seeds into its four neighbours and into a few far cells."""
        cfg = self._cfg
        h, w = self._biomass.shape
        offsets: list[tuple[int, int, bool]] = [(dy, dx, False) for dy, dx in _NEIGHBOURS]
        for _ in range(cfg.far_offsets_per_tick):
            jump = _MIN_FAR_JUMP + rng.exponential(cfg.wind_range_cells)
            angle = rng.uniform(0.0, 2.0 * math.pi)
            offsets.append((round(jump * math.sin(angle)), round(jump * math.cos(angle)), True))

        span = _F(1.0 - cfg.seed_min_biomass)
        attempts = _F(cfg.seed_rate_per_year * dt_years)
        for dy, dx, far in offsets:
            if abs(dy) >= h or abs(dx) >= w:
                rng.random((h, w), dtype=_F)  # keep the stream aligned
                continue
            # Seed production is read before this offset's establishments are written.
            ready = np.clip((self._biomass - _F(cfg.seed_min_biomass)) / span, 0.0, 1.0)
            seed_gene = self._genome[Gene.SEED].astype(_F) / _F(_GENE_MAX)
            if far:
                # Animals carry fruit far whatever the seed is like.
                fruit = has(self._rare, Rare.FRUITING)
                weight = np.where(fruit, _F(1.0), _F(1.0) - seed_gene).astype(_F)
            else:
                weight = _F(cfg.near_weight_wind) + _F(1.0 - cfg.near_weight_wind) * seed_gene
            chance = attempts * ready * weight
            lands = rng.random((h, w), dtype=_F) < chance
            src_y, src_x = np.nonzero(lands)
            dst_y, dst_x = src_y + dy, src_x + dx
            inside = (dst_y >= 0) & (dst_y < h) & (dst_x >= 0) & (dst_x < w)
            src_y, src_x, dst_y, dst_x = src_y[inside], src_x[inside], dst_y[inside], dst_x[inside]
            if src_y.size:
                self._establish(
                    rng,
                    dst_y,
                    dst_x,
                    self._genome[:, src_y, src_x],
                    self._rare[src_y, src_x],
                    temp,
                    elevation,
                )

    def _seed_rain(self, rng: Generator, temp: Grid, elevation: Grid, dt_years: float) -> None:
        """Seeds with random genomes arrive from outside the map."""
        h, w = self._biomass.shape
        count = int(rng.poisson(self._cfg.seed_rain_per_year * dt_years))
        if count == 0:
            return
        ys = rng.integers(0, h, size=count)
        xs = rng.integers(0, w, size=count)
        genome = rng.integers(0, 256, size=(GENE_COUNT, count), dtype=np.uint8)
        self._establish(
            rng, ys, xs, genome, np.zeros(count, dtype=np.uint8), temp, elevation, mutate=False
        )

    def _establish(
        self,
        rng: Generator,
        ys: Index,
        xs: Index,
        genome: Bytes,
        rare: Bytes,
        temp: Grid,
        elevation: Grid,
        *,
        mutate: bool = True,
    ) -> None:
        """Seeds with ``genome``/``rare`` (one column per seed) land on cells (ys, xs)."""
        cfg, terrain = self._cfg, self._terrain
        genes = genome.astype(_F) / _F(_GENE_MAX)
        site_temp, site_fertility = temp[ys, xs], terrain.fertility[ys, xs]
        depth_ok = elevation[ys, xs] > _F(-cfg.mangrove_max_depth)
        habitable = terrain.land[ys, xs] | (depth_ok & has(rare, Rare.MANGROVE))

        site_elevation = elevation[ys, xs]
        fit = suitability(cfg, genes, rare, site_temp, site_fertility)
        # A seed only takes where the plant could persist: suitability weighted by the
        # biomass it would reach there (zero above its tree line or on soil too poor).
        prospect = fit * viability(cfg, genes, rare, fit, site_elevation)
        chance = prospect ** _F(cfg.establishment_sharpness) * (
            _F(1.0) + _F(cfg.fruit_establishment_bonus) * genes[Gene.SEED]
        )

        resident_biomass = self._biomass[ys, xs]
        resident_genes = self._genome[:, ys, xs].astype(_F) / _F(_GENE_MAX)
        resident_rare = self._rare[ys, xs]
        resident_stature = stature(cfg, resident_genes, resident_rare)
        shade = canopy(cfg, resident_biomass, resident_stature)
        light = (_F(1.0) - shade) + shade * genes[Gene.SHADE]
        occupied = resident_biomass > 0
        base = _F(cfg.competition_base)
        score = prospect * (base + stature(cfg, genes, rare))
        resident_fit = suitability(cfg, resident_genes, resident_rare, site_temp, site_fertility)
        resident_prospect = resident_fit * viability(
            cfg, resident_genes, resident_rare, resident_fit, site_elevation
        )
        resident_score = resident_prospect * (base + resident_stature)
        lead = score - resident_score - _F(cfg.competition_margin)
        edge = np.clip(lead / _F(cfg.competition_softness), -30.0, 30.0)
        wins = np.where(occupied, _F(1.0) / (_F(1.0) + np.exp(-edge)), _F(1.0))

        chance = np.minimum(chance, _F(1.0)) * light * wins
        success = habitable & (rng.random(ys.size, dtype=_F) < chance)
        count = int(np.count_nonzero(success))
        if count == 0:
            return
        ys, xs, genome, rare = ys[success], xs[success], genome[:, success], rare[success]
        if mutate:
            step = rng.normal(0.0, cfg.mutation_sigma * _GENE_MAX, size=genome.shape)
            genome = np.clip(np.rint(genome + step), 0, 255).astype(np.uint8)
            for gene in RARE_GENES:
                carried = has(rare, gene)
                flip = rng.random(count) < np.where(
                    carried, cfg.rare_loss_probability, cfg.rare_gain_probability
                )
                rare = np.where(flip, rare ^ np.uint8(gene), rare).astype(np.uint8)
        kept = self._biomass[ys, xs] * _F(cfg.takeover_keep)
        self._genome[:, ys, xs] = genome
        self._forms = None
        self._form_masks = None
        self._rare[ys, xs] = rare
        self._biomass[ys, xs] = np.maximum(kept, _F(cfg.seedling_biomass))


# --- Wildfire subsystem -----------------------------------------------------------------


class Wildfire:
    """Lightning fires in the flora. Reports each fire's size when it goes out."""

    def __init__(self, cfg: FloraConfig, flora: Flora, terrain: Terrain) -> None:
        self._cfg = cfg
        self._flora = flora
        self._terrain = terrain
        self._shape: tuple[int, int] = (terrain.height.shape[0], terrain.height.shape[1])
        # Hours each cell still burns; 0 where nothing burns.
        self._burning: Grid = np.zeros(self._shape, dtype=_F)
        self._active = False
        self._burnt_cells = 0
        self._started_ms = 0
        self._flammability = np.zeros(len(Cover), dtype=_F)
        for cover, value in (
            (Cover.LICHEN, cfg.flammability_lichen),
            (Cover.GRASS, cfg.flammability_grass),
            (Cover.SHRUB, cfg.flammability_shrub),
            (Cover.BROADLEAF, cfg.flammability_broadleaf),
            (Cover.CONIFER, cfg.flammability_conifer),
        ):
            self._flammability[cover] = value

    @property
    def name(self) -> str:
        return FIRE

    @property
    def burning(self) -> Mask:
        return self._burning > 0

    def dryness(self, instant: Instant) -> float:
        """0 in the cool season, 1 at the height of a warm summer."""
        cfg = self._cfg
        lowland = lowland_temperature(cfg, warmth(instant))
        return min(max((lowland - cfg.fire_dry_temperature) / cfg.fire_dry_span, 0.0), 1.0)

    def ignite(self, y: int, x: int, t_ms: int) -> list[OutputEvent]:
        """Try to set cell (y, x) alight; nothing happens without fuel."""
        if not self._fuel()[y, x] or self._burning[y, x] > 0:
            return []
        self._burning[y, x] = self._cfg.fire_burn_hours
        if self._active:
            return []
        self._active, self._burnt_cells, self._started_ms = True, 0, t_ms
        return [FireStarted(t_ms, float(x), float(y))]

    def initialize(self, ctx: Context) -> list[OutputEvent]:
        return []

    def tick(self, ctx: Context) -> list[OutputEvent]:
        cfg, rng = self._cfg, ctx.rng
        hours = ctx.dt_s / 3600.0
        dryness = self.dryness(ctx.instant)
        outputs: list[OutputEvent] = []

        # One draw per tick whether or not lightning strikes, to keep the stream aligned.
        strike = rng.random() < cfg.fire_ignitions_per_year * dryness * hours / _HOURS_PER_YEAR
        if strike:
            rows, columns = self._shape
            y, x = int(rng.integers(0, rows)), int(rng.integers(0, columns))
            outputs += self.ignite(y, x, ctx.t_ms)
        if not self._active:
            return outputs

        ys, xs = np.nonzero(self._burning > 0)
        self._spread(rng, ys, xs, dryness, hours)
        self._burning[ys, xs] -= _F(hours)
        out = self._burning[ys, xs] <= 0
        if out.any():
            self._burning[ys[out], xs[out]] = 0.0
            self._flora.burn(ys[out], xs[out])
            self._burnt_cells += int(np.count_nonzero(out))
        if not (self._burning > 0).any():
            self._active = False
            duration = (ctx.t_ms - self._started_ms) / 3_600_000.0
            outputs.append(FireEnded(ctx.t_ms, self._burnt_cells, duration))
        return outputs

    def handle(self, event: InputEvent, ctx: Context) -> list[OutputEvent]:
        return []

    def get_state(self) -> Tree:
        return {
            "burning": self._burning.copy(),
            "active": self._active,
            "burnt_cells": self._burnt_cells,
            "started_ms": self._started_ms,
        }

    def set_state(self, tree: Tree) -> None:
        burning = np.array(tree["burning"], dtype=_F)
        if burning.shape != self._burning.shape:
            raise ValueError(f"saved fire grid is {burning.shape}")
        self._burning = burning
        self._active = bool(tree["active"])
        self._burnt_cells = int(tree["burnt_cells"])
        self._started_ms = int(tree["started_ms"])

    def _fuel(self) -> Mask:
        """Cells that can catch fire: enough biomass and not recently burnt."""
        flora = self._flora
        return (flora.biomass >= self._cfg.fire_min_fuel) & (flora.scorch <= 0)

    def _spread(self, rng: Generator, ys: Index, xs: Index, dryness: float, hours: float) -> None:
        cfg, flora = self._cfg, self._flora
        h, w = self._burning.shape
        weather = cfg.fire_wet_spread + (1.0 - cfg.fire_wet_spread) * dryness
        base = _F(1.0 - math.exp(-cfg.fire_spread_per_hour * weather * hours))
        fuel = self._fuel()
        form = classify_form(cfg, flora.genes())
        draws = cast(Any, rng.random((len(_NEIGHBOURS), ys.size), dtype=_F))
        for k, (dy, dx) in enumerate(_NEIGHBOURS):
            ny, nx = ys + dy, xs + dx
            inside = (ny >= 0) & (ny < h) & (nx >= 0) & (nx < w)
            ny, nx = ny[inside], nx[inside]
            chance = base * self._flammability[form[ny, nx]] * flora.biomass[ny, nx]
            catches = fuel[ny, nx] & (self._burning[ny, nx] <= 0) & (draws[k][inside] < chance)
            self._burning[ny[catches], nx[catches]] = cfg.fire_burn_hours
