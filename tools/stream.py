"""Record the state stream from a save, for the renderer to play without a server (R1).

Usage::

    uv run python -m tools.stream <save.lzma> --out renderer/public/stream/recording.json
        [--skip-days 0] [--days 28] [--land-every 7] [--creatures]

Runs the world on from the save (first ``--skip-days`` unrecorded, to reach another time
of year) one sim-day at a time and writes the messages a server
would have sent (``server/lineage_server/protocol``): everything on connect, then each
day a ``clock`` and, every ``--land-every`` days, a ``land``. With ``--creatures`` the
``creatures`` message of each day too (for R2). The renderer's ``Recording`` plays it.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from lineage_server.protocol import encode
from lineage_sim.config import parse_config
from lineage_sim.state import io
from lineage_sim.world import World

from tools.runs import DEFAULT_CONFIG

FORMAT = "lineage-stream-recording/1"
MS_PER_DAY = 86_400_000


def record(
    world: World, days: int, land_every: int, creatures: bool = False
) -> list[dict[str, Any]]:
    """The messages from now over ``days`` sim-days; the world is advanced."""
    sent: set[int] = set()
    messages = encode.connect_messages(world, sent)
    if not creatures:
        messages = [message for message in messages if message["type"] != "creatures"]
    for day in range(1, days + 1):
        world.advance_to(world.t_ms + MS_PER_DAY)
        messages.append(encode.clock_message(world))
        if day % land_every == 0:
            messages.append(encode.land_message(world))
        if creatures:
            messages.append(encode.creatures_message(world, sent))
    return messages


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(description="Record the state stream from a save.")
    parser.add_argument("save", type=Path, help="a save file written by the sim (.lzma)")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--out", type=Path, required=True, help="the recording (.json)")
    parser.add_argument("--skip-days", type=int, default=0, help="sim-days to run unrecorded")
    parser.add_argument("--days", type=int, default=28, help="sim-days to record")
    parser.add_argument("--land-every", type=int, default=7, help="days between lands")
    parser.add_argument("--creatures", action="store_true", help="also every creature")
    args = parser.parse_args(argv)
    config = parse_config(args.config.read_text(encoding="utf-8"))
    world = World.restore(config, io.loads(args.save.read_bytes()))
    if args.skip_days > 0:
        world.advance_to(world.t_ms + args.skip_days * MS_PER_DAY)
    messages = record(world, args.days, args.land_every, args.creatures)
    document = {"format": FORMAT, "source": args.save.as_posix(), "messages": messages}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    lands = sum(message["type"] == "land" for message in messages)
    print(f"wrote {len(messages)} messages ({lands} lands) to {args.out}")


if __name__ == "__main__":
    main()
