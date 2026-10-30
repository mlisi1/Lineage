"""What the device layer tells the server, and what the server asks of it (S1; S2 fills in
the hardware behind it).

The device hands over events as they happen: the owner arrived or left (the PIR, its
hold logic already applied), a button was pressed, mains power was lost or came back. The
first event is always the presence as it is now. The server lights the cooldown LED.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol


@dataclass(frozen=True)
class Presence:
    """The owner is at the desk (True) or has left it (False)."""

    present: bool


@dataclass(frozen=True)
class GodPowerPressed:
    """The god-power button was pressed (the island chooses the power, ADR 0016)."""


@dataclass(frozen=True)
class ViewPressed:
    """The view button was pressed (the screen's next view, ADR 0020)."""


@dataclass(frozen=True)
class PowerLost:
    """Mains power was lost; the device runs on its UPS."""


@dataclass(frozen=True)
class PowerRestored:
    """Mains power came back."""


DeviceEvent = Presence | GodPowerPressed | ViewPressed | PowerLost | PowerRestored


class Device(Protocol):
    async def next_event(self) -> DeviceEvent:
        """The next event, waiting until there is one."""
        ...

    def set_cooldown_led(self, on: bool) -> None:
        """Light the LED while the god power is cooling down (on), dark when ready."""
        ...

    def close(self) -> None: ...
