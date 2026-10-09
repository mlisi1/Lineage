"""Seeded random streams, one per subsystem (CLAUDE.md §4.2).

Each named stream is an independent PCG64 generator derived from the world seed and a
stable digest of the stream name, so draws in one subsystem never shift another's. Streams
are created on first use; a stream's initial state does not depend on when or in which
order streams are created. Stream state is part of the saved world state.
"""

from __future__ import annotations

import hashlib
from typing import Any, cast

from numpy.random import PCG64, Generator, SeedSequence

# Stream names. Every subsystem draws only from its own stream.
TERRAIN = "terrain"
FLORA = "flora"
FAUNA = "fauna"
SPECIES = "species"
PRESENCE = "presence"
CHRONICLE = "chronicle"
APOCALYPSE = "apocalypse"

_BIT_GENERATOR = "PCG64"


def stream_key(name: str) -> int:
    """Stable 64-bit key of a stream name (never Python's salted ``hash``)."""
    if not name:
        raise ValueError("stream name must be non-empty")
    return int.from_bytes(hashlib.blake2b(name.encode("utf-8"), digest_size=8).digest(), "little")


def new_generator(seed: int, name: str) -> Generator:
    """Fresh generator for stream ``name`` of a world with ``seed``."""
    if seed < 0:
        raise ValueError(f"seed must be non-negative, got {seed}")
    return Generator(PCG64(SeedSequence(entropy=seed, spawn_key=(stream_key(name),))))


class Streams:
    """The world's named random streams."""

    def __init__(self, seed: int) -> None:
        if seed < 0:
            raise ValueError(f"seed must be non-negative, got {seed}")
        self._seed = seed
        self._streams: dict[str, Generator] = {}

    @property
    def seed(self) -> int:
        return self._seed

    def get(self, name: str) -> Generator:
        stream = self._streams.get(name)
        if stream is None:
            stream = self._streams[name] = new_generator(self._seed, name)
        return stream

    def get_state(self) -> dict[str, dict[str, Any]]:
        """JSON-compatible state of every created stream, keyed by name in sorted order."""
        out: dict[str, dict[str, Any]] = {}
        for name in sorted(self._streams):
            raw = cast(dict[str, Any], self._streams[name].bit_generator.state)
            inner = cast(dict[str, int], raw["state"])
            out[name] = {
                # 128-bit integers stored as hex strings so any JSON reader keeps them exact.
                "state": f"{inner['state']:x}",
                "inc": f"{inner['inc']:x}",
                "has_uint32": int(raw["has_uint32"]),
                "uinteger": int(raw["uinteger"]),
            }
        return out

    def set_state(self, state: dict[str, dict[str, Any]]) -> None:
        self._streams = {}
        for name in sorted(state):
            s = state[name]
            bit_generator = PCG64(0)  # seeded placeholder, state replaced below
            bit_generator.state = {
                "bit_generator": _BIT_GENERATOR,
                "state": {"state": int(s["state"], 16), "inc": int(s["inc"], 16)},
                "has_uint32": int(s["has_uint32"]),
                "uinteger": int(s["uinteger"]),
            }
            self._streams[name] = Generator(bit_generator)
