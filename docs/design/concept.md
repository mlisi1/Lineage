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
by the caller and stored in the save; the sim never reads the clock. The server injects
elapsed time through `World.step(dt)` (seconds, rounded to the millisecond) and real-world
inputs as events through `World.apply(event)`.

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
`.npy` form) inside an xz stream whose CRC detects truncation. The same state always gives
the same bytes, so the SHA-256 of the encoding is the state hash used by determinism
tests. Saves carry `schema_version` and are migrated forward on load
(`state/migrations/`); the sim returns bytes and the caller writes them atomically.

## World lifecycle

A world starts from a seed as a new continent. If life collapses, an apocalypse plays, the
world is archived (chronicle, bestiary, phylogeny, final map) and a new continent is
generated with a new seed. Worlds are numbered.

As of M9 a world never ends: when the last creature dies, new founders land once plants
cover the island again (in spring or summer), strangers arrive a few times a year and
the ark god power brings more. What counts as a collapse, and whether re-founding stops
then, is M10's first decision. Everything an archive needs is in the world's save: its
chronicle and bestiary (ADR 0017), its species records, its terrain and plant cover.

## Outputs

- One continuous scene on the 7" desk screen: documentary camera and captions. The
  camera shows the world from three distances: the whole continent as a map, a region,
  and one animal from close to the ground (`renderer.md`).
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

- Collapse criteria for ending a world (M10).
- Archive retention policy on the device.
