"""Rendering of terrain grids for reports: hypsometric tints with hillshade."""

from __future__ import annotations

import numpy as np
from matplotlib.colors import to_rgb

from tools.viz import style

# Colour stops as (height above sea, colour); below sea as (depth, colour).
_LAND_STOPS = (
    (0.000, "#d8c9a3"),  # beach
    (0.015, style.LAND_COVER["bare"]),
    (0.120, "#a08a6c"),
    (0.240, "#857361"),
    (0.360, "#8a8580"),
    (0.470, "#b9b7b5"),
    (0.560, style.LAND_COVER["snow"]),
)
_SEA_STOPS = (
    (0.000, "#6fa3d8"),  # shallows
    (0.030, style.LAND_COVER["water"]),
    (0.150, "#234a82"),
    (0.400, "#13294d"),
)


def _ramp(values: np.ndarray, stops: tuple[tuple[float, str], ...]) -> np.ndarray:
    xs = np.array([s[0] for s in stops])
    rgb = np.array([to_rgb(s[1]) for s in stops])
    return np.stack([np.interp(values, xs, rgb[:, c]) for c in range(3)], axis=-1)


def hillshade(height: np.ndarray, exaggeration: float = 14.0) -> np.ndarray:
    """Lambertian shading in [0, 1], light from the north-west."""
    gy, gx = np.gradient(height.astype(np.float64) * exaggeration)
    normal = np.stack([-gx, -gy, np.ones_like(gx)], axis=-1)
    normal /= np.linalg.norm(normal, axis=-1, keepdims=True)
    light = np.array([-1.0, -1.0, 1.4])
    light /= np.linalg.norm(light)
    return np.clip(normal @ light, 0.0, 1.0)


def terrain_rgb(height: np.ndarray, sea_level: float) -> np.ndarray:
    """RGB image (H, W, 3) in [0, 1] of a height grid at a given sea level."""
    height = height.astype(np.float64)
    land = height > sea_level
    rgb = np.where(
        land[..., None],
        _ramp(height - sea_level, _LAND_STOPS),
        _ramp(sea_level - height, _SEA_STOPS),
    )
    shade = hillshade(height)
    # Full relief shading on land, a hint of it on the sea floor.
    strength = np.where(land, 0.55, 0.12)[..., None]
    lit = rgb * (1.0 - strength + strength * (shade[..., None] / shade.mean()))
    return np.clip(lit, 0.0, 1.0)
