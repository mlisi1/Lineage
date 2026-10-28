"""Record the state stream from a save, for the renderer to play without a server (R1).

Usage::

    uv run python -m tools.stream <save.lzma> --out renderer/public/stream/recording.json
        [--skip-days 0] [--days 28] [--land-every 7] [--creatures [--creatures-every 86400]]
        [--sky-every 600] [--schedule office] [--press-days 3,9] [--famine-day 12]
        [--stage 2:14:volcano] [--stage 3:12:fire@120,60] ...

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
``--stage DAY:HOUR:WHAT[@X,Y]`` makes WHAT happen then (for the report's films, R4):
``fire`` (a thunderstorm whose lightning strikes cell X,Y), a spell of the island's own
rain (``shower``, ``thunder``, ``storm``, for four hours) or an overcast (``cloud``), ``volcano`` or
``quake`` (at X,Y, by the terrain's own functions, sized as the middle of its ranges), or a
god power by name (``meteor``, ``rain``, ``seed``, ``ark``: the button, with the power
chosen; the sim aims it). Without X,Y a fire, volcano or quake is put on land near the
island's middle. A ``land`` follows every event that changes the land (terrain events, god
powers, a fire going out), as a server sends it. The renderer's ``Recording`` plays it.
"""

from __future__ import annotations

import argparse
import json
import math
from collections.abc import Callable, Sequence
from pathlib import Path
from typing import Any

import numpy as np
from lineage_server.feed import Feed
from lineage_sim import terrain as tr
from lineage_sim.config import parse_config
from lineage_sim.events import (
    EarthquakeStruck,
    GodPower,
    InputEvent,
    OutputEvent,
    PresenceChanged,
    VolcanoErupted,
)
from lineage_sim.flora import Cover
from lineage_sim.state import io
from lineage_sim.weather import Rain
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


# A staged spell of rain lasts this long; the thunderstorm of a staged fire passes after one
# hour, as a dry summer storm does, so that the fire then runs on dry land.
STAGED_STORM_HOURS = 4
STAGED_FIRE_STORM_HOURS = 1
POWERS = ("meteor", "rain", "seed", "ark")
# The island's own rain kinds that can be staged, as the weather's state has them.
SPELLS = {"shower": Rain.RAIN, "thunder": Rain.THUNDER, "storm": Rain.STORM, "cloud": Rain.CLOUD}
STAGES = ("fire", *SPELLS, "volcano", "quake", *POWERS)

# Something done to the world at a time: an input event, or a staged happening.
Action = Callable[[World], list[OutputEvent]] | InputEvent


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


# Cells round a staged fire's place that count toward how woody it is (half-width).
WOOD_REACH = 3


def _land_near_middle(world: World, woody: bool = False) -> tuple[int, int]:
    """The land cell nearest the island's middle that carries enough plants to burn; with
    `woody`, the cell round which the most fuel would catch (biomass × its form's
    flammability: grass and conifers burn well, broadleaf wood poorly) within a third of
    the island's middle."""
    fuel = world.terrain.land & (world.flora.biomass >= world.config.flora.fire_min_fuel)
    land = fuel if fuel.any() else world.terrain.land
    ys, xs = np.nonzero(land)
    rows, columns = land.shape
    near = (ys - rows / 2) ** 2 + (xs - columns / 2) ** 2
    if not woody:
        k = int(np.argmin(near))
        return int(xs[k]), int(ys[k])
    cfg = world.config.flora
    flammable = {
        Cover.LICHEN: cfg.flammability_lichen,
        Cover.GRASS: cfg.flammability_grass,
        Cover.SHRUB: cfg.flammability_shrub,
        Cover.BROADLEAF: cfg.flammability_broadleaf,
        Cover.CONIFER: cfg.flammability_conifer,
    }
    lookup = np.zeros(max(int(c) for c in Cover) + 1, dtype=np.float32)
    for cover, value in flammable.items():
        lookup[int(cover)] = value
    biomass = np.where(fuel, world.flora.biomass * lookup[world.flora.cover()], 0.0)
    padded = np.pad(biomass, WOOD_REACH)
    span = 2 * WOOD_REACH + 1
    around = np.zeros_like(biomass)
    for dy in range(span):
        for dx in range(span):
            around += padded[dy : dy + rows, dx : dx + columns]
    middle = near <= (min(rows, columns) / 3) ** 2
    k = int(np.argmax(np.where(middle, around[ys, xs], -1.0)))
    return int(xs[k]), int(ys[k])


def staged(what: str, at: tuple[int, int] | None) -> Action:
    """WHAT, as a thing done to the world (``--stage``)."""
    if what in POWERS:
        return GodPower(what)

    def act(world: World) -> list[OutputEvent]:
        x, y = at if at is not None else _land_near_middle(world, woody=what == "fire")
        t_ms = world.t_ms
        if what == "fire" or what in SPELLS:
            hours = STAGED_FIRE_STORM_HOURS if what == "fire" else STAGED_STORM_HOURS
            until = t_ms + hours * 3_600_000
            kind = SPELLS.get(what, Rain.STORM)
            world.weather.set_state({"rain": int(kind), "until_ms": until})
            # The lightning of the storm, as the fire's own strike does it.
            return world.wildfire.ignite(y, x, t_ms) if what == "fire" else []
        cfg = world.config.terrain
        state = world.terrain.get_state()
        geo = tr.geometry(cfg)
        if what == "volcano":
            radius = (cfg.volcano_radius_min_cells + cfg.volcano_radius_max_cells) / 2
            cone = (cfg.volcano_height_min + cfg.volcano_height_max) / 2
            state["height"], state["fertility"] = tr.apply_volcano(
                cfg, geo, state["height"], state["fertility"], x, y, radius, cone
            )
            world.terrain.set_state(state)
            erupted: list[OutputEvent] = [VolcanoErupted(t_ms, float(x), float(y), radius, cone)]
            return erupted + world.witness(erupted)
        radius = (cfg.earthquake_radius_min_cells + cfg.earthquake_radius_max_cells) / 2
        throw = (cfg.earthquake_throw_min + cfg.earthquake_throw_max) / 2
        state["height"] = tr.apply_earthquake(geo, state["height"], x, y, radius, throw, 0.6)
        world.terrain.set_state(state)
        struck: list[OutputEvent] = [EarthquakeStruck(t_ms, float(x), float(y), radius, throw)]
        return struck + world.witness(struck)

    return act


def _stage(text: str) -> tuple[int, float, str, tuple[int, int] | None]:
    """``DAY:HOUR:WHAT[@X,Y]`` as (day, hour, what, place)."""
    day, hour, rest = text.split(":", 2)
    what, _, place = rest.partition("@")
    if what not in STAGES:
        raise argparse.ArgumentTypeError(f"cannot stage {what!r}; known: {', '.join(STAGES)}")
    at = None
    if place:
        x, y = place.split(",")
        at = (int(x), int(y))
    return int(day), float(hour), what, at


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
    stages: Sequence[tuple[int, float, str, tuple[int, int] | None]] = (),
) -> list[dict[str, Any]]:
    """The messages from now over ``days`` sim-days; the world is advanced."""
    if schedule not in SCHEDULES:
        raise ValueError(f"unknown schedule {schedule!r}; known: {', '.join(SCHEDULES)}")
    every_ms = _every_ms(creatures_every_s, "creatures") if creatures else MS_PER_DAY
    sky = sky_every_s > 0
    sky_ms = _every_ms(sky_every_s, "sky") if sky else every_ms
    tick_ms = math.gcd(every_ms, sky_ms)
    feed = Feed(world, creatures=creatures, sky=sky)
    messages = feed.start(world)
    # The owner's schedule follows the desk: the run's seed and Unix days, whatever world.
    desk_seed, start_unix = world.seed, world.unix_ms
    # The schedule's owner, from the first moment: at the desk for "always", even when the
    # save was made with them away.
    if world.presence.present != starts_present(schedule):
        world.apply(PresenceChanged(starts_present(schedule)))

    def live_to(unix_ms: int, inputs: list[tuple[int, Action]]) -> list[OutputEvent]:
        """Advance to ``unix_ms``, doing what is due before it on the way."""
        outputs: list[OutputEvent] = []
        while inputs and inputs[0][0] < unix_ms:
            at, action = inputs.pop(0)
            outputs += world.advance_to_unix(at)
            outputs += world.apply(action) if isinstance(action, InputEvent) else action(world)
        return outputs + world.advance_to_unix(unix_ms)

    for day in range(1, days + 1):
        day_start = start_unix + (day - 1) * MS_PER_DAY
        inputs: list[tuple[int, Action]] = []
        if schedule != "always":
            date = world.instant.date
            for hour, present in day_events(schedule, desk_seed, day - 1, date):
                inputs.append((day_start + round(hour * MS_PER_HOUR), PresenceChanged(present)))
        if day in press_days:
            inputs.append((day_start + PRESS_HOUR * MS_PER_HOUR, GodPower()))
        for stage_day, hour, what, at in stages:
            if stage_day == day:
                inputs.append((day_start + round(hour * MS_PER_HOUR), staged(what, at)))
        inputs.sort(key=lambda item: item[0])
        if day == famine_day:
            starve(world)
        for tick in range(1, MS_PER_DAY // tick_ms + 1):
            elapsed = tick * tick_ms
            outputs = live_to(day_start + elapsed, inputs)
            messages += feed.advance(
                world,
                outputs,
                step=elapsed % every_ms == 0,
                sky_due=sky and elapsed % sky_ms == 0,
                land_due=elapsed == MS_PER_DAY and day % land_every == 0,
            )
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
    parser.add_argument(
        "--stage",
        type=_stage,
        action="append",
        default=[],
        help="DAY:HOUR:WHAT[@X,Y]: make WHAT happen then (fire, storm, volcano, quake, a power)",
    )
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
        stages=args.stage,
    )
    document = {"format": FORMAT, "source": args.save.as_posix(), "messages": messages}
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(document, separators=(",", ":")) + "\n", encoding="utf-8")
    lands = sum(message["type"] == "land" for message in messages)
    print(f"wrote {len(messages)} messages ({lands} lands) to {args.out}")


if __name__ == "__main__":
    main()
