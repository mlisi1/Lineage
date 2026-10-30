"""The minimal fake device (S1): events pushed by code or typed as keys."""

from __future__ import annotations

import asyncio
import io

from lineage_device.fake import FakeDevice, KeyboardDevice, event_of_key
from lineage_device.interface import (
    GodPowerPressed,
    PowerLost,
    PowerRestored,
    Presence,
    ViewPressed,
)


def test_the_first_event_is_the_presence_now() -> None:
    async def first() -> object:
        return await FakeDevice(present=False).next_event()

    assert asyncio.run(first()) == Presence(False)


def test_pushed_events_come_in_order_and_the_led_is_remembered() -> None:
    async def run() -> list[object]:
        device = FakeDevice()
        device.push(GodPowerPressed())
        device.push(ViewPressed())
        events: list[object] = [await device.next_event() for _ in range(3)]
        return events

    assert asyncio.run(run()) == [Presence(True), GodPowerPressed(), ViewPressed()]
    device = FakeDevice()
    for on in (True, True, False, True):
        device.set_cooldown_led(on)
    assert device.led is True
    assert device.led_changes == [True, False, True]


def test_keys_stand_for_events() -> None:
    assert event_of_key("p\n", present=True) == Presence(False)
    assert event_of_key("P", present=False) == Presence(True)
    assert event_of_key("g", present=True) == GodPowerPressed()
    assert event_of_key("v", present=True) == ViewPressed()
    assert event_of_key("l", present=True) == PowerLost()
    assert event_of_key("r", present=True) == PowerRestored()
    assert event_of_key("x", present=True) is None


def test_typed_keys_reach_the_server_and_presence_toggles() -> None:
    async def run() -> list[object]:
        device = KeyboardDevice(present=True, stream=io.StringIO("p\nx\np\ng\n"))
        events: list[object] = [await device.next_event() for _ in range(4)]
        device.close()
        return events

    assert asyncio.run(run()) == [
        Presence(True),
        Presence(False),
        Presence(True),
        GodPowerPressed(),
    ]
