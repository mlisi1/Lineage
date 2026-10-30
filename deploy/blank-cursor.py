#!/usr/bin/env python3
"""Make a cursor theme whose every cursor is invisible, for the kiosk (R5).

The kiosk's compositor (cage) draws the pointer itself until the page under it says
otherwise, and the page says so only once the pointer has moved over it; cage has no
option to hide it. A theme of see-through cursors, chosen in the kiosk's units
(``Environment=XCURSOR_THEME=lineage-blank`` and ``XCURSOR_PATH``), hides it from the start.

    python3 blank-cursor.py            # writes ~/.local/share/icons/lineage-blank

Standard library only: run on the board as the kiosk's user.
"""

from __future__ import annotations

import struct
import sys
from pathlib import Path

THEME = "lineage-blank"
# The names a compositor or a browser may ask for; all the same see-through cursor.
NAMES = (
    "default",
    "left_ptr",
    "arrow",
    "pointer",
    "hand",
    "hand1",
    "hand2",
    "text",
    "xterm",
    "crosshair",
    "wait",
    "watch",
    "progress",
    "move",
    "grab",
    "grabbing",
    "not-allowed",
    "help",
)
# Sizes the cursor is given at: a compositor picks the nearest to its own.
SIZES = (16, 24, 32, 48, 64)
IMAGE = 0xFFFD0002


def cursor_file() -> bytes:
    """An Xcursor file with one see-through 1 x 1 image at each size."""
    header_size = 16
    toc_size = 12 * len(SIZES)
    image_header = 36
    image_size = image_header + 4  # one ARGB pixel
    out = struct.pack("<4sIII", b"Xcur", header_size, 0x10000, len(SIZES))
    position = header_size + toc_size
    for size in SIZES:
        out += struct.pack("<III", IMAGE, size, position)
        position += image_size
    for size in SIZES:
        out += struct.pack("<IIIIIIIII", image_header, IMAGE, size, 1, 1, 1, 0, 0, 0)
        out += struct.pack("<I", 0)  # transparent
    return out


def write_theme(root: Path) -> Path:
    theme = root / THEME
    cursors = theme / "cursors"
    cursors.mkdir(parents=True, exist_ok=True)
    data = cursor_file()
    for name in NAMES:
        (cursors / name).write_bytes(data)
    (theme / "index.theme").write_text(
        f"[Icon Theme]\nName={THEME}\nComment=Every cursor see-through (the Lineage kiosk)\n",
        encoding="utf-8",
    )
    return theme


def main(argv: list[str]) -> int:
    root = Path(argv[1]) if len(argv) > 1 else Path.home() / ".local/share/icons"
    print(f"wrote {write_theme(root)}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
