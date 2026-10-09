"""Lineage world simulation.

Pure and deterministic: no wall clock, filesystem, network, environment or GPIO access.
Time advances only through ``World.step(dt)``; the outside world arrives only as events
through ``World.apply(event)``. See CLAUDE.md §4.
"""

__version__ = "0.0.0"
