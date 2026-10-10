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
from PIL import Image

from tools.viz import style

BAND_LOW, BAND_HIGH = 10, 90  # percentile band shown around the median


def band_over_seeds(values: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Median and 10–90 % band across seeds; ``values`` has shape (seeds, times).

    NaN marks "not measured yet" (e.g. a year-over-year change during the first year) and
    is ignored; a time where every seed is NaN stays NaN.
    """
    if values.ndim != 2 or values.shape[0] == 0:
        raise ValueError(f"expected a (seeds, times) array, got shape {values.shape}")
    out = np.full((3, values.shape[1]), np.nan)
    measured = np.isfinite(values).any(axis=0)
    out[:, measured] = np.nanpercentile(values[:, measured], [BAND_LOW, 50, BAND_HIGH], axis=0)
    low, median, high = out
    return median, low, high


def time_series_band(
    times: np.ndarray,
    values: np.ndarray,
    *,
    title: str,
    xlabel: str,
    ylabel: str,
    colour: str = style.SERIES,
    integer_y: bool = False,
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
    if integer_y:
        ax.yaxis.set_major_locator(MaxNLocator(integer=True))
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


def bars_with_spread(
    labels: Sequence[str],
    per_seed: Sequence[np.ndarray],
    *,
    title: str,
    ylabel: str,
) -> Figure:
    """One bar per label at the median across seeds, whisker over the 10–90 % band.

    Bars are named on the axis, so they share one colour.
    """
    stats = np.array([np.percentile(v, [BAND_LOW, 50, BAND_HIGH]) for v in per_seed])
    low, median, high = stats.T
    fig, ax = plt.subplots()
    positions = np.arange(len(labels))
    ax.bar(positions, median, width=0.6, color=style.SERIES)
    ax.errorbar(
        positions,
        median,
        yerr=[median - low, high - median],
        fmt="none",
        ecolor=style.TEXT_PRIMARY,
        elinewidth=1.0,
        capsize=4,
        label="10–90 % of seeds",
    )
    for x, value in zip(positions, median, strict=True):
        ax.annotate(
            f"{value:g}",
            (x, value),
            xytext=(8, 2),
            textcoords="offset points",
            fontsize=8,
            color=style.TEXT_SECONDARY,
        )
    ax.set_xticks(positions, labels)
    ax.set_title(title)
    ax.set_ylabel(ylabel)
    ax.grid(axis="x", visible=False)
    ax.legend(loc="best")
    fig.tight_layout()
    return fig


def image_grid(
    images: Sequence[Sequence[np.ndarray]],
    row_labels: Sequence[str],
    column_labels: Sequence[str],
) -> Figure:
    """A grid of RGB images (rows × columns) with labels on the left and on top."""
    rows, columns = len(images), len(images[0])
    aspect = images[0][0].shape[0] / images[0][0].shape[1]
    width = 10.0
    cell = (width - 0.5) / columns
    fig, axes = plt.subplots(
        rows, columns, figsize=(width, rows * cell * aspect + 0.4), squeeze=False
    )
    for r in range(rows):
        for c in range(columns):
            ax = axes[r][c]
            ax.imshow(images[r][c], interpolation="nearest")
            ax.set_xticks([])
            ax.set_yticks([])
            ax.grid(visible=False)
            for spine in ax.spines.values():
                spine.set_visible(False)
            if r == 0:
                ax.set_title(column_labels[c], fontsize=9, loc="center", fontweight="normal")
            if c == 0:
                ax.set_ylabel(row_labels[r], fontsize=9)
    fig.subplots_adjust(left=0.04, right=0.995, top=0.94, bottom=0.01, wspace=0.03, hspace=0.05)
    return fig


def to_data_uri(fig: Figure, fmt: str = "svg") -> str:
    """Render ``fig`` to a base64 data URI (``svg``, or ``png`` for image-heavy figures)."""
    buffer = io.BytesIO()
    if fmt == "svg":
        fig.savefig(buffer, format="svg", metadata={"Date": None})
        mime = "image/svg+xml"
    else:
        fig.savefig(buffer, format="png", dpi=110, metadata={"Software": None})
        mime = "image/png"
    plt.close(fig)
    return f"data:{mime};base64," + base64.b64encode(buffer.getvalue()).decode("ascii")


def animation_data_uri(frames: Sequence[np.ndarray], frame_ms: int) -> str:
    """Encode RGB frames (uint8, H×W×3) as a looping animated WebP data URI."""
    images = [Image.fromarray(frame, mode="RGB") for frame in frames]
    buffer = io.BytesIO()
    images[0].save(
        buffer,
        format="WEBP",
        save_all=True,
        append_images=images[1:],
        duration=frame_ms,
        loop=0,
        quality=80,
        method=4,
    )
    return "data:image/webp;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
