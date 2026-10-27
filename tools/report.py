"""Build a milestone report from a fast-forward run (CLAUDE.md §7).

Usage::

    uv run python -m tools.report <milestone> --runs runs/<id> [--baseline runs/<id>]...
        [--out reports]

Writes ``reports/<MID>-<slug>/`` with ``report.html`` (self-contained), ``metrics.json``,
``config.toml`` and ``README.md``. Reports are regenerated, never hand-edited.

Milestones with statistical behaviour have a module in ``tools/milestones/`` providing
their metrics, acceptance criteria and figures; the others get a generic report with
every recorded series. A milestone whose module sets ``NEEDS_BASELINE`` compares runs and
needs ``--baseline``: the run with the mechanism off (an ablation, M5), or, repeated, the
runs under other presence schedules (M8).

Milestones measured on the device (R0) are built from the file the device benchmark
wrote instead of a run: ``--runs`` is that file or the directory holding it. The file is
copied into the report directory in place of ``config.toml``, since a PC cannot
regenerate it.
"""

from __future__ import annotations

import argparse
import html
import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from types import ModuleType
from typing import Any

import numpy as np

from tools.milestones import m2, m3, m4, m5, m6, m7, m8, m9, m11, r0
from tools.milestones.base import Criterion, Section, SeriesLabel, figure_html
from tools.runs import REPO_ROOT, TIME_KEY, Run, read_run
from tools.viz import figures, style

__all__ = ["CRITERIA", "MILESTONES", "Criterion", "Section", "SeriesLabel", "build_report"]

DEFAULT_OUT = REPO_ROOT / "reports"


@dataclass(frozen=True)
class Milestone:
    mid: str
    slug: str
    title: str


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
        Milestone("R0", "renderer-spike", "Renderer spike on the device"),
    )
}

# Milestones with their own metrics and report sections.
MODULES: dict[str, ModuleType] = {
    "M2": m2,
    "M3": m3,
    "M4": m4,
    "M5": m5,
    "M6": m6,
    "M7": m7,
    "M8": m8,
    "M9": m9,
    "M11": m11,
}

# Milestones measured on the device rather than by fast-forward: the module reads its
# own evidence file and provides the header, metrics and sections from it.
DEVICE_MODULES: dict[str, ModuleType] = {"R0": r0}

# Acceptance criteria per milestone; each milestone adds its own when it lands.
CRITERIA: dict[str, list[Criterion]] = {
    "M2": m2.CRITERIA,
    "M3": m3.CRITERIA,
    "M4": m4.CRITERIA,
    "M5": m5.CRITERIA,
    "M6": m6.CRITERIA,
    "M7": m7.CRITERIA,
    "M8": m8.CRITERIA,
    "M9": m9.CRITERIA,
    "M11": m11.CRITERIA,
    "R0": r0.CRITERIA,
}

# Display names and units of recorded series; every series a milestone records goes here.
SERIES_LABELS: dict[str, SeriesLabel] = {
    "save_kib": SeriesLabel("Save size", "KiB"),
    "step_ms": SeriesLabel("Step time", "ms per sim-day"),
    **m2.SERIES_LABELS,
    **m3.SERIES_LABELS,
    **m4.SERIES_LABELS,
    **m5.SERIES_LABELS,
    **m6.SERIES_LABELS,
    **m7.SERIES_LABELS,
    **m8.SERIES_LABELS,
    **m9.SERIES_LABELS,
    **m11.SERIES_LABELS,
}


def series_label(name: str) -> SeriesLabel:
    return SERIES_LABELS.get(name, SeriesLabel(name, "unit not registered"))


def compute_metrics(run: Run) -> dict[str, float]:
    """Generic per-series metrics: spread of each series' final value across seeds."""
    names = sorted(
        {n for s in run.series.values() for n in s if n != TIME_KEY and not n.startswith("_")}
    )
    metrics: dict[str, float] = {}
    for name in names:
        finals = np.array([s[name][-1] for s in run.series.values() if name in s], dtype=float)
        finals = finals[np.isfinite(finals)]
        if finals.size == 0:
            continue
        p10, median, p90 = np.percentile(finals, [10, 50, 90])
        metrics |= {
            f"{name}.final.median": float(median),
            f"{name}.final.p10": float(p10),
            f"{name}.final.p90": float(p90),
            f"{name}.final.min": float(finals.min()),
            f"{name}.final.max": float(finals.max()),
        }
    return metrics


def series_figures(run: Run, names: list[str], *, finals: bool = True) -> list[tuple[str, str]]:
    """(caption, data URI) per named series: time series band, then final distribution."""
    style.apply_style()
    out: list[tuple[str, str]] = []
    for name in names:
        rows = [s for s in run.series.values() if name in s]
        if not rows:
            continue
        times = rows[0][TIME_KEY]
        values = np.stack([r[name] for r in rows])
        if not np.isfinite(values).any():
            continue  # nothing measured in this run (e.g. shorter than the metric's lag)
        label = series_label(name)
        ylabel = f"{label.title} ({label.unit})"
        fig = figures.time_series_band(
            times, values, title=label.title, xlabel="sim time (years)", ylabel=ylabel
        )
        caption = f"{label.title}: median and 10–90 % band across {len(rows)} seeds"
        out.append((caption, figures.to_data_uri(fig)))
        if finals:
            last = values[:, -1]
            fig = figures.distribution(
                last[np.isfinite(last)], title=f"{label.title} at end of run", xlabel=ylabel
            )
            out.append((f"{label.title}: final value per seed", figures.to_data_uri(fig)))
    return out


def generic_sections(run: Run) -> list[Section]:
    """Fallback for milestones without their own module: every recorded series."""
    names = sorted(
        {n for s in run.series.values() for n in s if n != TIME_KEY and not n.startswith("_")}
    )
    body = "".join(figure_html(html.escape(c), u) for c, u in series_figures(run, names))
    return [Section("Figures", body or '<p class="empty">This run recorded no series.</p>')]


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
.note { color:var(--muted); font-size:.9rem; max-width:75ch; }
table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
th, td { text-align:left; padding:6px 8px; border-bottom:1px solid var(--rule); }
th { color:var(--muted); font-weight:600; font-size:.85rem; }
.PASS { color:var(--pass); font-weight:600; } .FAIL { color:var(--fail); font-weight:600; }
.MISSING { color:var(--missing); font-weight:600; }
figure { margin:16px 0; background:#fcfcfb; border-radius:6px; padding:8px; }
figure img { width:100%; height:auto; display:block; }
figure.pixel { background:#14213d; }
figure.pixel img { width:auto; max-width:100%; margin:0 auto; image-rendering:pixelated; }
figure.pixel figcaption { color:#c9d3dc; }
figcaption { color:#52514e; font-size:.85rem; padding:4px 4px 0; }
.empty { color:var(--muted); font-style:italic; }
.wrap { overflow-x:auto; }
pre { overflow-x:auto; font-size:.8rem; color:var(--muted); }
small { color:var(--muted); }
.lede { font-size:1.05rem; max-width:70ch; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:10px;
  margin:16px 0; }
.tile { border:1px solid var(--rule); border-radius:8px; padding:12px 14px; }
.tile b { display:block; font-size:1.6rem; line-height:1.2; }
.tile span { color:var(--muted); font-size:.85rem; }
details { margin:12px 0; } summary { cursor:pointer; color:var(--muted); font-weight:600; }
"""
# Acceptance tables longer than this fold behind a one-line summary.
FOLD_ACCEPTANCE_ROWS = 12


def _row(cells: list[str], tag: str = "td") -> str:
    return "<tr>" + "".join(f"<{tag}>{c}</{tag}>" for c in cells) + "</tr>"


def run_header(run: Run) -> list[tuple[str, str]]:
    """Header rows of a report built from a fast-forward run."""
    m = run.manifest
    return [
        ("Git commit", m.git_commit),
        ("Config hash", m.config_hash),
        ("Seeds", f"{len(m.seeds)} ({', '.join(map(str, m.seeds))})"),
        ("Sim-years per seed", f"{m.sim_years:g}"),
        ("Wall time", f"{m.wall_time_s:g} s"),
        ("Run", f"{m.run_id} (created {m.created_utc}; {m.notes})"),
    ]


def run_summary(run: Run) -> str:
    """What was run, in one line, for the report's README."""
    m = run.manifest
    return (
        f"Run `{m.run_id}`: {len(m.seeds)} seeds × {m.sim_years:g} sim-years, "
        f"commit `{m.git_commit}`, config `{m.config_hash}`, wall time {m.wall_time_s:g} s."
    )


def render_html(
    milestone: Milestone,
    header: list[tuple[str, str]],
    acceptance: list[dict[str, Any]],
    metrics: dict[str, float],
    sections: list[Section],
    *,
    story_first: bool = False,
) -> str:
    """The page. ``story_first`` (M11) puts the milestone's sections ahead of the header
    and the criteria, and folds the long tables away."""
    e = html.escape
    header = [("Milestone", f"{milestone.mid} — {milestone.title}"), *header]
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
        if len(acceptance) > FOLD_ACCEPTANCE_ROWS:
            passed = sum(a["status"] == "PASS" for a in acceptance)
            acc = (
                f"<details><summary>{passed} of {len(acceptance)} criteria pass "
                f"(open the table)</summary>{acc}</details>"
            )
    else:
        acc = '<p class="empty">No acceptance criteria defined for this milestone.</p>'

    body = "".join(f"<h2>{e(section.title)}</h2>\n{section.html}\n" for section in sections)

    if metrics:
        metric_rows = _row(["Metric", "Value"], "th") + "".join(
            _row([e(k), f"{v:.6g}"]) for k, v in sorted(metrics.items())
        )
        metric_table = (
            f"<details><summary>All {len(metrics)} metrics</summary>"
            f'<div class="wrap"><table>{metric_rows}</table></div></details>'
        )
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
{body if story_first else ""}<h2>Header</h2>
{_header_table(header_rows, len(header), story_first)}
<h2>Acceptance</h2>
{acc}
{"" if story_first else body}<h2>Metrics</h2>
{metric_table}
</main>
</body>
</html>
"""


def _header_table(rows: str, count: int, fold: bool) -> str:
    table = f'<div class="wrap"><table>{rows}</table></div>'
    if fold:
        return f"<details><summary>Runs and provenance ({count} rows)</summary>{table}</details>"
    return f"<table>{rows}</table>"


def render_readme(milestone: Milestone, summary: str, acceptance: list[dict[str, Any]]) -> str:
    lines = [f"# {milestone.mid} — {milestone.title}", "", summary, ""]
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


def evaluate(milestone_id: str, metrics: dict[str, float]) -> list[dict[str, Any]]:
    """The milestone's acceptance criteria measured against ``metrics``."""
    acceptance: list[dict[str, Any]] = []
    for c in CRITERIA.get(milestone_id, []):
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
    return acceptance


def _write_report(
    out_dir: Path,
    milestone: Milestone,
    header: list[tuple[str, str]],
    summary: str,
    provenance: dict[str, Any],
    metrics: dict[str, float],
    sections: list[Section],
    *,
    story_first: bool = False,
) -> None:
    acceptance = evaluate(milestone.mid, metrics)
    metrics_doc = {
        "milestone": milestone.mid,
        **provenance,
        "acceptance": acceptance,
        "metrics": metrics,
    }
    (out_dir / "metrics.json").write_text(
        json.dumps(metrics_doc, indent=2, allow_nan=False) + "\n", encoding="utf-8"
    )
    (out_dir / "report.html").write_text(
        render_html(milestone, header, acceptance, metrics, sections, story_first=story_first),
        encoding="utf-8",
    )
    (out_dir / "README.md").write_text(
        render_readme(milestone, summary, acceptance), encoding="utf-8"
    )


def _build_device_report(milestone: Milestone, source: Path, out_dir: Path) -> None:
    module = DEVICE_MODULES[milestone.mid]
    evidence = module.load(source)
    _write_report(
        out_dir,
        milestone,
        module.header(evidence),
        module.summary(evidence),
        module.provenance(evidence),
        module.metrics(evidence),
        module.sections(evidence),
    )
    # The evidence stays with the report: it is what a rebuild starts from.
    (out_dir / module.EVIDENCE).write_text(json.dumps(evidence, indent=1) + "\n", encoding="utf-8")


def build_report(
    milestone_id: str,
    run_dir: Path,
    out_root: Path = DEFAULT_OUT,
    baseline_dir: Path | Sequence[Path] | None = None,
    sweeps: Sequence[Path] = (),
) -> Path:
    try:
        milestone = MILESTONES[milestone_id]
    except KeyError:
        raise ValueError(
            f"unknown milestone {milestone_id!r}; known: {', '.join(MILESTONES)}"
        ) from None
    out_dir = out_root / f"{milestone.mid}-{milestone.slug}"
    if milestone.mid in DEVICE_MODULES:
        # Read before creating anything, so a missing evidence file leaves no empty report.
        DEVICE_MODULES[milestone.mid].load(run_dir)
        out_dir.mkdir(parents=True, exist_ok=True)
        _build_device_report(milestone, run_dir, out_dir)
        return out_dir
    run = read_run(run_dir)
    module = MODULES.get(milestone.mid)
    compared: tuple[Run, ...] = ()
    if module is not None and getattr(module, "NEEDS_BASELINE", False):
        if baseline_dir is None:
            raise ValueError(f"{milestone.mid} compares runs: pass --baseline runs/<id>")
        dirs = [baseline_dir] if isinstance(baseline_dir, Path) else list(baseline_dir)
        compared = tuple(read_run(d) for d in dirs)
        mixed = getattr(module, "MIXED_RUNS", False)  # M11: held-out seeds, longer runs
        if not mixed and any(b.manifest.seeds != run.manifest.seeds for b in compared):
            raise ValueError("the baseline run must use the same seeds")
    # A module that reads sweeps (M11) takes them as a keyword.
    extra: dict[str, Any] = (
        {"sweeps": tuple(sweeps)}
        if module is not None and getattr(module, "TAKES_SWEEPS", False)
        else {}
    )
    # A milestone module reports its own, curated numbers; the generic per-series spread
    # is for milestones without one.
    metrics = compute_metrics(run) if module is None else module.metrics(run, *compared, **extra)
    if module is not None:
        sections: list[Section] = module.sections(run, run_dir, *compared, **extra)
    else:
        sections = generic_sections(run)
    header, summary = run_header(run), run_summary(run)
    for other in compared:
        b = other.manifest
        header.append(
            (
                "Baseline run",
                f"{b.run_id}, config {b.config_hash}, commit {b.git_commit} ({b.notes})",
            )
        )
        summary += f"\nBaseline `{b.run_id}`: config `{b.config_hash}` ({b.notes})."

    out_dir.mkdir(parents=True, exist_ok=True)
    m = run.manifest
    provenance = {
        "run_id": m.run_id,
        "git_commit": m.git_commit,
        "config_hash": m.config_hash,
        "seeds": m.seeds,
        "sim_years": m.sim_years,
        "wall_time_s": m.wall_time_s,
    }
    story_first = bool(getattr(module, "STORY_FIRST", False))
    _write_report(
        out_dir, milestone, header, summary, provenance, metrics, sections, story_first=story_first
    )
    (out_dir / "config.toml").write_text(run.config_text, encoding="utf-8")
    return out_dir


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Build a milestone report from a run.")
    parser.add_argument("milestone", help="milestone id, e.g. M3")
    parser.add_argument(
        "--runs",
        type=Path,
        required=True,
        help="run directory, runs/<id>; for R0 the device benchmark file or its directory",
    )
    parser.add_argument(
        "--baseline",
        type=Path,
        action="append",
        help="run to compare with: the mechanism off (M5); other schedules (M8, repeatable)",
    )
    parser.add_argument(
        "--sweep",
        type=Path,
        action="append",
        default=[],
        help="sweep directory runs/sweep-<name> for the sensitivity section (M11, repeatable)",
    )
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT, help="reports root")
    args = parser.parse_args(argv)
    out_dir = build_report(args.milestone, args.runs, args.out, args.baseline, args.sweep)
    print(f"wrote {out_dir}")


if __name__ == "__main__":
    main()
