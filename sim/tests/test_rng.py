"""Named random streams: seeded, independent, order-free, serialisable."""

import numpy as np
from hypothesis import given
from hypothesis import strategies as st
from lineage_sim import rng
from lineage_sim.rng import Streams


def test_same_seed_same_draws() -> None:
    a, b = Streams(7), Streams(7)
    assert np.array_equal(a.get(rng.FLORA).random(5), b.get(rng.FLORA).random(5))


def test_streams_differ_by_name_and_seed() -> None:
    draws = {
        (seed, name): Streams(seed).get(name).random()
        for seed in (1, 2)
        for name in (rng.TERRAIN, rng.FLORA, rng.FAUNA)
    }
    assert len(set(draws.values())) == len(draws)


def test_draws_in_one_stream_do_not_shift_another() -> None:
    quiet, busy = Streams(3), Streams(3)
    busy.get(rng.FAUNA).random(10_000)
    assert np.array_equal(quiet.get(rng.TERRAIN).random(4), busy.get(rng.TERRAIN).random(4))


def test_creation_order_does_not_matter() -> None:
    a, b = Streams(5), Streams(5)
    a.get(rng.FLORA)
    a_terrain = a.get(rng.TERRAIN).random(3)
    b_terrain = b.get(rng.TERRAIN).random(3)
    assert np.array_equal(a_terrain, b_terrain)


def test_stream_key_is_stable() -> None:
    # Pinned: changing the derivation would silently change every world.
    assert rng.stream_key("terrain") == 2871847306086812506


@given(seed=st.integers(0, 2**63), draws=st.integers(0, 50), name=st.text(min_size=1))
def test_state_round_trip_continues_identically(seed: int, draws: int, name: str) -> None:
    streams = Streams(seed)
    streams.get(name).random(draws)
    streams.get(name).integers(0, 10, size=draws % 3, dtype=np.uint32)  # has_uint32 buffer
    restored = Streams(seed)
    restored.set_state(streams.get_state())
    assert restored.get_state() == streams.get_state()
    assert np.array_equal(restored.get(name).random(6), streams.get(name).random(6))
