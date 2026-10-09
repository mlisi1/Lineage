"""Lineage device layer: the only code that touches GPIO (CLAUDE.md §4.6).

Planned modules (S2): ``presence`` (PIR), ``switch`` (covered god-power switch), ``led``
(cooldown LED), ``backlight``, ``power`` (UPS mains-loss sense), and ``fake`` which exposes
the same interface driven from the keyboard / a small web panel so everything runs on a PC.
"""

__version__ = "0.0.0"
