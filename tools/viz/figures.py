"""Figure helpers used by every milestone report.

Each helper returns a matplotlib Figure with exactly one axis. ``to_data_uri`` turns it
into an inline ``<img>`` source so ``report.html`` is self-contained.
"""

from __future__ import annotations

import base64
import io
from collections.abc import Sequence

import matplotlib

matplotlib.use("Agg")

import matplotlib.pyplot as plt
import numpy as np
from matplotlib.figure import Figure
from matplotlib.ticker import MaxNLocator

from tools.viz import style

BAND_LOW, BAND_HIGH = 10, 90  # percentile band shown around the median


def band_over_seeds(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Median and 10–90 % band across seeds; ``values`` has shape (seeds, times)."""
    if values.ndim != 2 or values.shape[0] == 0:
        raise ValueError(f"expected a (seeds, times) array, got shape {values.shape}")
    low, median, high = np.percentile(values, [BAND_LOW, 50, BAND_HIGH], axis=0)
    return median, low, high


def time_series_band(
    times: np.ndarray,
    values: np.ndarray,
    *,
    title: str,
    xlabel: str,
    ylabel: str,
    colour: str = style.SERIES,
) -> Figure:
    """Median across seeds as a line with the 10–90 % band; never a single seed alone."""
    median, low, high = band_over_seeds(values)
    fig, ax = plt.subplots()
    ax.fill_between(times, low, high, color=colour, alpha=0.18, linewidth=0, label="10–90 %")
    ax.plot(times, median, color=colour, label=f"median of {values.shape[0]} seeds")
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.margins(x=0)
    ax.legend(loc="best")
    fig.tight_layout()
    return fig


def distribution(
    per_seed: Sequence[float] | np.ndarray,
    *,
    title: str,
    xlabel: str,
    bins: int = 20,
    log: bool = False,
) -> Figure:
    """Histogram of a per-seed outcome (e.g. time to first forest)."""
    data = np.asarray(per_seed, dtype=float)
    fig, ax = plt.subplots()
    ax.hist(data, bins=bins, color=style.SERIES, edgecolor=style.SURFACE, linewidth=1.0)
    if log:
        ax.set_yscale("log")
    else:
        ax.yaxis.set_major_locator(MaxNLocator(integer=True))
    median = float(np.median(data))
    ax.axvline(
        median,
        color=style.TEXT_PRIMARY,
        linewidth=1.0,
        linestyle="--",
        label=f"median {median:.3g}",
    )
    ax.legend(loc="best")
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel("seeds")
    fig.tight_layout()
    return fig


def to_data_uri(fig: Figure) -> str:
    """Render ``fig`` to a base64 SVG data URI and close it."""
    buffer = io.BytesIO()
    fig.savefig(buffer, format="svg", metadata={"Date": None})
    plt.close(fig)
    return "data:image/svg+xml;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
