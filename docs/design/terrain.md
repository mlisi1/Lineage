# Terrain

Height and fertility grids describe the island. Everything changes slowly and never
resets except at the end of a world. Implemented in `lineage_sim/terrain.py` (M2); every
number below is a `[terrain]` key in `sim/config/default.toml`.

## Grid and units

- 256 × 150 cells, `float32`, indexed `[y, x]`; one cell is 4 px on the 1024×600 display.
- Heights are dimensionless in `[0, 1]`; mean sea level is `sea_base` (0.42).
- Fertility is the mineral richness of the ground in `[0, 1]`. Plants build soil on top
  of it in M3.
- Terrain ticks once per sim-day (`[schedule] terrain`).

## Generation

The island is fractal noise minus a radial falloff, shifted so `initial_land_fraction`
(0.42) of the cells lie above mean sea level; a deep band along the border guarantees open
water all around.

The noise is a sum of randomly oriented plane waves rather than a lattice noise, so
coasts never follow the grid. It has two parts: a large-scale **continent shape** (2
octaves from an 80-cell wavelength) and fine **detail** (3 octaves) blended on top.

Initial fertility is low (0.05–0.45), patchy, and richer in the lowlands.

## What happens each day

1. **Hotspots** — six moving hotspots, alternately lifting and sinking the ground around
   them. They drift at up to 10 cells/year, die after 2–6 years and reappear elsewhere.
   Their uplift is rugged (modulated by a fixed roughness field) and zero-sum, and fades
   to nothing at the map border.
2. **Plate drift** — the continent shape is a mix of three noise fields whose weights
   rotate slowly (`drift_period_years`, 30) and never repeat. The large-scale shape of
   the land (heights blurred over ~8 cells) follows this drifting template with a
   3-year time constant; small-scale detail is untouched. This is what turns one
   archipelago into a different one over a decade, and it bounds relief forever.
3. **Events** (rates per year): volcano 0.4 (a cone over a lifting hotspot; lava
   sterilises the centre, ash enriches the flanks), earthquake 1.0 (a fault slips near a
   hotspot: one side up, the other down), crater 0.08 (a bowl with a rim anywhere; the
   meteor god power of M8 will reuse it).
4. **Erosion** — neighbouring cells exchange material: slow creep plus landslides on
   slopes steeper than `talus_slope`. Mass is conserved. Vegetation cover (supplied by
   flora through `Terrain.set_vegetation_cover`) suppresses up to 80 % of it. Deposits
   gain fertility, stripped slopes lose it.
5. **Sea level** — `sea_base` plus two cycles (1.7 and 6.5 years; amplitudes 0.03 and
   0.02) with phases drawn per world. Submerged ground slowly gains fertility, so land
   that emerges from the sea is richer than old rock.
6. **Landmasses** — 4-connected land areas are labelled. Areas of at least
   `landmass_min_cells` (100) count as landmasses; when one becomes several, or several
   become one, the world emits `LandmassSplit` / `LandmassesRejoined`.

Output events: `VolcanoErupted`, `EarthquakeStruck`, `CraterFormed`, `LandmassSplit`,
`LandmassesRejoined`.

## Invariants (tested)

Heights stay in `[0, 1]`; no NaN; erosion conserves mass; the map border is always sea;
the result does not depend on how `step(dt)` is chunked.

## Measured behaviour (M2 report, 20 seeds × 10 sim-years)

See `reports/M2-terrain/`. Targets from CLAUDE.md §8:

- Land fraction stays in `[0.25, 0.6]`.
- At least one split/rejoin per 3 years in `[≥ 50%]` of seeds.
- No seed loses all land; terrain step within budget.

## Open

- Mean fertility of bare land rises by about a third over a decade because emerged sea
  floor is fertile. Revisit with M3 if succession turns out too easy.
- Whether hotspot and event sites should be shown to the owner (camera interest, R3).
