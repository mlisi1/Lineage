# 0023 — The server: real time, catching up, saves, one stream

- **Status**: accepted
- **Date**: 2026-10-28

## Context

S1 runs the sim in real time on the device (CLAUDE.md §8 S1). It needs daily atomic
saves, the last N of them kept, a WebSocket state stream and recovery on start. Its tests
are an integration with a fake device and a save that survives `kill -9`.

The pieces were already there:
- `World.advance_to_unix` follows the wall clock across a world's end (M10, ADR 0018).
- `io.dumps`/`io.loads` make canonical xz saves with a CRC, migrated on load (M1).
- The wire schema and its encoder (R1–R5).
- `tools/stream.py`, which recorded the stream a server would send. The renderer plays
  those recordings; `SocketSource` had never been tried.
- R5's kiosk build connects to `ws://<host>/stream`, served from the same host as the page.

Before coding, the owner made these choices (2026-10-28):

1. **Downtime**: when the device was off, the island **catches up** on start, counting
   the hours missed as the owner away. It does not pause.
2. **Saves kept**: the newest of each of the last **7 days**, plus the **oldest of each
   month**, forever. Also a save on a clean shutdown and at a world's end, the archive
   first.
3. **Dependency**: `websockets` (asyncio, pure Python, no other dependencies).
4. **Stream rate**: creatures at the **behaviour rate** (each fauna tick, 10 minutes).
   The renderer lives between ticks.
5. **Fake device**: a **minimal one in S1**, for the tests and to run by hand. S2 brings
   the full fake, its web panel and the parity test.
6. **View button**: device → server → a **`view` message to the desk only**.
7. S1 is worked **in parallel with R5's close**, on `s1-server` branched from `r5-final`.

## Decision

- **One process, one port** (8080): the kiosk's pages, `/stream`, `/status`. Settings in
  `server/config/server.toml`, apart from the sim's tunables.
- **One sim thread**: every call on the world runs in a single-worker executor. Its
  messages are handed to the clients under one asyncio lock, so a client sees everything
  in the order it was made. The connect messages come first, then whatever follows. Each
  client has a queue and its own writer task; a client with more than `client_backlog`
  batches waiting is let go, and the renderer reconnects.
- **Wall time is passed in** (`Island` takes `now_ms`; the server reads a `WallClock`), so
  the tests run days of island time on a clock moved by hand.
- **Ticks from the sim's schedule**: the server advances to each boundary of the fauna,
  presence and flora periods (`config.period_ms`), and says at each what is due. Nothing
  is hard-coded (§4.3).
- **One feed**: the logic of `tools/stream.py`'s `record()` moved into
  `lineage_server.feed.Feed`, used by both. The committed `life`, `office` and `end`
  recordings re-recorded through it are byte-identical.
- **Catch-up**: absence applied at the save's instant, then advance from midnight to
  midnight with a save at each. A clock found more than `jump_seconds` ahead while running
  (the board has no clock of its own) is caught up on the same way, and every client is
  sent the island anew. The board's unit waits for `time-sync.target`.
- **Saves**: atomic (tmp, fsync, rename, fsync the directory). The newest that loads is
  used; one that does not is logged and passed over. Archives are never deleted.
- **The desk is the loopback client**: the kiosk runs on the board, phones never do, so
  the page needs no flag to say it is the desk.
- **`view`** is a new message on the wire (`protocol` stays 1: an older renderer ignores
  it). `SocketSource` reconnects after 1 s, doubling up to 30 s.
- **The device interface** (`lineage_device.interface.Device`): events
  (`Presence` first, `GodPowerPressed`, `ViewPressed`, `PowerLost`, `PowerRestored`) and
  `set_cooldown_led`. The LED follows `Presence.ready_t_ms`.

No sim change, no schema bump.

## Results

On the PC, 2026-10-28:
- A full world (v9, about 200 animals) is saved through the store in 197 ms. 189 ms of
  that is xz at preset 6; preset 1 gives the same 0.68 MB in about 68 ms. (Before the
  change to preset 0 in Consequences: 53 ms since.)
- A new island starts in 0.1 s.
- The kiosk build draws the live stream: map view of a new world, no errors.
- The board's session rehearsed from the wheels in a fresh environment, with the unit's
  command line: an island a year old today (seed 3, office schedule, 203 animals in 15
  species) catches up at 0.37 s of CPU a sim-day, saves in 0.19 s, holds 64 MB.

Added while preparing the board:
- A save straight after a catch-up, so caught-up time is not lost to a crash before
  midnight.
- `/status` reports the catch-up's CPU per sim-day: the board's cost of a sim-day, the
  number M11 left to S1.
- `deploy/s1-board.sh` and `tools/server_watch.py` run and judge the session from the PC.

Tests:
- Store: 20 seeded `kill -9`s while saving; a save loads after every one.
- Resume: a restart without downtime is bit-identical to a run never stopped. A restart
  after downtime equals a run where the owner left at the cut.
- End to end: real WebSocket and HTTP clients, with the view button reaching the desk only.

On the board, 2026-10-29 (Orange Pi Zero 2W, the 7" screen, after R5's last run; the
island of seed 3, a year old, office schedule, about 200 animals; `runs/s1-board/`):

| | Board | Budget (§4.8) |
|---|---|---|
| Sim's share of one core, 20 min with the kiosk drawing | 0.0011 | ≤ 0.25 |
| Catching up 1.78 sim-days on start | 10.8 s of CPU: 6.1 s a sim-day (16× the PC) | — |
| Saves | 1.34 s, 1.22 s; 1.61 s with the kiosk drawing | ≤ 2 s |
| Server's resident memory | 88–89 MB, flat | ≤ 300 MB |

The whole board with the kiosk: 495 MB of 1.97 GB in use, 63 °C, Chromium about 60 % of a
core. The kiosk reconnected by itself when the server was restarted. Every budget is met;
the save has the least margin (1.61 of 2 s), and grows with the island.

## Consequences

- The board's Python is Debian's 3.13 (Trixie), the project's 3.11. `deploy/s1-board.sh`
  installs `uv` in `~/.lineage-uv` (from PyPI) and makes the server's environment with
  uv's Python 3.11, from wheels built on the PC and the versions pinned in `uv.lock`. S6
  writes the deployment's own setup.
- The save was the budget with the least margin on the board (1.61 s of 2 s with the
  kiosk drawing). The owner chose a lighter compression (2026-10-30): `io.dumps` now
  uses xz preset 0 (`io.XZ_PRESET`) instead of the default 6. On the board's island
  (PC): 118 → 51 ms, 0.681 → 0.683 MB, the save's extra memory 35 → 3 MB, loading
  unchanged (15 ms); through the store 197 → 53 ms. On the board (2026-10-30, the same
  island, `runs/s1-board-xz0/`): saves 0.62 and 0.73 s after the catch-up, 0.88 s with the
  kiosk drawing (1.61 s before), the server 61–68 MB (89 before), the sim 0.12 % of a core
  over 20 minutes, 6.2 s of CPU a sim-day; S7's soak follows the save as the island grows. Older saves and the frozen
  fixtures load as before (any preset decompresses the same way); state hashes, golden
  hashes and save → load → save identity are unchanged.
- S2 implements `Device` on GPIO and keeps the fake in step (parity test, web panel).
- S3 adds the API beside `/status` and a phone page, the same stream without `view`.
- S4 reads the island's major chronicle entries; the server is where they come out.
- S5 can take the saves and archives from `DIR`.

## References

- websockets documentation, "asyncio server" and `process_request`:
  https://websockets.readthedocs.io/en/stable/reference/asyncio/server.html
- The atomic write pattern (write, fsync, rename, fsync the directory): Linux `rename(2)`
  and `fsync(2)` manual pages.
- systemd `time-sync.target` and `systemd-time-wait-sync.service`: systemd.special(7).
