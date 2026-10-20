"""Record the state stream from a save, for the renderer to play without a server (R1).

Usage::

    uv run python -m tools.stream <save.lzma> --out renderer/public/stream/recording.json
        [--skip-days 0] [--days 28] [--land-every 7] [--creatures [--creatures-every 86400]]

Runs the world on from the save (first ``--skip-days`` unrecorded, to reach another time
of year) one sim-day at a time and writes the messages a server
would have sent (``server/lineage_server/protocol``): everything on connect, then each
day a ``clock`` and, every ``--land-every`` days, a ``land``. With ``--creatures`` the
``creatures`` message of each day too (for R2), or every ``--creatures-every`` sim-seconds
(R3: the camera follows them), each with a ``clock``. The species again when one is born or
dies out, and new chronicle entries as a ``chronicle`` message (R3's captions). The
renderer's ``Recording`` plays it.
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
    world: World,
    days: int,
    land_every: int,
    creatures: bool = False,
    creatures_every_s: int = MS_PER_DAY // 1000,
) -> list[dict[str, Any]]:
    """The messages from now over ``days`` sim-days; the world is advanced."""
    every_ms = creatures_every_s * 1000 if creatures else MS_PER_DAY
    if every_ms <= 0 or MS_PER_DAY % every_ms != 0:
        raise ValueError(f"creatures every {creatures_every_s} s does not divide a day")
    sent: set[int] = set()
    messages = encode.connect_messages(world, sent)
    if not creatures:
        messages = [message for message in messages if message["type"] != "creatures"]
    # The history so far is not news: only entries written while recording are sent.
    told = len(world.chronicle.entries())
    census = encode.species_message(world)
    for day in range(1, days + 1):
        for step in range(1, MS_PER_DAY // every_ms + 1):
            world.advance_to(world.t_ms + every_ms)
            messages.append(encode.clock_message(world))
            if step == MS_PER_DAY // every_ms and day % land_every == 0:
                messages.append(encode.land_message(world))
            # A species born or gone is sent, as a server would, before the animals of it.
            species = encode.species_message(world)
            if species is not None and species != census:
                messages.append(species)
                census = species
            if creatures:
                messages.append(encode.creatures_message(world, sent))
            chronicle = encode.chronicle_message(world, told)
            if chronicle is not None:
                messages.append(chronicle)
                told = chronicle["entries"][-1]["number"]
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
    parser.add_argument(
        "--creatures-every",
        type=int,
        default=MS_PER_DAY // 1000,
        help="sim-seconds between creature messages (a divisor of a day)",
    )
    args = parser.parse_args(argv)
    config = parse_config(args.config.read_text(encoding="utf-8"))
    world = World.restore(config, io.loads(args.save.read_bytes()))
    if args.skip_days > 0:
        world.advance_to(world.t_ms + args.skip_days * MS_PER_DAY)
    messages = record(world, args.days, args.land_every, args.creatures, args.creatures_every)
    document = {"format": FORMAT, "source": args.save.as_posix(), "messages": messages}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    lands = sum(message["type"] == "land" for message in messages)
    print(f"wrote {len(messages)} messages ({lands} lands) to {args.out}")


if __name__ == "__main__":
    main()
