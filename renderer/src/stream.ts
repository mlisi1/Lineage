/**
 * The state stream, as the renderer takes it: messages (`protocol.ts`, generated from the
 * server's schema) decoded into what the painters and plant layers draw from.
 *
 * A source hands messages over one at a time: the server's WebSocket (S1), or a
 * recording written by `tools/stream.py` that is played back without a server.
 */
import type { YearTime } from "./plants/turning";
import type { ClockMessage, Grid, LandMessage, Message } from "./protocol";
import type { Land } from "./terrain/land";
import { DORMANT_BELOW, DORMANT_CLASSES, LAND_PALETTE } from "./terrain/palette";

/** Decode base64 into bytes (browsers and Node both provide `atob`). */
export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** A grid's whole numbers, one per cell: bytes for u8, little-endian pairs for u16le. */
export function gridNumbers(grid: Grid, cells: number): Uint8Array | Uint16Array {
  const bytes = decodeBase64(grid.data);
  if (grid.encoding === "u8") {
    if (bytes.length !== cells) throw new Error(`stream: a grid of ${bytes.length}, not ${cells}`);
    return bytes;
  }
  if (bytes.length !== 2 * cells)
    throw new Error(`stream: a grid of ${bytes.length / 2}, not ${cells}`);
  const numbers = new Uint16Array(cells);
  for (let i = 0; i < cells; i++) numbers[i] = (bytes[2 * i] ?? 0) | ((bytes[2 * i + 1] ?? 0) << 8);
  return numbers;
}

/** A grid's values (numbers over its scale), one per cell. */
export function gridValues(grid: Grid, cells: number): Float32Array {
  const numbers = gridNumbers(grid, cells);
  const values = new Float32Array(cells);
  for (let i = 0; i < cells; i++) values[i] = (numbers[i] ?? 0) / grid.scale;
  return values;
}

/** A grid of shares (0–1) as bytes 0–255, whatever its scale. */
function asBytes(grid: Grid, cells: number): Uint8Array {
  if (grid.encoding === "u8" && grid.scale === 255) return gridNumbers(grid, cells) as Uint8Array;
  const values = gridValues(grid, cells);
  return Uint8Array.from(values, (value) => Math.round(Math.min(Math.max(value, 0), 1) * 255));
}

/** Where the world is in its year, from the clock. */
export function yearOf(clock: ClockMessage): YearTime {
  return { season: clock.season, progress: clock.season_progress };
}

/** The land of a `land` message, in the report maps' palette, in the season of `clock`. */
export function landOf(message: LandMessage, clock: ClockMessage | null): Land {
  const cells = message.width * message.height;
  const cover = gridNumbers(message.cover, cells);
  return {
    ...LAND_PALETTE,
    width: message.width,
    height: message.height,
    heights: gridValues(message.heights, cells),
    seaLevel: message.sea_level,
    cover: cover instanceof Uint8Array ? cover : Uint8Array.from(cover),
    biomass: asBytes(message.biomass, cells),
    coverClasses: message.cover_classes,
    dormantBelow: Math.round(DORMANT_BELOW * 255),
    dormantClasses: DORMANT_CLASSES,
    season: clock?.season ?? "summer",
    plantHeight: asBytes(message.plant_height, cells),
    plantEvergreen: asBytes(message.plant_evergreen, cells),
    snow: asBytes(message.snow, cells),
    plantRare: Uint8Array.from(gridNumbers(message.plant_rare, cells)),
    rareGenes: message.rare_genes,
  };
}

/** Something that hands over the stream's messages as they come. */
export interface Source {
  /** Called with each message, in order. */
  listen(handler: (message: Message) => void): void;
  close(): void;
}

/** Messages of the types this renderer knows; the rest are let through to be ignored. */
export function isMessage(value: unknown): value is Message {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { protocol?: unknown }).protocol === 1 &&
    typeof (value as { type?: unknown }).type === "string"
  );
}

/** The server's stream, over a WebSocket at `url`. */
export class SocketSource implements Source {
  private readonly socket: WebSocket;
  private handler: ((message: Message) => void) | null = null;

  constructor(url: string) {
    this.socket = new WebSocket(url);
    this.socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      const parsed: unknown = JSON.parse(event.data);
      if (isMessage(parsed)) this.handler?.(parsed);
    });
  }

  listen(handler: (message: Message) => void): void {
    this.handler = handler;
  }

  close(): void {
    this.socket.close();
  }
}

/** The sim time a message is of, for those that say (clock, creatures). */
function timeOf(message: Message): number | null {
  return "t_ms" in message ? message.t_ms : null;
}

/**
 * A recording (`tools/stream.py`): the messages a server would have sent over some
 * sim-days, handed over in order, one every `everyMs` of wall time (all at once for 0);
 * or, with `speed`, as the sim's time goes by at `speed` sim-seconds a wall second, each
 * message without a time of its own straight after the one before it (R3: animals move
 * as often as they were recorded, whatever else came between).
 */
export class Recording implements Source {
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly messages: readonly Message[],
    private readonly everyMs = 0,
    private readonly speed = 0,
  ) {}

  /** The recording at `url`: JSON `{ "messages": [...] }`. */
  static async load(url: string, everyMs = 0, speed = 0): Promise<Recording> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    const document = (await response.json()) as { messages?: unknown };
    if (!Array.isArray(document.messages)) throw new Error(`${url}: no messages`);
    return new Recording(document.messages.filter(isMessage), everyMs, speed);
  }

  /** Wall milliseconds from the start at which each message is due, played at `speed`. */
  private dueTimes(): number[] {
    const first = this.messages.map(timeOf).find((time) => time !== null) ?? 0;
    let due = 0;
    return this.messages.map((message) => {
      const time = timeOf(message);
      if (time !== null) due = Math.max(due, (time - first) / this.speed);
      return due;
    });
  }

  get length(): number {
    return this.messages.length;
  }

  listen(handler: (message: Message) => void): void {
    if (this.speed > 0) {
      const due = this.dueTimes();
      const start = Date.now();
      let next = 0;
      const play = (): void => {
        const now = Date.now() - start;
        while (next < this.messages.length && (due[next] ?? 0) <= now) {
          const message = this.messages[next];
          if (message !== undefined) handler(message);
          next += 1;
        }
        if (next < this.messages.length) {
          this.timer = setTimeout(play, Math.max((due[next] ?? 0) - now, 0));
        }
      };
      play();
      return;
    }
    if (this.everyMs <= 0) {
      for (const message of this.messages) handler(message);
      return;
    }
    let next = 0;
    const play = (): void => {
      const message = this.messages[next];
      if (message === undefined) return;
      handler(message);
      next += 1;
      this.timer = setTimeout(play, this.everyMs);
    };
    play();
  }

  close(): void {
    if (this.timer !== null) clearTimeout(this.timer);
  }
}
