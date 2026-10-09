# 0002 — Time representation, random streams and save format

- **Status**: accepted
- **Date**: 2026-10-09

## Context

M1 builds the core every later milestone depends on, and saves must outlive code for
years (CLAUDE.md §4.4). Choices made here are expensive to change later.

## Decision

- **Integer milliseconds** for sim time (`t_ms`). Floats accumulate rounding error over
  years and make tick times depend on step chunking; integers make schedules exact.
  Millisecond resolution is far below any planned behaviour rate.
- **Absolute tick times**: a subsystem with period `p` ticks at `k·p`. Any chunking of
  `step(dt)` gives a bit-identical world, which is what lets fast-forward share the
  device's code path.
- **Calendar in UTC** from an injected `epoch_unix_ms`; **astronomical seasons** on fixed
  dates from config, chosen by the owner over meteorological seasons. Hemisphere is a
  config switch.
- **One PCG64 stream per name**, seeded with `SeedSequence(entropy=seed,
  spawn_key=(blake2b64(name),))`. Created lazily; the initial state of a stream does not
  depend on creation order. `numpy.random.default_rng` and unseeded generators are banned
  by the purity test.
- **Save container without new dependencies**: xz (`lzma`, CRC64) around
  `MAGIC | u32 header length | sorted compact JSON header | .npy v1.0 arrays`. Arrays are
  numbered in sorted-key order so encoding is canonical; the state hash is the SHA-256 of
  the uncompressed encoding. Pickle is never used: it ties saves to class layouts and is
  unsafe to load.
- **Migrations operate on raw trees**, not dataclasses, so an old save never depends on
  current classes. The registry is explicit and a test requires one migration per past
  version and one frozen fixture per version.

## Consequences

- Subsystems must keep all persistent state in their `get_state()` tree, using only JSON
  values and NumPy arrays.
- `World.restore` needs the same subsystem set as the save; adding a subsystem is a schema
  change with a migration that creates its initial state.
- 128-bit PCG64 state is stored as hex strings so any JSON reader keeps it exact.
