"""Lying snow: derived from the season and the height, for the renderer (R1)."""

from __future__ import annotations

import numpy as np
from hypothesis import given
from hypothesis import strategies as st
from lineage_sim import flora as fl
from lineage_sim.config import Config

_F = np.float32


def _heights() -> np.ndarray:
    return np.linspace(-0.1, 0.7, 81, dtype=_F)


def test_snow_lies_high_in_winter_and_on_peaks_only_in_summer(config: Config) -> None:
    cfg = config.flora
    elevation = _heights()
    winter = fl.snow_cover(cfg, -1.0, elevation)
    summer = fl.snow_cover(cfg, 1.0, elevation)
    # None on the sea, none on the lowland shore even in midwinter.
    assert np.all(winter[elevation <= 0] == 0)
    assert winter[np.searchsorted(elevation, 0.05)] == 0
    # Deeper the higher, more in winter than in summer.
    assert np.all(np.diff(winter[elevation > 0]) >= 0)
    assert np.all(winter >= summer)
    assert winter[-1] == 1.0
    lowest_winter = elevation[np.argmax(winter > 0)]
    lowest_summer = elevation[np.argmax(summer > 0)]
    assert 0.08 < lowest_winter < 0.16
    assert lowest_summer > 0.5


@given(st.floats(-1.0, 1.0), st.lists(st.floats(-1.0, 2.0), min_size=1, max_size=20))
def test_snow_depth_is_a_share(config: Config, season_warmth: float, heights: list[float]) -> None:
    depth = fl.snow_cover(config.flora, season_warmth, np.array(heights, dtype=_F))
    assert depth.dtype == _F
    assert np.all((depth >= 0) & (depth <= 1))
