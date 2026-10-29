"""The device benchmark runner: /proc sampling, browser command lines, results intake."""

from __future__ import annotations

import json
import urllib.error
import urllib.request
from pathlib import Path

import pytest

from tools import kiosk_bench as kb
from tools.kiosk_bench import PROFILES, Process, Sample

TICKS = 100  # clock ticks per second in these tests


def _stat(pid: int, name: str, parent: int, utime: int, stime: int, rss: int) -> str:
    """A /proc/<pid>/stat line with the fields the runner reads in the right places."""
    after_name = ["S", str(parent), *["0"] * 9, str(utime), str(stime), *["0"] * 8, str(rss)]
    return f"{pid} ({name}) " + " ".join(after_name) + " 0 0\n"


def _fake_proc(tmp_path: Path, rows: list[tuple[int, str, int, int, int, int, str]]) -> Path:
    proc = tmp_path / "proc"
    for pid, name, parent, utime, stime, rss, cmdline in rows:
        folder = proc / str(pid)
        folder.mkdir(parents=True)
        (folder / "stat").write_text(_stat(pid, name, parent, utime, stime, rss))
        (folder / "cmdline").write_text(cmdline)
    (proc / "self").mkdir()  # non-numeric entries are skipped
    (proc / "stat").write_text("cpu  100 0 50 800 50 0 0 0 0 0\ncpu0 1 2 3\n")
    (proc / "meminfo").write_text("MemTotal:  1998000 kB\nMemAvailable:  912345 kB\n")
    return proc


def test_parse_stat_copes_with_awkward_names() -> None:
    process = kb.parse_stat(_stat(42, "Web Content) (x", 7, 300, 20, 5000))
    assert process == Process(pid=42, parent=7, cpu_ticks=320, rss_pages=5000)
    assert kb.parse_stat("garbage") is None
    assert kb.parse_stat("1 (short) S 0") is None


def test_process_tree_and_kinds(tmp_path: Path) -> None:
    proc = _fake_proc(
        tmp_path,
        [
            (1, "init", 0, 1, 1, 10, "init"),
            (100, "chromium", 1, 50, 10, 4000, "chromium\0--kiosk\0http://x/"),
            (101, "chromium", 100, 5, 1, 1000, "chromium\0--type=zygote"),
            (102, "chromium", 101, 200, 30, 9000, "chromium\0--type=renderer\0--lang=en"),
            # Chromium rewrites its children's command lines into one string with spaces.
            (103, "chromium", 100, 400, 90, 6000, "/usr/lib/chromium --type=gpu-process --x\0"),
            (104, "chromium", 100, 3, 1, 500, "/usr/lib/chromium --type=utility --utility-sub\0"),
            (900, "bash", 1, 9, 9, 99, "bash"),
        ],
    )
    processes = kb.read_processes(proc)
    assert set(processes) == {1, 100, 101, 102, 103, 104, 900}
    tree = kb.descendants(processes, 100)
    assert tree == {100, 101, 102, 103, 104}  # not init, not the unrelated shell
    assert kb.descendants(processes, 555) == set()
    assert {pid: kb.read_kind(proc, pid) for pid in sorted(tree)} == {
        100: "browser",
        101: "zygote",
        102: "renderer",
        103: "gpu",
        104: "utility",
    }
    assert kb.read_kind(proc, 31337) == "gone"
    assert kb.read_system_cpu(proc) == (150, 1000)  # idle and iowait are not busy
    assert kb.read_meminfo_kb(proc, "MemAvailable") == 912345
    assert kb.read_meminfo_kb(proc, "Nope") is None


def test_pss_and_temperature(tmp_path: Path) -> None:
    proc = _fake_proc(tmp_path, [(5, "chromium", 1, 1, 1, 1, "chromium")])
    (proc / "5" / "smaps_rollup").write_text("Rss:  90000 kB\nPss:   41234 kB\nShared: 1 kB\n")
    assert kb.read_pss_kb(proc, 5) == 41234
    assert kb.read_pss_kb(proc, 6) is None
    sys_root = tmp_path / "sys"
    for zone, value in (("thermal_zone0", "48500"), ("thermal_zone1", "61250")):
        (sys_root / "class" / "thermal" / zone).mkdir(parents=True)
        (sys_root / "class" / "thermal" / zone / "temp").write_text(value + "\n")
    assert kb.read_temperature_c(sys_root) == 61.25
    assert kb.read_temperature_c(tmp_path / "nothing") is None


def _sample(
    t_s: float,
    ticks: dict[int, int],
    *,
    pss: int | None = None,
    busy: int = 0,
    total: int = 0,
    rss: int = 1000,
    temp: float | None = None,
) -> Sample:
    kinds = {1: "browser", 2: "renderer", 3: "gpu"}
    return Sample(
        t_s * 1000.0, ticks, {pid: kinds[pid] for pid in ticks}, rss, pss, busy, total, None, temp
    )


def test_cpu_between_samples_is_percent_of_one_core() -> None:
    before = _sample(10.0, {1: 100, 2: 500})
    # Two seconds later: the renderer used 1.5 s of CPU, and a GPU process appeared.
    after = _sample(12.0, {1: 110, 2: 650, 3: 80})
    used = kb.cpu_between(before, after, TICKS)
    assert used == pytest.approx({"browser": 5.0, "renderer": 75.0, "gpu": 40.0})
    assert kb.cpu_between(after, after, TICKS) == {}


def test_usage_in_a_scenario_window() -> None:
    samples = [
        _sample(0.0, {2: 0}, pss=300_000, busy=0, total=0, rss=900_000, temp=50.0),
        _sample(1.0, {2: 50}, busy=100, total=400, rss=950_000, temp=51.0),
        _sample(2.0, {2: 150}, busy=300, total=800, rss=1_000_000, temp=55.0),
        _sample(3.0, {2: 250}, pss=350_000, busy=500, total=1200, rss=1_050_000, temp=58.0),
        _sample(4.0, {2: 260}, busy=520, total=1600, rss=1_000_000, temp=57.0),
    ]
    # A window holding the samples at 2 s and 3 s: measured from the sample before it.
    usage = kb.usage_in_window(samples, 1500.0, 3500.0, TICKS)
    assert usage is not None
    assert usage["samples"] == 3
    assert usage["cpu_pct"] == pytest.approx(100.0)  # 200 ticks over 2 s
    assert usage["cpu_pct_by_kind"] == {"renderer": 100.0}
    assert usage["system_cpu_pct"] == pytest.approx(50.0)  # 400 busy of 800
    assert usage["pss_mb"] == pytest.approx(350_000 / 1024, abs=0.1)
    assert usage["rss_sum_mb"] == pytest.approx(1_050_000 / 1024, abs=0.1)
    assert usage["temperature_c"] == 58.0

    # No memory reading inside the window: the nearest one in time is used, here the
    # one a second after it rather than the one from two seconds before.
    between = kb.usage_in_window(samples, 1500.0, 2500.0, TICKS)
    assert between is not None
    assert between["pss_mb"] == pytest.approx(350_000 / 1024, abs=0.1)

    # A window between two samples still gets an estimate from the pair around it.
    short = kb.usage_in_window(samples, 3200.0, 3600.0, TICKS)
    assert short is not None
    assert short["cpu_pct"] == pytest.approx(10.0)
    assert kb.usage_in_window(samples, 9000.0, 9500.0, TICKS) is None
    assert kb.usage_in_window([], 0.0, 1.0, TICKS) is None


def test_sampler_follows_the_browser_tree(tmp_path: Path) -> None:
    proc = _fake_proc(
        tmp_path,
        [
            (100, "chromium", 1, 50, 10, 4000, "chromium"),
            (102, "chromium", 100, 200, 30, 9000, "chromium\0--type=renderer"),
            (900, "bash", 1, 9, 9, 99, "bash"),
        ],
    )
    (proc / "100" / "smaps_rollup").write_text("Pss:  20000 kB\n")
    (proc / "102" / "smaps_rollup").write_text("Pss:  30000 kB\n")
    sampler = kb.Sampler(100, proc, tmp_path / "sys")
    sample = sampler.sample()
    assert sample.ticks == {100: 60, 102: 230}
    assert sample.kinds == {100: "browser", 102: "renderer"}
    assert sample.rss_kb == 13000 * sampler.page_kb
    assert sample.pss_kb == 50000  # read on the first sample
    assert sample.mem_available_kb == 912345
    assert sampler.sample().pss_kb is None  # then only every few samples
    assert len(sampler.samples) == 2


def test_browser_command_for_kiosk_and_for_a_pc(tmp_path: Path) -> None:
    kiosk = kb.browser_command(
        "chromium",
        PROFILES["gpu"],
        "http://127.0.0.1:1/spike.html",
        tmp_path,
        headless=False,
        window=(1024, 600),
        sandbox=True,
    )
    assert kiosk[0] == "chromium"
    assert kiosk[-1] == "http://127.0.0.1:1/spike.html"
    assert "--kiosk" in kiosk
    assert "--ignore-gpu-blocklist" in kiosk
    assert "--window-size=1024,600" in kiosk
    assert f"--user-data-dir={tmp_path}" in kiosk
    assert "--no-sandbox" not in kiosk
    assert "--headless=new" not in kiosk

    desk = kb.browser_command(
        "chrome",
        PROFILES["default"],
        "http://x/",
        tmp_path,
        headless=True,
        window=(1024, 600),
        sandbox=False,
    )
    assert "--headless=new" in desk
    assert "--kiosk" not in desk
    assert "--no-sandbox" in desk
    assert "--ignore-gpu-blocklist" not in desk


def test_profiles_and_page_url() -> None:
    assert list(PROFILES) == ["default", "gpu", "gpu-gles", "software", "canvas", "cpu-ground"]
    assert PROFILES["default"].flags == ()
    url = kb.page_url(8137, "spike.html", PROFILES["canvas"], 8.0, 2.0, "floor,spec-1x")
    assert url.startswith("http://127.0.0.1:8137/spike.html?")
    for part in (
        "seconds=8",
        "warmup=2",
        "post=%2Fresults",
        "label=canvas",
        "backend=canvas",
        "only=floor%2Cspec-1x",
    ):
        assert part in url
    assert "backend" not in kb.page_url(1, "spike.html", PROFILES["gpu"], 1.0, 0.0, None)
    assert "bench" not in url  # the spike always measures itself


def test_the_scene_page_is_asked_for_its_benchmark_and_cap() -> None:
    url = kb.page_url(8137, kb.SCENE_PAGE, PROFILES["gpu"], 8.0, 2.0, "acceptance", 30.0)
    assert url.startswith("http://127.0.0.1:8137/index.html?bench=1&")
    for part in ("seconds=8", "warmup=2", "post=%2Fresults", "only=acceptance", "cap=30"):
        assert part in url
    assert "cap" not in kb.page_url(1, kb.SCENE_PAGE, PROFILES["gpu"], 1.0, 0.0, None)
    assert kb.is_spike("spike.html")
    assert not kb.is_spike("index.html")
    # The scene has no canvas backend: it is not run by default, nor taken when asked; nor
    # is the CPU's drawing run by default (the owner), though it can be asked for.
    assert kb.default_profiles(kb.SCENE_PAGE) == "default"
    assert [p.name for p in kb.chosen_profiles("software", None, kb.SCENE_PAGE)] == ["software"]
    assert kb.default_profiles(kb.SPIKE_PAGE) == "default,gpu,gpu-gles,software,canvas"
    with pytest.raises(ValueError, match="canvas: only the R0 spike"):
        kb.chosen_profiles("gpu,canvas", None, kb.SCENE_PAGE)
    assert [p.name for p in kb.chosen_profiles("gpu", None, kb.SCENE_PAGE)] == ["gpu"]
    # The ground's colour pass on the CPU, to compare with the GPU's: the scene's alone.
    ground = kb.page_url(1, kb.SCENE_PAGE, PROFILES["cpu-ground"], 1.0, 0.0, None)
    assert "painter=cpu" in ground
    assert PROFILES["cpu-ground"].flags == ()
    with pytest.raises(ValueError, match="cpu-ground: only the scene"):
        kb.chosen_profiles("cpu-ground", None, kb.SPIKE_PAGE)


def test_choosing_profiles() -> None:
    assert [p.name for p in kb.chosen_profiles("gpu,canvas", None)] == ["gpu", "canvas"]
    with_custom = kb.chosen_profiles("default", "--use-gl=egl  --enable-features=Vulkan")
    assert [p.name for p in with_custom] == ["default", "custom"]
    assert with_custom[1].flags == ("--use-gl=egl", "--enable-features=Vulkan")
    with pytest.raises(ValueError, match="unknown profile: turbo"):
        kb.chosen_profiles("gpu,turbo", None)


def test_server_serves_the_build_and_takes_results(tmp_path: Path) -> None:
    (tmp_path / "spike.html").write_text("<p>hello</p>")
    server, inbox = kb.serve(tmp_path, 0)
    base = f"http://127.0.0.1:{server.server_address[1]}"
    try:
        with urllib.request.urlopen(f"{base}/spike.html", timeout=5) as response:
            assert response.read() == b"<p>hello</p>"
            assert response.headers["Cache-Control"] == "no-store"
        body = json.dumps({"tool": "lineage-renderer-spike", "scenarios": []}).encode()
        request = urllib.request.Request(f"{base}/results", data=body, method="POST")
        with urllib.request.urlopen(request, timeout=5) as response:
            assert response.status == 204
        assert inbox.get(timeout=5) == {"tool": "lineage-renderer-spike", "scenarios": []}
        for path, data in (("/elsewhere", body), ("/results", b"not json")):
            bad = urllib.request.Request(f"{base}{path}", data=data, method="POST")
            with pytest.raises(urllib.error.HTTPError) as refused:
                urllib.request.urlopen(bad, timeout=5)
            refused.value.close()
        assert inbox.empty()
    finally:
        server.shutdown()
        server.server_close()


def test_a_compositor_without_a_screen_is_a_virtual_display() -> None:
    assert kb.virtual_display({"WLR_BACKENDS": "headless"})
    assert kb.virtual_display({"WLR_BACKENDS": "headless,libinput"})
    assert not kb.virtual_display({"WLR_BACKENDS": "drm,libinput"})
    assert not kb.virtual_display({"WAYLAND_DISPLAY": "wayland-0"})
    assert not kb.virtual_display({})


def test_drawn_by_names_the_path_that_ran() -> None:
    hardware = {"gpu": {"api": "webgl", "unmasked_renderer": "Mali-G31", "software": False}}
    assert kb.drawn_by(hardware) == "WebGL on Mali-G31"
    software = {"gpu": {"api": "webgl", "renderer": "llvmpipe", "software": True}}
    assert kb.drawn_by(software) == "WebGL on llvmpipe (software, on the CPU)"
    fell_back = {"gpu": {"api": "canvas"}, "settings": {"backend": "webgl"}}
    assert kb.drawn_by(fell_back) == "2D canvas, on the CPU (WebGL was not available)"
    asked = {"gpu": {"api": "canvas"}, "settings": {"backend": "canvas"}}
    assert kb.drawn_by(asked) == "2D canvas, on the CPU"


def test_summary_table() -> None:
    document = {
        "runs": [
            {
                "profile": "gpu",
                "status": "ok",
                "detail": "",
                "results": {
                    "gpu": {"api": "webgl", "unmasked_renderer": "Mali-G31", "software": False},
                    "scenarios": [
                        {
                            "name": "spec-1x",
                            "fps_median": 41.2,
                            "fps_1pct_low": 30.5,
                            "js_ms_median": 6.4,
                        },
                        {
                            "name": "middle-crowd",
                            "fps_median": 30.0,
                            "fps_1pct_low": 29.4,
                            "over_budget_pct": 2.5,
                            "js_ms_median": 9.1,
                            "probe": {
                                "late_by_phase": {"outside": 2, "herd": 5},
                                "late_notes": {"creatures": 3},
                            },
                            "ground_made": {"gpu": 12, "cpu": 1},
                        },
                    ],
                    "acceptance": {
                        "scenarios": ["mid-view", "local-view"],
                        "fps_median": 41.2,
                        "target_fps": 30,
                        "pass": True,
                    },
                },
                "usage": {"spec-1x": {"cpu_pct": 87.0, "pss_mb": 301.0}},
                "gpu_timeouts": 3,
            },
            {
                "profile": "software",
                "status": "timeout",
                "detail": "no results after 210 s",
                "results": None,
                "usage": {},
            },
        ]
    }
    text = "\n".join(kb.summary_lines(document))
    assert "[gpu] ok" in text
    assert "drawn by: WebGL on Mali-G31" in text
    assert "mid-view, local-view: 41.2 fps median at the lowest, target 30: PASS" in text
    assert "87" in text
    assert "301" in text
    # The scene's page also says how many frames came later than 30 fps allows.
    assert any(
        line.split()[:4] == ["middle-crowd", "30.0", "29.4", "2.5"] for line in text.splitlines()
    )
    # And where its late frames came from, as the page's frame probe saw them.
    assert "late frames by phase: herd 5, outside 2; with creatures 3" in text
    assert "ground painted on the GPU: 12 of 13" in text
    assert "[software] timeout no results after 210 s" in text
    assert "GPU jobs the kernel killed (hangs): 3" in text
    # Where the kernel log could not be read nothing is claimed.
    assert text.count("GPU jobs") == 1


def test_gpu_hangs_are_counted_from_the_kernel_log() -> None:
    log = (
        "[  12.5] panfrost 1800000.gpu: gpu sched timeout, js=0, status=0x8, head=0x0\n"
        "[  12.6] panfrost 1800000.gpu: js fault, js=0, status=DATA_INVALID_FAULT\n"
        "[  13.1] panfrost 1800000.gpu: gpu sched timeout, js=0, status=0x8, head=0x0\n"
    )
    assert kb.count_gpu_timeouts(log) == 2
    assert kb.count_gpu_timeouts("") == 0
    assert kb.count_gpu_timeouts(None) is None


def test_the_runner_needs_only_the_standard_library() -> None:
    """It is copied to the device as one file: no third-party or project imports."""
    import ast
    import sys

    tree = ast.parse(Path(kb.__file__).read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            imported.update(alias.name.split(".")[0] for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module is not None:
            imported.add(node.module.split(".")[0])
    assert imported <= set(sys.stdlib_module_names), imported - set(sys.stdlib_module_names)
