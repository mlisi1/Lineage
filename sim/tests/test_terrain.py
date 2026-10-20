"""Terrain: generation, dynamics, events, landmasses, and the subsystem in a world."""

from __future__ import annotations

import math
from dataclasses import replace
from typing import Any

import numpy as np
import pytest
from hypothesis import given, settings
from hypothesis import strategies as st
from hypothesis.extra import numpy as hnp
from lineage_sim import terrain as tr
from lineage_sim.config import Config, TerrainConfig
from lineage_sim.events import (
    CraterFormed,
    EarthquakeStruck,
    LandmassesRejoined,
    LandmassSplit,
    VolcanoErupted,
)
from lineage_sim.state import io
from lineage_sim.subsystem import Subsystem
from lineage_sim.world import World
from numpy.random import PCG64, Generator
from numpy.typing import NDArray

EPOCH_UNIX_MS = 1_772_323_200_000  # 2026-03-01 00:00 UTC
DAY_S = 86_400
YEAR_DAYS = 365
# Final state of the default world (every subsystem), seed 42, after 30 days.
GOLDEN_TERRAIN_SEED_42 = "b958dc654911a6d7f1504dd84ecdaf0b0fe851ec4953ccd6d72954a75d354f0e"

Grid = NDArray[np.float32]


@pytest.fixture(scope="module")
def small(config: Config) -> TerrainConfig:
    """A 64×48 terrain with lengths scaled down, for fast property tests."""
    return replace(
        config.terrain,
        grid_width=64,
        grid_height=48,
        edge_margin_cells=5.0,
        noise_wavelength_cells=24.0,
        fertility_wavelength_cells=12.0,
        hotspot_radius_min_cells=4.0,
        hotspot_radius_max_cells=8.0,
        hotspot_speed_max_cells_per_year=4.0,
        relax_blur_cells=3,
        volcano_radius_min_cells=3.0,
        volcano_radius_max_cells=5.0,
        earthquake_radius_min_cells=4.0,
        earthquake_radius_max_cells=8.0,
        crater_radius_min_cells=2.0,
        crater_radius_max_cells=4.0,
        landmass_min_cells=8,
    )


@pytest.fixture(scope="module")
def small_config(config: Config, small: TerrainConfig) -> Config:
    return replace(config, terrain=small)


def _rng(seed: int) -> Generator:
    return Generator(PCG64(seed))


def _flat(cfg: TerrainConfig, level: float) -> Grid:
    return np.full((cfg.grid_height, cfg.grid_width), level, dtype=np.float32)


def _mass(grid: Grid) -> float:
    return float(grid.sum(dtype=np.float64))


def _island(cfg: TerrainConfig, seed: int) -> tuple[Grid, Grid]:
    geo = tr.geometry(cfg)
    fields = tr.continent_fields(cfg, (seed, seed + 1, seed + 2))
    return tr.generate(cfg, geo, fields, _rng(seed))


# --- Generation -------------------------------------------------------------------------


@pytest.mark.parametrize("seed", range(8))
def test_generated_island_invariants(small: TerrainConfig, seed: int) -> None:
    height, fertility = _island(small, seed)
    assert height.dtype == np.float32
    assert fertility.dtype == np.float32
    assert np.isfinite(height).all()
    assert np.isfinite(fertility).all()
    assert float(height.min()) >= 0.0
    assert float(height.max()) <= 1.0
    assert small.fertility_min - 1e-6 <= float(fertility.min())
    assert float(fertility.max()) <= small.fertility_max + 1e-6
    land = height > small.sea_base
    assert float(land.mean()) == pytest.approx(small.initial_land_fraction, abs=0.01)
    border = np.concatenate([land[0], land[-1], land[:, 0], land[:, -1]])
    assert not border.any(), "the map border must be open sea"


def test_generation_is_seeded(small: TerrainConfig) -> None:
    a, _ = _island(small, 1)
    b, _ = _island(small, 1)
    c, _ = _island(small, 2)
    assert a.tobytes() == b.tobytes()
    assert a.tobytes() != c.tobytes()


def test_wave_noise_range_and_isotropy() -> None:
    noise = tr.wave_noise(_rng(3), 96, 96, 24.0, 3, 0.5)
    assert float(noise.min()) >= 0.0
    assert float(noise.max()) <= 1.0
    assert float(noise.mean()) == pytest.approx(0.5, abs=0.05)
    # No preferred axis: variation along x and along y are of the same size.
    along_x = float(np.abs(np.diff(noise, axis=1)).mean())
    along_y = float(np.abs(np.diff(noise, axis=0)).mean())
    assert along_x == pytest.approx(along_y, rel=0.35)


def test_initial_fertility_is_richer_in_lowlands(small: TerrainConfig) -> None:
    height, fertility = _island(small, 4)
    land = height > small.sea_base
    low = land & (height < np.quantile(height[land], 0.3))
    high = land & (height > np.quantile(height[land], 0.7))
    assert float(fertility[low].mean()) > float(fertility[high].mean())


# --- Sea level and drift ----------------------------------------------------------------


@given(t=st.floats(0.0, 500.0), a=st.floats(0.0, 6.3), b=st.floats(0.0, 6.3))
def test_sea_level_stays_within_its_amplitudes(
    config: Config, t: float, a: float, b: float
) -> None:
    cfg = config.terrain
    swing = cfg.sea_cycle_amplitude + cfg.sea_slow_amplitude
    assert abs(tr.sea_level(cfg, t, (a, b)) - cfg.sea_base) <= swing + 1e-12


def test_sea_level_main_cycle_repeats(config: Config) -> None:
    cfg = replace(config.terrain, sea_slow_amplitude=0.0)
    now = tr.sea_level(cfg, 3.3, (0.4, 0.0))
    assert tr.sea_level(cfg, 3.3 + cfg.sea_cycle_period_years, (0.4, 0.0)) == pytest.approx(now)
    assert tr.sea_level(cfg, 3.3 + cfg.sea_cycle_period_years / 2, (0.4, 0.0)) != pytest.approx(now)


def test_continent_drifts_but_keeps_its_land_share(small: TerrainConfig) -> None:
    geo = tr.geometry(small)
    fields = tr.continent_fields(small, (7, 8, 9))
    shapes = [
        tr.shape_island(small, geo, tr.continent_noise(small, fields, t, None))
        for t in (0.0, 1.0, small.drift_period_years / 4)
    ]
    for shape in shapes:
        assert float((shape > small.sea_base).mean()) == pytest.approx(
            small.initial_land_fraction, abs=0.01
        )
    near = float(np.abs(shapes[1] - shapes[0]).mean())
    far = float(np.abs(shapes[2] - shapes[0]).mean())
    assert 0.0 < near < far


# --- Tectonics --------------------------------------------------------------------------


def test_uplift_is_zero_sum_and_spares_the_border(small: TerrainConfig) -> None:
    geo = tr.geometry(small)
    rng = _rng(5)
    hotspots = np.array([tr.spawn_hotspot(small, rng, k) for k in range(small.hotspot_count)])
    roughness = tr.wave_noise(rng, small.grid_height, small.grid_width, 8.0, 2, 0.5)
    field = tr.uplift_rate(small, geo, hotspots, roughness)
    assert abs(_mass(field)) < 1e-3
    assert float(np.abs(field[0]).max()) == 0.0
    assert float(np.abs(field[:, -1]).max()) == 0.0
    assert float(np.abs(field).max()) > 0.2 * small.hotspot_rate_max_per_year


def test_hotspots_alternate_sign_stay_inside_and_respawn(small: TerrainConfig) -> None:
    rng = _rng(6)
    hotspots = np.array([tr.spawn_hotspot(small, rng, k) for k in range(6)])
    assert (np.sign(hotspots[:, 5]) == [1, -1, 1, -1, 1, -1]).all()
    start = hotspots.copy()
    margin = small.edge_margin_cells
    for _ in range(40 * YEAR_DAYS // 30):
        tr.advance_hotspots(small, hotspots, rng, 30 / 365.25)
        assert (hotspots[:, 0] >= margin - 1e-9).all()
        assert (hotspots[:, 0] <= small.grid_width - 1 - margin + 1e-9).all()
        assert (hotspots[:, 1] >= margin - 1e-9).all()
        assert (hotspots[:, 1] <= small.grid_height - 1 - margin + 1e-9).all()
        assert (hotspots[:, 6] > 0).all()
    assert (np.sign(hotspots[:, 5]) == np.sign(start[:, 5])).all()
    assert not np.allclose(hotspots[:, 4], start[:, 4]), "all hotspots should have respawned"


def test_relaxation_follows_the_target_at_large_scale_only(small: TerrainConfig) -> None:
    rng = _rng(7)
    target = _flat(small, 0.5)
    detail = (0.02 * (rng.random(target.shape) - 0.5)).astype(np.float32)
    start = _flat(small, 0.3) + detail
    relaxed = tr.relax(small, start, target, small.relax_time_years)
    # One time constant closes 1 - 1/e of the large-scale gap…
    assert float(relaxed.mean()) == pytest.approx(0.3 + 0.2 * (1 - math.exp(-1)), abs=0.003)
    # …and keeps almost all of the fine detail.
    kept = np.corrcoef((relaxed - relaxed.mean()).ravel(), detail.ravel())[0, 1]
    assert kept > 0.9
    assert float(np.std(relaxed)) > 0.8 * float(np.std(detail))


def test_box_blur_is_a_local_mean() -> None:
    grid = _rng(8).random((20, 30)).astype(np.float32)
    blurred = tr.box_blur(grid, 2)
    assert float(blurred[10, 15]) == pytest.approx(float(grid[8:13, 13:18].mean()), abs=1e-6)
    assert tr.box_blur(np.full((9, 9), 0.25, dtype=np.float32), 3) == pytest.approx(0.25)


# --- Erosion ----------------------------------------------------------------------------

HEIGHTS = hnp.arrays(np.float32, (16, 20), elements=st.floats(0.0, 1.0, width=32, allow_nan=False))


@settings(max_examples=60, deadline=None)
@given(height=HEIGHTS, days=st.integers(1, 400))
def test_erosion_conserves_mass_and_never_overshoots(
    config: Config, height: Grid, days: int
) -> None:
    eroded = tr.erode(config.terrain, height, None, days / 365.25)
    assert np.isfinite(eroded).all()
    assert _mass(eroded) == pytest.approx(_mass(height), abs=1e-3)
    assert float(eroded.min()) >= float(height.min()) - 1e-5
    assert float(eroded.max()) <= float(height.max()) + 1e-5


def test_erosion_leaves_flat_and_gentle_ground_almost_alone(config: Config) -> None:
    cfg = replace(config.terrain, creep_rate_per_year=0.0)
    flat = _flat(cfg, 0.5)
    assert tr.erode(cfg, flat, None, 1.0).tobytes() == flat.tobytes()
    ramp = (0.2 + 0.5 * cfg.talus_slope * np.arange(40, dtype=np.float32))[None, :].repeat(8, 0)
    assert tr.erode(cfg, ramp, None, 1.0) == pytest.approx(ramp)  # below talus: stable


def test_landslides_bring_a_cliff_down_to_the_talus_slope(config: Config) -> None:
    cfg = config.terrain
    cliff = _flat(cfg, 0.3)
    cliff[:, cfg.grid_width // 2 :] = 0.7
    steepest_before = float(np.abs(np.diff(cliff, axis=1)).max())
    soon = tr.erode(cfg, cliff, None, 0.5)
    after = tr.erode(cfg, soon, None, 7.5)
    steepest_soon = float(np.abs(np.diff(soon, axis=1)).max())
    steepest_after = float(np.abs(np.diff(after, axis=1)).max())
    assert steepest_before == pytest.approx(0.4)
    assert steepest_after < steepest_soon < steepest_before
    assert steepest_after < 1.5 * cfg.talus_slope
    assert _mass(after) == pytest.approx(_mass(cliff), rel=1e-5)


def test_vegetation_cover_slows_erosion(config: Config) -> None:
    cfg = config.terrain
    cliff = _flat(cfg, 0.3)
    cliff[:, cfg.grid_width // 2 :] = 0.7
    one_day = 1 / 365.25
    bare = tr.erode(cfg, cliff, None, one_day)
    covered = tr.erode(cfg, cliff, np.ones_like(cliff), one_day)
    moved_bare = float(np.abs(bare - cliff).sum())
    moved_covered = float(np.abs(covered - cliff).sum())
    assert moved_bare > 0
    assert moved_covered == pytest.approx((1 - cfg.vegetation_protection) * moved_bare, rel=0.02)
    assert _mass(covered) == pytest.approx(_mass(cliff), rel=1e-5)


def test_sediment_carries_fertility(config: Config) -> None:
    cfg = config.terrain
    fertility = _flat(cfg, 0.4)
    change = np.zeros_like(fertility)
    change[0, 0], change[0, 1] = 0.5 * cfg.talus_slope, -0.5 * cfg.talus_slope
    moved = tr.move_fertility(cfg, fertility, change)
    assert float(moved[0, 0]) > 0.4 > float(moved[0, 1])
    assert float(moved[5, 5]) == pytest.approx(0.4)
    assert float(moved.min()) >= 0.0
    assert float(moved.max()) <= 1.0


def test_leaching_decays_land_fertility_toward_the_floor(config: Config) -> None:
    cfg = config.terrain
    fertility = _flat(cfg, 0.45)
    fertility[0, 0] = cfg.fertility_min / 2  # already below the floor
    land = np.ones(fertility.shape, dtype=np.bool_)
    land[:, :10] = False
    land[0, 0] = True
    span = 1.0 / cfg.leaching_rate_per_year  # one time constant
    leached = tr.leach(cfg, fertility, land, None, span)
    expected = cfg.fertility_min + (0.45 - cfg.fertility_min) * math.exp(-1)
    assert float(leached[5, 50]) == pytest.approx(expected, abs=1e-6)
    assert float(leached[5, 5]) == pytest.approx(0.45)  # under water: untouched
    assert float(leached[0, 0]) == pytest.approx(cfg.fertility_min / 2)  # never raised
    forever = tr.leach(cfg, fertility, land, None, 1e6)
    assert float(forever[5, 50]) == pytest.approx(cfg.fertility_min, abs=1e-6)
    assert float(forever.min()) >= cfg.fertility_min / 2 - 1e-7


def test_leaching_is_the_same_in_one_span_or_many_ticks(config: Config) -> None:
    cfg = config.terrain
    _, fertility = _island(cfg, 2)
    land = np.ones(fertility.shape, dtype=np.bool_)
    once = tr.leach(cfg, fertility, land, None, 2.0)
    stepped = fertility
    for _ in range(200):
        stepped = tr.leach(cfg, stepped, land, None, 0.01)
    assert stepped == pytest.approx(once, abs=1e-4)


def test_vegetation_cover_slows_leaching(config: Config) -> None:
    cfg = config.terrain
    fertility = _flat(cfg, 0.4)
    land = np.ones(fertility.shape, dtype=np.bool_)
    bare = 0.4 - float(tr.leach(cfg, fertility, land, None, 1.0)[3, 3])
    covered = 0.4 - float(tr.leach(cfg, fertility, land, np.ones_like(fertility), 1.0)[3, 3])
    assert bare > 0
    assert covered == pytest.approx((1 - cfg.vegetation_protection) * bare, rel=1e-3)


def test_sea_floor_gains_fertility_up_to_the_marine_level(config: Config) -> None:
    cfg = config.terrain
    fertility = _flat(cfg, 0.1)
    fertility[0, 0] = 0.9  # ash-rich ground that drowned keeps what it has
    underwater = np.ones(fertility.shape, dtype=np.bool_)
    underwater[:, :10] = False
    underwater[0, 0] = True
    settled = tr.settle_sediment(cfg, fertility, underwater, 5.0)
    assert 0.1 < float(settled[5, 50]) < cfg.fertility_max
    assert float(settled[5, 5]) == pytest.approx(0.1)  # dry land: untouched
    assert float(settled[0, 0]) == pytest.approx(0.9)
    assert float(tr.settle_sediment(cfg, fertility, underwater, 1e6)[5, 50]) == pytest.approx(
        cfg.fertility_max
    )


# --- Events -----------------------------------------------------------------------------


def test_volcano_builds_new_land_where_it_erupts(config: Config) -> None:
    cfg = config.terrain
    geo = tr.geometry(cfg)
    seabed, fertility = _flat(cfg, cfg.sea_base - 0.08), _flat(cfg, 0.3)
    x, y, radius, cone = 180.0, 60.0, 8.0, 0.2
    height, enriched = tr.apply_volcano(cfg, geo, seabed, fertility, x, y, radius, cone)

    land = height > cfg.sea_base
    assert land[60, 180], "the summit is above the sea"
    ys, xs = np.nonzero(land)
    assert float(np.hypot(xs - x, ys - y).max()) < radius, "new land only inside the cone"
    assert float(height[60, 180]) == pytest.approx(cfg.sea_base - 0.08 + cone, abs=1e-6)
    assert float(height[60, 100]) == pytest.approx(cfg.sea_base - 0.08)  # far away: untouched
    assert tr.label_landmasses(land)[1].tolist() == [0, int(land.sum())]  # one new island
    # Lava at the centre is barren; ash enriches the flanks.
    assert float(enriched[60, 180]) == pytest.approx(cfg.volcano_lava_fertility)
    assert float(enriched[60, 180 + 6]) > 0.3
    assert float(enriched[60, 100]) == pytest.approx(0.3, abs=1e-4)


def test_crater_digs_a_bowl_with_a_rim(config: Config) -> None:
    cfg = config.terrain
    geo = tr.geometry(cfg)
    plain, fertility = _flat(cfg, 0.6), _flat(cfg, 0.5)
    height, scorched = tr.apply_crater(cfg, geo, plain, fertility, 100.0, 70.0, 6.0, 0.15)
    assert float(height[70, 100]) == pytest.approx(0.45, abs=1e-6)
    assert float(height[70, 100 + 7]) > 0.6  # rim
    assert float(height[70, 100 + 10]) == pytest.approx(0.6)  # beyond the rim
    assert float(scorched[70, 100]) == pytest.approx(0.5 * cfg.crater_fertility_factor)
    assert float(scorched[70, 100 + 10]) == pytest.approx(0.5)


def test_earthquake_lifts_one_side_and_drops_the_other(config: Config) -> None:
    cfg = config.terrain
    geo = tr.geometry(cfg)
    plain = _flat(cfg, 0.5)
    shaken = tr.apply_earthquake(geo, plain, 128.0, 75.0, 15.0, 0.04, 0.0)
    assert float(shaken[75, 128 + 5]) == pytest.approx(0.5 + 0.02, abs=0.004)
    assert float(shaken[75, 128 - 5]) == pytest.approx(0.5 - 0.02, abs=0.004)
    assert float(shaken[75, 128 + 80]) == pytest.approx(0.5, abs=1e-4)
    assert _mass(shaken) == pytest.approx(_mass(plain), rel=1e-5)


# --- Landmasses -------------------------------------------------------------------------


def _flood_fill_partition(land: NDArray[np.bool_]) -> set[frozenset[tuple[int, int]]]:
    """Reference implementation: 4-connected components by explicit flood fill."""
    seen: set[tuple[int, int]] = set()
    parts: set[frozenset[tuple[int, int]]] = set()
    h, w = land.shape
    for y0 in range(h):
        for x0 in range(w):
            if not land[y0, x0] or (y0, x0) in seen:
                continue
            stack, part = [(y0, x0)], set[tuple[int, int]]()
            while stack:
                y, x = stack.pop()
                if (y, x) in seen or not (0 <= y < h and 0 <= x < w) or not land[y, x]:
                    continue
                seen.add((y, x))
                part.add((y, x))
                stack += [(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)]
            parts.add(frozenset(part))
    return parts


@settings(max_examples=150, deadline=None)
@given(land=hnp.arrays(np.bool_, hnp.array_shapes(min_dims=2, max_dims=2, max_side=14)))
def test_labelling_matches_flood_fill(land: NDArray[np.bool_]) -> None:
    labels, sizes = tr.label_landmasses(land)
    assert ((labels > 0) == land).all()
    parts = {
        frozenset((int(y), int(x)) for y, x in np.argwhere(labels == k))
        for k in range(1, len(sizes))
    }
    assert parts == _flood_fill_partition(land)
    assert sizes[0] == 0
    assert [len(p) for p in sorted(parts, key=min)] == sizes[1:].tolist()


def _two_islands(cfg: TerrainConfig, strait: float) -> Grid:
    """Two plateaus at 0.5 separated by a 6-cell-wide strait with the given floor."""
    height = _flat(cfg, 0.2)
    height[40:110, 60:120] = 0.5
    height[40:110, 126:190] = 0.5
    height[40:110, 120:126] = strait
    return height


def test_strait_closes_when_uplift_exceeds_the_sea(config: Config) -> None:
    cfg = replace(config.terrain, hotspot_ruggedness=0.0)
    geo = tr.geometry(cfg)
    sea = cfg.sea_base
    height = _two_islands(cfg, strait=sea - 0.02)
    # One lifting hotspot centred on the strait: x, y, vx, vy, radius, rate, life.
    hotspot = np.array([[123.0, 75.0, 0.0, 0.0, 12.0, 0.05, 99.0]])
    rate = tr.uplift_rate(cfg, geo, hotspot, _flat(cfg, 0.5))
    lift_per_year = float(rate[75, 123])
    assert lift_per_year > 0.04

    before = tr.label_landmasses(height > sea)
    assert int((before[1] >= cfg.landmass_min_cells).sum()) == 2
    years_to_close = 0.02 / lift_per_year

    too_early = height + np.float32(0.5 * years_to_close) * rate
    early = tr.label_landmasses(too_early > sea)
    assert tr.landmass_changes(before, early, cfg.landmass_min_cells) == ([], [])

    lifted = height + np.float32(1.5 * years_to_close) * rate
    after = tr.label_landmasses(lifted > sea)
    assert tr.landmass_changes(before, after, cfg.landmass_min_cells) == ([], [2])
    assert int((after[1] >= cfg.landmass_min_cells).sum()) == 1


def test_rising_sea_splits_a_landmass(config: Config) -> None:
    cfg = config.terrain
    height = _two_islands(cfg, strait=0.44)
    joined = tr.label_landmasses(height > 0.42)
    apart = tr.label_landmasses(height > 0.46)
    assert tr.landmass_changes(joined, apart, cfg.landmass_min_cells) == ([2], [])
    assert tr.landmass_changes(apart, joined, cfg.landmass_min_cells) == ([], [2])
    assert tr.landmass_changes(joined, joined, cfg.landmass_min_cells) == ([], [])


def test_small_islets_do_not_count_as_splits(config: Config) -> None:
    cfg = config.terrain
    height = _flat(cfg, 0.2)
    height[40:110, 60:120] = 0.5
    height[70:73, 120:124] = 0.44  # a spit
    height[70:73, 124:127] = 0.5  # with a 9-cell tip, below landmass_min_cells
    whole = tr.label_landmasses(height > 0.42)
    cut = tr.label_landmasses(height > 0.46)
    assert tr.landmass_changes(whole, cut, cfg.landmass_min_cells) == ([], [])


# --- The subsystem in a world -----------------------------------------------------------


def test_new_world_has_an_island(config: Config) -> None:
    world, outputs = World.create(config, 42, EPOCH_UNIX_MS)
    terrain = world.terrain
    assert outputs == []
    assert terrain.height.shape == (150, 256)
    assert 0.3 < terrain.land_fraction < 0.55
    assert terrain.landmass_count >= 1
    assert abs(terrain.sea_level - config.terrain.sea_base) <= 0.05
    assert int(terrain.landmass_labels.max()) >= terrain.landmass_count


def test_golden_hash_and_two_runs(config: Config) -> None:
    hashes: list[str] = []
    for _ in range(2):
        world, _ = World.create(config, 42, EPOCH_UNIX_MS)
        world.step(30 * DAY_S)
        hashes.append(world.state_hash())
    assert hashes[0] == hashes[1] == GOLDEN_TERRAIN_SEED_42


def test_save_load_continue_equals_uninterrupted(config: Config) -> None:
    straight, _ = World.create(config, 7, EPOCH_UNIX_MS)
    straight.step(40 * DAY_S)
    first, _ = World.create(config, 7, EPOCH_UNIX_MS)
    first.step(17.5 * DAY_S)
    resumed = World.restore(config, io.loads(io.dumps(first.snapshot())))
    resumed.step(22.5 * DAY_S)
    assert resumed.state_hash() == straight.state_hash()
    # Derived data is rebuilt identically too.
    assert (resumed.terrain.landmass_labels == straight.terrain.landmass_labels).all()


@pytest.mark.parametrize("seed", range(4))
def test_two_years_keep_every_invariant(small_config: Config, seed: int) -> None:
    world, _ = World.create(small_config, seed, EPOCH_UNIX_MS, [tr.Terrain(small_config.terrain)])
    cfg = small_config.terrain
    swing = cfg.sea_cycle_amplitude + cfg.sea_slow_amplitude
    for _ in range(2 * YEAR_DAYS // 5):
        world.step(5 * DAY_S)
        terrain = world.terrain
        assert np.isfinite(terrain.height).all()
        assert np.isfinite(terrain.fertility).all()
        assert float(terrain.height.min()) >= 0.0
        assert float(terrain.height.max()) <= 1.0
        assert float(terrain.fertility.min()) >= 0.0
        assert float(terrain.fertility.max()) <= 1.0
        assert abs(terrain.sea_level - cfg.sea_base) <= swing
        assert 0.05 < terrain.land_fraction < 0.9
        border = terrain.land[[0, -1], :]
        assert not border.any()


def test_terrain_draws_do_not_shift_other_streams(toy_config: Config, toy_factory: Any) -> None:
    def walker_state(subsystems: list[Subsystem]) -> dict[str, Any]:
        world, _ = World.create(toy_config, 5, EPOCH_UNIX_MS, subsystems)
        world.step(20 * DAY_S)
        return world.snapshot().subsystems["walker"]

    alone = walker_state(toy_factory()[:1])
    with_terrain = walker_state([tr.Terrain(toy_config.terrain), *toy_factory()[:1]])
    assert alone["position"] == with_terrain["position"]


def test_event_rates_and_outputs(small_config: Config) -> None:
    busy = replace(
        small_config,
        terrain=replace(
            small_config.terrain,
            volcano_rate_per_year=40.0,
            earthquake_rate_per_year=60.0,
            crater_rate_per_year=20.0,
        ),
    )
    world, _ = World.create(busy, 3, EPOCH_UNIX_MS, [tr.Terrain(busy.terrain)])
    outputs = world.step(2 * 365.25 * DAY_S)
    cfg = busy.terrain
    counts = {
        kind: sum(isinstance(o, kind) for o in outputs)
        for kind in (VolcanoErupted, EarthquakeStruck, CraterFormed)
    }
    # Poisson counts over two years: mean ± 4 standard deviations.
    for kind, mean in ((VolcanoErupted, 80), (EarthquakeStruck, 120), (CraterFormed, 40)):
        assert abs(counts[kind] - mean) < 4 * math.sqrt(mean), (kind.__name__, counts[kind])
    for event in outputs:
        if isinstance(event, VolcanoErupted | EarthquakeStruck | CraterFormed):
            assert cfg.edge_margin_cells <= event.x <= cfg.grid_width - 1 - cfg.edge_margin_cells
            assert cfg.edge_margin_cells <= event.y <= cfg.grid_height - 1 - cfg.edge_margin_cells
            assert 0 < event.t_ms <= world.t_ms


def test_quiet_world_has_no_events(small_config: Config) -> None:
    quiet = replace(
        small_config,
        terrain=replace(
            small_config.terrain,
            volcano_rate_per_year=0.0,
            earthquake_rate_per_year=0.0,
            crater_rate_per_year=0.0,
        ),
    )
    world, _ = World.create(quiet, 3, EPOCH_UNIX_MS, [tr.Terrain(quiet.terrain)])
    outputs = world.step(365 * DAY_S)
    assert not any(isinstance(o, VolcanoErupted | EarthquakeStruck | CraterFormed) for o in outputs)


def test_split_and_rejoin_outputs_match_the_landmass_count(small_config: Config) -> None:
    world, _ = World.create(small_config, 1, EPOCH_UNIX_MS, [tr.Terrain(small_config.terrain)])
    seen = 0
    for _ in range(6 * YEAR_DAYS):
        outputs = world.step(DAY_S)
        changes = [o for o in outputs if isinstance(o, LandmassSplit | LandmassesRejoined)]
        for change in changes:
            assert change.parts >= 2
            assert change.landmasses == world.terrain.landmass_count
        seen += len(changes)
    assert seen >= 1, "six years of sea cycles should split or rejoin something"


def test_vegetation_cover_hook_slows_change(config: Config) -> None:
    def cliff_after(cover: bool) -> float:
        world, _ = World.create(config, 9, EPOCH_UNIX_MS)
        terrain = world.terrain
        if cover:
            terrain.set_vegetation_cover(np.ones_like(terrain.height))
        before = terrain.height.copy()
        world.step(DAY_S)
        return float(np.abs(np.diff(terrain.height, axis=1) - np.diff(before, axis=1)).sum())

    assert cliff_after(cover=True) < cliff_after(cover=False)


def test_restoring_a_different_grid_is_rejected(config: Config, small_config: Config) -> None:
    world, _ = World.create(small_config, 1, EPOCH_UNIX_MS, [tr.Terrain(small_config.terrain)])
    with pytest.raises(ValueError, match="config expects"):
        World.restore(config, world.snapshot())


@pytest.mark.parametrize(
    ("change", "message"),
    [
        ({"grid_width": 8}, "at least 16"),
        ({"sea_base": 1.5}, "within \\[0, 1\\]"),
        ({"talus_slope": 0.0}, "must be positive"),
        ({"volcano_rate_per_year": -1.0}, "must not be negative"),
        ({"crater_depth_min": 0.5}, "crater_depth_min exceeds"),
        ({"fertility_min": 0.9}, "fertility_min exceeds"),
    ],
)
def test_invalid_terrain_config_is_rejected(
    config: Config, change: dict[str, Any], message: str
) -> None:
    from lineage_sim.config import ConfigError

    with pytest.raises(ConfigError, match=message):
        replace(config.terrain, **change)


def test_erosion_does_not_depend_on_how_time_is_chunked(config: Config) -> None:
    cfg = config.terrain
    height, _ = _island(cfg, 3)
    once = tr.erode(cfg, height, None, 40 / 365.25)
    stepped = height
    for _ in range(40):
        stepped = tr.erode(cfg, stepped, None, 1 / 365.25)
    assert float(np.abs(once - stepped).max()) < 2e-3
