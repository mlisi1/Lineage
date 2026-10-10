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
    fastforward(0.1, [0, 1, 2], run_dir, save_days=10, snapshot_days=0)
    run = read_run(run_dir)
    assert run.manifest.seeds == [0, 1, 2]
    assert run.series[0][TIME_KEY][-1] == pytest.approx(0.1, abs=1 / 365)
    assert set(run.manifest.final_state_hashes) == {"0", "1", "2"}
    assert sorted(p.name for p in (run_dir / "saves").iterdir()) == [
        "0.lzma",
        "1.lzma",
        "2.lzma",
    ]
    assert not (run_dir / "snapshots").exists()
    land = run.series[0]["land_fraction"]
    assert ((land > 0.2) & (land < 0.7)).all()
    out = build_report("M0", run_dir, tmp_path / "reports")
    _parse(out / "report.html")


def test_parallel_jobs_give_the_same_worlds(tmp_path: Path) -> None:
    serial = fastforward(0.05, [0, 1], tmp_path / "serial", save_days=30, snapshot_days=0)
    parallel = fastforward(
        0.05, [0, 1], tmp_path / "parallel", save_days=30, snapshot_days=0, jobs=2
    )
    assert serial.manifest.final_state_hashes == parallel.manifest.final_state_hashes


@pytest.mark.parametrize("save_days", [1, 7])
def test_power_cut_resumes_bit_identical(tmp_path: Path, save_days: int) -> None:
    def run(name: str, seeds: list[int], power_cut_day: int | None = None) -> Run:
        return fastforward(
            0.1,
            seeds,
            tmp_path / name,
            power_cut_day=power_cut_day,
            save_days=save_days,
            snapshot_days=0,
        )

    straight = run("straight", [3, 4])
    cut = run("cut", [3, 4], power_cut_day=20)
    assert straight.manifest.final_state_hashes == cut.manifest.final_state_hashes
    assert "power cut after day 20" in cut.manifest.notes
    # The recorded series are the same too: the replayed days are not sampled twice.
    for seed in (3, 4):
        assert np.array_equal(
            straight.series[seed]["land_fraction"], cut.series[seed]["land_fraction"]
        )
    other = run("other", [5])
    assert other.manifest.final_state_hashes["5"] not in set(
        straight.manifest.final_state_hashes.values()
    )


def test_fastforward_rejects_bad_arguments(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="power cut day"):
        fastforward(0.1, [0], tmp_path / "x", power_cut_day=1000)
    with pytest.raises(ValueError, match="at least one day"):
        fastforward(0.1, [0], tmp_path / "x", save_days=0)


def test_m2_report_has_acceptance_maps_and_animation(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "m2"
    fastforward(1.2, [0, 1], run_dir, save_days=500, snapshot_days=60)
    out = build_report("M2", run_dir, tmp_path / "reports")
    assert out.name == "M2-terrain"

    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in doc["acceptance"]] == ["M2.1", "M2.2", "M2.3", "M2.4", "M2.5"]
    assert all(a["status"] in {"PASS", "FAIL"} for a in doc["acceptance"])
    assert doc["metrics"]["seeds_without_land"] == 0
    assert 0.25 <= doc["metrics"]["land_fraction.min"] <= doc["metrics"]["land_fraction.max"]

    page = _parse(out / "report.html")
    assert page.external == []
    kinds = [src.split(";")[0] for src in page.img_srcs]
    assert kinds.count("data:image/png") == 1  # the map grid
    assert kinds.count("data:image/webp") == 1  # the animation
    assert kinds.count("data:image/svg+xml") >= 6
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "M2.1" in readme


def test_m3_report_has_acceptance_pixel_maps_and_animation(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "m3"
    fastforward(1.0, [0, 1], run_dir, save_days=1000, snapshot_days=45, jobs=2)
    out = build_report("M3", run_dir, tmp_path / "reports")
    assert out.name == "M3-flora"

    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in doc["acceptance"]] == ["M3.1", "M3.2", "M3.3", "M3.4", "M3.5"]
    metrics = doc["metrics"]
    assert metrics["seeds_single_class"] == 0
    assert 3 <= metrics["grass_half.months.median"] <= 12
    assert 0 <= metrics["forms.median"] <= 5

    html_text = (out / "report.html").read_text(encoding="utf-8")
    page = _parse(out / "report.html")
    assert page.external == []
    kinds = [src.split(";")[0] for src in page.img_srcs]
    assert kinds.count("data:image/png") == 2  # seasons and years, pixel art
    assert kinds.count("data:image/webp") == 1  # the animation
    assert html_text.count('<figure class="pixel">') == 3
    assert "image-rendering:pixelated" in html_text


def test_pixel_map_uses_flat_tones_and_whole_pixel_scaling() -> None:
    from lineage_sim.flora import Cover

    from tools.viz import pixelmap

    rng = np.random.Generator(np.random.PCG64(5))
    height = (0.3 + 0.4 * rng.random((20, 30))).astype(np.float32)
    cover = np.where(height > 0.42, Cover.GRASS, Cover.WATER).astype(np.uint8)
    cover[height > 0.6] = Cover.CONIFER
    image = pixelmap.render(height, 0.42, cover)
    assert image.shape == (20, 30, 3)
    assert image.dtype == np.uint8
    # A handful of flat colours, not a gradient.
    assert len(np.unique(image.reshape(-1, 3), axis=0)) <= 5 + 3 * 2 + 1
    big = pixelmap.render(height, 0.42, cover, scale=3)
    assert big.shape == (60, 90, 3)
    assert (big[::3, ::3] == image).all()
    assert (big[1::3, 2::3] == image).all()
    # Dormant low vegetation is drawn differently from growing vegetation.
    dormant = pixelmap.render(height, 0.42, cover, np.zeros_like(height))
    grass = cover == Cover.GRASS
    assert (dormant[grass] != image[grass]).any()
    assert (dormant[cover == Cover.CONIFER] == image[cover == Cover.CONIFER]).all()


def test_tile_grid_keeps_tiles_pixel_exact() -> None:
    from tools.viz import pixelmap

    tile = np.full((10, 16, 3), 200, dtype=np.uint8)
    grid = pixelmap.tile_grid([[tile, tile], [tile, tile]], ["a", "b"], ["x", "y"])
    assert grid.dtype == np.uint8
    assert int((grid == 200).all(axis=-1).sum()) >= 4 * tile.shape[0] * tile.shape[1]


def test_m4_report_has_acceptance_and_creature_maps(tmp_path: Path) -> None:
    run_dir = tmp_path / "runs" / "m4"
    run = fastforward(1.25, [0, 1], run_dir, save_days=1000, snapshot_days=60, jobs=2)
    assert max(float(s["population"].max()) for s in run.series.values()) > 0, "no founders"
    assert run.series[0]["_final_genes"].shape[1] == 11
    out = build_report("M4", run_dir, tmp_path / "reports")
    assert out.name == "M4-fauna-evolution"

    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert [a["id"] for a in doc["acceptance"]] == ["M4.1", "M4.2", "M4.3", "M4.4"]
    assert all(a["status"] in {"PASS", "FAIL"} for a in doc["acceptance"])
    metrics = doc["metrics"]
    assert 0.0 <= metrics["extinct_seed_years.share"] <= 1.0
    assert 0.0 <= metrics["both_diets.share_of_seeds"] <= 1.0
    assert metrics["first_arrival.months.median"] > 3

    html_text = (out / "report.html").read_text(encoding="utf-8")
    page = _parse(out / "report.html")
    assert page.external == []
    assert html_text.count('<figure class="pixel">') == 2  # creature maps and animation
    kinds = [src.split(";")[0] for src in page.img_srcs]
    assert kinds.count("data:image/webp") == 1


def test_creatures_are_drawn_by_diet() -> None:
    from tools.viz import pixelmap

    image = np.zeros((10, 10, 3), dtype=np.uint8)
    creatures = np.array(
        [[2.0, 3.0, 0.1, 0.5], [5.0, 5.0, 0.9, 0.5], [np.nan, np.nan, np.nan, np.nan]],
        dtype=np.float32,
    )
    pixelmap.draw_creatures(image, creatures, 0.35, 0.65)
    assert image[3, 2].tolist() == [255, 255, 255]  # herbivore: white, at row y, column x
    assert image[5, 5].tolist() == [226, 59, 59]  # predator: red
    assert int((image.sum(axis=-1) > 0).sum()) == 2  # the padding row draws nothing
    big = pixelmap.draw_creatures(np.zeros((30, 30, 3), dtype=np.uint8), creatures, 0.35, 0.65,
                                  scale=3)  # fmt: skip
    assert big[10, 7].tolist() == [255, 255, 255]  # centre of the 3×3 block
    assert big[9, 6].tolist() == [27, 27, 27]  # its outline
