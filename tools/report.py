"""Build a milestone report from a fast-forward run (CLAUDE.md §7).

Usage::

    uv run python -m tools.report <milestone> --runs runs/<id> [--out reports]

Writes ``reports/<MID>-<slug>/`` with ``report.html`` (self-contained), ``metrics.json``,
``config.toml`` and ``README.md``. Reports are regenerated, never hand-edited.
"""

from __future__ import annotations

import argparse
import html
import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

from tools.runs import REPO_ROOT, TIME_KEY, Run, read_run
from tools.viz import figures, style

DEFAULT_OUT = REPO_ROOT / "reports"


@dataclass(frozen=True)
class Milestone:
    mid: str
    slug: str
    title: str


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


MILESTONES: dict[str, Milestone] = {
    m.mid: m
    for m in (
        Milestone("M0", "tooling", "Repository and tooling"),
        Milestone("M1", "core", "Core: clock, RNG, world loop, state, saves, migrations"),
        Milestone("M2", "terrain", "Terrain generation and dynamics"),
        Milestone("M3", "flora", "Flora"),
        Milestone("M4", "fauna-evolution", "Fauna I: genome, body, energy, evolution"),
        Milestone("M5", "fauna-learning", "Fauna II: lifetime learning"),
        Milestone("M6", "species", "Species, names, phylogeny"),
        Milestone("M7", "rare-genes", "Rare genes (creatures and plants)"),
        Milestone("M8", "presence", "Presence, calendar, god powers"),
        Milestone("M9", "chronicle", "Chronicle and bestiary"),
        Milestone("M10", "apocalypse", "Apocalypse and worlds"),
        Milestone("M11", "long-run", "Long-run tuning and stability"),
    )
}

# Acceptance criteria per milestone; each milestone adds its own when it lands.
CRITERIA: dict[str, list[Criterion]] = {}

# Display names and units of recorded series; every series a milestone records goes here.
SERIES_LABELS: dict[str, SeriesLabel] = {}


def series_label(name: str) -> SeriesLabel:
    return SERIES_LABELS.get(name, SeriesLabel(name, "unit not registered"))


def compute_metrics(run: Run) -> dict[str, float]:
    """Generic per-series metrics: spread of each series' final value across seeds."""
    names = sorted({n for s in run.series.values() for n in s if n != TIME_KEY})
    metrics: dict[str, float] = {}
    for name in names:
        finals = np.array([s[name][-1] for s in run.series.values() if name in s], dtype=float)
        p10, median, p90 = np.percentile(finals, [10, 50, 90])
        metrics |= {
            f"{name}.final.median": float(median),
            f"{name}.final.p10": float(p10),
            f"{name}.final.p90": float(p90),
            f"{name}.final.min": float(finals.min()),
            f"{name}.final.max": float(finals.max()),
        }
    return metrics


def _figures(run: Run) -> list[tuple[str, str]]:
    """(caption, data URI) for each recorded series: time series band + final distribution."""
    style.apply_style()
    out: list[tuple[str, str]] = []
    names = sorted({n for s in run.series.values() for n in s if n != TIME_KEY})
    for name in names:
        rows = [s for s in run.series.values() if name in s]
        times = rows[0][TIME_KEY]
        values = np.stack([r[name] for r in rows])
        label = series_label(name)
        ylabel = f"{label.title} ({label.unit})"
        fig = figures.time_series_band(
            times, values, title=label.title, xlabel="sim time (years)", ylabel=ylabel
        )
        out.append(
            (f"{label.title}: median and 10–90 % band across seeds", figures.to_data_uri(fig))
        )
        fig = figures.distribution(
            values[:, -1], title=f"{label.title} at end of run", xlabel=ylabel
        )
        out.append((f"{label.title}: final value per seed", figures.to_data_uri(fig)))
    return out


_CSS = """
:root { --surface:#fcfcfb; --text:#0b0b0b; --muted:#52514e; --rule:#e4e3df;
  --pass:#008300; --fail:#c53a39; --missing:#8a6d00; color-scheme: light; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --surface:#1a1a19; --text:#ffffff; --muted:#c3c2b7; --rule:#383835;
  --pass:#4fb34f; --fail:#e66767; --missing:#d9a300; color-scheme: dark; } }
:root[data-theme="dark"] { --surface:#1a1a19; --text:#ffffff; --muted:#c3c2b7;
  --rule:#383835; --pass:#4fb34f; --fail:#e66767; --missing:#d9a300; color-scheme: dark; }
body { margin:0; background:var(--surface); color:var(--text);
  font:15px/1.5 system-ui, sans-serif; }
main { max-width:960px; margin:0 auto; padding:24px 16px 64px; }
h1 { font-size:1.5rem; margin:0 0 4px; } h2 { font-size:1.1rem; margin:32px 0 8px; }
.sub { color:var(--muted); margin:0 0 16px; }
table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--rule); }
th { color:var(--muted); font-weight:600; font-size:.85rem; }
.PASS { color:var(--pass); font-weight:600; } .FAIL { color:var(--fail); font-weight:600; }
.MISSING { color:var(--missing); font-weight:600; }
figure { margin:16px 0; background:#fcfcfb; border-radius:6px; padding:8px; }
figure img { width:100%; height:auto; display:block; }
figcaption { color:#52514e; font-size:.85rem; padding:4px 4px 0; }
.empty { color:var(--muted); font-style:italic; }
.wrap { overflow-x:auto; }
"""


def _row(cells: list[str], tag: str = "td") -> str:
    return "<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>"


def render_html(
    milestone: Milestone,
    run: Run,
    acceptance: list[dict[str, Any]],
    metrics: dict[str, float],
) -> str:
    m = run.manifest
    e = html.escape
    header = [
        ("Milestone", f"{milestone.mid} — {milestone.title}"),
        ("Git commit", m.git_commit),
        ("Config hash", m.config_hash),
        ("Seeds", f"{len(m.seeds)} ({', '.join(map(str, m.seeds))})"),
        ("Sim-years per seed", f"{m.sim_years:g}"),
        ("Wall time", f"{m.wall_time_s:g} s"),
        ("Run", f"{m.run_id} (created {m.created_utc})"),
    ]
    header_rows = "".join(_row([e(k), e(v)]) for k, v in header)

    if acceptance:
        acc_rows = _row(["Criterion", "Measured", "Target", "Result"], "th") + "".join(
            _row(
                [
                    e(f"{a['id']}: {a['description']}"),
                    "—" if a["value"] is None else f"{a['value']:.4g}",
                    e(a["target"]),
                    f'<span class="{a["status"]}">{a["status"]}</span>',
                ]
            )
            for a in acceptance
        )
        acc = f'<div class="wrap"><table>{acc_rows}</table></div>'
    else:
        acc = '<p class="empty">No acceptance criteria defined for this milestone.</p>'

    figs = (
        "".join(
            f'<figure><img src="{uri}" alt="{e(cap)}"><figcaption>{e(cap)}</figcaption></figure>'
            for cap, uri in _figures(run)
        )
        or '<p class="empty">This run recorded no series.</p>'
    )

    if metrics:
        metric_rows = _row(["Metric", "Value"], "th") + "".join(
            _row([e(k), f"{v:.6g}"]) for k, v in sorted(metrics.items())
        )
        metric_table = f'<div class="wrap"><table>{metric_rows}</table></div>'
    else:
        metric_table = '<p class="empty">No metrics.</p>'

    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Lineage {e(milestone.mid)} report</title>
<style>{_CSS}</style>
</head>
<body>
<main>
<h1>Lineage {e(milestone.mid)} — {e(milestone.title)}</h1>
<p class="sub">Generated by tools/report.py. Regenerate; do not hand-edit.</p>
<h2>Header</h2>
<table>{header_rows}</table>
<h2>Acceptance</h2>
{acc}
<h2>Figures</h2>
{figs}
<h2>Metrics</h2>
{metric_table}
</main>
</body>
</html>
"""


def render_readme(milestone: Milestone, run: Run, acceptance: list[dict[str, Any]]) -> str:
    m = run.manifest
    lines = [
        f"# {milestone.mid} — {milestone.title}",
        "",
        f"Run `{m.run_id}`: {len(m.seeds)} seeds × {m.sim_years:g} sim-years, "
        f"commit `{m.git_commit}`, config `{m.config_hash}`, wall time {m.wall_time_s:g} s.",
        "",
    ]
    if acceptance:
        for a in acceptance:
            measured = "—" if a["value"] is None else f"{a['value']:.4g}"
            lines.append(
                f"- **{a['status']}** {a['id']}: {a['description']} "
                f"(measured {measured}, target {a['target']})"
            )
    else:
        lines.append("No acceptance criteria defined for this milestone.")
    lines += ["", "See `report.html` for figures and `metrics.json` for every number."]
    return "\n".join(lines) + "\n"


def build_report(milestone_id: str, run_dir: Path, out_root: Path = DEFAULT_OUT) -> Path:
    try:
        milestone = MILESTONES[milestone_id]
    except KeyError:
        raise ValueError(
            f"unknown milestone {milestone_id!r}; known: {', '.join(MILESTONES)}"
        ) from None
    run = read_run(run_dir)
    metrics = compute_metrics(run)
    acceptance: list[dict[str, Any]] = []
    for c in CRITERIA.get(milestone.mid, []):
        value, status = c.evaluate(metrics)
        acceptance.append(
            {
                "id": c.cid,
                "description": c.description,
                "metric": c.metric,
                "value": value,
                "target": c.band(),
                "status": status,
            }
        )

    out_dir = out_root / f"{milestone.mid}-{milestone.slug}"
    out_dir.mkdir(parents=True, exist_ok=True)
    m = run.manifest
    metrics_doc = {
        "milestone": milestone.mid,
        "run_id": m.run_id,
        "git_commit": m.git_commit,
        "config_hash": m.config_hash,
        "seeds": m.seeds,
        "sim_years": m.sim_years,
        "wall_time_s": m.wall_time_s,
        "acceptance": acceptance,
        "metrics": metrics,
    }
    (out_dir / "metrics.json").write_text(
        json.dumps(metrics_doc, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    (out_dir / "config.toml").write_text(run.config_text, encoding="utf-8")
    (out_dir / "report.html").write_text(
        render_html(milestone, run, acceptance, metrics), encoding="utf-8"
    )
    (out_dir / "README.md").write_text(render_readme(milestone, run, acceptance), encoding="utf-8")
    return out_dir


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        description="Build a milestone report from a fast-forward run."
    )
    parser.add_argument("milestone", help="milestone id, e.g. M3")
    parser.add_argument("--runs", type=Path, required=True, help="run directory, runs/<id>")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="reports root")
    args = parser.parse_args(argv)
    out_dir = build_report(args.milestone, args.runs, args.out)
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main()
