"""Flora and wildfire: traits, scenarios on hand-built sites, and the world as a whole."""

from __future__ import annotations

import datetime as dt
import math
from dataclasses import replace
from typing import Any

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from lineage_sim import clock
from lineage_sim import flora as fl
from lineage_sim.config import Config, FloraConfig, Hemisphere
from lineage_sim.events import FireEnded, FireStarted, OutputEvent
from lineage_sim.flora import Cover, Flora, Gene, Rare, Wildfire
from lineage_sim.state import io
from lineage_sim.subsystem import Context
from lineage_sim.terrain import Terrain
from lineage_sim.world import World
from numpy.random import PCG64, Generator
from numpy.typing import NDArray

EPOCH_UNIX_MS = 1_772_323_200_000  # 2026-03-01 00:00 UTC
DAY_S = 86_400
# Final state of the default world, seed 42, after 200 days (no creatures yet).
GOLDEN_FLORA_SEED_42 = "759997a0f62d52547859888eb69ea48a55ea63230157b7dce51801cd0ce07a33"

Grid = NDArray[np.float32]
ROWS, COLUMNS = 40, 60
SEA = 0.42

# Hand-made genomes, by gene: HEIGHT GROWTH COLD FRUGALITY SHADE SEED EVERGREEN DEFENCE.
GRASS = (0.20, 0.90, 0.20, 0.40, 0.10, 0.20, 0.10, 0.10)
SHRUB = (0.45, 0.60, 0.20, 0.40, 0.30, 0.60, 0.30, 0.30)
BROADLEAF = (0.80, 0.50, 0.20, 0.20, 0.60, 0.80, 0.10, 0.20)
CONIFER = (0.80, 0.50, 0.60, 0.50, 0.50, 0.30, 0.90, 0.20)
LICHEN = (0.05, 0.50, 0.80, 0.90, 0.10, 0.10, 0.80, 0.10)


def _genes(*genome: float) -> Grid:
    """A single genome as a float array of shape (8, 1)."""
    return np.array(genome, dtype=np.float32).reshape(fl.GENE_COUNT, 1)


def _none() -> NDArray[np.uint8]:
    return np.zeros(1, dtype=np.uint8)


def _value(grid: Any) -> float:
    return float(np.asarray(grid).ravel()[0])


class Site:
    """A terrain frozen in place with a flora and a fire on it, ticked by hand."""

    def __init__(
        self,
        config: Config,
        height: Grid,
        fertility: float | Grid,
        *,
        flora: FloraConfig | None = None,
        seed: int = 1,
    ) -> None:
        rows, columns = height.shape
        self.config = config
        # No seeds from outside and no lightning unless a test asks for them.
        self.cfg = flora or replace(
            config.flora, seed_rain_per_year=0.0, fire_ignitions_per_year=0.0
        )
        terrain_cfg = replace(config.terrain, grid_height=rows, grid_width=columns)
        self.terrain = Terrain(terrain_cfg)
        self.terrain.set_state(
            {
                "height": height.astype(np.float32),
                "fertility": np.broadcast_to(np.float32(fertility), height.shape).copy(),
                "hotspots": np.zeros((0, 7)),
                "sea_phases": [0.0, 0.0],
                "sea_level": SEA,
                "continent_seeds": [1, 2, 3],
                "roughness_seed": 4,
            }
        )
        self.flora = Flora(self.cfg, self.terrain)
        self.fire = Wildfire(self.cfg, self.flora, self.terrain)
        self.rng = Generator(PCG64(seed))
        self.t_ms = 0

    def plant(self, cells: NDArray[np.bool_], genome: tuple[float, ...], biomass: float,
              rare: int = 0) -> None:  # fmt: skip
        state = self.flora.get_state()
        state["biomass"][cells] = biomass
        state["genome"][:, cells] = np.round(np.array(genome) * 255).astype(np.uint8)[:, None]
        state["rare"][cells] = rare
        self.flora.set_state(state)

    def _context(self, when: dt.date, dt_s: float) -> Context:
        unix_ms = clock.date_to_unix_ms(when) + self.t_ms % clock.MS_PER_DAY
        instant = clock.instant(unix_ms, 0, self.config.calendar)
        return Context(self.t_ms, dt_s, instant, self.rng)

    def grow(self, days: int, start: dt.date = dt.date(2026, 5, 1)) -> None:
        """Run daily flora ticks from ``start``."""
        for day in range(days):
            self.t_ms += clock.MS_PER_DAY
            self.flora.tick(self._context(start + dt.timedelta(days=day), DAY_S))

    def burn(self, hours: int, when: dt.date = dt.date(2026, 8, 5)) -> list[OutputEvent]:
        """Run hourly fire ticks at the height of summer (full dryness)."""
        outputs: list[OutputEvent] = []
        for _ in range(hours):
            self.t_ms += 3_600_000
            outputs += self.fire.tick(self._context(when, 3600.0))
        return outputs

    def forms(self) -> NDArray[np.uint8]:
        return fl.classify_form(self.cfg, self.flora.genes())

    def count(self, form: Cover) -> int:
        alive = self.flora.biomass >= self.cfg.cover_min_biomass
        return int(np.count_nonzero(alive & (self.forms() == form)))


def _plain(level: float = SEA + 0.10) -> Grid:
    return np.full((ROWS, COLUMNS), level, dtype=np.float32)


def _all() -> NDArray[np.bool_]:
    return np.ones((ROWS, COLUMNS), dtype=np.bool_)


# --- Traits -----------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("genome", "form"),
    [
        (LICHEN, Cover.LICHEN),
        (GRASS, Cover.GRASS),
        (SHRUB, Cover.SHRUB),
        (BROADLEAF, Cover.BROADLEAF),
        (CONIFER, Cover.CONIFER),
        # Low but not frugal is grass, not lichen.
        ((0.05, 0.5, 0.5, 0.2, 0.1, 0.1, 0.8, 0.1), Cover.GRASS),
    ],
)
def test_form_classification(config: Config, genome: tuple[float, ...], form: Cover) -> None:
    assert int(fl.classify_form(config.flora, _genes(*genome))[0]) == form


def test_cover_classification_precedence(config: Config) -> None:
    cfg = config.flora
    genes = np.repeat(_genes(*GRASS), 5, axis=1)
    biomass = np.array([0.0, 0.0, 0.0, 0.5, 0.5], dtype=np.float32)
    scorch = np.array([0.0, 0.0, 0.7, 0.7, 0.0], dtype=np.float32)
    land = np.array([False, True, True, True, False])
    cover = fl.classify_cover(cfg, biomass, genes, scorch, land)
    # water, bare, burnt, regrowth on scorched ground, a mangrove standing in water
    assert cover.tolist() == [Cover.WATER, Cover.BARE, Cover.BURNT, Cover.GRASS, Cover.GRASS]


def _with(genome: tuple[float, ...], gene: Gene, value: float) -> Grid:
    changed = list(genome)
    changed[gene] = value
    return _genes(*changed)


@pytest.mark.parametrize("gene", [Gene.HEIGHT, Gene.FRUGALITY, Gene.SHADE, Gene.DEFENCE,
                                  Gene.EVERGREEN])  # fmt: skip
def test_every_benefit_costs_growth(config: Config, gene: Gene) -> None:
    low = fl.growth_rate(config.flora, _with(SHRUB, gene, 0.1), _none())
    high = fl.growth_rate(config.flora, _with(SHRUB, gene, 0.9), _none())
    assert _value(high) < _value(low)


def test_rare_genes_cost_growth(config: Config) -> None:
    plain = _value(fl.growth_rate(config.flora, _genes(*SHRUB), _none()))
    for gene in Rare:
        carrier = np.array([gene], dtype=np.uint8)
        assert _value(fl.growth_rate(config.flora, _genes(*SHRUB), carrier)) < plain


def test_fast_growers_die_young_and_tall_plants_live_long(config: Config) -> None:
    cfg = config.flora
    sheltered = np.array([0.1], dtype=np.float32)
    slow = _value(fl.mortality(cfg, _with(GRASS, Gene.GROWTH, 0.1), _none(), sheltered))
    fast = _value(fl.mortality(cfg, _with(GRASS, Gene.GROWTH, 0.9), _none(), sheltered))
    tall = _value(fl.mortality(cfg, _with(GRASS, Gene.HEIGHT, 0.9), _none(), sheltered))
    assert slow < fast
    assert tall < _value(fl.mortality(cfg, _genes(*GRASS), _none(), sheltered))


def test_fertility_need(config: Config) -> None:
    cfg = config.flora

    def need(genome: tuple[float, ...]) -> float:
        return _value(fl.fertility_need(cfg, _genes(*genome), _none()))

    assert need(LICHEN) < need(GRASS) < need(SHRUB) < need(BROADLEAF)
    frugal = _value(fl.fertility_need(cfg, _with(BROADLEAF, Gene.FRUGALITY, 1.0), _none()))
    assert frugal < need(BROADLEAF)
    fixer = np.array([Rare.NITROGEN_FIXER], dtype=np.uint8)
    assert _value(fl.fertility_need(cfg, _genes(*BROADLEAF), fixer)) < frugal
    assert need(LICHEN) >= cfg.need_floor


def test_suitability_peaks_at_the_optimum_temperature(config: Config) -> None:
    cfg = config.flora
    genes = _genes(*GRASS)
    best = _value(fl.optimum_temperature(cfg, genes))
    rich = np.array([0.9], dtype=np.float32)

    def fit(temp: float) -> float:
        return _value(fl.suitability(cfg, genes, _none(), np.array([temp], np.float32), rich))

    assert fit(best) == pytest.approx(1.0)
    assert fit(best - 0.2) < fit(best - 0.1) < fit(best)
    assert fit(best + 0.2) < fit(best + 0.1) < fit(best)
    cold = _value(fl.optimum_temperature(cfg, _with(GRASS, Gene.COLD, 1.0)))
    assert cold < best


def test_suitability_needs_fertile_ground_for_trees(config: Config) -> None:
    cfg = config.flora
    genes = _genes(*BROADLEAF)
    temp = fl.optimum_temperature(cfg, genes)

    def fit(fertility: float) -> float:
        soil = np.array([fertility], dtype=np.float32)
        return _value(fl.suitability(cfg, genes, _none(), temp, soil))

    assert fit(0.05) < 0.05
    assert fit(0.05) < fit(0.2) < fit(0.6)
    assert fit(0.6) == pytest.approx(1.0)


GENOMES = st.lists(st.floats(0.0, 1.0, width=32), min_size=8, max_size=8)


@given(genome=GENOMES, temp=st.floats(-0.5, 1.5), soil=st.floats(0.0, 1.0),
       elevation=st.floats(-0.2, 0.6), rare=st.integers(0, 7))  # fmt: skip
def test_traits_stay_in_range(
    config: Config, genome: list[float], temp: float, soil: float, elevation: float, rare: int
) -> None:
    cfg = config.flora
    genes = _genes(*genome)
    mask = np.array([rare], dtype=np.uint8)

    def at(value: float) -> Grid:
        return np.array([value], dtype=np.float32)

    fit = fl.suitability(cfg, genes, mask, at(temp), at(soil))
    assert 0.0 <= _value(fit) <= 1.0
    assert 0.0 <= _value(fl.viability(cfg, genes, mask, fit, at(elevation))) <= 1.0
    assert _value(fl.growth_rate(cfg, genes, mask)) > 0.0
    assert _value(fl.mortality(cfg, genes, mask, at(elevation))) > 0.0
    assert _value(fl.winter_dieback(cfg, genes, at(temp))) >= 0.0
    assert 0.0 <= _value(fl.exposure(cfg, at(elevation))) <= 1.0
    assert int(fl.classify_form(cfg, genes)[0]) in fl.PLANT_FORMS


def test_warmth_follows_the_seasons_in_both_hemispheres(config: Config) -> None:
    def at(month: int, day: int, calendar: Any) -> float:
        unix_ms = clock.date_to_unix_ms(dt.date(2026, month, day))
        return fl.warmth(clock.instant(unix_ms, 0, calendar))

    north = config.calendar
    south = replace(north, hemisphere=Hemisphere.SOUTH)
    assert at(8, 6, north) == pytest.approx(1.0, abs=0.02)  # mid-summer
    assert at(2, 4, north) == pytest.approx(-1.0, abs=0.02)  # mid-winter
    assert abs(at(5, 5, north)) < 0.1
    assert at(8, 6, south) == pytest.approx(-1.0, abs=0.02)
    assert at(2, 4, south) == pytest.approx(1.0, abs=0.02)


def test_it_is_colder_higher_up(config: Config) -> None:
    cfg = config.flora
    elevation = np.array([-0.2, 0.0, 0.1, 0.3], dtype=np.float32)
    temp = fl.temperature(cfg, 1.0, elevation)
    assert float(temp[0]) == pytest.approx(float(temp[1]))  # the sea is at lowland temperature
    assert float(temp[1]) > float(temp[2]) > float(temp[3])
    assert float(temp[1]) == pytest.approx(fl.lowland_temperature(cfg, 1.0))


def test_exposure_is_on_the_shore_and_the_summits(config: Config) -> None:
    cfg = config.flora
    sheltered = (cfg.shore_span + cfg.treeline_height) / 2
    summit = cfg.treeline_height + cfg.treeline_span
    values = fl.exposure(cfg, np.array([0.0, sheltered, summit, summit + 0.2], np.float32))
    assert values.tolist() == pytest.approx([1.0, 0.0, 1.0, 1.0])


def test_tall_plants_are_not_viable_where_it_is_exposed(config: Config) -> None:
    cfg = config.flora
    one = np.ones(1, dtype=np.float32)
    summit = np.array([cfg.treeline_height + cfg.treeline_span], dtype=np.float32)
    sheltered = np.array([(cfg.shore_span + cfg.treeline_height) / 2], dtype=np.float32)
    tree, grass = _genes(*BROADLEAF), _genes(*GRASS)
    assert _value(fl.viability(cfg, tree, _none(), one, sheltered)) > 0.8
    assert _value(fl.viability(cfg, tree, _none(), one, summit)) == 0.0
    assert _value(fl.viability(cfg, grass, _none(), one, summit)) > 0.3


def test_mangroves_shrug_off_the_shore_but_not_the_summit(config: Config) -> None:
    cfg = config.flora
    genes = _genes(*SHRUB)
    mangrove = np.array([Rare.MANGROVE], dtype=np.uint8)
    waterline = np.array([0.0], dtype=np.float32)
    summit = np.array([cfg.treeline_height + cfg.treeline_span], dtype=np.float32)
    assert _value(fl.mortality(cfg, genes, mangrove, waterline)) < 0.2 * _value(
        fl.mortality(cfg, genes, _none(), waterline)
    )
    assert _value(fl.mortality(cfg, genes, mangrove, summit)) == pytest.approx(
        _value(fl.mortality(cfg, genes, _none(), summit))
    )


def test_winter_dieback_spares_evergreens_and_trees(config: Config) -> None:
    cfg = config.flora
    freezing = np.array([0.0], dtype=np.float32)
    mild = np.array([0.9], dtype=np.float32)
    assert _value(fl.winter_dieback(cfg, _genes(*GRASS), freezing)) > 1.0
    assert _value(fl.winter_dieback(cfg, _genes(*GRASS), mild)) == 0.0
    assert _value(fl.winter_dieback(cfg, _with(GRASS, Gene.EVERGREEN, 1.0), freezing)) == 0.0
    assert _value(fl.winter_dieback(cfg, _with(GRASS, Gene.HEIGHT, 1.0), freezing)) == 0.0


def test_species_keys_separate_roles() -> None:
    genome = np.zeros((8, 3), dtype=np.uint8)
    genome[Gene.HEIGHT] = [10, 20, 200]
    rare = np.array([0, 0, 0], dtype=np.uint8)
    keys = fl.species_keys(genome, rare)
    assert keys[0] == keys[1] != keys[2]
    assert fl.species_keys(genome, np.array([1, 0, 0], dtype=np.uint8))[0] != keys[1]


# --- Scenarios on hand-built sites ------------------------------------------------------


def test_grass_grows_to_cover_fertile_ground(config: Config) -> None:
    site = Site(config, _plain(), 0.5)
    seed = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    seed[20, 30] = True
    site.plant(seed, GRASS, 0.5)
    site.grow(120)
    assert site.count(Cover.GRASS) > 0.5 * ROWS * COLUMNS
    assert float(site.flora.biomass.max()) > 0.8


def test_trees_cannot_establish_on_infertile_soil(config: Config) -> None:
    grove = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    grove[18:22, 28:32] = True

    def trees_after_two_summers(fertility: float) -> int:
        soil = np.full((ROWS, COLUMNS), fertility, dtype=np.float32)
        soil[grove] = 0.7  # the grove itself always stands on good soil
        site = Site(config, _plain(), soil)
        site.plant(grove, BROADLEAF, 0.9)
        site.grow(150)
        site.grow(150)
        return site.count(Cover.BROADLEAF)

    assert trees_after_two_summers(0.6) > 10 * int(grove.sum())
    assert trees_after_two_summers(0.04) <= int(grove.sum()) + 2


def test_flooded_cells_die_but_mangroves_hold_shallow_water(config: Config) -> None:
    height = _plain()
    height[:, 30:] = SEA - 0.01  # shallow water, within mangrove depth
    height[:, 50:] = SEA - 0.20  # deep water
    site = Site(config, height, 0.5)
    site.plant(_all(), SHRUB, 0.8)
    mangrove = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    mangrove[10:30, 35:55] = True
    site.plant(mangrove, SHRUB, 0.8, rare=Rare.MANGROVE)
    site.grow(1)
    biomass = site.flora.biomass
    # (Medians: a few cells per day are re-seeded by a neighbour and restart low.)
    assert float(np.median(biomass[:, :30])) > 0.7  # dry land: alive
    ordinary = (site.flora.rare & Rare.MANGROVE) == 0
    assert float(biomass[:, 30:][ordinary[:, 30:]].max()) == 0.0  # flooded, no gene: dead
    assert float(np.median(biomass[10:30, 35:50])) > 0.7  # mangroves in the shallows: alive
    assert float(biomass[:, 50:].max()) == 0.0  # too deep even for mangroves
    assert int(site.flora.genome[:, biomass == 0].max()) == 0  # dead cells forget their genome


def test_winter_dieback_stops_at_the_root_reserve(config: Config) -> None:
    site = Site(config, _plain(), 0.5)
    site.plant(_all(), GRASS, 0.9)
    evergreen = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    evergreen[:, 40:] = True
    hardy = list(GRASS)
    hardy[Gene.EVERGREEN] = 1.0
    site.plant(evergreen, tuple(hardy), 0.9)
    site.grow(100, start=dt.date(2025, 12, 1))
    reserve = site.cfg.winter_reserve_biomass
    grass = float(np.median(site.flora.biomass[:, :40]))
    assert grass < 0.3  # died back
    assert grass > 0.5 * reserve  # but the roots are still there
    assert float(np.median(site.flora.biomass[:, 40:])) > 2 * grass


def test_plants_build_soil_up_to_their_cap(config: Config) -> None:
    still = replace(config.flora, seed_rain_per_year=0.0, seed_rate_per_year=0.0)
    site = Site(config, _plain(), 0.05, flora=still)
    planted = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    planted[:, :20] = True
    site.plant(planted, LICHEN, 0.9)
    cap = _value(fl.soil_cap(site.cfg, _genes(*LICHEN)))
    for _ in range(4):
        site.grow(90, start=dt.date(2026, 6, 1))
    under_plants = site.terrain.fertility[20, 5]
    assert 0.05 < float(under_plants) <= cap + 1e-4
    assert float(under_plants) > 0.8 * cap
    assert float(site.terrain.fertility[20, 55]) == pytest.approx(0.05)  # far bare ground


def test_taller_plants_take_over_from_grass(config: Config) -> None:
    """Shading succession: on soil that suits both, shrubs replace the grass they grow in."""
    site = Site(config, _plain(), 0.5)
    site.plant(_all(), GRASS, 0.9)
    thicket = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    thicket[:, :3] = True
    site.plant(thicket, SHRUB, 0.9)
    before = site.count(Cover.SHRUB)
    site.grow(60)
    assert site.count(Cover.SHRUB) > 5 * before
    site.grow(60)
    assert site.count(Cover.GRASS) < 0.05 * ROWS * COLUMNS
    # Nothing but the descendants of the thicket is left, and they did not get shorter.
    assert float(site.flora.genes()[Gene.HEIGHT].mean()) >= SHRUB[Gene.HEIGHT] - 0.02


def test_grass_does_not_displace_established_forest(config: Config) -> None:
    site = Site(config, _plain(), 0.6)
    site.plant(_all(), BROADLEAF, 0.9)
    meadow = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    meadow[:, :3] = True
    site.plant(meadow, GRASS, 0.9)
    site.grow(150)
    assert site.count(Cover.GRASS) <= int(meadow.sum())


def test_exposure_sorts_forms_into_belts(config: Config) -> None:
    """On a slope from the shore to a summit, with every kind of seed arriving, the
    sheltered middle ends up with taller plants than the shore and the summit."""
    cfg = config.flora
    top = cfg.treeline_height + cfg.treeline_span + 0.05
    ramp = np.linspace(0.0, top, COLUMNS, dtype=np.float32)
    height = np.broadcast_to(SEA + 0.001 + ramp, (ROWS, COLUMNS)).copy()
    site = Site(
        config,
        height,
        0.6,
        flora=replace(cfg, seed_rain_per_year=30_000.0, fire_ignitions_per_year=0.0),
    )
    for _ in range(3):
        site.grow(180)
    stature = site.flora.genes()[Gene.HEIGHT]
    alive = site.flora.biomass >= cfg.cover_min_biomass

    def mean_stature(low: float, high: float) -> float:
        band = alive & (ramp >= low)[None, :] & (ramp < high)[None, :]
        assert band.sum() > 20
        return float(stature[band].mean())

    shore = mean_stature(0.0, 0.3 * cfg.shore_span)
    middle = mean_stature(cfg.shore_span, cfg.treeline_height)
    summit = mean_stature(cfg.treeline_height + cfg.treeline_span, 9.0)
    assert middle > shore + 0.15
    assert middle > summit + 0.15


def test_grazing_respects_defence_and_shares_what_is_there(config: Config) -> None:
    site = Site(config, _plain(), 0.5)
    site.plant(_all(), GRASS, 0.5)
    thorny = list(GRASS)
    thorny[Gene.DEFENCE] = 1.0
    patch = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    patch[0, 0] = True
    site.plant(patch, tuple(thorny), 0.5)
    before = float(site.flora.biomass.sum(dtype=np.float64))

    ys = np.array([0, 5, 9, 9, 9])
    xs = np.array([0, 5, 9, 9, 9])
    demand = np.array([0.2, 0.2, 0.4, 0.4, 0.4], dtype=np.float32)
    eaten = site.flora.graze(ys, xs, demand)

    palatable = 1 - site.cfg.defence_strength * (GRASS[Gene.DEFENCE])
    assert float(eaten[1]) == pytest.approx(0.2 * palatable, rel=0.02)
    assert float(eaten[0]) < 0.5 * float(eaten[1])  # thorns
    # Three grazers on one cell want more than it holds: they split evenly everything
    # above the roots, which nobody can eat.
    reachable = 0.5 - site.cfg.grazing_reserve_biomass
    assert float(eaten[2:].sum()) == pytest.approx(reachable, rel=0.02)
    assert float(eaten[2]) == pytest.approx(float(eaten[4]))
    assert float(site.flora.biomass[9, 9]) == pytest.approx(site.cfg.grazing_reserve_biomass)
    assert float(site.flora.grazeable()[9, 9]) == pytest.approx(0.0, abs=1e-6)
    after = float(site.flora.biomass.sum(dtype=np.float64))
    assert before - after == pytest.approx(float(eaten.sum()), rel=1e-4)
    assert float(site.flora.biomass.min()) >= 0.0


# --- Rare genes (M7) --------------------------------------------------------------------


def _patch(*cells: tuple[int, int]) -> NDArray[np.bool_]:
    patch = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    for y, x in cells:
        patch[y, x] = True
    return patch


def test_poisonous_plants_refuse_grazers_and_poison_them(config: Config) -> None:
    site = Site(config, _plain(), 0.5)
    site.plant(_all(), GRASS, 0.5)
    site.plant(_patch((0, 0)), GRASS, 0.5, rare=Rare.POISONOUS)
    ys, xs = np.array([0, 5]), np.array([0, 5])
    eaten = site.flora.graze(ys, xs, np.array([0.2, 0.2], dtype=np.float32))
    assert float(eaten[0]) == pytest.approx((1 - site.cfg.poisonous_refusal) * float(eaten[1]))
    factor = site.flora.meal_factor(ys, xs)
    assert float(factor[0]) < 0.0  # a meal that costs energy
    assert float(factor[1]) == 1.0


def test_fruit_feeds_grazers_better(config: Config) -> None:
    site = Site(config, _plain(), 0.5)
    site.plant(_all(), GRASS, 0.5)
    site.plant(_patch((0, 0)), GRASS, 0.5, rare=Rare.FRUITING)
    factor = site.flora.meal_factor(np.array([0, 5]), np.array([0, 5]))
    assert float(factor[0]) == pytest.approx(1.0 + site.cfg.fruiting_meal_bonus)


def _far_cells(site: Site, source: NDArray[np.bool_], reach: int) -> int:
    alive = site.flora.biomass > 0
    ys, xs = np.nonzero(source)
    y0, x0 = float(ys.mean()), float(xs.mean())
    yy, xx = np.mgrid[0:ROWS, 0:COLUMNS]
    far = np.hypot(yy - y0, xx - x0) > reach
    return int(np.count_nonzero(alive & far))


def test_animals_carry_fruit_far(config: Config) -> None:
    """Heavy seeds stay near; the same plant bearing fruit lands far away."""
    heavy = list(GRASS)
    heavy[Gene.SEED] = 1.0
    source = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    source[18:22, 28:32] = True
    counts: dict[int, int] = {}
    for rare in (0, int(Rare.FRUITING)):
        site = Site(config, _plain(), 0.5)
        site.plant(source, tuple(heavy), 0.9, rare=rare)
        site.grow(20)
        counts[rare] = _far_cells(site, source, 8)
    assert counts[0] == 0
    assert counts[int(Rare.FRUITING)] > 0


def test_emergent_crowns_shade_more_but_need_soil_and_shelter(config: Config) -> None:
    cfg = config.flora
    genes, emergent = _genes(*BROADLEAF), np.array([Rare.EMERGENT], dtype=np.uint8)
    tall = fl.stature(cfg, genes, emergent)
    assert _value(tall) == pytest.approx(BROADLEAF[Gene.HEIGHT] * (1 + cfg.emergent_height_bonus))
    grass = fl.stature(cfg, _genes(*GRASS), emergent)
    assert _value(grass) < SHRUB[Gene.HEIGHT]  # an emergent grass does not overtop shrubs
    biomass = np.full(1, 0.6, dtype=np.float32)
    assert _value(fl.canopy(cfg, biomass, tall)) > _value(
        fl.canopy(cfg, biomass, fl.stature(cfg, genes, _none()))
    )
    assert _value(fl.canopy(cfg, np.ones(1, np.float32), tall)) <= 1.0
    assert _value(fl.fertility_need(cfg, genes, emergent)) > _value(
        fl.fertility_need(cfg, genes, _none())
    )
    shore = np.full(1, 0.3 * cfg.shore_span, dtype=np.float32)
    assert _value(fl.mortality(cfg, genes, emergent, shore)) > _value(
        fl.mortality(cfg, genes, _none(), shore)
    )


def test_emergents_overtop_a_closed_forest(config: Config) -> None:
    site = Site(config, _plain(), 0.8)
    site.plant(_all(), BROADLEAF, 0.9)
    grove = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    grove[:, :3] = True
    site.plant(grove, BROADLEAF, 0.9, rare=Rare.EMERGENT)
    site.grow(150)
    crowns = int(np.count_nonzero(fl.has(site.flora.rare, Rare.EMERGENT)))
    assert crowns > 3 * int(grove.sum())


# --- Fire -------------------------------------------------------------------------------


def _meadow_with_channel(config: Config) -> Site:
    """Dense grass on both banks of a two-cell-wide water channel."""
    height = _plain()
    height[:, 30:32] = SEA - 0.1
    site = Site(config, height, 0.5)
    land = _all()
    land[:, 30:32] = False
    site.plant(land, GRASS, 0.9)
    return site


def test_fire_spreads_through_grass_and_stops_at_water(config: Config) -> None:
    site = _meadow_with_channel(config)
    started = site.fire.ignite(20, 10, site.t_ms)
    assert [type(o) for o in started] == [FireStarted]
    outputs = site.burn(24 * 12)

    ended = [o for o in outputs if isinstance(o, FireEnded)]
    assert len(ended) == 1
    assert not site.fire.burning.any()
    west = site.flora.scorch[:, :30] > 0
    assert int(west.sum()) > 0.6 * west.size  # most of the near bank burnt
    assert not (site.flora.scorch[:, 30:] > 0).any()  # nothing crossed the water
    assert float(site.flora.biomass[:, 32:].min()) == pytest.approx(0.9)
    assert ended[0].cells == int(west.sum())
    assert ended[0].hours > site.cfg.fire_burn_hours


def test_fire_needs_fuel(config: Config) -> None:
    site = Site(config, _plain(), 0.5)
    assert site.fire.ignite(5, 5, 0) == []  # bare ground
    site.plant(_all(), GRASS, 0.5 * site.cfg.fire_min_fuel)
    assert site.fire.ignite(5, 5, 0) == []  # too little to carry fire
    assert not site.fire.burning.any()


def test_burnt_ground_cannot_burn_again_until_it_recovers(config: Config) -> None:
    site = _meadow_with_channel(config)
    site.fire.ignite(20, 10, site.t_ms)
    site.burn(24 * 12)
    assert site.fire.ignite(20, 10, site.t_ms) == []
    # Grass resprouts from the roots: same genome, less biomass, scorch fading.
    assert 0.0 < float(site.flora.biomass[20, 10]) < 0.3
    assert site.count(Cover.GRASS) > 0
    site.grow(int(site.cfg.scorch_days) + 2)
    assert float(site.flora.scorch.max()) == 0.0


def test_fire_pines_survive_a_fire_that_kills_other_trees(config: Config) -> None:
    cfg = replace(
        config.flora,
        flammability_conifer=1.0,
        seed_rain_per_year=0.0,
        fire_ignitions_per_year=0.0,
    )
    site = Site(config, _plain(), 0.6, flora=cfg)
    site.plant(_all(), CONIFER, 0.9)
    pines = np.zeros((ROWS, COLUMNS), dtype=np.bool_)
    pines[:, 30:] = True
    site.plant(pines, CONIFER, 0.9, rare=Rare.FIRE_PINE)
    site.fire.ignite(20, 29, site.t_ms)
    site.burn(24 * 12)

    burnt = site.flora.scorch > 0
    assert burnt[:, :30].sum() > 100
    assert burnt[:, 30:].sum() > 100
    ordinary = site.flora.biomass[burnt & ~pines]
    survivors = site.flora.biomass[burnt & pines]
    assert float(ordinary.max()) < 0.05
    assert float(survivors.min()) == pytest.approx(0.9 * cfg.fire_pine_survival, rel=0.01)


def test_fire_burns_fertility_out_of_the_soil(config: Config) -> None:
    site = _meadow_with_channel(config)
    site.fire.ignite(20, 10, site.t_ms)
    site.burn(24 * 12)
    lost = 0.5 * site.cfg.fire_fertility_loss
    assert float(site.terrain.fertility[20, 10]) == pytest.approx(0.5 - lost, abs=1e-4)
    assert float(site.terrain.fertility[20, 50]) == pytest.approx(0.5)


def test_fires_are_a_warm_season_event(config: Config) -> None:
    site = Site(config, _plain(), 0.5)

    def dryness(month: int, day: int) -> float:
        unix_ms = clock.date_to_unix_ms(dt.date(2026, month, day))
        return site.fire.dryness(clock.instant(unix_ms, 0, config.calendar))

    assert dryness(1, 15) == 0.0
    assert dryness(4, 1) == 0.0
    assert dryness(8, 5) == 1.0


# --- The world as a whole ---------------------------------------------------------------


def test_new_world_starts_as_bare_rock(config: Config) -> None:
    world, _ = World.create(config, 42, EPOCH_UNIX_MS)
    shares = world.flora.cover_shares()
    assert shares[Cover.BARE] == 1.0
    assert world.flora.species_count() == 0
    assert world.flora.closed_forest_share() == 0.0


def test_golden_hash_and_two_runs(config: Config) -> None:
    hashes: list[str] = []
    for _ in range(2):
        world, _ = World.create(config, 42, EPOCH_UNIX_MS)
        world.step(200 * DAY_S)
        hashes.append(world.state_hash())
    assert hashes[0] == hashes[1] == GOLDEN_FLORA_SEED_42


def test_streams_are_per_subsystem(config: Config) -> None:
    world, _ = World.create(config, 42, EPOCH_UNIX_MS)
    world.step(3 * DAY_S)
    assert sorted(world.snapshot().rng) == [
        "fauna", "fire", "flora", "presence", "species", "terrain",
    ]  # fmt: skip


def test_save_load_continue_and_chunking(config: Config) -> None:
    straight, _ = World.create(config, 7, EPOCH_UNIX_MS)
    straight.step(160 * DAY_S)

    first, _ = World.create(config, 7, EPOCH_UNIX_MS)
    first.step(100.3 * DAY_S)
    resumed = World.restore(config, io.loads(io.dumps(first.snapshot())))
    for _ in range(5):
        resumed.step(7.7 * 3600)  # odd chunks that straddle hourly and daily ticks
    resumed.advance_to(straight.t_ms)
    assert resumed.state_hash() == straight.state_hash()


@settings(max_examples=6, deadline=None)
@given(seed=st.integers(0, 10_000))
def test_a_year_keeps_every_invariant(config: Config, seed: int) -> None:
    small = replace(
        config,
        terrain=replace(
            config.terrain,
            grid_width=64,
            grid_height=48,
            edge_margin_cells=5.0,
            noise_wavelength_cells=24.0,
            hotspot_radius_min_cells=4.0,
            hotspot_radius_max_cells=8.0,
            relax_blur_cells=3,
            landmass_min_cells=8,
        ),
        flora=replace(config.flora, seed_rain_per_year=4000.0, fire_ignitions_per_year=400.0),
    )
    world, _ = World.create(small, seed, EPOCH_UNIX_MS)
    fires = 0
    for _ in range(12):
        outputs = world.step(30 * DAY_S)
        fires += sum(isinstance(o, FireEnded) for o in outputs)
        flora, terrain = world.flora, world.terrain
        biomass = flora.biomass
        assert np.isfinite(biomass).all()
        assert float(biomass.min()) >= 0.0
        assert float(biomass.max()) <= 1.0
        assert int(flora.genome[:, biomass == 0].max(initial=0)) == 0
        assert int(flora.rare[biomass == 0].max(initial=0)) == 0
        assert int(flora.rare.max()) <= sum(Rare)
        assert float(flora.scorch.min()) >= 0.0
        assert float(flora.scorch.max()) <= 1.0
        assert float(terrain.fertility.min()) >= 0.0
        assert float(terrain.fertility.max()) <= 1.0
        assert (
            float(biomass[~terrain.land & ((flora.rare & Rare.MANGROVE) == 0)].max(initial=0)) == 0
        )
        assert sum(flora.cover_shares().values()) == pytest.approx(1.0)
        assert set(np.unique(flora.cover()).tolist()) <= {int(c) for c in Cover}
    assert float(world.flora.biomass.max()) > 0.3
    assert fires >= 1


def test_vegetation_protects_the_ground(config: Config) -> None:
    """Erosion feedback: the flora hands its cover to the terrain every day."""
    world, _ = World.create(config, 3, EPOCH_UNIX_MS)
    world.step(200 * DAY_S)
    cover = world.terrain._cover  # pyright: ignore[reportPrivateUsage]
    assert cover is not None
    assert cover.tobytes() == world.flora.biomass.tobytes()
    assert float(cover.max()) > 0.5


def test_daylight_scales_growth(config: Config) -> None:
    def biomass_after(daylight: float) -> float:
        site = Site(config, _plain(), 0.5)
        site.plant(_all(), GRASS, 0.2)
        site.flora.set_daylight(daylight)
        site.grow(10)
        return float(site.flora.biomass.mean())

    assert biomass_after(0.0) < 0.2 < biomass_after(0.3) < biomass_after(1.0)
    assert math.isclose(biomass_after(2.0), biomass_after(1.0))  # clamped
