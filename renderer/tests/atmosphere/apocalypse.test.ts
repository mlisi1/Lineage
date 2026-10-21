import { describe, expect, it } from "vitest";
import {
  ACTS,
  APOCALYPSE_S,
  Sequence,
  actAt,
  apocalypseAt,
  endsWorld,
  floodPixels,
  seaLevelAt,
  ventsOf,
} from "../../src/atmosphere/apocalypse";
import type { Message } from "../../src/protocol";
import { mulberry32 } from "../../src/rng";
import type { Land } from "../../src/terrain/land";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { world } from "../spike/worlds";

/** An island rising to a peak in its middle. */
const land: Land = {
  ...world(["~~~~~~~~", "~~gggg~~", "~gggggg~", "~~gggg~~", "~~~~~~~~"], 200, (x, y, water) =>
    water ? 0.3 : 0.42 + 0.04 * (3 - Math.abs(x - 3.5) - Math.abs(y - 2)),
  ),
  ...LAND_PALETTE,
};

const ended: Message = {
  type: "events",
  protocol: 1,
  events: [
    { kind: "fire_ended", t_ms: 1, cells: 3, hours: 2 },
    { kind: "world_ended", t_ms: 2, world: 1, seed: 5, cause: "last_creature" },
    { kind: "world_began", t_ms: 0, world: 2, seed: 9 },
  ],
};
const clock = (t: number): Message => ({
  type: "clock",
  protocol: 1,
  t_ms: t,
  date: "2027-08-04",
  season: "summer",
  season_progress: 0.5,
  day_of_year: 216,
  days_in_year: 365,
});
const news: Message = {
  type: "chronicle",
  protocol: 1,
  notable_importance: 3,
  major_importance: 4,
  entries: [
    { number: 1, t_ms: 0, kind: "world_begin", importance: 4, text: "", species: 0, x: -1, y: -1 },
  ],
};

describe("the end of a world, act by act", () => {
  it("lasts about three minutes in five acts (the owner, 2026-10-20)", () => {
    expect(APOCALYPSE_S).toBe(180);
    expect(ACTS.map((act) => act.name)).toEqual(["omen", "fire", "flood", "dark", "rise"]);
    expect(actAt(0).act).toBe("omen");
    expect(actAt(25).act).toBe("fire");
    expect(actAt(100).act).toBe("flood");
    expect(actAt(125).act).toBe("dark");
    expect(actAt(179).act).toBe("rise");
  });

  it("reddens, burns, floods, goes dark and brings the light back", () => {
    expect(apocalypseAt(0).red).toBe(0);
    expect(apocalypseAt(30).red).toBe(1);
    expect(apocalypseAt(50).vents).toBeGreaterThan(0.5);
    expect(apocalypseAt(30).ash).toBeGreaterThan(0);
    expect(apocalypseAt(90).flood).toBeCloseTo(0.5);
    expect(apocalypseAt(119.9).flood).toBeGreaterThan(0.99);
    expect(apocalypseAt(130).black).toBe(1);
    expect(apocalypseAt(130).flood).toBe(1);
    expect(apocalypseAt(160).recede).toBeCloseTo(0.5);
    expect(apocalypseAt(180).black).toBe(0);
    expect(apocalypseAt(180).recede).toBe(1);
  });

  it("shakes in quakes during the fire, never in the dark", () => {
    const shakes = Array.from({ length: 400 }, (_, i) => apocalypseAt(20 + i * 0.1).shake);
    expect(Math.max(...shakes)).toBeGreaterThan(2);
    expect(shakes.filter((shake) => shake === 0).length).toBeGreaterThan(100);
    for (let t = 120; t <= 180; t += 0.5) expect(apocalypseAt(t).shake).toBe(0);
  });

  it("raises the sea over the land, the peak last, and lowers it over the next", () => {
    expect(seaLevelAt(land, apocalypseAt(10))).toBeNull();
    const top = Math.max(...land.heights);
    const half = seaLevelAt(land, apocalypseAt(90)) ?? 0;
    expect(half).toBeGreaterThan(land.seaLevel);
    expect(half).toBeLessThan(top);
    expect(seaLevelAt(land, apocalypseAt(130))).toBeGreaterThan(top);
    expect(seaLevelAt(land, apocalypseAt(180))).toBeCloseTo(land.seaLevel);
  });

  it("paints the risen sea over the land under it only, foam at its edge", () => {
    const rgba = new Uint8ClampedArray(land.width * land.height * 4);
    const covered = (level: number): number => {
      floodPixels(land, level, rgba);
      let count = 0;
      for (let at = 0; at < land.width * land.height; at++)
        if ((rgba[at * 4 + 3] ?? 0) > 0) count++;
      return count;
    };
    expect(covered(land.seaLevel)).toBe(0);
    const some = covered(0.46);
    expect(some).toBeGreaterThan(0);
    expect(covered(1)).toBe(14); // every cell of land
    expect(covered(0.5)).toBeGreaterThanOrEqual(some);
    // The sea that was already there is left to the ground.
    floodPixels(land, 1, rgba);
    expect(rgba[3]).toBe(0);
  });

  it("opens vents on high land only", () => {
    const vents = ventsOf(land, 5, mulberry32(3));
    expect(vents.length).toBeGreaterThan(0);
    for (const vent of vents) {
      const height = land.heights[Math.floor(vent.y) * land.width + Math.floor(vent.x)] ?? 0;
      expect(height).toBeGreaterThan(land.seaLevel + 0.03);
    }
  });
});

describe("the stream while a world ends", () => {
  it("starts on the end and lets everything else through before it", () => {
    const got: Message[] = [];
    const sequence = new Sequence((message) => got.push(message));
    expect(endsWorld(ended)).toBe(true);
    expect(endsWorld(clock(0))).toBe(false);
    expect(sequence.take(clock(0))).toBe(false);
    expect(sequence.active).toBe(false);
    expect(sequence.take(ended)).toBe(true);
    expect(sequence.active).toBe(true);
    // The end and what came before it in its message go on; the next world's beginning waits.
    expect(got).toHaveLength(1);
    const first = got[0];
    expect(first?.type === "events" && first.events.map((event) => event.kind)).toEqual([
      "fire_ended",
      "world_ended",
    ]);
  });

  it("holds the next world until the dark and its news until the rise", () => {
    const got: Message[] = [];
    const sequence = new Sequence((message) => got.push(message));
    sequence.take(ended);
    got.length = 0;
    sequence.take(clock(1));
    sequence.take(news);
    sequence.update(100);
    expect(got).toHaveLength(0);
    sequence.update(25); // into the dark, not yet black: the next world still waits
    expect(got).toHaveLength(0);
    sequence.update(3); // black (a third of the way into the dark)
    expect(got.map((message) => message.type)).toEqual(["events", "clock"]);
    // In the dark the next world's messages go straight on, its news still waits.
    sequence.take(clock(2));
    sequence.take(news);
    expect(got.map((message) => message.type)).toEqual(["events", "clock", "clock"]);
    sequence.update(17); // into the rise
    expect(got.filter((message) => message.type === "chronicle")).toHaveLength(2);
    sequence.update(60);
    expect(sequence.active).toBe(false);
    expect(sequence.take(clock(3))).toBe(false);
  });

  it("plays on a clock of its own length", () => {
    const sequence = new Sequence(() => undefined, 18);
    sequence.take(ended);
    sequence.update(9);
    expect(sequence.moment.act).toBe(apocalypseAt(90).act);
    sequence.update(9);
    expect(sequence.active).toBe(false);
  });
});
