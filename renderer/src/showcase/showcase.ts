/**
 * The showcase (R5, the owner): a scripted tour of Lineage in the real scene, looping on
 * the board without reloading, as on the desk. Each act of `script.ts` stages what it is
 * about with what the films and tests already use (animals put and sent by hand, hunts,
 * births, rare genes granted, the atmosphere's demo light, weather and powers, a winter
 * laid on the island) and points the camera at it; its line is written over the scene
 * (`overlay.ts`). Everything runs on the scene's own clock, so a film of it (`?film`) is
 * the same every time.
 */
import type { Shot } from "../director";
import type { Herd } from "../herd";
import type { Show } from "../atmosphere/demo";
import { regrid } from "../atmosphere/demo";
import type { RareLook } from "../creatures/rare";
import type { ClockMessage, LandMessage, Message } from "../protocol";
import { gridNumbers } from "../stream";
import { ACTS, actAt, type Act, type ActName } from "./script";

/** What the showcase drives in the scene (`main.ts`). */
export interface ShowcaseHost {
  /** The world's size in cells, once a land has come. */
  size(): { width: number; height: number } | null;
  /** The land and clock as the stream last sent them. */
  landMessage(): LandMessage | null;
  clock(): ClockMessage | null;
  /** A message, as if the stream had sent it. */
  receive(message: Message): void;
  /** The atmosphere's demo (`atmosphere/demo.ts`) of `shows` round (x, y). */
  demo(shows: readonly Show[], x: number, y: number): void;
  /** Move the atmosphere on by so many seconds more this frame (the world's end, sped up). */
  advance(seconds: number): void;
  /** Whether the ground under the shot last returned is painted (`Landscape.groundShown`). */
  groundShown(): boolean;
  /** Paint and keep ahead the ground of a shot to come (`Landscape.prefetch`). */
  prefetch(view: Shot["view"], centre: { x: number; y: number }): void;
  herd: Herd;
}

/** Places on the island of the creatures' recording (`stream/life.json`), in cells. */
const PLACES = {
  /** Open grass, where the films stage eating, hunting and births. */
  grass: { x: 64, y: 71 },
  /** A cluster of bushes. */
  bushes: { x: 92, y: 124 },
  /** The north coast, its shallows. */
  shore: { x: 183, y: 10 },
  /** A wood of broadleaves. */
  wood: { x: 234, y: 97 },
  /** Where most animals are, for the middle view at night. */
  crowd: { x: 176, y: 43 },
  /** A middle view of coasts and woods, its drift from one to the other. */
  driftFrom: { x: 70, y: 60 },
  driftTo: { x: 120, y: 95 },
  /** The god powers, each in a place of its own. */
  meteor: { x: 70, y: 75 },
  seed: { x: 130, y: 105 },
  ark: { x: 176, y: 43 },
} as const;

/** The animals the films stage, by id, in the creatures' recording; others stand in. */
const CAST = { big: 2048, small: 2184, other: 2220, mother: 2075, mate: 2113, young: 2196 };

/** Seconds the picture takes to fade out before a cut, and in after it. */
const FADE_OUT_S = 0.6;
const FADE_IN_S = 0.8;
/** Seconds the caption takes to come in after the picture, and to go before it. */
const CAPTION_FADE_S = 0.5;
/** For cues timed just after a cut: the picture is back by then. */
const CUT_S = FADE_IN_S;

/** Eased from 0 to 1 as `t` goes from 0 to 1 (clamped). */
const ease = (t: number): number => {
  const u = Math.min(Math.max(t, 0), 1);
  return u * u * (3 - 2 * u);
};

/**
 * How dark the picture is `intoS` into an act of `seconds` with cuts at `cuts` (seconds in,
 * besides its start and end): faded out before each cut, in after it.
 */
export function dipAt(intoS: number, seconds: number, cuts: readonly number[] = []): number {
  let dim = 0;
  for (const cut of [0, ...cuts, seconds]) {
    const before = cut - intoS;
    if (before >= 0 && before < FADE_OUT_S && cut > 0)
      dim = Math.max(dim, ease(1 - before / FADE_OUT_S));
    const after = intoS - cut;
    if (after >= 0 && after < FADE_IN_S && cut < seconds)
      dim = Math.max(dim, ease(1 - after / FADE_IN_S));
  }
  return dim;
}

/** How much of an act's caption shows `intoS` into it: in after the picture, out before it. */
export function captionAt(intoS: number, seconds: number): number {
  const comes = ease((intoS - FADE_IN_S) / CAPTION_FADE_S);
  const goes = ease((seconds - FADE_OUT_S - intoS) / CAPTION_FADE_S);
  return Math.min(comes, goes);
}
/**
 * While dipped this dark and the ground under the shot is not painted yet, the showcase
 * waits (its clock does not move): the next shot opens on its ground, not bare land. At
 * most `MOST_HELD_S` at a time.
 */
const HOLD_FROM_DIM = 0.85;
/** The most the showcase's clock moves in one frame (seconds). */
const MOST_STEP_S = 0.1;
/**
 * Seconds before a cut the ground of the shot after it is painted ahead, so that it is
 * kept by the time the camera gets there (a screenful is some 10 s on the board).
 */
const PREFETCH_S = 9;
const MOST_HELD_S = 20;
/** How much faster the world's end plays than it would (three minutes in some fifteen s). */
const END_SPEED = 12;
/** The day of the year shown late in autumn and in winter (the clock rewritten). */
const AUTUMN_DAY = 315;
const WINTER_DAY = 25;
/** Snow lies above this share of the land's heights, in the winter the showcase lays on. */
const SNOW_FROM = 0.35;

interface Cue {
  atS: number;
  run: () => void;
}

/** An act as staged: what it does when, and where the camera looks. */
interface Staging {
  cues: Cue[];
  shot: (intoS: number) => Shot;
  /** Cuts within the act, seconds in, where the camera goes elsewhere through the dark. */
  cuts?: number[];
}

export class Showcase {
  private timeS = 0;
  private playing: { loop: number; index: number } | null = null;
  private staging: Staging | null = null;
  private done = 0;
  /** The day as the recording had it, put back after the seasons and the world's end. */
  private landAtStart: LandMessage | null = null;
  private clockAtStart: ClockMessage | null = null;
  /** Prey already taken: a hunt in a later loop takes another. */
  private readonly eaten = new Set<number>();
  /** The cuts whose next shot has been painted ahead, by loop, act and second. */
  private readonly prefetched = new Set<string>();
  /** How dark the last shot was, and how long the showcase has waited in it. */
  private lastDim = 1;
  /** How much of the act's caption shows (0–1). */
  caption = 0;
  private heldS = 0;

  constructor(private readonly host: ShowcaseHost) {}

  /** Seconds since the showcase began. */
  get time(): number {
    return this.timeS;
  }

  /** The act shown now, and its index and loop. */
  get now(): { act: Act; index: number; loop: number; intoS: number } {
    return actAt(this.timeS);
  }

  /** Move the showcase on by `dtS`; returns the camera's shot, or null before the land. */
  update(dtS: number): Shot | null {
    const size = this.host.size();
    if (size === null) return null;
    // A frame the page was held up for (a new land laid out) moves the showcase on no
    // more than an ordinary one: its scene is not skipped, its dark lasts a little longer.
    dtS = Math.min(dtS, MOST_STEP_S);
    // Waiting in the dark for the ground of the shot (shown since the last frame).
    if (this.lastDim >= HOLD_FROM_DIM && !this.host.groundShown() && this.heldS < MOST_HELD_S) {
      this.heldS += dtS;
    } else {
      this.timeS += dtS;
      if (this.lastDim < HOLD_FROM_DIM) this.heldS = 0;
    }
    const { loop, index, intoS } = actAt(this.timeS);
    if (this.playing === null || this.playing.loop !== loop || this.playing.index !== index) {
      this.playing = { loop, index };
      this.staging = this.stage((ACTS[index] as Act).name, size);
      this.done = 0;
    }
    const staging = this.staging;
    if (staging === null) return null;
    while (this.done < staging.cues.length && (staging.cues[this.done]?.atS ?? Infinity) <= intoS) {
      staging.cues[this.done]?.run();
      this.done += 1;
    }
    const shot = staging.shot(intoS);
    // Into each act and out of it, and at its cuts, through the dark.
    const seconds = (ACTS[index] as Act).seconds;
    this.prefetchNext(loop, index, intoS, seconds, staging, size);
    shot.dim = Math.max(shot.dim, dipAt(intoS, seconds, staging.cuts));
    this.caption = captionAt(intoS, seconds);
    this.lastDim = shot.dim;
    return shot;
  }

  /** What `name` stages, on a world of `size` cells. */
  private stage(name: ActName, size: { width: number; height: number }): Staging {
    const host = this.host;
    const herd = host.herd;
    const centre = { x: size.width / 2, y: size.height / 2 };
    const fixed =
      (view: Shot["view"], at: { x: number; y: number }, subject: number | null = null) =>
      (): Shot => ({ view, centre: { ...at }, dim: 0, subject });
    const following = (id: number, fallback: { x: number; y: number }) => (): Shot => {
      const seen = herd.subjects().find((subject) => subject.id === id);
      return {
        view: "local",
        centre: seen === undefined ? { ...fallback } : { x: seen.x, y: seen.y },
        dim: 0,
        subject: seen === undefined ? null : id,
      };
    };
    const put = (id: number, x: number, y: number, heading = 0): void => {
      herd.pin(id, x, y, heading);
      herd.send(id, x, y);
    };
    const { grass, bushes, shore, wood, crowd } = PLACES;
    switch (name) {
      case "title":
        return {
          cues: [
            {
              atS: 0,
              run: () => {
                // Every loop begins on the day the recording has, in daylight (held again
                // once laid out: `restore`).
                this.restore();
                host.demo(["day"], centre.x, centre.y);
              },
            },
          ],
          shot: fixed("map", centre),
        };
      case "world":
        return {
          cues: [],
          shot: (intoS) => {
            const t = intoS / (ACTS[1]?.seconds ?? 12);
            const { driftFrom: a, driftTo: b } = PLACES;
            return {
              view: "middle",
              centre: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t },
              dim: 0,
              subject: null,
            };
          },
        };
      case "creatures": {
        const big = this.alive(CAST.big);
        return {
          cues: [
            {
              atS: 0,
              run: () => {
                [big, this.alive(CAST.small), this.alive(CAST.other)].forEach((id, k) =>
                  put(id, bushes.x - 3, bushes.y - 0.7 + k * 0.5),
                );
              },
            },
            {
              atS: 1.5,
              run: () =>
                [big, this.alive(CAST.small), this.alive(CAST.other)].forEach((id, k) =>
                  herd.send(id, bushes.x + 4, bushes.y - 0.7 + k * 0.5),
                ),
            },
          ],
          shot: following(big, bushes),
        };
      }
      case "life": {
        const big = this.alive(CAST.big);
        const grazer = this.alive(CAST.other);
        return {
          cues: [
            {
              atS: 0,
              run: () => {
                put(big, grass.x - 0.6, grass.y);
                herd.feed(big, "plants");
                put(grazer, grass.x + 1.6, grass.y + 0.3, Math.PI);
                herd.feed(grazer, "plants");
              },
            },
            {
              atS: 6,
              run: () => {
                const prey = this.prey([big, grazer]);
                put(prey, grass.x + 2.2, grass.y + 0.3, 2.8);
                herd.feed(big, "none");
                put(big, grass.x - 1.7, grass.y - 0.2);
              },
            },
            { atS: 7, run: () => herd.hunt(big, this.lastPrey) },
          ],
          shot: fixed("local", grass),
        };
      }
      case "family": {
        const mother = this.alive(CAST.mother);
        const mate = this.alive(CAST.mate);
        return {
          cues: [
            {
              atS: 0,
              run: () => {
                put(mother, grass.x - 0.6, grass.y);
                put(mate, grass.x + 0.4, grass.y + 0.9, 3.6);
              },
            },
            {
              atS: 0.5,
              run: () => {
                const [a, b] = [this.prey([mother, mate]), this.prey([mother, mate])];
                herd.pin(a, grass.x + 6, grass.y + 4, 0);
                herd.pin(b, grass.x + 6, grass.y + 5, 0);
                herd.birth(mother, a, false);
                herd.birth(mother, b, true);
              },
            },
            { atS: 6, run: () => herd.send(mother, grass.x + 3, grass.y) },
          ],
          shot: fixed("local", { x: grass.x + 1, y: grass.y }),
        };
      }
      case "rare": {
        const basker = this.alive(CAST.other);
        const venomous = this.alive(CAST.mate);
        const swimmer = this.alive(CAST.big);
        const grant = (id: number, look: RareLook): void => {
          herd.grant(id, look);
        };
        return {
          cues: [
            {
              atS: 0,
              run: () => {
                grant(basker, "leaves");
                put(basker, grass.x, grass.y);
              },
            },
            {
              atS: 4,
              run: () => {
                grant(venomous, "venom");
                const prey = this.prey([basker, venomous]);
                put(prey, grass.x + 2.2, grass.y + 0.3, 2.8);
                put(venomous, grass.x - 1.7, grass.y - 0.2);
              },
            },
            { atS: 4.6, run: () => herd.hunt(venomous, this.lastPrey) },
            {
              atS: 8,
              run: () => {
                grant(swimmer, "gills");
                herd.pin(swimmer, shore.x - 4, shore.y, 0);
                herd.send(swimmer, shore.x + 4, shore.y + 0.5);
              },
            },
          ],
          cuts: [8],
          shot: (intoS) => ({
            view: "local",
            centre: intoS < 8 ? { ...grass } : { ...shore },
            dim: 0,
            subject: null,
          }),
        };
      }
      case "seasons":
        return {
          cues: [
            { atS: 0, run: () => this.season("autumn", AUTUMN_DAY, 0.9, null) },
            {
              atS: 7,
              run: () => {
                this.season("winter", WINTER_DAY, 0.4, this.snowed());
                host.demo(["rain"], wood.x, wood.y);
              },
            },
          ],
          cuts: [7],
          shot: (intoS) => ({
            view: intoS < 7 ? "local" : "middle",
            centre: { ...wood },
            dim: 0,
            subject: null,
          }),
        };
      case "weather": {
        const cast = [this.alive(CAST.big), this.alive(CAST.small), this.alive(CAST.other)];
        return {
          cues: [
            {
              atS: 0,
              run: () => {
                this.restore();
                host.demo(["rain"], grass.x, grass.y);
                cast.forEach((id, k) => put(id, grass.x - 1 + k * 1.3, grass.y + (k % 2) * 0.8, k));
              },
            },
            { atS: 5, run: () => host.demo(["day"], grass.x, grass.y) },
            {
              atS: 8,
              run: () => {
                host.demo(["storm"], grass.x, grass.y);
                cast.forEach((id, k) => herd.send(id, grass.x + 3 - k * 2, grass.y + 0.5));
              },
            },
          ],
          shot: fixed("local", grass),
        };
      }
      case "night":
        return {
          cues: [
            { atS: 0, run: () => host.demo(["dusk"], crowd.x, crowd.y) },
            { atS: 4, run: () => host.demo(["night"], crowd.x, crowd.y) },
          ],
          shot: fixed("middle", crowd),
        };
      case "powers": {
        // Each power in a place of its own (the owner: not the god light on the meteor's).
        const { meteor, seed, ark } = PLACES;
        const at = (intoS: number): { x: number; y: number } =>
          intoS < 5 ? meteor : intoS < 10 ? seed : ark;
        return {
          cues: [
            { atS: CUT_S, run: () => host.demo(["day", "meteor"], meteor.x, meteor.y) },
            { atS: 5 + CUT_S, run: () => host.demo(["day", "seed"], seed.x, seed.y) },
            { atS: 10 + CUT_S, run: () => host.demo(["day", "ark"], ark.x, ark.y) },
          ],
          cuts: [5, 10],
          shot: (intoS) => ({ view: "middle", centre: { ...at(intoS) }, dim: 0, subject: null }),
        };
      }
      case "chronicle":
        return {
          cues: [
            {
              atS: 0.5,
              run: () =>
                host.receive({
                  type: "chronicle",
                  protocol: 1,
                  notable_importance: 3,
                  major_importance: 4,
                  entries: [
                    {
                      number: 900_000 + (this.playing?.loop ?? 0),
                      t_ms: this.clockAtStart?.t_ms ?? 0,
                      kind: "speciation",
                      importance: 4,
                      text: "A new kind has split from the herd on the eastern shore.",
                      species: -1,
                      x: -1,
                      y: -1,
                    },
                  ],
                }),
            },
          ],
          shot: fixed("middle", PLACES.driftTo),
        };
      case "end":
        return {
          cues: [{ atS: 0, run: () => host.demo(["end"], centre.x, centre.y) }],
          shot: (intoS) => {
            // The world's end, sped up: some three minutes in the act's fifteen seconds.
            if (intoS > CUT_S) host.advance((END_SPEED - 1) / 30);
            return { view: "map", centre: { ...centre }, dim: 0, subject: null };
          },
        };
      case "card":
        return { cues: [], shot: fixed("map", centre) };
    }
  }

  /**
   * Paint ahead the ground of the shot after the next cut, once it is `PREFETCH_S` away:
   * the next act's first shot, or the act's own after a cut within it.
   */
  private prefetchNext(
    loop: number,
    index: number,
    intoS: number,
    seconds: number,
    staging: Staging,
    size: { width: number; height: number },
  ): void {
    for (const cut of [...(staging.cuts ?? []), seconds]) {
      const toGo = cut - intoS;
      if (toGo <= 0 || toGo > PREFETCH_S) continue;
      const mark = `${loop}:${index}:${cut}`;
      if (this.prefetched.has(mark)) continue;
      this.prefetched.add(mark);
      if (this.prefetched.size > 64) this.prefetched.clear();
      const next =
        cut < seconds
          ? staging.shot(cut + 0.01)
          : this.stage((ACTS[(index + 1) % ACTS.length] as Act).name, size).shot(0);
      this.host.prefetch(next.view, next.centre);
    }
  }

  /** `id` if it is alive, else the first animal alive not in the cast. */
  private alive(id: number): number {
    const subjects = this.host.herd.subjects();
    if (subjects.some((subject) => subject.id === id && !this.eaten.has(id))) return id;
    const cast = new Set(Object.values(CAST));
    return subjects.find((s) => !cast.has(s.id) && !this.eaten.has(s.id))?.id ?? id;
  }

  /** An animal to be prey or young, not one of `besides`, not taken before; kept as last. */
  private prey(besides: readonly number[]): number {
    const cast = new Set<number>([...Object.values(CAST), ...besides]);
    const found = this.host.herd
      .subjects()
      .find((subject) => !cast.has(subject.id) && !this.eaten.has(subject.id));
    const id = found?.id ?? CAST.small;
    this.eaten.add(id);
    this.lastPrey = id;
    return id;
  }

  private lastPrey = CAST.small;

  /** The clock rewritten to `season` (and the land, if given), laid out now. */
  private season(
    season: ClockMessage["season"],
    day: number,
    progress: number,
    land: LandMessage | null,
  ): void {
    this.keepStart();
    const clock = this.clockAtStart;
    if (clock === null) return;
    if (land !== null) this.host.receive(land);
    this.host.receive({ ...clock, season, season_progress: progress, day_of_year: day });
  }

  /** Put back the day the recording had: its land and clock. */
  private restore(): void {
    this.keepStart();
    if (this.landAtStart === null || this.clockAtStart === null) return;
    this.host.receive(this.landAtStart);
    this.host.receive(this.clockAtStart);
  }

  private keepStart(): void {
    this.landAtStart ??= this.host.landMessage();
    this.clockAtStart ??= this.host.clock();
  }

  /** The recording's land with snow on its higher ground (the winter the showcase lays on). */
  private snowed(): LandMessage | null {
    this.keepStart();
    const message = this.landAtStart;
    if (message === null || message.snow === undefined) return message;
    const cells = message.width * message.height;
    const heights = gridNumbers(message.heights, cells);
    const sea = message.sea_level * message.heights.scale;
    const top = Math.max(...heights);
    const from = sea + (top - sea) * SNOW_FROM;
    const snow = new Uint8Array(cells);
    heights.forEach((height, cell) => {
      if (height > from)
        snow[cell] = Math.min(255, Math.round((255 * (height - from)) / (top - from)) + 90);
    });
    return { ...message, snow: regrid(message.snow, snow) };
  }
}
