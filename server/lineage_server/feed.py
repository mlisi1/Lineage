"""The state stream's feed: which messages a world's steps make, and in what order (S1).

One piece of code for the live server and for the recordings (``tools/stream.py``), so the
renderer meets the same stream from both. The caller advances the world and says what is
due at that moment (a ``clock`` and ``creatures``, a ``sky``, the day's ``land``); the feed
adds what the outputs call for: the species when they change, chronicle entries and the
scene's events as they happen, the land again after an event that changes it, and at a
world's end the old world's last news, then the next world as a renderer meets it on
connect (``encode.connect_messages``).

Genomes are sent once (``creatures`` ``born``): the feed keeps one record of those sent,
shared by every client of a broadcast; a client that connects later gets its own full set
(`Feed.connect`), so at worst it is sent a genome twice, which a renderer takes as the same.
"""

from __future__ import annotations

from collections.abc import Sequence

from lineage_sim.events import (
    ChronicleEntry,
    CraterFormed,
    EarthquakeStruck,
    FireEnded,
    GodPowerUsed,
    OutputEvent,
    VolcanoErupted,
    WorldEnded,
)
from lineage_sim.world import World

from lineage_server.protocol import encode
from lineage_server.protocol.encode import Message

# What changes the land, so that the land is sent again at once.
LAND_CHANGES = (VolcanoErupted, EarthquakeStruck, CraterFormed, GodPowerUsed, FireEnded)


class _Census:
    """What has been sent of the world now living: its genomes and its species."""

    def __init__(self, world: World) -> None:
        self.sent: set[int] = set()
        self.species = encode.species_message(world)


def news_messages(world: World, outputs: Sequence[OutputEvent], sky: bool) -> list[Message]:
    """The chronicle entries and events (with ``sky``) among ``outputs``, as messages: the
    entries first, so that a world's last lines come before its end."""
    messages: list[Message] = []
    entries = [output for output in outputs if isinstance(output, ChronicleEntry)]
    chronicle = encode.entries_message(world, entries)
    if chronicle is not None:
        messages.append(chronicle)
    events = encode.events_message(outputs) if sky else None
    if events is not None:
        messages.append(events)
    return messages


class Feed:
    """The stream of one world line (across its apocalypses).

    ``creatures`` and ``sky`` say whether those messages are sent at all (a recording may
    leave them out; the server sends both). Without ``sky`` neither the scene's events nor
    the land after them are sent: the recordings made before R4 had none.
    """

    def __init__(self, world: World, *, creatures: bool = True, sky: bool = True) -> None:
        self.creatures = creatures
        self.sky = sky
        self._census = _Census(world)
        # The world's outputs since the last creatures message: who died of what, who landed.
        self._news: list[OutputEvent] = []

    def _opening(self, world: World, sent: set[int]) -> list[Message]:
        messages = encode.connect_messages(world, sent)
        if not self.creatures:
            messages = [message for message in messages if message["type"] != "creatures"]
        if not self.sky:
            messages = [message for message in messages if message["type"] != "sky"]
        return messages

    def start(self, world: World) -> list[Message]:
        """The stream's opening, for whoever listens from now (a recording's first
        messages): the genomes it sends count as sent."""
        return self._opening(world, self._census.sent)

    def connect(self, world: World) -> list[Message]:
        """Everything a client that connects now needs (the server's, per client): every
        living creature's genome, whatever was sent before."""
        return self._opening(world, set())

    def advance(
        self,
        world: World,
        outputs: Sequence[OutputEvent],
        *,
        step: bool = False,
        sky_due: bool = False,
        land_due: bool = False,
    ) -> list[Message]:
        """The messages for ``outputs``, which the world just made reaching now. ``step``:
        a ``clock`` and (with ``creatures``) the ``creatures`` are due; ``sky_due``: a
        ``sky``; ``land_due``: the day's ``land`` (unless an event sends it anyway)."""
        messages: list[Message] = []
        outputs = list(outputs)
        # A world that ends: its news, then the next world as a renderer meets it.
        ended = [i for i, output in enumerate(outputs) if isinstance(output, WorldEnded)]
        if ended:
            split = ended[-1] + 1
            messages += news_messages(world, outputs[:split], self.sky)
            self._census = _Census(world)
            messages += self.start(world)
            outputs = outputs[split:]
            self._news = []
        self._news += outputs
        if step:
            messages.append(encode.clock_message(world))
        # The land after an event that changes it comes after the event's news, so that a
        # renderer knows what is coming (a meteor's crater shows once it has struck).
        changed = self.sky and any(isinstance(output, LAND_CHANGES) for output in outputs)
        if land_due and not changed:
            messages.append(encode.land_message(world))
        # A species born or gone is sent, as a server would, before the animals of it.
        species = encode.species_message(world)
        if species is not None and species != self._census.species:
            messages.append(species)
            self._census.species = species
        if self.creatures and step:
            messages.append(encode.creatures_message(world, self._census.sent, self._news))
        if step:
            self._news = []
        if self.sky and sky_due:
            messages.append(encode.sky_message(world))
        messages += news_messages(world, outputs, self.sky)
        if changed:
            messages.append(encode.land_message(world))
        return messages
