# Concept

Lineage is an idle desk gadget: a small procedurally generated island where creatures and
plants evolve over **years** of real time. It sits on a work desk, runs 24/7, and writes
its own history.

## Pillars

- **Slow, real time.** One sim second is one wall second on the device. Nothing resets
  except at the end of a world.
- **Life evolves.** Creatures (genome → procedural body, small neural brain, evolution
  plus lifetime learning) and plants (8-gene genome, succession) change over generations.
  Rare genes give an extreme bonus at a real cost.
- **The owner is the sun.** Presence at the desk sets daylight; absences are nights,
  weekends are the Long Night, holidays are dark ages. Seasons follow the real calendar.
- **One rare intervention.** A button triggers a god power with a 7-day cooldown; the
  island draws which, weighted by what it needs (ADR 0016).
- **History is the product.** A chronicle of dated entries and a bestiary of every species
  that ever lived.

## Time model

Sim time is an integer number of **milliseconds** since world creation (`t_ms`), mapped
1:1 to wall time on the device. The world's creation instant (`epoch_unix_ms`) is injected
by the caller and stored in the save; the sim never reads the clock. Time passes through
`World.step(dt)` (seconds, rounded to the millisecond) or `World.advance_to_unix`, which
the server calls about once a wall second to bring the world to now, across a world's end
(S1, `server.md`); real-world inputs arrive as events through `World.apply(event)`. When
the device was off, the server lives the missed time at once on start, the owner away.

Subsystems tick on their own schedules from `sim/config/default.toml` `[schedule]`: a
subsystem with period `p` ticks at sim times `p, 2p, 3p, …`. Everything due inside one
`step` runs in time order (ties: calendar first, then subsystem registration order).
Because tick times are absolute, stepping one day at once or in a thousand pieces gives a
bit-identical world, so fast-forward runs exactly the device's code with large steps.

### Calendar and seasons

The calendar is computed in UTC, so daylight saving time never applies. Each instant
exposes date, weekday/weekend, ISO week, day of year, a smooth `year_fraction` and the
current season with its `season_progress`. Seasons are **astronomical**, starting on
fixed approximate dates (`[calendar]`: spring 03-20, summer 06-21, autumn 09-22, winter
12-21); a hemisphere switch swaps them for the southern hemisphere.

`World.step` returns `DayStarted` at every UTC midnight and `SeasonStarted` when a season
begins.

### Randomness

Every random draw comes from a named stream (`lineage_sim.rng`): an independent PCG64
generator derived from the world seed and a stable digest of the stream name, one per
subsystem. Draws in one stream never shift another; stream states are saved.

### Saves

A save is the world state encoded canonically (sorted JSON header plus NumPy arrays in
`.npy` form) inside an xz stream (xz's lightest preset, as small as the default and
faster) whose CRC detects truncation. The same state always gives
the same bytes, so the SHA-256 of the encoding is the state hash used by determinism
tests. Saves carry `schema_version` and are migrated forward on load
(`state/migrations/`); the sim returns bytes and the caller writes them atomically. On
the device the server saves at each UTC midnight, on shutdown, on power loss and at a
world's end, and keeps the newest save of each of the last 7 days and the oldest of each
month (`server.md`).

## World lifecycle

A world starts from a seed as a new continent. If life collapses, an apocalypse plays, the
world is archived (chronicle, bestiary, phylogeny, final map) and a new continent is
generated with a new seed. Worlds are numbered.

**Collapse** (the owner, 2026-10-20; ADR 0018): once life is established (30 days after
the first creatures land), the death of the last creature ends the world. Before that, a
landing that dies out is followed by new founders, as on a new continent. The ark helps
only while something lives (no strangers come since M11, ADR 0019). At M10's tuning this is rare (2 of 80
three-year runs emptied after first life), so a world lasts decades. The owner settled
it in M11 (ADR 0019): worlds should end rarely, about once a decade, so the island is
not made harsher to end them more often.

**The hand-over** is immediate: the world is archived and the next one begins at the
same instant with a seed drawn by the old one, its own clock from 0 and the calendar
unbroken. The new continent is bare rock; founders land once plants cover it, months
later. The renderer plays the apocalypse over the hand-over (R4).

**Archives** are the final saves of ended worlds, so they hold everything: the
chronicle and bestiary (ADR 0017), the species records (phylogeny), terrain and plant
cover (the final map). They load through the same migrations as any save. The device
keeps all of them (the owner; a few hundred KiB each), and the save of the living world
records each past world in a small ledger (number, seed, dates, cause, species).

## Outputs

- One continuous scene on the 7" desk screen: documentary camera and captions. The
  camera shows the world from three distances: the whole continent as a map, a region,
  and one animal from close to the ground (`renderer.md`). A view button steps between
  them; the map is where it rests (ADR 0020).
- Phone web app with the same renderer, plus chronicle, bestiary and stats.
- Push notifications for major events.
- A daily public journal (static site) that also backs up the save off-device.

## Visual style

Everything drawn is pixel art: flat limited palettes, stepped shading instead of
gradients, hard pixel edges, whole-number scaling. On the desk display an art pixel is
2×2 screen pixels, and a terrain cell is 2, 8 or 32 art pixels across depending on how
close the camera is. The look is "cosy", after Stardew Valley's (ADR 0013 for the
creatures, ADR 0014 for the land): warm saturated colours, shade toward violet and light
toward gold, outlines in each thing's own darkest tone, seen from above. The reference
palette and rules live in `tools/viz/pixelmap.py` (used by the reports) and the renderer
paints the ground by them. Charts in reports are ordinary plots.

## Open

- Collapse criteria for ending a world (M10). (Settled in M10, ADR 0018: the last
  creature's death once life is established.)
- Archive retention policy on the device. (Settled: every archive is kept, ADR 0018; the
  living world's saves as above, ADR 0023.)
