"""Record the state stream from a save, for the renderer to play without a server (R1).

Usage::

    uv run python -m tools.stream <save.lzma> --out renderer/public/stream/recording.json
        [--skip-days 0] [--days 28] [--land-every 7] [--creatures [--creatures-every 86400]]
        [--sky-every 600] [--schedule office] [--press-days 3,9] [--famine-day 12]

Runs the world on from the save (first ``--skip-days`` unrecorded, to reach another time
of year) one sim-day at a time and writes the messages a server
would have sent (``server/lineage_server/protocol``): everything on connect, then each
day a ``clock`` and, every ``--land-every`` days, a ``land``. With ``--creatures`` the
``creatures`` message of each day too (for R2), or every ``--creatures-every`` sim-seconds
(R3: the camera follows them), each with a ``clock``. The species again when one is born or
dies out, and new chronicle entries as a ``chronicle`` message (R3's captions).

For the atmosphere (R4): with ``--sky-every`` a ``sky`` message (light, rain, fires) that
often, and the ``events`` the scene shows (fires, volcanoes, god powers, a world's end) as
they happen. ``--schedule`` plays the owner's presence (``tools.schedules``), so that there
are dusks and nights; ``--press-days`` presses the god-power button at noon of those days
(counted from 1); ``--famine-day`` starves every creature at the start of that day, so
that the herd dies on the next tick and the world ends the way it does when its last
creature dies: the sim's own end, archive and next continent, which is then recorded on.
The renderer's ``Recording`` plays it.
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Sequence
from pathlib import Path
from typing import Any

import numpy as np
from lineage_server.protocol import encode
from lineage_sim.config import parse_config
from lineage_sim.events import (
    ChronicleEntry,
    GodPower,
    InputEvent,
    OutputEvent,
    PresenceChanged,
    WorldEnded,
)
from lineage_sim.state import io
from lineage_sim.world import World

from tools.runs import DEFAULT_CONFIG
from tools.schedules import SCHEDULES, day_events, starts_present

FORMAT = "lineage-stream-recording/1"
MS_PER_DAY = 86_400_000
MS_PER_HOUR = 3_600_000
# The god-power button is pressed at this hour of a press day.
PRESS_HOUR = 12
# A famine leaves every creature this much energy: far below what any meal gives back, so
# none eats its way out of it before the next tick.
FAMINE_ENERGY = -1e6


def _every_ms(seconds: int, what: str) -> int:
    every_ms = seconds * 1000
    if every_ms <= 0 or MS_PER_DAY % every_ms != 0:
        raise ValueError(f"{what} every {seconds} s does not divide a day")
    return every_ms


def starve(world: World) -> None:
    """Leave every creature starving (``FAMINE_ENERGY``): on the next tick the herd dies."""
    fauna = world.fauna
    state = fauna.get_state()
    state["energy"] = np.full_like(state["energy"], FAMINE_ENERGY)
    fauna.set_state(state)


class _Census:
    """What has been sent of the world now living: its genomes and its species."""

    def __init__(self, world: World) -> None:
        self.sent: set[int] = set()
        self.species = encode.species_message(world)


def _connect(world: World, census: _Census, creatures: bool, sky: bool) -> list[dict[str, Any]]:
    messages = encode.connect_messages(world, census.sent)
    if not creatures:
        messages = [message for message in messages if message["type"] != "creatures"]
    if not sky:
        messages = [message for message in messages if message["type"] != "sky"]
    return messages


def _news(world: World, outputs: Sequence[OutputEvent], sky: bool) -> list[dict[str, Any]]:
    """The chronicle entries and events (with ``sky``) among ``outputs``, as messages: the
    entries first, so that a world's last lines come before its end."""
    messages: list[dict[str, Any]] = []
    entries = [output for output in outputs if isinstance(output, ChronicleEntry)]
    chronicle = encode.entries_message(world, entries)
    if chronicle is not None:
        messages.append(chronicle)
    events = encode.events_message(outputs) if sky else None
    if events is not None:
        messages.append(events)
    return messages


def record(
    world: World,
    days: int,
    land_every: int,
    creatures: bool = False,
    creatures_every_s: int = MS_PER_DAY // 1000,
    *,
    sky_every_s: int = 0,
    schedule: str = "always",
    press_days: Sequence[int] = (),
    famine_day: int = 0,
) -> list[dict[str, Any]]:
    """The messages from now over ``days`` sim-days; the world is advanced."""
    if schedule not in SCHEDULES:
        raise ValueError(f"unknown schedule {schedule!r}; known: {', '.join(SCHEDULES)}")
    every_ms = _every_ms(creatures_every_s, "creatures") if creatures else MS_PER_DAY
    sky = sky_every_s > 0
    sky_ms = _every_ms(sky_every_s, "sky") if sky else every_ms
    tick_ms = math.gcd(every_ms, sky_ms)
    census = _Census(world)
    messages = _connect(world, census, creatures, sky)
    # The owner's schedule follows the desk: the run's seed and Unix days, whatever world.
    desk_seed, start_unix = world.seed, world.unix_ms
    if schedule != "always" and world.presence.present != starts_present(schedule):
        world.apply(PresenceChanged(starts_present(schedule)))

    def live_to(unix_ms: int, inputs: list[tuple[int, InputEvent]]) -> list[OutputEvent]:
        """Advance to ``unix_ms``, applying the inputs due before it on the way."""
        outputs: list[OutputEvent] = []
        while inputs and inputs[0][0] < unix_ms:
            at, event = inputs.pop(0)
            outputs += world.advance_to_unix(at)
            outputs += world.apply(event)
        return outputs + world.advance_to_unix(unix_ms)

    for day in range(1, days + 1):
        day_start = start_unix + (day - 1) * MS_PER_DAY
        inputs: list[tuple[int, InputEvent]] = []
        if schedule != "always":
            date = world.instant.date
            for hour, present in day_events(schedule, desk_seed, day - 1, date):
                inputs.append((day_start + round(hour * MS_PER_HOUR), PresenceChanged(present)))
        if day in press_days:
            inputs.append((day_start + PRESS_HOUR * MS_PER_HOUR, GodPower()))
        inputs.sort(key=lambda item: item[0])
        if day == famine_day:
            starve(world)
        for tick in range(1, MS_PER_DAY // tick_ms + 1):
            elapsed = tick * tick_ms
            outputs = live_to(day_start + elapsed, inputs)
            # A world that ends: its news, then the next world as a renderer meets it.
            ended = [i for i, output in enumerate(outputs) if isinstance(output, WorldEnded)]
            if ended:
                split = ended[-1] + 1
                messages += _news(world, outputs[:split], sky)
                census = _Census(world)
                messages += _connect(world, census, creatures, sky)
                outputs = outputs[split:]
            step = elapsed % every_ms == 0
            if step:
                messages.append(encode.clock_message(world))
            if elapsed == MS_PER_DAY and day % land_every == 0:
                messages.append(encode.land_message(world))
            # A species born or gone is sent, as a server would, before the animals of it.
            species = encode.species_message(world)
            if species is not None and species != census.species:
                messages.append(species)
                census.species = species
            if creatures and step:
                messages.append(encode.creatures_message(world, census.sent))
            if sky and elapsed % sky_ms == 0:
                messages.append(encode.sky_message(world))
            messages += _news(world, outputs, sky)
    return messages


def _days(text: str) -> list[int]:
    return [int(part) for part in text.split(",") if part.strip()]


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
    parser.add_argument(
        "--sky-every", type=int, default=0, help="sim-seconds between sky messages (R4; 0: none)"
    )
    parser.add_argument("--schedule", choices=SCHEDULES, default="always")
    parser.add_argument("--press-days", type=_days, default=[], help="days to press the button")
    parser.add_argument("--famine-day", type=int, default=0, help="day the herd starves (0: never)")
    args = parser.parse_args(argv)
    config = parse_config(args.config.read_text(encoding="utf-8"))
    world = World.restore(config, io.loads(args.save.read_bytes()))
    if args.skip_days > 0:
        world.advance_to(world.t_ms + args.skip_days * MS_PER_DAY)
    messages = record(
        world,
        args.days,
        args.land_every,
        args.creatures,
        args.creatures_every,
        sky_every_s=args.sky_every,
        schedule=args.schedule,
        press_days=args.press_days,
        famine_day=args.famine_day,
    )
    document = {"format": FORMAT, "source": args.save.as_posix(), "messages": messages}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    lands = sum(message["type"] == "land" for message in messages)
    print(f"wrote {len(messages)} messages ({lands} lands) to {args.out}")


if __name__ == "__main__":
    main()
