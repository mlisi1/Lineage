import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ClockMessage, LandMessage, Message } from "../src/protocol";
import { Recording, gridNumbers, gridValues, isMessage, landOf, yearOf } from "../src/stream";
import { LAND_PALETTE } from "../src/terrain/palette";

const recording = JSON.parse(
  readFileSync(new URL("../public/stream/recording.json", import.meta.url), "utf-8"),
) as { messages: Message[] };
const lands = recording.messages.filter(
  (message): message is LandMessage => message.type === "land",
);
const clocks = recording.messages.filter(
  (message): message is ClockMessage => message.type === "clock",
);

describe("the stream", () => {
  it("decodes grids of bytes and of little-endian pairs", () => {
    const bytes = {
      encoding: "u8",
      scale: 255,
      data: btoa(String.fromCharCode(0, 51, 255)),
    } as const;
    expect([...gridNumbers(bytes, 3)]).toEqual([0, 51, 255]);
    expect([...gridValues(bytes, 3)].map((value) => value.toFixed(2))).toEqual([
      "0.00",
      "0.20",
      "1.00",
    ]);
    const pairs = {
      encoding: "u16le",
      scale: 65535,
      data: btoa(String.fromCharCode(0xff, 0xff, 1, 0)),
    } as const;
    expect([...gridNumbers(pairs, 2)]).toEqual([65535, 1]);
    expect(() => gridNumbers(bytes, 4)).toThrow(/grid of 3/);
  });

  it("turns a land message into the land the painters draw, in the shared palette", () => {
    const message = lands[0];
    const clock = clocks[0];
    if (message === undefined || clock === undefined) throw new Error("no land in the recording");
    const land = landOf(message, clock);
    const cells = message.width * message.height;
    expect([land.width, land.height]).toEqual([256, 150]);
    for (const grid of [land.heights, land.cover, land.biomass, land.snow, land.plantHeight]) {
      expect(grid?.length).toBe(cells);
    }
    expect(land.palette).toBe(LAND_PALETTE.palette);
    expect(land.season).toBe(clock.season);
    expect(Math.max(...land.heights)).toBeLessThanOrEqual(1);
    // Land and sea where the heights say.
    const water = land.coverClasses.indexOf("WATER");
    let wet = 0;
    land.cover.forEach((cover, cell) => {
      if (cover === water) wet += 1;
      else expect(land.heights[cell]).toBeGreaterThan(land.seaLevel - 1e-4);
    });
    expect(wet).toBeGreaterThan(cells / 10);
    // Plant genes only where something grows.
    land.plantHeight?.forEach((gene, cell) => {
      if ((land.biomass[cell] ?? 0) === 0) expect(gene).toBe(0);
    });
  });

  it("knows where the year is", () => {
    expect(
      yearOf({ ...(clocks[0] as ClockMessage), season: "autumn", season_progress: 0.2 }),
    ).toEqual({
      season: "autumn",
      progress: 0.2,
    });
  });

  it("plays a recording in order and lets unknown things be", () => {
    expect(isMessage({ type: "weather", protocol: 1 })).toBe(true);
    expect(isMessage({ type: "clock", protocol: 2 })).toBe(false);
    expect(isMessage("clock")).toBe(false);
    const played: string[] = [];
    new Recording(recording.messages).listen((message) => played.push(message.type));
    expect(played).toEqual(recording.messages.map((message) => message.type));
    expect(played.filter((type) => type === "land")).toHaveLength(3);
  });
});
