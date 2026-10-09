# Terrain

Height and fertility grids describe the island. Everything changes slowly and never
resets except at the end of a world.

## Mechanisms (M2)

- **Generation**: noise plus a radial falloff produces an island; a fertility layer is
  derived alongside height.
- **Sea level**: a slow cycle raises and lowers the waterline, splitting and rejoining
  landmasses.
- **Plate drift**: moving uplift and subsidence zones.
- **Erosion**: moves material downhill; vegetation cover slows it (hook used by flora).
- **Events**: volcano (new land), earthquake, crater.
- **Landmass counting**: connected land components, used by the chronicle for
  splits and rejoins.

## Invariants

Heights stay in `[0, 1]`; no NaN; erosion roughly conserves mass.

## Targets (M2 report, 20 seeds × 10 sim-years)

- Land fraction stays in `[0.25, 0.6]`.
- At least one split/rejoin per 3 years in `[≥ 50%]` of seeds.
- No seed loses all land; terrain step within budget.

## Open

- Grid resolution and its relation to the 1024×600 display.
- Event rates and magnitudes (config, tuned by the M2 report).
