/**
 * The end of a world on the screen (R4, ADR 0021): about three minutes, on the map, when
 * the stream says a world ended (M10: its last creature died). The owner chose the
 * dramatic one (2026-10-20):
 *
 *   omen    20 s  the sky reddens; ash starts to fall
 *   fire    40 s  vents of lava open over the land; quakes shake the picture
 *   flood   60 s  the sea rises over the land, the lowland first, the peaks last
 *   dark    20 s  nothing; the next world is laid out behind the dark
 *   rise    40 s  the light comes back and the new continent rises from the sea
 *
 * The world's end is told by the chronicle's own entry as it comes (the scroll); the next
 * world's first entries wait for the rise. Everything the stream sends of the next world
 * waits for the dark (`Sequence`), so the old land stays until the sea has it.
 *
 * Pure: the page hands it the time that passed and draws what `apocalypseAt` says.
 */
import type { Message } from "../protocol";
import type { Land } from "../terrain/land";

export const ACTS = [
  { name: "omen", s: 20 },
  { name: "fire", s: 40 },
  { name: "flood", s: 60 },
  { name: "dark", s: 20 },
  { name: "rise", s: 40 },
] as const;
export type Act = (typeof ACTS)[number]["name"];
export const APOCALYPSE_S = ACTS.reduce((sum, act) => sum + act.s, 0);
/** Seconds between two quakes in the fire, and how long each shakes. */
const QUAKE_EVERY_S = 6;
const QUAKE_S = 1.6;
/** Art pixels the picture is shaken by at most, in the fire and (less) in the flood. */
const QUAKE_PX = 3;

/** What the sequence shows at a moment. */
export interface Moment {
  act: Act;
  /** How far through its act, 0–1. */
  progress: number;
  /** How red the sky is, 0–1. */
  red: number;
  /** How dark the picture is, 0–1 (1: black but for what glows). */
  black: number;
  /** How far the sea has risen over the old land, 0–1 (1: all of it). */
  flood: number;
  /** How far the sea has fallen from over the new land, 0–1 (1: back to its level). */
  recede: number;
  /** Share of the lava vents open, 0–1. */
  vents: number;
  /** How thick the falling ash is, 0–1. */
  ash: number;
  /** How far the picture is shaken now, in art pixels. */
  shake: number;
}

function smooth(t: number): number {
  const x = Math.min(Math.max(t, 0), 1);
  return x * x * (3 - 2 * x);
}

/** The quake's strength at `timeS` into the fire: a jolt that dies away, every few seconds. */
function quake(timeS: number): number {
  const into = timeS % QUAKE_EVERY_S;
  return into < QUAKE_S ? 1 - into / QUAKE_S : 0;
}

/** The act at `timeS` seconds into the sequence, and how far through it. */
export function actAt(timeS: number): { act: Act; progress: number; start: number } {
  let start = 0;
  for (const act of ACTS) {
    if (timeS < start + act.s) return { act: act.name, progress: (timeS - start) / act.s, start };
    start += act.s;
  }
  return { act: "rise", progress: 1, start: start - (ACTS[ACTS.length - 1]?.s ?? 0) };
}

/** What the sequence shows `timeS` seconds in. */
export function apocalypseAt(timeS: number): Moment {
  const { act, progress, start } = actAt(Math.max(timeS, 0));
  const into = timeS - start;
  const still: Moment = {
    act,
    progress,
    red: 0,
    black: 0,
    flood: 0,
    recede: 0,
    vents: 0,
    ash: 0,
    shake: 0,
  };
  switch (act) {
    case "omen":
      return { ...still, red: smooth(progress), ash: 0.4 * progress };
    case "fire":
      return {
        ...still,
        red: 1,
        vents: smooth(progress * 1.5),
        ash: 0.4 + 0.6 * progress,
        shake: QUAKE_PX * quake(into),
      };
    case "flood":
      return {
        ...still,
        red: 1 - 0.4 * progress,
        flood: smooth(progress),
        vents: 1,
        ash: 1 - progress,
        shake: (QUAKE_PX / 2) * (1 - progress) * quake(into),
      };
    case "dark":
      return { ...still, red: 0.6 * (1 - progress), black: smooth(progress * 3), flood: 1 };
    case "rise":
      return { ...still, black: 1 - smooth(progress * 2), recede: smooth(progress) };
  }
}

/** The sea's height over `land` for a moment: rising over it, or falling back from over the next. */
export function seaLevelAt(land: Land, moment: Moment): number | null {
  let top = land.seaLevel;
  for (const height of land.heights) top = Math.max(top, height);
  // A little above the highest peak, so that the last of it goes under.
  const over = top + 0.02;
  if (moment.act === "rise") return over + (land.seaLevel - over) * moment.recede;
  if (moment.flood > 0) return land.seaLevel + (over - land.seaLevel) * moment.flood;
  return null;
}

/** Depth under the risen sea within which the water is foam. */
const FOAM_DEPTH = 0.006;
const FOAM = 0xf2f6ff;

/**
 * The risen sea over `land` at `level`, one pixel to the cell, into `rgba`: the colour of
 * the sea's depth band where a cell is under it, foam where it only just is, clear where
 * the land stands above it or the sea was already there.
 */
export function floodPixels(land: Land, level: number, rgba: Uint8ClampedArray): void {
  const bands = land.relief.seaBands.map((band) => ({
    limit: band.limit,
    colour: Number.parseInt(band.colour.replace("#", ""), 16),
  }));
  const deepest = bands[bands.length - 1]?.colour ?? 0x24529c;
  const cells = land.width * land.height;
  for (let at = 0; at < cells; at++) {
    const height = land.heights[at] ?? 0;
    const below = level - height;
    const o = at * 4;
    if (below <= 0 || height < land.seaLevel) {
      rgba[o + 3] = 0;
      continue;
    }
    const colour =
      below < FOAM_DEPTH ? FOAM : (bands.find((band) => below <= band.limit)?.colour ?? deepest);
    rgba[o] = colour >> 16;
    rgba[o + 1] = (colour >> 8) & 255;
    rgba[o + 2] = colour & 255;
    rgba[o + 3] = 255;
  }
}

/** Places on `land` for lava vents: high land, spread by a hash, at most `count`. */
export function ventsOf(
  land: Land,
  count: number,
  random: () => number,
): { x: number; y: number }[] {
  const vents: { x: number; y: number }[] = [];
  const tries = count * 20;
  for (let i = 0; i < tries && vents.length < count; i++) {
    const x = Math.floor(random() * land.width);
    const y = Math.floor(random() * land.height);
    const height = land.heights[y * land.width + x] ?? 0;
    // Land well above the sea, more likely the higher it is.
    if (height <= land.seaLevel + 0.03) continue;
    if (random() > (height - land.seaLevel) * 4) continue;
    vents.push({ x: x + 0.5, y: y + 0.5 });
  }
  return vents;
}

/** Whether `message` begins a world's end. */
export function endsWorld(message: Message): boolean {
  return message.type === "events" && message.events.some((event) => event.kind === "world_ended");
}

/**
 * The stream while a world ends: every message after the end is held back, the next
 * world's land and animals until the dark, its chronicle until the rise, and handed on
 * then in the order they came.
 */
export class Sequence {
  private timeS = 0;
  private running = false;
  private held: Message[] = [];
  private heldNews: Message[] = [];
  private landed = false;

  constructor(
    private readonly deliver: (message: Message) => void,
    private readonly lengthS = APOCALYPSE_S,
  ) {}

  /** Whether a world is ending on the screen. */
  get active(): boolean {
    return this.running;
  }

  /** Seconds into the sequence, on its own clock (scaled to `APOCALYPSE_S`). */
  get moment(): Moment {
    return apocalypseAt((this.timeS / this.lengthS) * APOCALYPSE_S);
  }

  /**
   * Take `message`: false when it goes on as usual. A message that ends the world starts
   * the sequence (its own events still go on); while it plays, the rest wait.
   */
  take(message: Message): boolean {
    if (!this.running) {
      if (!endsWorld(message)) return false;
      this.running = true;
      this.timeS = 0;
      this.landed = false;
      if (message.type === "events") {
        const at = message.events.findIndex((event) => event.kind === "world_ended");
        const after = message.events.slice(at + 1);
        // What came with the end in the same message is of the next world: it waits too.
        this.deliver({ ...message, events: message.events.slice(0, at + 1) });
        if (after.length > 0) this.held.push({ ...message, events: after });
      }
      return true;
    }
    // Once the dark has come the next world's messages go on as they come, its news once
    // it has risen.
    if (message.type === "chronicle") {
      if (this.moment.act === "rise") this.deliver(message);
      else this.heldNews.push(message);
    } else if (this.landed) this.deliver(message);
    else this.held.push(message);
    return true;
  }

  update(dtS: number): void {
    if (!this.running) return;
    this.timeS += dtS;
    const { act, black } = this.moment;
    // The next world is laid out only once the screen is black, so it is not seen arriving.
    if (!this.landed && ((act === "dark" && black >= 0.99) || act === "rise")) {
      this.landed = true;
      this.flush(this.held);
    }
    if (act === "rise") this.flush(this.heldNews);
    if (this.timeS >= this.lengthS) {
      this.running = false;
      this.flush(this.held);
      this.flush(this.heldNews);
    }
  }

  private flush(queue: Message[]): void {
    const messages = queue.splice(0);
    for (const message of messages) this.deliver(message);
  }
}
