"""The report tool turns a (dummy) run into a valid, self-contained report."""

import json
import math
from html.parser import HTMLParser
from pathlib import Path

import numpy as np
import pytest

from tools import report
from tools.fastforward import fastforward
from tools.report import Criterion, build_report
from tools.runs import TIME_KEY, Manifest, Run, config_hash, read_run, write_run

SEEDS = list(range(20))


class _Collector(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[str] = []
        self.text: list[str] = []
        self.img_srcs: list[str] = []
        self.external: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        a = dict(attrs)
        if tag == "img":
            self.img_srcs.append(a.get("src") or "")
        for key in ("src", "href"):
            if (a.get(key) or "").startswith(("http:", "https:", "//")):
                self.external.append(a[key] or "")
        if tag not in {"meta", "img", "br", "link"}:
            self.stack.append(tag)

    def handle_endtag(self, tag: str) -> None:
        assert self.stack, f"unexpected </{tag}>"
        assert self.stack[-1] == tag, f"unbalanced </{tag}> in {self.stack}"
        self.stack.pop()

    def handle_data(self, data: str) -> None:
        self.text.append(data)


def _parse(path: Path) -> _Collector:
    parser = _Collector()
    parser.feed(path.read_text(encoding="utf-8"))
    parser.close()
    assert parser.stack == [], f"unclosed tags: {parser.stack}"
    return parser


def _dummy_run(tmp_path: Path) -> Path:
    """20 seeds × 3 sim-years of a synthetic, seeded 'land_fraction' series."""
    rng = np.random.Generator(np.random.PCG64(1234))
    times = np.linspace(0.0, 3.0, 157)
    series = {
        seed: {TIME_KEY: times, "land_fraction": 0.4 + 0.05 * rng.standard_normal(times.size)}
        for seed in SEEDS
    }
    text = "[meta]\nconfig_version = 1\n"
    manifest = Manifest(
        run_id="dummy",
        seeds=SEEDS,
        sim_years=3.0,
        config_hash=config_hash(text),
        git_commit="abc123",
        wall_time_s=1.5,
        created_utc="2026-10-09T00:00:00+00:00",
    )
    run_dir = tmp_path / "runs" / "dummy"
    write_run(Run(manifest, text, series), run_dir)
    return run_dir


def test_dummy_report_is_valid_html(tmp_path: Path) -> None:
    out = build_report("M0", _dummy_run(tmp_path), tmp_path / "reports")
    assert out.name == "M0-tooling"
    assert {p.name for p in out.iterdir()} == {
        "report.html",
        "metrics.json",
        "config.toml",
        "README.md",
    }

    page = _parse(out / "report.html")
    text = " ".join(page.text)
    for expected in ("M0", "abc123", "Seeds", "20", "Wall time", "Config hash"):
        assert expected in text
    assert page.external == [], "report must be self-contained"
    assert len(page.img_srcs) == 2
    assert all(src.startswith("data:image/svg+xml;base64,") for src in page.img_srcs)


def test_metrics_json_carries_header_and_spread(tmp_path: Path) -> None:
    out = build_report("M0", _dummy_run(tmp_path), tmp_path / "reports")
    metrics = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert metrics["seeds"] == SEEDS
    assert metrics["git_commit"] == "abc123"
    m = metrics["metrics"]
    assert m["land_fraction.final.p10"] <= m["land_fraction.final.median"]
    assert m["land_fraction.final.median"] <= m["land_fraction.final.p90"]


def test_report_is_reproducible(tmp_path: Path) -> None:
    run_dir = _dummy_run(tmp_path)
    first = (build_report("M0", run_dir, tmp_path / "a") / "report.html").read_bytes()
    second = (build_report("M0", run_dir, tmp_path / "b") / "report.html").read_bytes()
    assert first == second


def test_acceptance_table(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setitem(
        report.CRITERIA,
        "M0",
        [
            Criterion("A1", "land stays", "land_fraction.final.median", 0.25, 0.6),
            Criterion("A2", "impossible", "land_fraction.final.min", 2.0),
            Criterion("A3", "not measured", "nope"),
        ],
    )
    out = build_report("M0", _dummy_run(tmp_path), tmp_path / "reports")
    statuses = [a["status"] for a in json.loads((out / "metrics.json").read_text())["acceptance"]]
    assert statuses == ["PASS", "FAIL", "MISSING"]
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "**PASS** A1" in readme
    assert "**FAIL** A2" in readme
    _parse(out / "report.html")


def test_criterion_band_formatting() -> None:
    assert Criterion("x", "", "m", 0.25, 0.6).band() == "[0.25, 0.6]"
    assert Criterion("x", "", "m", 0.5).band() == "≥ 0.5"
    assert Criterion("x", "", "m", high=0.3).band() == "≤ 0.3"
    assert Criterion("x", "", "m", -math.inf, math.inf).band() == "any"


def test_unknown_milestone_is_rejected(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="unknown milestone"):
        build_report("M99", _dummy_run(tmp_path), tmp_path / "reports")


def test_fastforward_then_report(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "ff"
    fastforward(0.5, [0, 1, 2], run_dir)
    run = read_run(run_dir)
    assert run.manifest.seeds == [0, 1, 2]
    assert run.series[0][TIME_KEY][-1] == pytest.approx(0.5, abs=1 / 365)
    assert set(run.manifest.final_state_hashes) == {"0", "1", "2"}
    assert sorted(p.name for p in (run_dir / "saves").iterdir()) == [
        "0.lzma",
        "1.lzma",
        "2.lzma",
    ]
    out = build_report("M0", run_dir, tmp_path / "reports")
    _parse(out / "report.html")


def test_power_cut_resumes_bit_identical(tmp_path: Path) -> None:
    straight = fastforward(0.25, [3, 4], tmp_path / "straight")
    cut = fastforward(0.25, [3, 4], tmp_path / "cut", power_cut_day=40)
    assert straight.manifest.final_state_hashes == cut.manifest.final_state_hashes
    assert "power cut after day 40" in cut.manifest.notes
    other_seed = fastforward(0.25, [5], tmp_path / "other")
    assert (
        other_seed.manifest.final_state_hashes["5"]
        not in straight.manifest.final_state_hashes.values()
    )


def test_fastforward_rejects_bad_power_cut(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="power cut day"):
        fastforward(0.1, [0], tmp_path / "x", power_cut_day=1000)
