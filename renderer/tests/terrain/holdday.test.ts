import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Landscape } from "../../src/landscape";
import type { ClockMessage, LandMessage } from "../../src/protocol";
import { InlinePainter } from "../../src/terrain/painter";
import { fakeCanvas } from "../support/canvas";

fakeCanvas();

const messages = (
  JSON.parse(readFileSync("public/stream/life.json", "utf8")) as { messages: { type: string }[] }
).messages;
const land = messages.find((m) => m.type === "land") as unknown as LandMessage;
const clock = messages.find((m) => m.type === "clock") as unknown as ClockMessage;
const dayAfter = (day: number): ClockMessage => ({ ...clock, day_of_year: day });

/** A landscape on the map with the recording's first land laid out. */
function laidOut(): Landscape {
  const landscape = new Landscape(new InlinePainter());
  landscape.show("map", { x0: 0, y0: 0, x1: land.width, y1: land.height });
  landscape.receive(land);
  landscape.receive(clock);
  landscape.update(0);
  return landscape;
}

describe("the day held (the benchmark, R5)", () => {
  it("keeps the land and day drawn while held, and lays out what came once let go", () => {
    const landscape = laidOut();
    expect(landscape.dayDue).toBe(false);
    const drawn = landscape.current;
    expect(drawn).not.toBeNull();

    landscape.holdDay = true;
    landscape.receive(dayAfter(clock.day_of_year + 1));
    landscape.receive({ ...land });
    landscape.update(1 / 30);
    // Due, but not laid out: the same land is drawn, never none.
    expect(landscape.dayDue).toBe(true);
    expect(landscape.current).toBe(drawn);

    landscape.holdDay = false;
    landscape.update(1 / 30);
    expect(landscape.dayDue).toBe(false);
    expect(landscape.current).not.toBe(drawn);
  });

  it("says frames are on time only after a few seconds without a late one", () => {
    const landscape = laidOut();
    expect(landscape.framesOnTime).toBe(true);
    landscape.update(0.06);
    expect(landscape.framesOnTime).toBe(false);
    for (let k = 0; k < 30; k++) landscape.update(1 / 30);
    expect(landscape.framesOnTime).toBe(false);
    for (let k = 0; k < 70; k++) landscape.update(1 / 30);
    expect(landscape.framesOnTime).toBe(true);
  });
});
