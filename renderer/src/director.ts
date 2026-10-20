/**
 * The documentary camera (R3, ADR 0020): which view the screen shows, where it looks,
 * and whom it follows. The owner's view button steps through the three views:
 *
 *   map      the whole continent, still: where the desk rests
 *   middle   a region, drifting slowly from one place on the island to another
 *   local    one animal from close by, of a species drawn at random; after about five
 *            minutes another, glided to if it is near, cut to if not
 *
 * and from the local view back to the map. Fifteen minutes after the last press the
 * screen goes back to the map by itself. Changes of view, and cuts, dip to dark and back,
 * waiting in the dark until the new view is painted (painted pixels shimmer at zooms in
 * between, so the camera never zooms: renderer.md).
 *
 * Pure: the page hands it the time that passed, what the world holds and whether the view
 * is painted, and draws what it says; random draws come from the stream it is given.
 */
import { Spring, Velocity, framing, within, type Point, type SpringOptions } from "./camera";
import type { ViewName } from "./landscape";
import type { Random } from "./rng";

/** Back to the map after this long without a press (seconds; the owner, 2026-10-20). */
export const IDLE_S = 15 * 60;
/** Seconds on one animal before the next, from and to (about five minutes, the owner). */
export const FOLLOW_MIN_S = 4 * 60;
export const FOLLOW_MAX_S = 6 * 60;
/** Seconds to dip to dark, the longest wait in the dark for a view to be painted, and back. */
export const DIP_OUT_S = 0.4;
export const WAIT_MAX_S = 3;
export const DIP_IN_S = 0.6;
/** The middle view drifts this fast (cells a second) to places this far apart (cells). */
const DRIFT_SPEED = 1.2;
const DRIFT_MIN_CELLS = 20;
const DRIFT_MAX_CELLS = 70;
/** And lingers at each this long (seconds), from and to. */
const LINGER_MIN_S = 8;
const LINGER_MAX_S = 20;
/** Cells tried for a place on land to drift to; failing all, any place. */
const DRIFT_TRIES = 40;
/** The next animal within this many view widths is glided to; further, the camera cuts. */
const GLIDE_WIDTHS = 1;
/** Following: lead the subject by this many seconds of its walk; let it potter this far. */
const LEAD_S = 1.2;
const DEAD_ZONE_CELLS = 1;
/** Seconds over which the subject's walking speed is taken in. */
const VELOCITY_SMOOTH_S = 0.8;
/** How the camera moves in each way of moving. */
const DRIFTING: SpringOptions = { periodS: 6, damping: 1, maxSpeed: 2.5 };
const FOLLOWING: SpringOptions = { periodS: 2.4, damping: 0.75, maxSpeed: 6 };
const GLIDING: SpringOptions = { periodS: 3.2, damping: 0.9, maxSpeed: 8 };
/** A glide is over when the camera is this close to its new subject (cells). */
const GLIDE_DONE_CELLS = 0.5;

/** The director's clock: how long the screen waits for a press, and stays on an animal. */
export interface Timings {
  idleS: number;
  followMinS: number;
  followMaxS: number;
}
export const TIMINGS: Timings = {
  idleS: IDLE_S,
  followMinS: FOLLOW_MIN_S,
  followMaxS: FOLLOW_MAX_S,
};

/** What the button leads to from each view. */
export const NEXT: Readonly<Record<ViewName, ViewName>> = {
  map: "middle",
  middle: "local",
  local: "map",
};

/** An animal the camera may follow: where it is drawn, in cells. */
export interface Subject {
  id: number;
  /** Its species; 0 for none yet (newcomers). */
  species: number;
  x: number;
  y: number;
  torpid: boolean;
}

/** What the director reads of the scene each frame. */
export interface Scene {
  /** The world in cells. */
  width: number;
  height: number;
  /** Whether a place is land: the middle view drifts over the island, not the sea. */
  isLand(x: number, y: number): boolean;
  /** The animals alive now. */
  subjects: readonly Subject[];
  /** Whether the view shown is painted: a dip waits in the dark until it is. */
  ready: boolean;
}

/** What the screen shows this frame. */
export interface Shot {
  view: ViewName;
  /** The middle of the picture, in cells. */
  centre: Point;
  /** How dark the picture is dipped: 0 clear, 1 dark. */
  dim: number;
  /** The animal followed in the local view; null otherwise. */
  subject: number | null;
}

/** How the camera is moving in its view. */
export type Motion = "still" | "drift" | "linger" | "follow" | "glide";

type Dip = { phase: "out" | "wait" | "in"; t: number; then: (scene: Scene) => void };

export class Director {
  private view: ViewName = "map";
  private readonly spring: Spring;
  private readonly walking = new Velocity(VELOCITY_SMOOTH_S);
  private dip: Dip | null = null;
  /** The view a press during a dip leads on from: the one the dip is going to. */
  private going: ViewName | null = null;
  private idle = 0;
  private motion: Motion = "still";
  /** The middle view: the point the camera is pulled toward, the place it goes to, and for how long it lingers there. */
  private readonly carrot: Point = { x: 0, y: 0 };
  private readonly place: Point = { x: 0, y: 0 };
  private linger = 0;
  /** The local view: whom it follows and for how much longer. */
  private subject: number | null = null;
  private follow = 0;

  /** `sizes`: the cells each view has in sight. */
  constructor(
    private readonly sizes: Readonly<Record<ViewName, { width: number; height: number }>>,
    private readonly random: Random,
    private readonly timings: Timings = TIMINGS,
  ) {
    this.spring = new Spring({ x: 0, y: 0 }, DRIFTING);
  }

  /** The view button was pressed. */
  press(): void {
    this.idle = 0;
    this.go(NEXT[this.going ?? this.view]);
  }

  /** What the camera is doing, for tests and the page's readout. */
  get state(): {
    view: ViewName;
    motion: Motion;
    dipping: boolean;
    idleS: number;
    followLeftS: number;
  } {
    return {
      view: this.view,
      motion: this.motion,
      dipping: this.dip !== null,
      idleS: this.idle,
      followLeftS: this.follow,
    };
  }

  /** Move on by `dtS` seconds and say what to show. */
  update(dtS: number, scene: Scene): Shot {
    this.idle += dtS;
    if (this.view !== "map" && this.idle >= this.timings.idleS && this.going !== "map")
      this.go("map");
    this.moveDip(dtS, scene);
    this.film(dtS, scene);
    const size = this.sizes[this.view];
    const centre =
      this.view === "map"
        ? { x: scene.width / 2, y: scene.height / 2 }
        : within(this.spring.at, size.width, size.height, scene.width, scene.height);
    return {
      view: this.view,
      centre,
      dim: this.dim,
      subject: this.view === "local" ? this.subject : null,
    };
  }

  private get dim(): number {
    const dip = this.dip;
    if (dip === null) return 0;
    if (dip.phase === "out") return Math.min(dip.t / DIP_OUT_S, 1);
    if (dip.phase === "wait") return 1;
    return Math.max(1 - dip.t / DIP_IN_S, 0);
  }

  /** Dip to dark, do `then` in the dark, and come back once the view is painted. */
  private cut(then: (scene: Scene) => void): void {
    // From partway back up, the way down starts as dark as the picture is.
    const t = this.dip === null ? 0 : this.dim * DIP_OUT_S;
    this.dip = { phase: "out", t, then };
  }

  private go(view: ViewName): void {
    this.going = view;
    this.cut((scene) => {
      this.going = null;
      this.view = view;
      this.walking.reset();
      if (view === "map") {
        this.motion = "still";
        this.subject = null;
      } else if (view === "middle") {
        this.subject = null;
        this.spring.options = DRIFTING;
        this.spring.snap(this.landPlace(scene, null));
        this.startDrift(scene);
      } else {
        this.spring.options = FOLLOWING;
        this.motion = "follow";
        const next = this.choose(scene, null);
        this.subject = next?.id ?? null;
        this.follow = this.followTime();
        this.spring.snap(next ?? { x: scene.width / 2, y: scene.height / 2 });
      }
    });
  }

  private moveDip(dtS: number, scene: Scene): void {
    const dip = this.dip;
    if (dip === null) return;
    dip.t += dtS;
    if (dip.phase === "out" && dip.t >= DIP_OUT_S) {
      dip.then(scene);
      this.dip = { phase: "wait", t: 0, then: dip.then };
    } else if (dip.phase === "wait" && (scene.ready || dip.t >= WAIT_MAX_S)) {
      this.dip = { phase: "in", t: 0, then: dip.then };
    } else if (dip.phase === "in" && dip.t >= DIP_IN_S) {
      this.dip = null;
    }
  }

  /** Move the camera within its view. */
  private film(dtS: number, scene: Scene): void {
    if (this.view === "middle") this.drift(dtS, scene);
    else if (this.view === "local") this.track(dtS, scene);
  }

  // The middle view.

  private startDrift(scene: Scene): void {
    const from = this.spring.at;
    this.carrot.x = from.x;
    this.carrot.y = from.y;
    const to = this.landPlace(scene, from);
    this.place.x = to.x;
    this.place.y = to.y;
    this.motion = "drift";
  }

  private drift(dtS: number, scene: Scene): void {
    if (this.motion === "linger") {
      this.linger -= dtS;
      if (this.linger <= 0) this.startDrift(scene);
    } else {
      const dx = this.place.x - this.carrot.x;
      const dy = this.place.y - this.carrot.y;
      const left = Math.hypot(dx, dy);
      const stride = DRIFT_SPEED * dtS;
      if (left <= stride) {
        this.carrot.x = this.place.x;
        this.carrot.y = this.place.y;
        this.motion = "linger";
        this.linger = between(this.random, LINGER_MIN_S, LINGER_MAX_S);
      } else {
        this.carrot.x += (dx / left) * stride;
        this.carrot.y += (dy / left) * stride;
      }
    }
    this.spring.step(this.carrot, dtS);
  }

  /**
   * A place on land, within reach of `from` (anywhere for null), whose view does not
   * look off the world's edge. Failing land, anywhere.
   */
  private landPlace(scene: Scene, from: Point | null): Point {
    const { width, height } = this.sizes.middle;
    let place: Point = { x: scene.width / 2, y: scene.height / 2 };
    for (let attempt = 0; attempt < DRIFT_TRIES; attempt++) {
      let x: number;
      let y: number;
      if (from === null) {
        x = this.random() * scene.width;
        y = this.random() * scene.height;
      } else {
        const angle = this.random() * 2 * Math.PI;
        const reach = between(this.random, DRIFT_MIN_CELLS, DRIFT_MAX_CELLS);
        x = from.x + Math.cos(angle) * reach;
        y = from.y + Math.sin(angle) * reach;
      }
      place = within({ x, y }, width, height, scene.width, scene.height);
      if (scene.isLand(place.x, place.y)) return place;
    }
    return place;
  }

  // The local view.

  private followTime(): number {
    return between(this.random, this.timings.followMinS, this.timings.followMaxS);
  }

  /**
   * The next animal to follow: a species drawn at random among those with an animal
   * awake (all of them if every one sleeps), then one of its animals, awake if it can
   * be, and not `current` while there is anyone else.
   */
  private choose(scene: Scene, current: number | null): Subject | null {
    const others = scene.subjects.filter((subject) => subject.id !== current);
    const pool = others.length > 0 ? others : scene.subjects;
    if (pool.length === 0) return null;
    const awake = pool.filter((subject) => !subject.torpid);
    const candidates = awake.length > 0 ? awake : pool;
    // Species in the order first met: the draw does not depend on how a Map orders keys.
    const species: number[] = [];
    for (const subject of candidates) {
      if (!species.includes(subject.species)) species.push(subject.species);
    }
    const chosen = species[Math.floor(this.random() * species.length)];
    const members = candidates.filter((subject) => subject.species === chosen);
    return members[Math.floor(this.random() * members.length)] ?? null;
  }

  private track(dtS: number, scene: Scene): void {
    this.follow -= dtS;
    let subject = scene.subjects.find((candidate) => candidate.id === this.subject) ?? null;
    if (subject === null || (this.follow <= 0 && this.dip === null)) {
      // Its time is up, or it died: on to the next.
      const next = this.choose(scene, this.subject);
      this.follow = this.followTime();
      if (next === null) {
        this.subject = null;
        return;
      }
      const reach = GLIDE_WIDTHS * this.sizes.local.width;
      const far = Math.hypot(next.x - this.spring.at.x, next.y - this.spring.at.y) > reach;
      if (far && this.dip === null) {
        // Keep on the one in sight, if it lives, until the picture is dark.
        this.cut(() => {
          this.subject = next.id;
          this.walking.reset();
          this.motion = "follow";
          this.spring.options = FOLLOWING;
          const now = scene.subjects.find((candidate) => candidate.id === next.id) ?? next;
          this.spring.snap(now);
        });
        if (subject === null) return;
      } else {
        this.subject = next.id;
        this.walking.reset();
        subject = next;
        if (far) {
          this.spring.snap(next);
        } else {
          this.motion = "glide";
          this.spring.options = GLIDING;
        }
      }
    }
    if (subject === null) return;
    const velocity = this.walking.update(subject, dtS);
    if (this.motion === "glide") {
      this.spring.step(subject, dtS);
      if (
        Math.hypot(subject.x - this.spring.at.x, subject.y - this.spring.at.y) < GLIDE_DONE_CELLS
      ) {
        this.motion = "follow";
        this.spring.options = FOLLOWING;
      }
      return;
    }
    this.spring.step(framing(this.spring.at, subject, velocity, LEAD_S, DEAD_ZONE_CELLS), dtS);
  }
}

function between(random: Random, from: number, to: number): number {
  return from + random() * (to - from);
}
