"""Shared types for milestone report modules."""

from __future__ import annotations

import html
import math
import re
from dataclasses import dataclass


@dataclass(frozen=True)
class Criterion:
    """An acceptance criterion from CLAUDE.md §8: ``low <= metrics[metric] <= high``."""

    cid: str
    description: str
    metric: str
    low: float = -math.inf
    high: float = math.inf

    def evaluate(self, metrics: dict[str, float]) -> tuple[float | None, str]:
        value = metrics.get(self.metric)
        if value is None or math.isnan(value):
            return None, "MISSING"
        return value, "PASS" if self.low <= value <= self.high else "FAIL"

    def band(self) -> str:
        if math.isinf(self.low) and math.isinf(self.high):
            return "any"
        if math.isinf(self.high):
            return f"≥ {self.low:g}"
        if math.isinf(self.low):
            return f"≤ {self.high:g}"
        return f"[{self.low:g}, {self.high:g}]"


@dataclass(frozen=True)
class SeriesLabel:
    title: str
    unit: str


@dataclass(frozen=True)
class Section:
    """A titled block of report HTML. ``html`` is trusted markup built by the tools."""

    title: str
    html: str


def figure_html(caption: str, uri: str, *, pixel: bool = False) -> str:
    """An inline figure; ``caption`` must already be HTML-safe.

    ``pixel`` marks pixel-art imagery: shown at its natural size with hard pixel edges.
    The caption may contain markup (a colour legend); the alt text drops it.
    """
    kind = ' class="pixel"' if pixel else ""
    # The caption is already escaped: unescape the text before escaping it as an attribute.
    alt = html.escape(html.unescape(re.sub(r"<[^>]+>", "", caption)), quote=True)
    return f'<figure{kind}><img src="{uri}" alt="{alt}"><figcaption>{caption}</figcaption></figure>'
