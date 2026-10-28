"""The island the server keeps: the world, its saves, and its stream (S1, ADR 0023).

Synchronous and single-threaded: the server runs every call in one sim thread, so the
world is never touched from two threads at once. Wall time comes in as an argument
(``now_ms``, Unix milliseconds); nothing here reads a clock, which is what lets the tests
run days of island time in a moment.

- `open`: load the newest save that loads (or make world 1), then catch up to now: the
  device was off, so the owner was away (the owner, 2026-10-28). A save at every UTC
  midnight on the way, so a long catch-up cut short does not start over.
- `advance`: bring the world to now. It steps through the ticks of the creatures, the
  light and the plants (the sim's ``[schedule]``) so that the feed sends each in turn. A
  clock that jumped far ahead (``jump_seconds``) is caught up on instead, and the island
  sent anew.
- `handle`: what the device says: presence, the god-power button, power lost or back; and
  the view button, which only the desk is told.
- Saves: at every UTC midnight (``DayStarted``), on `save` (a clean shutdown), at once on
  ``PowerLost``, and when a world ends: its archive first, then the next world.
"""

from __future__ import annotations

import logging
import math
import os
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import TypeVar

from lineage_device.interface import (
    DeviceEvent,
    GodPowerPressed,
    PowerLost,
    PowerRestored,
    Presence,
    ViewPressed,
)
from lineage_sim import clock
from lineage_sim.config import Config
from lineage_sim.events import (
    DayStarted,
    GodPower,
    OutputEvent,
    PresenceChanged,
    WorldEnded,
)
from lineage_sim.events import PowerLost as SimPowerLost
from lineage_sim.events import PowerRestored as SimPowerRestored
from lineage_sim.rng import FAUNA, FLORA, PRESENCE
from lineage_sim.state import io
from lineage_sim.world import World

from lineage_server.feed import Feed
from lineage_server.protocol import encode
from lineage_server.protocol.encode import Message
from lineage_server.settings import Settings
from lineage_server.store import Store

log = logging.getLogger(__name__)

SEED_BYTES = 4

_T = TypeVar("_T")


def new_seed() -> int:
    """A seed for the first world (outside the sim, which never draws its own)."""
    return int.from_bytes(os.urandom(SEED_BYTES), "little")


@dataclass
class Opened:
    """How the island came up: from which save (None: a new world), passing over which
    saves that did not load, and how much time it caught up."""

    save: Path | None
    skipped: list[Path]
    caught_up_ms: int


@dataclass
class Numbers:
    """What the island costs (for /status and the log, S1/S7)."""

    sim_cpu_s: float = 0.0
    saves: int = 0
    last_save_s: float = 0.0
    longest_save_s: float = 0.0


@dataclass
class Reply:
    """What a call makes: messages for every client, and for the desk only."""

    everyone: list[Message] = field(default_factory=list[Message])
    desk: list[Message] = field(default_factory=list[Message])


class Island:
    def __init__(
        self,
        config: Config,
        store: Store,
        settings: Settings,
        seed: Callable[[], int] = new_seed,
    ) -> None:
        self._config = config
        self._store = store
        self._settings = settings
        self._seed = seed
        self._world: World | None = None
        self._feed: Feed | None = None
        self.numbers = Numbers()
        # The feed's boundaries: the creatures (and clock), the light, the day's plants.
        self._creatures_ms = config.period_ms(FAUNA)
        self._sky_ms = config.period_ms(PRESENCE)
        self._land_ms = config.period_ms(FLORA)
        self._tick_ms = math.gcd(self._creatures_ms, self._sky_ms, self._land_ms)

    @property
    def world(self) -> World:
        if self._world is None:
            raise RuntimeError("the island is not open")
        return self._world

    @property
    def feed(self) -> Feed:
        if self._feed is None:
            raise RuntimeError("the island is not open")
        return self._feed

    @property
    def cooling_down(self) -> bool:
        """Whether the god power is cooling down (the LED is lit)."""
        world = self.world
        return world.t_ms < world.presence.ready_t_ms

    def _timed(self, work: Callable[[], _T]) -> _T:
        start = time.thread_time()
        try:
            return work()
        finally:
            self.numbers.sim_cpu_s += time.thread_time() - start

    # --- Opening --------------------------------------------------------------------------

    def open(self, now_ms: int) -> Opened:
        self._store.clean()
        loaded = self._store.load_newest(io.loads)
        if loaded is None:
            world, _ = World.create(self._config, self._seed(), now_ms)
            self._world = world
            log.info("a new island: world %d, seed %d", world.number, world.seed)
            self.save()
            opened = Opened(None, [], 0)
        else:
            self._world = World.restore(self._config, loaded.value)
            log.info("loaded %s (world %d)", loaded.path.name, self._world.number)
            opened = Opened(loaded.path, loaded.skipped, max(0, now_ms - self._world.unix_ms))
            self._catch_up(now_ms)
        self._feed = Feed(self.world)
        self.feed.start(self.world)
        self._store.prune(self._settings.daily_kept, self._settings.monthly_kept)
        return opened

    def _catch_up(self, now_ms: int) -> None:
        """Live the time the device was off, the owner away, from midnight to midnight."""
        world = self.world
        if now_ms <= world.unix_ms:
            return
        log.info("catching up %.1f days", (now_ms - world.unix_ms) / clock.MS_PER_DAY)
        if world.presence.present:
            self._keep(self._timed(lambda: world.apply(PresenceChanged(False))))
        while world.unix_ms < now_ms:
            midnight = clock.next_midnight_t_ms(world.epoch_unix_ms, world.t_ms)
            days = self._settings.catch_up_days - 1
            target = min(now_ms, world.epoch_unix_ms + midnight + days * clock.MS_PER_DAY)
            self._keep(self._timed(lambda target=target: world.advance_to_unix(target)))

    # --- Living ---------------------------------------------------------------------------

    def connect(self) -> list[Message]:
        """Everything a client connecting now needs."""
        return self._timed(lambda: self.feed.connect(self.world))

    def advance(self, now_ms: int) -> list[Message]:
        """Bring the world to ``now_ms``; the messages it makes on the way."""
        return self._timed(lambda: self._advance(now_ms))

    def _advance(self, now_ms: int) -> list[Message]:
        if now_ms - self.world.unix_ms > self._settings.jump_seconds * 1000:
            return self._jump(now_ms)
        world = self.world
        messages: list[Message] = []
        while True:
            boundary = (world.t_ms // self._tick_ms + 1) * self._tick_ms
            at = world.epoch_unix_ms + boundary
            if at > now_ms:
                break
            outputs = world.advance_to_unix(at)
            messages += self._after(outputs, due=True)
        if now_ms > world.unix_ms:
            messages += self._after(world.advance_to_unix(now_ms), due=False)
        return messages

    def _jump(self, now_ms: int) -> list[Message]:
        """The wall clock jumped ahead: catch up as on opening, then the owner as they were,
        and the island anew for every client."""
        present = self.world.presence.present
        log.warning("the clock jumped %.1f h ahead", (now_ms - self.world.unix_ms) / 3.6e6)
        self._catch_up(now_ms)
        if present:
            self._keep(self.world.apply(PresenceChanged(True)))
        self._feed = Feed(self.world)
        return self.feed.start(self.world)

    def _after(self, outputs: Sequence[OutputEvent], due: bool) -> list[Message]:
        """Keep what must be kept of ``outputs``, then the feed's messages for them; at a
        boundary (``due``) the creatures, the light and the land as they fall due."""
        self._keep(outputs)
        t_ms = self.world.t_ms
        return self.feed.advance(
            self.world,
            outputs,
            step=due and t_ms % self._creatures_ms == 0,
            sky_due=due and t_ms % self._sky_ms == 0,
            land_due=due and t_ms % self._land_ms == 0,
        )

    def handle(self, event: DeviceEvent, now_ms: int) -> Reply:
        """What the device says, at ``now_ms`` (the world is brought there first)."""
        return self._timed(lambda: self._handle(event, now_ms))

    def _handle(self, event: DeviceEvent, now_ms: int) -> Reply:
        reply = Reply(everyone=self._advance(now_ms))
        world = self.world
        if isinstance(event, ViewPressed):
            reply.desk.append(encode.view_message())
        elif isinstance(event, Presence):
            if event.present != world.presence.present:
                outputs = world.apply(PresenceChanged(event.present))
                # The light changes at its next tick; the sky now says who is there.
                reply.everyone += self._after(outputs, due=False)
                reply.everyone.append(encode.sky_message(world))
        elif isinstance(event, GodPowerPressed):
            reply.everyone += self._after(world.apply(GodPower()), due=False)
        elif isinstance(event, PowerLost):
            reply.everyone += self._after(world.apply(SimPowerLost()), due=False)
            self.save()
        elif isinstance(event, PowerRestored):
            reply.everyone += self._after(world.apply(SimPowerRestored()), due=False)
        return reply

    # --- Keeping --------------------------------------------------------------------------

    def _keep(self, outputs: Sequence[OutputEvent]) -> None:
        """Archive a world that ended, and save after it or at a new day."""
        ended = [output for output in outputs if isinstance(output, WorldEnded)]
        for end in ended:
            path = self._store.archive(io.dumps(end.archive), end.world, end.seed)
            log.info("world %d ended (%s); archived as %s", end.world, end.cause, path.name)
        if ended or any(isinstance(output, DayStarted) for output in outputs):
            self.save()
            self._store.prune(self._settings.daily_kept, self._settings.monthly_kept)

    def save(self) -> Path:
        """Save the world as it is now."""
        start = time.perf_counter()
        world = self.world
        path = self._store.save(io.dumps(world.snapshot()), world.unix_ms)
        took = time.perf_counter() - start
        numbers = self.numbers
        numbers.saves += 1
        numbers.last_save_s = took
        numbers.longest_save_s = max(numbers.longest_save_s, took)
        log.info("saved %s in %.2f s", path.name, took)
        return path
