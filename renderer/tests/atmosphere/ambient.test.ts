import { describe, expect, it } from "vitest";
import { Ambient, type AmbientView } from "../../src/atmosphere/ambient";
import { NIGHT_LIGHT, darkness } from "../../src/atmosphere/light";
import type { ViewName } from "../../src/landscape";
import type { ClockMessage } from "../../src/protocol";
import type { Land } from "../../src/terrain/land";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { fakeCanvas } from "../support/canvas";
import { world } from "../spike/worlds";

fakeCanvas();

const rows = (letter: string): string[] => Array.from({ length: 12 }, () => letter.repeat(16));
const landOf = (letter: string, biomass = 200): Land => ({
  ...world(rows(letter), biomass),
  ...LAND_PALETTE,
});
const MEADOW = landOf("g", 220);
const TILE: Readonly<Record<ViewName, number>> = { map: 4, middle: 8, local: 32 };
const DAY = 1;
const NIGHT = NIGHT_LIGHT;

/** A frame of `view` over the whole of `land`. */
const frameOf = (
  view: ViewName,
  light: number,
  land: Land | null = MEADOW,
  extra: Partial<AmbientView> = {},
): AmbientView => ({
  view,
  cells: { x0: 0, y0: 0, x1: 16, y1: 12 },
  tile: TILE[view],
  land,
  light,
  raining: false,
  ending: false,
  ...extra,
});

const clock = (season: ClockMessage["season"]): ClockMessage => ({
  type: "clock",
  protocol: 1,
  t_ms: 0,
  date: "2026-06-01",
  season,
  season_progress: 0.5,
  day_of_year: 150,
  days_in_year: 365,
});

type State = Ambient["state"];
/** Run an ambient for `seconds` in steps of a thirtieth; what it showed at each step. */
function run(ambient: Ambient, frame: AmbientView, seconds: number): State[] {
  const out: State[] = [];
  for (let k = 0; k < seconds * 30; k++) {
    ambient.update(1 / 30, frame);
    out.push(ambient.state);
  }
  return out;
}
const most = (states: readonly State[], key: "fireflies" | "birds" | "butterflies" | "dust") =>
  Math.max(0, ...states.map((state) => state[key]));

it("takes night for night: fireflies' darkness against the day's", () => {
  expect(darkness(NIGHT)).toBeGreaterThan(0.85);
  expect(darkness(DAY)).toBe(0);
});

describe("fireflies", () => {
  it("blink over the grass at night, in the middle and local views", () => {
    for (const view of ["middle", "local"] as const) {
      const states = run(new Ambient(3), frameOf(view, NIGHT), 10);
      expect(most(states, "fireflies"), view).toBeGreaterThan(0);
      expect(most(states, "fireflies")).toBeLessThanOrEqual(view === "middle" ? 12 : 8);
      // They blink: not every one is lit all the time.
      expect(new Set(states.map((state) => state.fireflies)).size).toBeGreaterThan(1);
    }
  });

  it("are not out by day, in rain, on the map, nor over the sea or bare ground", () => {
    expect(most(run(new Ambient(3), frameOf("middle", DAY), 10), "fireflies")).toBe(0);
    const wet = frameOf("middle", NIGHT, MEADOW, { raining: true });
    expect(most(run(new Ambient(3), wet, 10), "fireflies")).toBe(0);
    expect(most(run(new Ambient(3), frameOf("map", NIGHT), 10), "fireflies")).toBe(0);
    for (const letter of ["~", ".", "b"]) {
      const frame = frameOf("middle", NIGHT, landOf(letter));
      expect(most(run(new Ambient(3), frame, 10), "fireflies"), letter).toBe(0);
    }
  });

  it("come dark: none is lit in the first moment it is put somewhere", () => {
    const ambient = new Ambient(3);
    ambient.update(1 / 30, frameOf("middle", NIGHT));
    expect(ambient.state.fireflies).toBe(0);
  });
});

describe("gulls", () => {
  it("cross the middle view by day now and then, a few at a time, and are gone", () => {
    const states = run(new Ambient(5), frameOf("middle", DAY), 240);
    const flying = states.map((state) => state.birds);
    expect(Math.max(...flying)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...flying)).toBeLessThanOrEqual(4);
    // Not always: there are long gaps between flocks.
    expect(flying.filter((birds) => birds === 0).length).toBeGreaterThan(flying.length / 3);
    // More than one flock in four minutes.
    let flocks = 0;
    for (let k = 1; k < flying.length; k++) {
      if ((flying[k] ?? 0) > 0 && flying[k - 1] === 0) flocks += 1;
    }
    expect(flocks).toBeGreaterThanOrEqual(2);
  });

  it("fly in a straight line across the view", () => {
    const states = run(new Ambient(5), frameOf("middle", DAY), 240);
    const path = states.flatMap((state) => (state.flock === null ? [] : [state.flock]));
    expect(path.length).toBeGreaterThan(10);
    for (let k = 2; k < path.length; k++) {
      const [a, b, c] = [path[k - 2], path[k - 1], path[k]];
      if (a === undefined || b === undefined || c === undefined) continue;
      const step = Math.hypot(c.x - b.x, c.y - b.y);
      const before = Math.hypot(b.x - a.x, b.y - a.y);
      // A new flock starts elsewhere; along one flock's way each step is the same.
      if (step > 1 || before > 1) continue;
      expect(step).toBeCloseTo(before, 6);
      // Thirty art pixels a second, in cells of the middle view.
      expect(step).toBeCloseTo(30 / 8 / 30, 6);
    }
  });

  it("do not fly at night, up close, on the map or in the rain", () => {
    expect(most(run(new Ambient(5), frameOf("middle", NIGHT), 240), "birds")).toBe(0);
    expect(most(run(new Ambient(5), frameOf("local", DAY), 240), "birds")).toBe(0);
    expect(most(run(new Ambient(5), frameOf("map", DAY), 240), "birds")).toBe(0);
    const wet = frameOf("middle", DAY, MEADOW, { raining: true });
    expect(most(run(new Ambient(5), wet, 240), "birds")).toBe(0);
  });
});

describe("butterflies", () => {
  it("flit over a meadow up close by day in spring and summer, three at most", () => {
    for (const season of ["spring", "summer"] as const) {
      const ambient = new Ambient(7);
      ambient.receive(clock(season));
      const states = run(ambient, frameOf("local", DAY), 5);
      expect(most(states, "butterflies"), season).toBeGreaterThan(0);
      expect(most(states, "butterflies")).toBeLessThanOrEqual(3);
    }
  });

  it("are not out in autumn or winter, at night, in the middle view, or over thin grass", () => {
    for (const season of ["autumn", "winter"] as const) {
      const ambient = new Ambient(7);
      ambient.receive(clock(season));
      expect(most(run(ambient, frameOf("local", DAY), 5), "butterflies"), season).toBe(0);
    }
    expect(most(run(new Ambient(7), frameOf("local", NIGHT), 5), "butterflies")).toBe(0);
    expect(most(run(new Ambient(7), frameOf("middle", DAY), 5), "butterflies")).toBe(0);
    const thin = frameOf("local", DAY, landOf("g", 100));
    expect(most(run(new Ambient(7), thin, 5), "butterflies")).toBe(0);
  });
});

describe("dust behind running animals", () => {
  it("puffs up now and then where a foot comes down, and settles in half a second", () => {
    const ambient = new Ambient(11);
    const frame = frameOf("middle", DAY);
    ambient.update(1 / 30, frame);
    for (let k = 0; k < 10; k++) ambient.dust(4 + k * 0.1, 5);
    const puffs = ambient.state.dust;
    // About half the footfalls raise a puff.
    expect(puffs).toBeGreaterThan(0);
    expect(puffs).toBeLessThan(10);
    run(ambient, frame, 0.6);
    expect(ambient.state.dust).toBe(0);
  });

  it("keeps no more than twenty puffs at once", () => {
    const ambient = new Ambient(11);
    ambient.update(1 / 30, frameOf("local", DAY));
    for (let k = 0; k < 200; k++) ambient.dust(4, 5);
    expect(ambient.state.dust).toBeLessThanOrEqual(20);
    expect(ambient.state.dust).toBeGreaterThan(10);
  });

  it("raises no dust in rain or while a world ends", () => {
    for (const extra of [{ raining: true }, { ending: true }]) {
      const ambient = new Ambient(11);
      ambient.update(1 / 30, frameOf("local", DAY, MEADOW, extra));
      for (let k = 0; k < 50; k++) ambient.dust(4, 5);
      expect(ambient.state.dust).toBe(0);
    }
  });

  it("raises none on the map", () => {
    const ambient = new Ambient(11);
    ambient.update(1 / 30, frameOf("map", DAY));
    for (let k = 0; k < 50; k++) ambient.dust(4, 5);
    expect(ambient.state.dust).toBe(0);
  });
});

describe("small life as a whole", () => {
  it("is the same for the same seed, and none while a world ends or before a land", () => {
    const a = run(new Ambient(13), frameOf("middle", NIGHT), 5);
    const b = run(new Ambient(13), frameOf("middle", NIGHT), 5);
    expect(a).toEqual(b);
    const ending = frameOf("middle", NIGHT, MEADOW, { ending: true });
    expect(most(run(new Ambient(13), ending, 5), "fireflies")).toBe(0);
    expect(most(run(new Ambient(13), frameOf("middle", NIGHT, null), 5), "fireflies")).toBe(0);
  });

  it("clears what was in sight when the view changes", () => {
    const ambient = new Ambient(13);
    run(ambient, frameOf("middle", DAY), 240);
    for (let k = 0; k < 10; k++) ambient.dust(4, 5);
    ambient.update(1 / 30, frameOf("local", DAY));
    expect(ambient.state.birds).toBe(0);
    expect(ambient.state.dust).toBe(0);
  });
});
