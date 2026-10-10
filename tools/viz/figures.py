"""Figure helpers used by every milestone report.

Each helper returns a matplotlib Figure with exactly one axis. ``to_data_uri`` turns it
into an inline ``<img>`` source so ``report.html`` is self-contained.
"""

from __future__ import annotations

import base64
import io
import math
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


def median_lines(
    times: np.ndarray,
    series: dict[str, np.ndarray],
    *,
    title: str,
    xlabel: str,
    ylabel: str,
) -> Figure:
    """Median across seeds of several related series on one axis, labelled at the line end.

    ``series`` maps a label to a (seeds, times) array; colours follow the fixed
    categorical order.
    """
    fig, ax = plt.subplots()
    for slot, (label, values) in enumerate(series.items()):
        median, _, _ = band_over_seeds(values)
        ax.plot(times, median, color=style.categorical(slot), label=label)
        ax.annotate(
            label,
            (times[-1], median[-1]),
            xytext=(6, 0),
            textcoords="offset points",
            va="center",
            fontsize=8,
            color=style.TEXT_SECONDARY,
        )
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.margins(x=0)
    ax.legend(loc="best")
    fig.tight_layout(rect=(0, 0, 0.93, 1))
    return fig


def stacked_area(
    times: np.ndarray,
    layers: dict[str, tuple[np.ndarray, str]],
    *,
    title: str,
    xlabel: str,
    ylabel: str,
) -> Figure:
    """Stacked medians across seeds, bottom layer first. ``layers`` maps a label to a
    (seeds, times) array and its fixed colour."""
    medians = [band_over_seeds(values)[0] for values, _ in layers.values()]
    fig, ax = plt.subplots(figsize=(7.0, 3.6))
    ax.stackplot(
        times,
        medians,
        labels=list(layers),
        colors=[colour for _, colour in layers.values()],
        edgecolor=style.SURFACE,
        linewidth=0.8,
    )
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel(ylabel)
    ax.margins(x=0, y=0)
    handles, labels = ax.get_legend_handles_labels()
    ax.legend(handles[::-1], labels[::-1], loc="center left", bbox_to_anchor=(1.0, 0.5))
    fig.tight_layout()
    return fig


def band_panels(
    times: np.ndarray,
    panels: dict[str, tuple[np.ndarray, str]],
    *,
    xlabel: str,
    ylabel: str,
    columns: int = 3,
) -> Figure:
    """Small multiples: one median + 10–90 % band per panel, shared axes."""
    rows = math.ceil(len(panels) / columns)
    fig, axes = plt.subplots(
        rows, columns, figsize=(7.0, 1.9 * rows + 0.5), sharex=True, sharey=True, squeeze=False
    )
    flat = [ax for row in axes for ax in row]
    for ax, (label, (values, colour)) in zip(flat, panels.items(), strict=False):
        median, low, high = band_over_seeds(values)
        ax.fill_between(times, low, high, color=colour, alpha=0.3, linewidth=0)
        ax.plot(times, median, color=colour)
        ax.set_title(label, fontsize=9)
        ax.margins(x=0)
    for ax in flat[len(panels) :]:
        ax.set_visible(False)
    fig.supxlabel(xlabel, fontsize=9, color=style.TEXT_SECONDARY)
    fig.supylabel(ylabel, fontsize=9, color=style.TEXT_SECONDARY)
    fig.tight_layout()
    return fig


def log_histogram(values: Sequence[float] | np.ndarray, *, title: str, xlabel: str) -> Figure:
    """Histogram on logarithmic bins and a logarithmic count axis (heavy-tailed sizes)."""
    data = np.asarray(values, dtype=float)
    data = data[data > 0]
    fig, ax = plt.subplots()
    if data.size:
        top = max(2.0, float(data.max()))
        edges = np.unique(np.round(np.logspace(0, math.log10(top) + 1e-9, 16))) - 0.5
        edges = np.append(edges, top + 0.5)
        ax.hist(
            data, bins=edges.tolist(), color=style.SERIES, edgecolor=style.SURFACE, linewidth=1.0
        )
        ax.set_xscale("log")
        ax.set_yscale("log")
    ax.set_title(title)
    ax.set_xlabel(xlabel)
    ax.set_ylabel("fires (count)")
    fig.tight_layout()
    return fig


def histogram_panels(
    panels: dict[str, np.ndarray],
    *,
    xlabel: str,
    ylabel: str,
    columns: int = 3,
    bins: int = 20,
    value_range: tuple[float, float] = (0.0, 1.0),
) -> Figure:
    """Small multiples: one histogram per panel over a shared value range."""
    rows = math.ceil(len(panels) / columns)
    fig, axes = plt.subplots(
        rows, columns, figsize=(7.0, 1.9 * rows + 0.5), sharex=True, squeeze=False
    )
    flat = [ax for row in axes for ax in row]
    for ax, (label, values) in zip(flat, panels.items(), strict=False):
        ax.hist(
            values, bins=bins, range=value_range, color=style.SERIES, edgecolor=style.SURFACE,
            linewidth=0.6,
        )  # fmt: skip
        ax.set_title(label, fontsize=9)
        ax.set_yticks([])
    for ax in flat[len(panels) :]:
        ax.set_visible(False)
    fig.supxlabel(xlabel, fontsize=9, color=style.TEXT_SECONDARY)
    fig.supylabel(ylabel, fontsize=9, color=style.TEXT_SECONDARY)
    fig.tight_layout()
    return fig


def distribution(
    per_seed: Sequence[float] | np.ndarray,
    *,
    title: str,
    xlabel: str,
    bins: int | Sequence[float] = 20,
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
