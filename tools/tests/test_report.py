"""The report tool turns a (dummy) run into a valid, self-contained report."""

import html
import json
import math
import re
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import numpy as np
import pytest
from lineage_sim.fauna.genome import Gene

from tools import report
from tools.fastforward import fastforward
from tools.milestones import r0
from tools.report import Criterion, build_report
from tools.runs import REPO_ROOT, TIME_KEY, Manifest, Run, config_hash, read_run, write_run

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
    assert run.series[0]["_final_genes"].shape[1] == len(Gene)
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


# --- R0: a report built from the device benchmark instead of a run -------------------------


def _bench_scenario(name: str, fps: float, sprites: int = 17_281) -> dict[str, Any]:
    return {
        "name": name,
        "about": f"what {name} draws",
        "internal": [1024, 600],
        "plant_sprites": sprites - 777,
        "creature_sprites": 777,
        "frames": int(fps * 8),
        "fps_median": fps,
        "fps_1pct_low": fps * 0.8,
        "js_ms_median": 6.5,
    }


# The scene R0 was first written against, as it ran on the board: recorded, not judged.
FIRST_LOOK_FPS = 1.8
R0_IDS = ("R0.1", "R0.2", "R0.3", "R0.4", "R0.5")


def _r0_statuses(doc: dict[str, Any]) -> dict[str, str]:
    return {a["id"]: a["status"] for a in doc["acceptance"]}


def _bench_run(
    profile: str, fps: float | None, *, cpu: float = 180.0, driver: str = "Mali-G31 (Panfrost)"
) -> dict[str, Any]:
    """One browser profile, ``fps`` in every view R0 is judged on; None: it never reported back."""
    run: dict[str, Any] = {
        "profile": profile,
        "about": f"about {profile}",
        "flags": ["--kiosk", "--no-first-run", "--made-up-flag"],
        "status": "ok",
        "detail": "",
        "results": None,
        "usage": {},
        "peak": {},
    }
    if fps is None:
        return run | {"status": "timeout", "detail": "no results after 210 s"}
    software = "llvmpipe" in driver
    run["results"] = {
        "build_commit": "abc123def456",
        "user_agent": "Mozilla/5.0 (X11; Linux aarch64) <Chromium>",
        "screen": {"width": 1024, "height": 600, "device_pixel_ratio": 1},
        "viewport": {"width": 1024, "height": 600},
        "gpu": {"api": "webgl", "unmasked_renderer": driver, "software": software},
        "world": {"description": "seed 42, 2027-08-03 (summer)"},
        "settings": {"backend": "webgl"},
        "scenarios": [
            _bench_scenario("floor", 60.0, 0),
            _bench_scenario("spec-1x", FIRST_LOOK_FPS),
            *(_bench_scenario(name, fps) for name in r0.ACCEPTANCE_SCENARIOS),
        ],
    }
    usage = {
        "cpu_pct": cpu,
        "cpu_pct_by_kind": {"renderer": cpu * 0.3, "gpu": cpu * 0.6, "browser": cpu * 0.1},
        "system_cpu_pct": cpu / 4.0,
        "pss_mb": 310.0,
        "temperature_c": 61.5,
    }
    run["usage"] = {"floor": usage | {"cpu_pct": 20.0}, "spec-1x": usage} | {
        name: usage for name in r0.ACCEPTANCE_SCENARIOS
    }
    run["peak"] = {"pss_mb": 334.0, "rss_sum_mb": 910.0, "temperature_c": 63.0, "processes": 9}
    return run


def _bench_evidence(
    tmp_path: Path, runs: list[dict[str, Any]], *, machine: str = "aarch64", headless: bool = False
) -> Path:
    evidence = {
        "tool": "lineage-kiosk-bench",
        "version": 1,
        "started_at": "2026-10-11T09:30:00+00:00",
        "host": {
            "hostname": "lineage",
            "model": "OrangePi Zero 2W",
            "os": "Debian GNU/Linux 12 (bookworm)",
            "kernel": "6.1.31-sun50iw9",
            "machine": machine,
            "cpu": "",
            "cpu_count": 4,
            "memory_mb": 1976,
            "session": "x11",
            "display": ":0",
            "browser": "/usr/bin/chromium",
            "browser_version": "Chromium 130.0.6723.58",
            "glxinfo": "OpenGL renderer string: Mali-G31 <Panfrost> & co",
        },
        "page": "spike.html",
        "settings": {"seconds": 8.0, "warmup": 2.0, "window": [1024, 600], "headless": headless},
        "runs": runs,
    }
    folder = tmp_path / "from-the-device"
    folder.mkdir(exist_ok=True)
    (folder / "kiosk-bench.json").write_text(json.dumps(evidence), encoding="utf-8")
    return folder


def test_r0_report_from_device_evidence(tmp_path: Path) -> None:
    runs = [
        _bench_run("default", 14.0, cpu=390.0, driver="llvmpipe (LLVM 15, 128 bits)"),
        _bench_run("gpu", 41.2),
        _bench_run("software", None),
    ]
    out = build_report("R0", _bench_evidence(tmp_path, runs), tmp_path / "reports")
    assert out.name == "R0-renderer-spike"
    assert {p.name for p in out.iterdir()} == {
        "report.html",
        "metrics.json",
        "README.md",
        "kiosk-bench.json",
    }
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert doc["milestone"] == "R0"
    assert doc["best_profile"] == "gpu"
    assert doc["drawn_by"] == "WebGL on Mali-G31 (Panfrost)"
    assert doc["off_spec"] == []
    assert doc["host"]["model"] == "OrangePi Zero 2W"
    assert [(a["id"], a["status"]) for a in doc["acceptance"]] == [(i, "PASS") for i in R0_IDS]
    metrics = doc["metrics"]
    assert metrics["best.mid-crowd.fps_median"] == 41.2
    assert metrics["best.mid-crowd.cpu_pct"] == 180.0
    # Recorded, not judged.
    assert metrics["best.spec-1x.fps_median"] == FIRST_LOOK_FPS
    assert metrics["best.drawn_by_gpu"] == 1.0
    assert metrics["default.local-view.fps_median"] == 14.0
    assert metrics["gpu.floor.cpu_pct"] == 20.0
    assert not any(name.startswith("software.") for name in metrics)

    page = _parse(out / "report.html")
    text = " ".join(page.text)
    expected_text = (
        "OrangePi Zero 2W",
        "Mali-G31 (Panfrost)",
        "llvmpipe",
        "abc123def456",
        "timeout no results after 210 s",
        "Chromium 130.0.6723.58",
        "<Panfrost> & co",
    )
    for expected in expected_text:
        assert expected in text, expected
    assert "not the R0 measurement" not in text
    assert page.external == [], "report must be self-contained"
    assert len(page.img_srcs) == 2  # frame rate and CPU
    readme = (out / "README.md").read_text(encoding="utf-8")
    assert "**PASS** R0.5" in readme
    assert "Best profile: `gpu`" in readme


def test_r0_fails_below_the_target_and_away_from_the_device(tmp_path: Path) -> None:
    slow = build_report("R0", _bench_evidence(tmp_path, [_bench_run("gpu", 22.0)]), tmp_path / "a")
    slow_doc = json.loads((slow / "metrics.json").read_text(encoding="utf-8"))
    assert _r0_statuses(slow_doc) == {"R0.1": "PASS"} | dict.fromkeys(R0_IDS[1:], "FAIL")

    desk = _bench_evidence(tmp_path, [_bench_run("gpu", 60.0)], machine="x86_64", headless=True)
    out = build_report("R0", desk, tmp_path / "b")
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert _r0_statuses(doc) == {"R0.1": "FAIL"} | dict.fromkeys(R0_IDS[1:], "PASS")
    assert doc["off_spec"] == [
        "measured on x86_64, not on the ARM board",
        "Chromium ran headless, not as a kiosk on the display",
    ]
    assert "**Not the R0 measurement:**" in (out / "README.md").read_text(encoding="utf-8")
    assert "This is not the R0 measurement" in " ".join(_parse(out / "report.html").text)


def test_r0_counts_a_larger_display_as_at_least_as_hard(tmp_path: Path) -> None:
    """A monitor standing in for the 7" screen: the same scene stretched further (ADR 0008)."""

    def on(width: int, height: int, name: str) -> dict[str, Any]:
        run = _bench_run("gpu", 41.0)
        run["results"]["screen"] = {"width": width, "height": height, "device_pixel_ratio": 1}
        run["results"]["viewport"] = {"width": width, "height": height}
        out = build_report("R0", _bench_evidence(tmp_path, [run]), tmp_path / name)
        return json.loads((out / "metrics.json").read_text(encoding="utf-8")) | {
            "readme": (out / "README.md").read_text(encoding="utf-8"),
            "text": " ".join(_parse(out / "report.html").text),
        }

    monitor = on(1920, 1080, "monitor")
    assert monitor["off_spec"] == []
    assert monitor["stand_in"] == [
        "the page was 1920×1080, 3.4 times the pixels of the 1024×600 screen: "
        "at least as hard to draw"
    ]
    assert _r0_statuses(monitor) == dict.fromkeys(R0_IDS, "PASS")
    assert "**On a stand-in display:**" in monitor["readme"]
    assert "standing in for the 7″ screen" in monitor["text"]
    assert "1920×1080, page 1920×1080" in monitor["text"]
    assert "not the R0 measurement" not in monitor["text"]

    # The screen itself is no stand-in; a smaller page is less work and does not count.
    assert on(1024, 600, "screen")["stand_in"] == []
    small = on(800, 480, "small")
    assert small["stand_in"] == []
    assert small["off_spec"] == ["the page was 800×480, smaller than 1024×600"]
    assert _r0_statuses(small)["R0.1"] == "FAIL"
    # Wider and lower is not larger: it does not hold the screen's 600 rows.
    assert on(1280, 480, "wide")["off_spec"] == ["the page was 1280×480, smaller than 1024×600"]


def test_r0_does_not_take_a_virtual_display_for_the_screen(tmp_path: Path) -> None:
    """The board tried over SSH with no display attached: a preview, not the measurement."""
    source = _bench_evidence(tmp_path, [_bench_run("gpu", 58.0)])
    path = source / "kiosk-bench.json" if source.is_dir() else source
    evidence = json.loads(path.read_text(encoding="utf-8"))
    evidence["settings"]["virtual_display"] = True
    path.write_text(json.dumps(evidence), encoding="utf-8")
    out = build_report("R0", source, tmp_path / "virtual")
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert doc["off_spec"] == ["the display was a virtual one: the GPU drew, no screen showed it"]
    assert _r0_statuses(doc) == {"R0.1": "FAIL"} | dict.fromkeys(R0_IDS[1:], "PASS")
    # What it is good for is still there: what drew the page, and how fast.
    assert doc["drawn_by"] == "WebGL on Mali-G31 (Panfrost)"
    assert doc["metrics"]["best.mid-view.fps_median"] == 58.0


def test_r0_best_profile_at_equal_frame_rate_uses_less_cpu(tmp_path: Path) -> None:
    runs = [
        _bench_run("default", 60.1, cpu=310.0, driver="llvmpipe"),
        _bench_run("gpu", 59.9, cpu=95.0),
        _bench_run("gpu-gles", 48.0, cpu=40.0),
    ]
    out = build_report("R0", _bench_evidence(tmp_path, runs), tmp_path / "reports")
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert doc["best_profile"] == "gpu"
    assert doc["metrics"]["best.mid-crowd.cpu_pct"] == 95.0


def test_r0_without_a_finished_profile_has_no_verdict(tmp_path: Path) -> None:
    evidence = _bench_evidence(tmp_path, [_bench_run("default", None), _bench_run("gpu", None)])
    out = build_report("R0", evidence, tmp_path / "reports")
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert _r0_statuses(doc) == {"R0.1": "PASS"} | dict.fromkeys(R0_IDS[1:], "MISSING")
    assert doc["best_profile"] is None
    assert "No profile measured anything" in " ".join(_parse(out / "report.html").text)


def test_r0_rebuilds_from_its_own_report_directory(tmp_path: Path) -> None:
    """The evidence is committed with the report, so the report can be regenerated."""
    out = build_report(
        "R0", _bench_evidence(tmp_path, [_bench_run("gpu", 41.2)]), tmp_path / "reports"
    )
    before = {p.name: p.read_bytes() for p in out.iterdir()}
    assert build_report("R0", out, tmp_path / "reports") == out
    assert {p.name: p.read_bytes() for p in out.iterdir()} == before
    # The file itself works as well as the directory holding it.
    again = build_report("R0", out / "kiosk-bench.json", tmp_path / "elsewhere")
    assert (again / "report.html").read_bytes() == before["report.html"]


def test_r0_needs_the_device_benchmark_file(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match=r"kiosk-bench\.json not found"):
        build_report("R0", tmp_path, tmp_path / "reports")
    (tmp_path / "kiosk-bench.json").write_text('{"tool": "something-else"}', encoding="utf-8")
    with pytest.raises(ValueError, match="not a lineage-kiosk-bench"):
        build_report("R0", tmp_path, tmp_path / "reports")
    assert not (tmp_path / "reports").exists()


def test_r0_judges_the_scenarios_the_page_judges() -> None:
    """The acceptance scenarios and target are written down twice: here and in the page."""
    page = (REPO_ROOT / "renderer" / "src" / "spike" / "scenarios.ts").read_text(encoding="utf-8")
    listed = re.search(r"ACCEPTANCE_SCENARIOS[^=]*= \[(.*?)\];", page, re.DOTALL)
    assert listed is not None
    assert tuple(re.findall(r'"([^"]+)"', listed.group(1))) == r0.ACCEPTANCE_SCENARIOS
    assert f"TARGET_FPS = {r0.TARGET_FPS:g};" in page
    assert r0.FIRST_LOOK_SCENARIO not in r0.ACCEPTANCE_SCENARIOS


def test_r0_needs_every_view_from_one_profile(tmp_path: Path) -> None:
    """The kiosk runs one profile, so every view is judged from the same one."""
    partial = _bench_run("gpu", 60.0)
    partial["results"]["scenarios"] = [
        s for s in partial["results"]["scenarios"] if s["name"] != "local-view"
    ]
    runs = [partial, _bench_run("default", 35.0)]
    out = build_report("R0", _bench_evidence(tmp_path, runs), tmp_path / "reports")
    doc = json.loads((out / "metrics.json").read_text(encoding="utf-8"))
    assert doc["best_profile"] == "default"
    assert _r0_statuses(doc) == dict.fromkeys(R0_IDS, "PASS")


def test_figure_alt_text_is_escaped_once() -> None:
    from tools.milestones.base import figure_html

    caption = html.escape("the founders' winter & <b>")  # captions arrive HTML-safe
    page = figure_html(caption, "data:image/svg+xml;base64,AA==")
    alt = page.split('alt="', 1)[1].split('"', 1)[0]
    assert alt == "the founders&#x27; winter &amp; &lt;b&gt;"
