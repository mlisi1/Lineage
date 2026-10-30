"""Save format: canonical, compressed, round-trips exactly, rejects corruption."""

import lzma
from typing import Any, cast

import numpy as np
import pytest
from hypothesis import given
from hypothesis import strategies as st
from hypothesis.extra import numpy as hnp
from lineage_sim.state import io
from lineage_sim.state.schema import SCHEMA_VERSION, StateError, Tree, WorldState
from numpy.typing import NDArray

JSON_SCALARS = (
    st.none()
    | st.booleans()
    | st.integers(-(2**70), 2**70)
    | st.floats(allow_nan=False, allow_infinity=False)
    | st.text()
)
ARRAYS = hnp.arrays(
    dtype=st.sampled_from([np.float64, np.float32, np.int64, np.int32, np.uint8, np.bool_]),
    shape=hnp.array_shapes(min_dims=0, max_dims=3, max_side=5),
)
TREES: st.SearchStrategy[Any] = st.recursive(
    JSON_SCALARS | ARRAYS,
    lambda children: (
        st.lists(children, max_size=4)
        | st.dictionaries(
            st.text(max_size=8).filter(lambda k: k != "__ndarray__"), children, max_size=4
        )
    ),
    max_leaves=20,
)


def _assert_tree_equal(a: Any, b: Any) -> None:
    if isinstance(a, np.ndarray):
        assert isinstance(b, np.ndarray)
        x, y = cast(NDArray[Any], a), cast(NDArray[Any], b)
        assert x.dtype == y.dtype
        assert x.shape == y.shape
        assert x.tobytes() == y.tobytes()  # bit-exact, NaN payloads included
    elif isinstance(a, dict):
        assert isinstance(b, dict)
        x, y = cast(dict[str, Any], a), cast(dict[str, Any], b)
        assert x.keys() == y.keys()
        for key in x:
            _assert_tree_equal(x[key], y[key])
    elif isinstance(a, list | tuple):
        assert isinstance(b, list)
        x, y = list(cast(list[Any], a)), cast(list[Any], b)
        assert len(x) == len(y)
        for item_a, item_b in zip(x, y, strict=True):
            _assert_tree_equal(item_a, item_b)
    else:
        assert type(a) is type(b)
        assert a == b


def _state(subsystems: dict[str, Tree]) -> WorldState:
    return WorldState(seed=1, epoch_unix_ms=0, t_ms=5, subsystems=subsystems)


@given(tree=st.dictionaries(st.text(max_size=8), TREES, max_size=5))
def test_encode_decode_round_trip(tree: Tree) -> None:
    tree = {k: v for k, v in tree.items() if k != "__ndarray__"}
    encoded = io.encode(tree)
    decoded = io.decode(encoded)
    _assert_tree_equal(tree, decoded)
    assert io.encode(decoded) == encoded


@given(tree=st.dictionaries(st.text(max_size=8), TREES, max_size=5))
def test_save_load_save_is_byte_identical(tree: Tree) -> None:
    tree = {k: v for k, v in tree.items() if k != "__ndarray__"}
    first = io.dumps(_state({"toy": tree}))
    assert io.dumps(io.loads(first)) == first


def test_dict_key_order_does_not_change_bytes() -> None:
    assert io.encode({"a": 1, "b": [1.5, {"y": 2, "x": 3}]}) == io.encode(
        {"b": [1.5, {"x": 3, "y": 2}], "a": 1}
    )


def test_hash_tracks_content() -> None:
    a = _state({"toy": {"x": np.arange(4)}})
    b = _state({"toy": {"x": np.arange(4)}})
    c = _state({"toy": {"x": np.arange(4) + 1}})
    assert io.state_hash(a) == io.state_hash(b)
    assert io.state_hash(a) != io.state_hash(c)


def test_non_contiguous_arrays_save_canonically() -> None:
    base = np.arange(12, dtype=np.int64).reshape(3, 4)
    assert io.encode({"a": base.T}) == io.encode({"a": np.ascontiguousarray(base.T)})


@pytest.mark.parametrize(
    "bad",
    [
        {"x": np.array([object()], dtype=object)},
        {"x": {1, 2}},
        {"x": float("nan")},
        {"__ndarray__": 0},
        {"x": {3: "int key"}},
    ],
)
def test_unsavable_values_are_rejected(bad: Tree) -> None:
    with pytest.raises((StateError, ValueError)):
        io.encode(bad)


def test_truncated_save_is_detected() -> None:
    data = io.dumps(_state({"toy": {"x": np.arange(100)}}))
    with pytest.raises(StateError, match="corrupt save"):
        io.loads(data[: len(data) // 2])


def test_flipped_byte_is_detected() -> None:
    data = bytearray(io.dumps(_state({"toy": {"x": np.arange(100)}})))
    data[len(data) // 2] ^= 0xFF
    with pytest.raises(StateError):
        io.loads(bytes(data))


def test_wrong_magic_is_rejected() -> None:
    with pytest.raises(StateError, match="bad magic"):
        io.loads(lzma.compress(b"NOTASAVE" + bytes(8)))


def test_future_schema_is_rejected() -> None:
    tree = _state({}).to_tree() | {"schema_version": SCHEMA_VERSION + 1}
    with pytest.raises(StateError, match="newer than this code"):
        io.loads(lzma.compress(io.encode(tree)))


def test_saves_are_made_at_the_light_preset_and_any_preset_loads() -> None:
    state = _state({"toy": {"x": np.arange(10_000) % 7}})
    data = io.dumps(state)
    raw = lzma.decompress(data, format=lzma.FORMAT_XZ)
    light = lzma.compress(raw, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64, preset=0)
    assert data == light
    # A save written before S1 (the default preset 6) loads as before.
    heavy = lzma.compress(raw, format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64, preset=6)
    assert io.state_hash(io.loads(heavy)) == io.state_hash(state)
