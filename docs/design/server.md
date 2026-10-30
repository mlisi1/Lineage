# The server

What runs on the device around the simulation (S1; ADR 0023). The sim is pure
(CLAUDE.md §4.1): it never reads the clock or touches a file. The server brings it the
time and the owner's doings, keeps it on the SD card, and streams it to the screen and to
phones.

## One process, one port

`uv run python -m lineage_server.main --data DIR --dist renderer/dist-kiosk --fake-device`

| Path | What |
|---|---|
| `/` and the rest | the kiosk's pages (`--dist`, the renderer's desk build) |
| `/stream` | the state stream, a WebSocket of JSON messages (`server/lineage_server/protocol/schema.json`) |
| `/status` | the server's numbers as JSON: sim CPU, its share of one core, saves and their durations, memory |

The port and the rest of the server's settings are in `server/config/server.toml`
(`lineage_server/settings.py`). The island's tunables are not there; they stay in the
sim's `default.toml`.

Modules: `island.py` (the world, its saves, its stream; synchronous, one sim thread),
`server.py` (the asyncio loop, clients, pages), `feed.py` (which messages a step makes;
shared with `tools/stream.py`, so recordings and the live stream are the same code),
`store.py` (saves and archives on disk), `main.py` (the command).

## Time

Sim time is wall time (§4.3). About once a wall second (`poll_seconds`) the server
brings the world to now with `World.advance_to_unix`, which follows the world across an
apocalypse by itself. On the way it stops at each tick of the creatures, the light and the
plants (the sim's `[schedule]`: 10 minutes, 10 minutes, a day), so that the stream sends
each in turn.

- **Starting** (the owner, 2026-10-28): the newest save that loads is opened, and the time
  the device was off is lived at once, with the owner away. There is a save at each UTC
  midnight on the way, so a catch-up of months that is cut short does not start over,
  and one at the end. `/status` gives what it cost (`catch_up_s_per_day`: the device's
  CPU per sim-day).
  A world that ends on the way is archived as usual. On the PC a sim-day takes about
  0.4 s of CPU.
- **A clock that jumps** more than `jump_seconds` (an hour) ahead while running is
  caught up on the same way, quietly, and every client is sent the island anew. The board
  has no clock of its own: if the network sets its time late, the server would otherwise
  stream every tick of the hours jumped over. The board's unit also waits for the time
  to be synchronised before it starts.
- A save from the future (a clock set back) makes the island wait until the wall clock
  reaches it.

## Saves

Each save is written to `<name>.tmp`, fsynced and renamed, and the directory is fsynced
too. A power cut leaves the old save or the new one, and at worst a `.tmp` that the next
start removes. A save that does not load (the xz CRC catches a truncated one) is logged
and the next older one is used.

| When | What |
|---|---|
| each UTC midnight (`DayStarted`) | a save |
| `PowerLost` from the device | a save at once (S2 then shuts the board down) |
| SIGTERM, Ctrl+C | a save, then stop |
| a world ends (`WorldEnded`) | its archive (`archives/world-NNN-seed-S.lzma`, its final state), then the next world saved |

Saves are named after the world's instant: `saves/2026-10-28T00-00-00.000Z.lzma`. Kept
(the owner, 2026-10-28): the newest save of each of the last 7 days that have one, plus
the oldest of each month, forever. Archives are never deleted.

## The stream

The feed (`feed.py`) decides the messages:
- **On connect:** everything as it is now (`encode.connect_messages`).
- **At every creatures tick:** `clock` and `creatures` (who died of what, who was born
  to whom, who landed).
- **At every presence tick:** `sky`.
- **Daily:** the `land`, and again at once after an event that changes it.
- **When they change:** the `species`.
- **As they happen:** `chronicle` entries and the scene's `events`.
- **At a world's end:** its last news, then the next world as on connect.

Each message is encoded once and queued to every client in the order it was made.
Genomes go once to the broadcast; a client that connects later gets its own full set.

**The view button** (ADR 0020) reaches the page as `{"type": "view"}`, sent only to the
desk: the client on the device itself, a loopback address. Phones steer their own view
(S3). The renderer's `SocketSource` reconnects when the socket closes, after 1 s, then
waiting twice as long each time up to 30 s. The server sends everything anew on each
connection.

## The device

`lineage_device.interface` describes what the device hands over: the presence (first,
as it is now), the god-power and view buttons, mains lost and restored. The server lights
the cooldown LED from the island (`Presence.ready_t_ms`). Until S2 there is only the fake
(`lineage_device.fake`): `FakeDevice` for tests, `KeyboardDevice` for keys typed on
standard input (`p` presence, `g` god power, `v` view, `l`/`r` power lost/restored).

## On the board

`deploy/lineage-server@.service` runs the server as a user, in an environment of the
project's Python 3.11 that `deploy/s1-board.sh setup` makes with `uv` (the board's own
Python is Debian's 3.13); `deploy/lineage-s1-kiosk@.service` shows the kiosk on the
screen, and `tools/server_watch.py` samples `/status` from the PC (`deploy/README.md`). The numbers to hold (§4.8):
- sim at most 25 % of one core on average (`/status` `sim_core_share`);
- the daily save at most 2 s (`longest_save_s`);
- sim and server together at most 300 MB (`rss_mb`).

On the PC a full world's save takes about 50 ms, at xz's lightest preset (`io.XZ_PRESET`,
0: as small as the default and a third of its memory; the owner, 2026-10-30).
