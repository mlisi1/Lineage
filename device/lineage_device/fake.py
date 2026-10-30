"""A device with no hardware, so everything runs on a PC (CLAUDE.md §4.6).

S1's minimal fake: `FakeDevice`, driven by code (the server's tests push events into it),
and `KeyboardDevice`, driven by lines typed on standard input when the server runs by
hand. S2 completes it: the same interface as the real device, a small web panel, and a
test that the two agree.

Keys (each followed by Enter)::

    p   the owner arrives or leaves (presence toggles)
    g   the god-power button
    v   the view button
    l   mains power lost
    r   mains power restored
"""

from __future__ import annotations

import asyncio
import sys
from typing import TextIO

from lineage_device.interface import (
    DeviceEvent,
    GodPowerPressed,
    PowerLost,
    PowerRestored,
    Presence,
    ViewPressed,
)

KEYS = {"g": GodPowerPressed(), "v": ViewPressed(), "l": PowerLost(), "r": PowerRestored()}
PRESENCE_KEY = "p"


class FakeDevice:
    """Events pushed by code; the LED remembered (``led``, and every change in
    ``led_changes``)."""

    def __init__(self, present: bool = True) -> None:
        self._queue: asyncio.Queue[DeviceEvent] = asyncio.Queue()
        self._queue.put_nowait(Presence(present))
        self.led: bool | None = None
        self.led_changes: list[bool] = []

    def push(self, event: DeviceEvent) -> None:
        self._queue.put_nowait(event)

    async def next_event(self) -> DeviceEvent:
        return await self._queue.get()

    def set_cooldown_led(self, on: bool) -> None:
        if on != self.led:
            self.led_changes.append(on)
        self.led = on

    def close(self) -> None:
        pass


def event_of_key(key: str, present: bool) -> DeviceEvent | None:
    """The event a typed key stands for (``present``: the owner is there now), or None."""
    key = key.strip().lower()
    if key == PRESENCE_KEY:
        return Presence(not present)
    return KEYS.get(key)


class KeyboardDevice(FakeDevice):
    """The fake, driven by keys typed on ``stream`` (standard input), read in a thread."""

    def __init__(self, present: bool = True, stream: TextIO = sys.stdin) -> None:
        super().__init__(present)
        self._present = present
        self._stream = stream
        self._reader: asyncio.Task[None] | None = None

    async def _read(self) -> None:
        while True:
            line = await asyncio.to_thread(self._stream.readline)
            if line == "":
                return
            event = event_of_key(line, self._present)
            if event is None:
                print(f"keys: {PRESENCE_KEY} {' '.join(KEYS)}", file=sys.stderr)
                continue
            if isinstance(event, Presence):
                self._present = event.present
            self.push(event)

    async def next_event(self) -> DeviceEvent:
        if self._reader is None:
            self._reader = asyncio.create_task(self._read())
        return await super().next_event()

    def set_cooldown_led(self, on: bool) -> None:
        if on != self.led:
            print(f"LED {'on (cooling down)' if on else 'off (ready)'}", file=sys.stderr)
        super().set_cooldown_led(on)

    def close(self) -> None:
        if self._reader is not None:
            self._reader.cancel()
