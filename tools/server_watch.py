"""Watch a running server's numbers (S1, S7): sample its ``/status``, judge them against the
device's budgets (CLAUDE.md §4.8).

Usage::

    uv run python -m tools.server_watch http://<board>:8080 --minutes 180 \
        --out runs/s1-board/status.jsonl

Every ``--every`` seconds the server's ``/status`` is read and appended to ``--out`` (one
JSON object a line, with the time it was read); Ctrl+C or the end of ``--minutes`` stops
it. Then the window is summed up: the sim's share of one core over the window (from the
CPU it used and the wall time between the first and last samples), the longest save, the
largest resident memory, and the board's cost of a sim-day while it caught up, each
against its budget. Standard library only.
"""

from __future__ import annotations

import argparse
import json
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

# CLAUDE.md §4.8: the sim at most a quarter of one core on average, the daily save within
# 2 s, the sim and server within 300 MB.
CORE_SHARE_BUDGET = 0.25
SAVE_BUDGET_S = 2.0
MEMORY_BUDGET_MB = 300.0


def read_status(url: str, timeout_s: float) -> dict[str, Any]:
    with urllib.request.urlopen(url.rstrip("/") + "/status", timeout=timeout_s) as response:
        status: dict[str, Any] = json.loads(response.read())
    return status


def summary(samples: list[dict[str, Any]]) -> dict[str, Any]:
    """The window's numbers and verdicts, from samples of one server run (the last
    restart onward: the server's counters start again when it does)."""
    ready = [s for s in samples if s.get("ready")]
    run: list[dict[str, Any]] = []
    for sample in ready:
        if run and sample["wall_s"] < run[-1]["wall_s"]:
            run = []  # the server restarted: its counters began again
        run.append(sample)
    if len(run) < 2:
        return {"samples": len(samples), "enough": False}
    first, last = run[0], run[-1]
    wall = last["wall_s"] - first["wall_s"]
    share = (last["sim_cpu_s"] - first["sim_cpu_s"]) / wall if wall > 0 else 0.0
    memory = [s["rss_mb"] for s in run if s.get("rss_mb") is not None]
    peak_mb = max(memory) if memory else None
    longest = last["longest_save_s"]
    result: dict[str, Any] = {
        "samples": len(run),
        "enough": True,
        "window_h": round(wall / 3600, 2),
        "world": last["world"],
        "date": last["date"],
        "sim_core_share": round(share, 5),
        "sim_core_share_since_start": last["sim_core_share"],
        "saves": last["saves"],
        "longest_save_s": longest,
        "peak_rss_mb": peak_mb,
        "first_rss_mb": memory[0] if memory else None,
        "caught_up_days": last.get("caught_up_days"),
        "catch_up_s_per_day": last.get("catch_up_s_per_day"),
        "budgets": {
            "sim_core_share": CORE_SHARE_BUDGET,
            "longest_save_s": SAVE_BUDGET_S,
            "rss_mb": MEMORY_BUDGET_MB,
        },
    }
    result["pass"] = {
        "sim_core_share": share <= CORE_SHARE_BUDGET,
        "longest_save_s": last["saves"] > 0 and longest <= SAVE_BUDGET_S,
        "rss_mb": peak_mb is not None and peak_mb <= MEMORY_BUDGET_MB,
    }
    return result


def report(result: dict[str, Any]) -> str:
    if not result.get("enough"):
        return f"not enough samples of a running server ({result['samples']})"
    verdict = {key: "PASS" if ok else "FAIL" for key, ok in result["pass"].items()}
    per_day = result["catch_up_s_per_day"]
    lines = [
        f"world {result['world']}, {result['date']}; {result['window_h']} h watched, "
        f"{result['samples']} samples",
        f"sim's share of one core  {result['sim_core_share']:.4f}  "
        f"(budget {CORE_SHARE_BUDGET})  {verdict['sim_core_share']}",
        f"longest save             {result['longest_save_s']:.2f} s of {result['saves']}  "
        f"(budget {SAVE_BUDGET_S} s)  {verdict['longest_save_s']}",
        f"resident memory, peak    {result['peak_rss_mb']} MB, first {result['first_rss_mb']} MB  "
        f"(budget {MEMORY_BUDGET_MB:g} MB)  {verdict['rss_mb']}",
        f"catching up              {result['caught_up_days']} sim-days, "
        + (f"{per_day:.2f} s of CPU a sim-day" if per_day is not None else "none"),
    ]
    return "\n".join(lines)


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Watch a Lineage server's /status.")
    parser.add_argument("url", help="the server, e.g. http://192.168.1.50:8080")
    parser.add_argument("--minutes", type=float, default=180.0, help="how long to watch")
    parser.add_argument("--every", type=float, default=60.0, help="seconds between samples")
    parser.add_argument("--out", type=Path, required=True, help="samples, one JSON a line")
    args = parser.parse_args(argv)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    samples: list[dict[str, Any]] = []
    end = time.monotonic() + args.minutes * 60
    try:
        with args.out.open("a", encoding="utf-8") as out:
            while True:
                try:
                    sample = read_status(args.url, timeout_s=min(args.every, 30.0))
                except (urllib.error.URLError, OSError, ValueError) as error:
                    print(f"{time.strftime('%H:%M:%S')} no status: {error}")
                else:
                    sample["read_at"] = time.time()
                    samples.append(sample)
                    out.write(json.dumps(sample) + "\n")
                    out.flush()
                    print(
                        f"{time.strftime('%H:%M:%S')} share {sample.get('sim_core_share')} "
                        f"rss {sample.get('rss_mb')} MB saves {sample.get('saves')} "
                        f"longest {sample.get('longest_save_s')} s clients {sample.get('clients')}"
                    )
                if time.monotonic() >= end:
                    break
                time.sleep(args.every)
    except KeyboardInterrupt:
        print()
    result = summary(samples)
    summary_path = args.out.with_suffix(".summary.json")
    summary_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(report(result))
    print(f"samples in {args.out}, summary in {summary_path}")


if __name__ == "__main__":
    main()
