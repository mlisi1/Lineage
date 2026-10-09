# Plants

Vegetation lives on a grid over the terrain. Each occupied cell carries a plant genome.

## Mechanisms (M3)

- **Genome**: 8 genes (named constants, never bare indices), plus rare plant genes (M7).
- **Growth and suitability**: from fertility, water, light (presence-driven daylight) and
  season.
- **Dispersal**: wind and fruit.
- **Succession**: bare → grass → shrub → forest, driven by shading.
- **Soil building**: vegetation raises fertility over time.
- **Disturbance**: fire (spread, fire-pine survival), grazing (hook for fauna), winter
  dieback, flooding kills cells.
- **Erosion feedback**: cover reduces erosion.

## Targets (M3 report, 20 seeds × 5 sim-years from bare rock)

- Grass covers ≥ 50% of land within `[3–9 sim-months]`.
- First closed forest within `[12–24 sim-months]`.
- ≥ 4 distinct plant forms coexist at year 3 in ≥ 80% of seeds.
- No seed ends at 100% one class.

## Open

- The 8 gene names and ranges.
- Plant form classification thresholds.
