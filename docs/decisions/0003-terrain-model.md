# 0003 — Terrain model

- **Status**: accepted
- **Date**: 2026-10-10

## Context

M2 asks for island generation, sea-level cycles, moving uplift/subsidence, erosion,
events and landmass counting, with land fraction inside `[0.25, 0.6]` for 10 years and
regular landmass splits and rejoins. The spec fixes none of the mechanisms.

## Decision

- **Grid 256 × 150, float32, daily tick.** Same aspect as the display at 4 px per cell;
  small enough that a tick costs ~3 ms and a save ~230 KiB on a PC.
- **Wave noise instead of lattice noise.** The first version used value noise; large
  octaves produced straight, axis-aligned coasts (one seed was nearly a rectangle). Sums
  of randomly oriented plane waves are isotropic and pure arithmetic.
- **A drifting continent template instead of a fixed dome.** The first version relaxed
  the land toward a fixed radial dome to bound relief; within a decade every island
  became a round blob with a single landmass, and only 20–40 % of seeds met the
  split/rejoin target. The land now follows a template that mixes three noise fields
  with slowly rotating weights (the rotation rates differ by the golden ratio, so it
  never repeats). The template is a function of time and three stored seeds: no state
  accumulates and nothing can run away. Each tick it is re-shifted to
  `initial_land_fraction`, which is what keeps the land fraction in band.
- **Hotspots on top** for local, rugged mountain building and as sites for volcanoes and
  earthquakes; zero-sum so the mean height of the map does not drift.
- **Erosion as edge fluxes** between neighbouring cells (creep + landslides above a talus
  slope): conservative by construction, and sub-stepped so a long `dt` erodes like many
  short ticks.
- **Landmass labelling in NumPy** (row runs + union-find over runs, ~1 ms) rather than
  adding SciPy for `ndimage.label`.
- **`landmass_min_cells = 100`.** At 16 cells, islets detaching and reattaching produced
  up to 8 split/rejoin events per year; at 100 it is 1–4 per year.
- **Schema v2; subsystems missing from a save are initialised at restore.** Generating an
  island needs the config, which a migration does not have, so `v1_to_v2` only bumps the
  version and `World.restore` initialises any subsystem the save lacks, at the save's sim
  time and from its own stream. This supersedes the line in ADR 0002 that a migration
  creates the new subsystem's state. A save with a subsystem the code does not know is
  still rejected.
- **Leaching balances fertility.** The first M2 report showed mean land fertility rising
  steadily with no plants. A 40-year run confirmed it never settled (0.19 → 0.35) while
  barren ground disappeared (30 % → 9 % of land). Ablations attributed the rise to marine
  sediment (largest), volcanic ash, erosion deposits, and drift exposing richer sea
  floor. Rather than weakening the sources, land now loses fertility toward
  `fertility_min` at 0.04 per year: the mean settles near its initial value and the
  spread between poor and rich ground widens instead of collapsing. Vegetation cover
  slows leaching, giving plants a role in holding soil (M3).
- **Report**: maps are stored per seed as 8-bit height snapshots in `runs/`; the report
  embeds a PNG grid and an animated WebP. Pillow (already installed as a matplotlib
  dependency) is now a declared dependency of `tools`. Per-milestone report code lives in
  the new `tools/milestones/`.

## Consequences

- The world keeps changing shape indefinitely; a quarter of `drift_period_years` turns
  the continent into a different one.
- Golden hashes of M1 changed because the hashed state includes `schema_version`.
- Changing `grid_width`/`grid_height` invalidates saves (restore rejects the mismatch).
- The stationary fertility level is set by `leaching_rate_per_year` against the source
  rates; M3 must re-check it once plants build soil and slow leaching.
