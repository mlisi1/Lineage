import { describe, expect, it } from "vitest";
import { Atmosphere } from "../../src/atmosphere/atmosphere";
import { windStrength } from "../../src/plants/wind";
import type { SkyMessage } from "../../src/protocol";
import { mulberry32 } from "../../src/rng";
import { fakeCanvas } from "../support/canvas";

fakeCanvas();

const sky = (rain: SkyMessage["rain"], light = 1): SkyMessage => ({
  type: "sky",
  protocol: 1,
  t_ms: 3_600_000,
  light,
  present: light > 0.5,
  rain,
  burning: [],
});
/** An atmosphere settled at once into `rain`. */
function under(rain: SkyMessage["rain"]): Atmosphere {
  const atmosphere = new Atmosphere(() => undefined, { random: mulberry32(1) });
  atmosphere.receive(sky(rain));
  atmosphere.settleLight();
  return atmosphere;
}

describe("the sky's cloud and wind for the plants and animals (R5)", () => {
  it("is clear and calm before any weather comes", () => {
    const atmosphere = new Atmosphere(() => undefined, { random: mulberry32(1) });
    expect(atmosphere.overcastNow).toBe(0);
    expect(atmosphere.wind).toEqual({ timeS: 0, strength: windStrength(0, 0, 0) });
  });

  it("is overcast under cloud and rain, most in a thunderstorm", () => {
    expect(under("none").overcastNow).toBe(0);
    const cloud = under("cloud").overcastNow;
    const rain = under("rain").overcastNow;
    const storm = under("storm").overcastNow;
    expect(cloud).toBeGreaterThan(0);
    expect(rain).toBeGreaterThan(cloud);
    expect(storm).toBe(1);
  });

  it("blows harder in rain than under cloud, hardest in a thunderstorm", () => {
    const calm = under("none").wind.strength;
    const cloud = under("cloud").wind.strength;
    const rain = under("rain").wind.strength;
    const storm = under("storm").wind.strength;
    // Cloud alone brings no wind.
    expect(cloud).toBe(calm);
    expect(rain).toBeGreaterThan(calm);
    expect(storm).toBeGreaterThan(rain);
  });
});
