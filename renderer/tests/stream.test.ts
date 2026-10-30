import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { ClockMessage, LandMessage, Message } from "../src/protocol";
import {
  RECONNECT_FIRST_MS,
  RECONNECT_LAST_MS,
  Recording,
  SocketSource,
  type SocketLike,
  gridNumbers,
  gridValues,
  isMessage,
  landOf,
  yearOf,
} from "../src/stream";
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

  it("plays at a speed by the sim's time, the untimed straight after the timed", () => {
    vi.useFakeTimers();
    try {
      const clock = (t_ms: number): Message => ({ ...(clocks[0] as ClockMessage), t_ms });
      // A message without a time of its own, as the fauna, species, rare and chronicle are.
      const species: Message = { type: "species", protocol: 1, species: [] };
      // 0 s, then the species, then 60 sim-seconds on, then 120: at 60 sim-s a wall second.
      const messages = [clock(1_000), species, clock(61_000), clock(121_000)];
      const played: number[] = [];
      new Recording(messages, 0, 60).listen((message) =>
        played.push(message.type === "clock" ? message.t_ms : -1),
      );
      expect(played).toEqual([1_000, -1]);
      vi.advanceTimersByTime(999);
      expect(played).toEqual([1_000, -1]);
      vi.advanceTimersByTime(1);
      expect(played).toEqual([1_000, -1, 61_000]);
      vi.advanceTimersByTime(1_000);
      expect(played).toEqual([1_000, -1, 61_000, 121_000]);
    } finally {
      vi.useRealTimers();
    }
  });
});

/** A WebSocket stand-in: the test opens, sends on and closes it. */
class FakeSocket implements SocketLike {
  private readonly listeners = new Map<string, ((event: { data: unknown }) => void)[]>();
  closed = false;

  addEventListener(type: string, listener: (event: { data: unknown }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  emit(type: string, data: unknown = undefined): void {
    for (const listener of this.listeners.get(type) ?? []) listener({ data });
  }

  close(): void {
    this.closed = true;
  }
}

describe("the server's socket", () => {
  const view = JSON.stringify({ type: "view", protocol: 1 });

  it("hands over the server's messages and tries again, longer each time, when it drops", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const source = new SocketSource("ws://desk/stream", () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    const got: string[] = [];
    source.listen((message) => got.push(message.type));
    sockets[0]?.emit("open");
    sockets[0]?.emit("message", view);
    sockets[0]?.emit("message", JSON.stringify({ type: "view", protocol: 2 }));
    expect(got).toEqual(["view"]);
    // The server is gone: a try after the first wait, the next after twice as long.
    sockets[0]?.emit("close");
    vi.advanceTimersByTime(RECONNECT_FIRST_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);
    sockets[1]?.emit("close");
    vi.advanceTimersByTime(2 * RECONNECT_FIRST_MS - 1);
    expect(sockets).toHaveLength(2);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(3);
    // Connected again: messages flow, and the wait starts from the first again.
    sockets[2]?.emit("open");
    sockets[2]?.emit("message", view);
    expect(got).toEqual(["view", "view"]);
    sockets[2]?.emit("close");
    vi.advanceTimersByTime(RECONNECT_FIRST_MS);
    expect(sockets).toHaveLength(4);
    vi.useRealTimers();
  });

  it("waits no longer than the last wait, and stops trying once closed", () => {
    vi.useFakeTimers();
    const sockets: FakeSocket[] = [];
    const source = new SocketSource("ws://desk/stream", () => {
      const socket = new FakeSocket();
      sockets.push(socket);
      return socket;
    });
    for (let tries = 0; tries < 10; tries++) {
      sockets.at(-1)?.emit("close");
      vi.advanceTimersByTime(RECONNECT_LAST_MS);
    }
    expect(sockets).toHaveLength(11);
    source.close();
    expect(sockets.at(-1)?.closed).toBe(true);
    sockets.at(-1)?.emit("close");
    vi.advanceTimersByTime(10 * RECONNECT_LAST_MS);
    expect(sockets).toHaveLength(11);
    vi.useRealTimers();
  });
});
