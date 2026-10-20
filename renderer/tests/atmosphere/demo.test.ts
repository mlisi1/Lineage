import { describe, expect, it } from "vitest";
import {
  demoMessages,
  fireReach,
  landNear,
  showsOf,
  withBurnt,
  withCone,
  withCrater,
  withSprouts,
} from "../../src/atmosphere/demo";
import type { CreaturesMessage, LandMessage } from "../../src/protocol";
import { gridNumbers, landOf } from "../../src/stream";
import type { Land } from "../../src/terrain/land";

const WIDTH = 20;
const HEIGHT = 14;
const CLASSES = ["WATER", "BARE", "LICHEN", "GRASS", "SHRUB", "BROADLEAF", "CONIFER", "BURNT"];

function grid(numbers: number[], encoding: "u8" | "u16le", scale: number) {
  const bytes =
    encoding === "u8"
      ? Uint8Array.from(numbers)
      : Uint8Array.from(numbers.flatMap((n) => [n & 255, n >> 8]));
  return { encoding, scale, data: btoa(String.fromCharCode(...bytes)) };
}

/** An island of grass in the sea, with a bare patch in its west. */
function landMessage(): LandMessage {
  const cells = WIDTH * HEIGHT;
  const land = (i: number): boolean => {
    const x = i % WIDTH;
    const y = Math.floor(i / WIDTH);
    return x > 1 && x < WIDTH - 2 && y > 1 && y < HEIGHT - 2;
  };
  const bare = (i: number): boolean => land(i) && i % WIDTH < 6;
  const heights = Array.from({ length: cells }, (_, i) =>
    Math.round((land(i) ? 0.5 : 0.3) * 65535),
  );
  return {
    type: "land",
    protocol: 1,
    t_ms: 0,
    world: { seed: 1 },
    width: WIDTH,
    height: HEIGHT,
    sea_level: 0.42,
    cover_classes: CLASSES,
    heights: grid(heights, "u16le", 65535),
    cover: grid(
      Array.from({ length: cells }, (_, i) => (!land(i) ? 0 : bare(i) ? 1 : 3)),
      "u8",
      1,
    ),
    biomass: grid(
      Array.from({ length: cells }, (_, i) => (land(i) && !bare(i) ? 180 : 0)),
      "u8",
      255,
    ),
    snow: grid(new Array(cells).fill(0), "u8", 255),
    plant_height: grid(new Array(cells).fill(60), "u8", 255),
    plant_evergreen: grid(new Array(cells).fill(60), "u8", 255),
    plant_rare: grid(new Array(cells).fill(0), "u8", 1),
    rare_genes: [],
  };
}

const message = landMessage();
const land: Land = landOf(message, null);
const cells = WIDTH * HEIGHT;
const centre = (7 + 0.5) * 1;
const at = (x: number, y: number): number => y * WIDTH + x;

describe("the atmosphere on demand", () => {
  it("reads the shows asked for, and nothing else", () => {
    expect(showsOf("night, fire,bogus,meteor,thunder")).toEqual([
      "night",
      "fire",
      "meteor",
      "thunder",
    ]);
    expect(showsOf(null)).toEqual([]);
  });

  it("finds land, and bare land, near where it is asked", () => {
    expect(landNear(land, 0, 0)).toEqual({ x: 2.5, y: 2.5 });
    expect(landNear(land, 15, 7, true).x).toBeLessThan(6);
  });

  it("makes a sky with the light and rain asked for, and the events", () => {
    const world = { land, landMessage: message, creatures: null };
    const out = demoMessages(["night", "fire", "meteor", "end"], world, 10, 7, 99);
    const sky = out[0]?.message;
    expect(sky?.type).toBe("sky");
    if (sky?.type !== "sky") return;
    expect(sky.light).toBe(0.05);
    expect(sky.present).toBe(false);
    // A fire comes with the thunderstorm whose lightning set it.
    expect(sky.rain).toBe("storm");
    expect(sky.burning.length).toBeGreaterThan(0);
    expect(sky.burning).toEqual([...sky.burning].sort((a, b) => a - b));
    const events = out[1]?.message;
    expect(events?.type === "events" && events.events.map((event) => event.kind)).toEqual([
      "fire_started",
      "god_power",
      "crater",
      "world_ended",
    ]);
    // The meteor's bowl comes as it strikes.
    expect(out.some(({ afterS, message: m }) => m.type === "land" && afterS > 1)).toBe(true);
    expect(demoMessages(["day"], world, 3, 2, 0)).toHaveLength(1);
    const soaking = demoMessages(["soaking"], world, 3, 2, 0)[0]?.message;
    expect(soaking?.type === "sky" && soaking.rain).toBe("soaking");
  });

  it("raises a volcano's cone and bares its middle", () => {
    const after = landOf(withCone(message, 10.5, 7.5), null);
    expect(after.heights[at(10, 7)] ?? 0).toBeGreaterThan((land.heights[at(10, 7)] ?? 0) + 0.08);
    expect(after.heights[at(10, 7)] ?? 0).toBeGreaterThan(after.heights[at(13, 7)] ?? 0);
    expect(after.biomass[at(10, 7)]).toBe(0);
    // Far off, nothing changed.
    expect(after.heights[at(2, 2)]).toBe(land.heights[at(2, 2)]);
  });

  it("digs a meteor's bowl and clears it", () => {
    const after = landOf(withCrater(message, 12.5, 7.5), null);
    expect(after.heights[at(12, 7)] ?? 1).toBeLessThan(land.heights[at(12, 7)] ?? 0);
    expect(after.biomass[at(12, 7)]).toBe(0);
  });

  it("burns where plants carry the fire, and nowhere else", () => {
    const after = landOf(withBurnt(message, 12.5, 7.5, land), null);
    expect(after.coverClasses[after.cover[at(12, 7)] ?? 0]).toBe("BURNT");
    expect(after.scorch?.[at(12, 7)] ?? 0).toBeGreaterThan(200);
    let burnt = 0;
    for (let i = 0; i < cells; i++) {
      if (after.coverClasses[after.cover[i] ?? 0] !== "BURNT") continue;
      burnt += 1;
      // Only grass burnt: never the bare patch, never the sea.
      expect(land.biomass[i] ?? 0).toBeGreaterThan(38);
    }
    expect(burnt).toBeGreaterThan(30);
  });

  it("spreads a fire from cell to neighbouring cell", () => {
    const reach = fireReach(land, 12.5, 7.5, 24);
    expect(reach).toHaveLength(24);
    const set = new Set(reach);
    for (const cell of reach) {
      if (cell === at(12, 7)) continue;
      const near = [cell - 1, cell + 1, cell - WIDTH, cell + WIDTH].some((n) => set.has(n));
      expect(near).toBe(true);
    }
    expect(fireReach(land, 3.5, 7.5, 24)).toEqual([at(3, 7)]);
  });

  it("sprouts seeds on bare land only", () => {
    const after = landOf(withSprouts(message, 4.5, 7.5, land), null);
    let sprouted = 0;
    for (let i = 0; i < cells; i++) {
      if ((land.biomass[i] ?? 0) > 10) expect(after.biomass[i]).toBe(land.biomass[i]);
      else if ((after.biomass[i] ?? 0) > 0) sprouted += 1;
    }
    expect(sprouted).toBeGreaterThan(0);
  });

  it("lands the ark's newcomers beside those already there", () => {
    const before: CreaturesMessage = {
      type: "creatures",
      protocol: 1,
      t_ms: 0,
      ids: [5],
      positions: [[8, 8]],
      species: [2],
      born: [],
    };
    const out = demoMessages(["ark"], { land, landMessage: message, creatures: before }, 12, 7, 0);
    const landed = out.find(({ message: m }) => m.type === "creatures");
    expect(landed?.afterS).toBeGreaterThan(0);
    const creatures = landed?.message;
    if (creatures?.type !== "creatures") throw new Error("no newcomers");
    expect(creatures.ids[0]).toBe(5);
    expect(creatures.ids.length).toBe(1 + 6);
    expect(creatures.born.map((b) => b.id)).toEqual(creatures.ids.slice(1));
    expect(gridNumbers(message.heights, cells).length).toBe(cells);
    expect(centre).toBeGreaterThan(0);
  });
});
