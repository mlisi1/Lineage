"""Save and load world state as compressed bytes.

The sim does no file I/O: callers write the bytes (atomically: temp file, fsync, rename)
and read them back. Encoding is canonical — the same state always gives the same bytes —
so a save can be hashed and save → load → save is byte-identical.

Container (inside an xz stream, whose CRC64 detects truncated or corrupted saves)::

    MAGIC (8 bytes) | header length (u32 LE) | header JSON (UTF-8) | arrays (.npy v1.0 each)

The header holds the state tree with each NumPy array replaced by ``{"__ndarray__": i}``
plus the byte length of every array.
"""

from __future__ import annotations

import hashlib
import io
import json
import lzma
import struct
from typing import Any, cast

import numpy as np

from lineage_sim.state.migrations import migrate
from lineage_sim.state.schema import StateError, Tree, WorldState

MAGIC = b"LNGSAVE\x01"  # last byte is the container format version
_ARRAY_KEY = "__ndarray__"
_LEN = struct.Struct("<I")


def _strip_arrays(value: Any, arrays: list[np.ndarray[Any, Any]]) -> Any:
    if isinstance(value, np.ndarray):
        array = cast(np.ndarray[Any, Any], value)
        if array.dtype.hasobject:
            raise StateError("object arrays cannot be saved")
        # Not np.ascontiguousarray: it turns 0-d arrays into 1-d.
        arrays.append(array if array.flags.c_contiguous else array.copy(order="C"))
        return {_ARRAY_KEY: len(arrays) - 1}
    if isinstance(value, dict):
        node = cast(dict[Any, Any], value)
        for key in node:
            if not isinstance(key, str) or key == _ARRAY_KEY:
                raise StateError(f"invalid state key {key!r}")
        # Sorted, so array numbering matches the sorted JSON and the bytes are canonical.
        return {key: _strip_arrays(node[key], arrays) for key in sorted(node)}
    if isinstance(value, list | tuple):
        return [_strip_arrays(item, arrays) for item in cast(list[Any], value)]
    if value is None or isinstance(value, bool | int | float | str):
        return value
    raise StateError(f"cannot save value of type {type(value).__name__}")


def _restore_arrays(value: Any, arrays: list[np.ndarray[Any, Any]]) -> Any:
    if isinstance(value, dict):
        node = cast(dict[str, Any], value)
        if set(node) == {_ARRAY_KEY}:
            index: int = node[_ARRAY_KEY]
            return arrays[index]
        return {key: _restore_arrays(item, arrays) for key, item in node.items()}
    if isinstance(value, list):
        items = cast(list[Any], value)
        return [_restore_arrays(item, arrays) for item in items]
    return value


def encode(tree: Tree) -> bytes:
    """Canonical uncompressed bytes of a state tree."""
    arrays: list[np.ndarray[Any, Any]] = []
    body = _strip_arrays(tree, arrays)
    blobs: list[bytes] = []
    for array in arrays:
        buffer = io.BytesIO()
        np.lib.format.write_array(buffer, array, version=(1, 0), allow_pickle=False)
        blobs.append(buffer.getvalue())
    header = {"tree": body, "array_lengths": [len(b) for b in blobs]}
    header_bytes = json.dumps(
        header, sort_keys=True, separators=(",", ":"), allow_nan=False, ensure_ascii=True
    ).encode("ascii")
    return b"".join([MAGIC, _LEN.pack(len(header_bytes)), header_bytes, *blobs])


def decode(data: bytes) -> Tree:
    if data[: len(MAGIC)] != MAGIC:
        raise StateError("not a Lineage save (bad magic)")
    offset = len(MAGIC)
    (header_len,) = _LEN.unpack_from(data, offset)
    offset += _LEN.size
    header = json.loads(data[offset : offset + header_len])
    offset += header_len
    arrays: list[np.ndarray[Any, Any]] = []
    for length in header["array_lengths"]:
        blob = io.BytesIO(data[offset : offset + length])
        arrays.append(np.lib.format.read_array(blob, allow_pickle=False))
        offset += length
    if offset != len(data):
        raise StateError("trailing bytes after the last array")
    tree: Tree = _restore_arrays(header["tree"], arrays)
    return tree


def dumps(state: WorldState) -> bytes:
    """Compressed save bytes of ``state``."""
    return lzma.compress(encode(state.to_tree()), format=lzma.FORMAT_XZ, check=lzma.CHECK_CRC64)


def loads(data: bytes) -> WorldState:
    """Load save bytes of any known schema version, migrating to the current one."""
    try:
        raw = lzma.decompress(data, format=lzma.FORMAT_XZ)
    except lzma.LZMAError as exc:
        raise StateError(f"corrupt save: {exc}") from None
    return WorldState.from_tree(migrate(decode(raw)))


def state_hash(state: WorldState) -> str:
    """SHA-256 of the canonical encoding: equal hashes mean bit-identical states."""
    return hashlib.sha256(encode(state.to_tree())).hexdigest()
