# 0004 — Flora model and pixel-art visuals

- **Status**: accepted
- **Date**: 2026-10-10

## Context

M3 asks for a vegetation grid with an 8-gene genome, succession, soil building, fire and
rare genes, and sets timing targets from bare rock (grass on half the land in 3–9
months, closed forest in 12–24, at least 4 forms coexisting at year 3). During the
milestone the owner also asked for a pixel-art look across the project.

## Decision

- **One population per cell**, genome stored as bytes (8 × 256 × 150), biomass as
  float32. A full save is ~400 KiB and ~90 ms on a PC.
- **Seed rain starts and sustains the world.** Seeds with random genomes arrive from
  outside; the environment filters them. Evolution alone from one pioneer could not meet
  the timing targets and could not recover a lost form.
- **Fertility is shared with the terrain** (`Terrain.adjust_fertility`): plants build it
  toward a cap that grows with stature, leaching and fire remove it. One field, one
  mental model.
- **Fire is its own subsystem on an hourly schedule**, so a fire burns visibly for hours
  to days on the desk while growth stays on a cheap daily tick.
- **Viability-weighted establishment.** A first version let any suitable seed win a
  cell; tall plants then kept taking exposed ground and dying there, leaving it bare.
  Seeds now establish in proportion to the biomass the plant would reach at the site.
- **A margin protects residents.** Without it equals kept replacing each other (1.5 % of
  cells per day), each time resetting biomass.
- **Wind exposure on shore and summits** is what keeps grass and lichen in every world.
  Altitude alone was not enough: some worlds have only 2 % of their land high enough for
  an alpine belt, but every world has a coast.
- **Winter dieback stops at a root reserve**; without it grass had to recolonise from
  seed every spring.
- **Rare genes**: three in M3 to prove the mechanism; M7 owns the full table.
- **Schema v3**; like v2, the migration only bumps the version and restore initialises
  the new subsystems (a v2 world wakes up bare and is colonised).
- **Pixel art**: maps and animations are drawn by `tools/viz/pixelmap.py` with flat
  three-tone ramps per land-cover class, banded sea depth, stepped relief, a one-pixel
  shore outline, whole-number upscaling and lossless encoding; the report shows them
  with `image-rendering: pixelated`. Charts stay ordinary plots. The renderer (R tracks)
  follows the same palette and rules.

## Consequences

- Golden hashes of M1 and M2 changed with the schema version; the terrain golden also
  because plants now protect the ground.
- The M2 report is regenerated with the current world (plants included) so its maps use
  the pixel-art style; its criteria are about the ground and still hold.
- Mean land fertility now rises under vegetation toward the soil caps (~0.5 after five
  years) instead of settling near 0.22 as on bare ground. It is bounded by the caps.
- Without grazers, sheltered lowland ends up as forest. M4 herbivores are expected to
  open it up; the grazing hook is in place.
