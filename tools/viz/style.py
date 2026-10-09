"""Shared plotting style: one look and one colour per entity across every report.

Rules (CLAUDE.md §7 and the dataviz method):
- Colour follows the entity, never its rank: land-cover classes and event types have
  fixed colours; species take categorical slots in a fixed order and fold into "Other"
  past the last slot instead of generating new hues.
- One y-axis per chart; axes always carry units.
- Recessive grid and spines; thin lines; the median is the strong line and the 10–90 %
  band is a light fill of the same colour.
"""

from __future__ import annotations

from typing import Final

import matplotlib as mpl
from cycler import cycler

# Text and surface tokens (light theme; reports are printed/viewed on white).
SURFACE: Final = "#fcfcfb"
TEXT_PRIMARY: Final = "#0b0b0b"
TEXT_SECONDARY: Final = "#52514e"
GRID: Final = "#e4e3df"
NEUTRAL: Final = "#8a8984"

# Categorical slots, validated order (adjacent-pair CVD ΔE ≥ 8). Never cycled.
CATEGORICAL: Final = (
    "#2a78d6",  # blue
    "#eb6834",  # orange
    "#1baf7a",  # aqua
    "#eda100",  # yellow
    "#e87ba4",  # magenta
    "#008300",  # green
    "#4a3aa7",  # violet
    "#e34948",  # red
)
OTHER: Final = NEUTRAL

# Sequential ramp (single hue, light → dark) for magnitude maps such as fertility.
SEQUENTIAL: Final = (
    "#cde2fb",
    "#9ec5f4",
    "#6da7ec",
    "#3987e5",
    "#256abf",
    "#184f95",
    "#0d366b",
)

# Diverging pair with a neutral midpoint, e.g. uplift (red) vs subsidence (blue).
DIVERGING: Final = ("#256abf", "#f0efec", "#c53a39")

# Land-cover classes: semantic, fixed colours (CLAUDE.md §7 "consistent colours per
# land-cover class"). Keys are the class names used in sim outputs.
LAND_COVER: Final = {
    "water": "#3b6fb6",
    "bare": "#b9a98f",
    "grass": "#a8c66c",
    "shrub": "#6f9a45",
    "forest": "#2f5d2a",
    "burnt": "#4a4038",
    "snow": "#eef1f4",
}

# Chronicle event types: fixed colours so a fire is the same orange in every report.
EVENT_TYPE: Final = {
    "speciation": CATEGORICAL[0],
    "fire": CATEGORICAL[1],
    "first": CATEGORICAL[2],
    "god_power": CATEGORICAL[3],
    "migration": CATEGORICAL[4],
    "split_rejoin": CATEGORICAL[5],
    "volcano": CATEGORICAL[6],
    "extinction": CATEGORICAL[7],
}

# Per-seed outcome distributions use one neutral series colour.
SERIES: Final = CATEGORICAL[0]
WORST_SEED: Final = CATEGORICAL[7]


def categorical(slot: int) -> str:
    """Colour of categorical slot ``slot``; past the last slot everything is "Other"."""
    if slot < 0:
        raise ValueError(f"slot must be non-negative, got {slot}")
    return CATEGORICAL[slot] if slot < len(CATEGORICAL) else OTHER


def species_colour(order: int) -> str:
    """Colour of a species by its stable order of appearance (not by rank or abundance)."""
    return categorical(order)


def apply_style() -> None:
    """Apply the shared matplotlib style. Call once before building figures."""
    mpl.rcParams.update(
        {
            "figure.figsize": (7.0, 3.2),
            "figure.dpi": 100,
            "figure.facecolor": SURFACE,
            "axes.facecolor": SURFACE,
            "axes.edgecolor": NEUTRAL,
            "axes.labelcolor": TEXT_SECONDARY,
            "axes.titlecolor": TEXT_PRIMARY,
            "axes.titlesize": 11,
            "axes.titleweight": "bold",
            "axes.titlelocation": "left",
            "axes.labelsize": 9,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "axes.axisbelow": True,
            "axes.prop_cycle": cycler(color=list(CATEGORICAL)),
            "grid.color": GRID,
            "grid.linewidth": 0.6,
            "xtick.color": TEXT_SECONDARY,
            "ytick.color": TEXT_SECONDARY,
            "xtick.labelsize": 8,
            "ytick.labelsize": 8,
            "lines.linewidth": 2.0,
            "legend.frameon": False,
            "legend.fontsize": 8,
            "font.family": "sans-serif",
            "font.sans-serif": ["DejaVu Sans"],
            "text.color": TEXT_PRIMARY,
            # Deterministic SVG output so regenerated reports diff cleanly.
            "svg.hashsalt": "lineage",
            "svg.fonttype": "none",
        }
    )
