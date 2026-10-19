/**
 * The palette of the land: the report maps' own (`tools/viz/pixelmap.py`), from the copy
 * that writes for the renderer (`palette.json`, `uv run python -m tools.viz.pixelmap`;
 * a test there keeps it current). The state stream does not carry it.
 */
import written from "./palette.json";
import type { LandPalette, Ramp } from "./land";

const ramp = (tones: readonly string[]): Ramp => [tones[0] ?? "", tones[1] ?? "", tones[2] ?? ""];

export const LAND_PALETTE: LandPalette = {
  palette: Object.fromEntries(
    Object.entries(written.palette).map(([name, tones]) => [name, ramp(tones)]),
  ),
  relief: {
    seaBands: written.relief.seaBands,
    slope: written.relief.slope,
    highRockFrom: written.relief.highRockFrom,
    highRock: ramp(written.relief.highRock),
    snowFrom: written.relief.snowFrom,
    snow: ramp(written.relief.snow),
    shoreOutline: written.relief.shoreOutline,
  },
};

/** Low plants below this biomass (0–1) look dried, if their class is among these. */
export const DORMANT_BELOW = written.dormantBelow;
export const DORMANT_CLASSES: readonly string[] = written.dormantClasses;
