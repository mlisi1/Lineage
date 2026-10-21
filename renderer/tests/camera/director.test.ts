import { describe, expect, it } from "vitest";
import {
  DIP_IN_S,
  DIP_OUT_S,
  Director,
  FOLLOW_MAX_S,
  FOLLOW_MIN_S,
  IDLE_S,
  WAIT_MAX_S,
  type Scene,
  type Shot,
  type Subject,
} from "../../src/director";
import { mulberry32 } from "../../src/rng";

const SIZES = {
  map: { width: 256, height: 150 },
  middle: { width: 64, height: 37.5 },
  local: { width: 16, height: 9.375 },
};
const FRAME_S = 1 / 30;

/** A world 256 × 150 whose west (x < 60) is sea, with these animals in it. */
function sceneWith(subjects: Subject[] = [], ready = true): Scene {
  return { width: 256, height: 150, isLand: (x) => x >= 60, subjects, ready };
}

function herd(): Subject[] {
  const subjects: Subject[] = [];
  for (let i = 0; i < 30; i++) {
    subjects.push({
      id: 100 + i,
      species: 1 + (i % 3),
      x: 70 + i * 6,
      y: 20 + (i % 5) * 25,
      torpid: false,
    });
  }
  return subjects;
}

function run(director: Director, scene: Scene, seconds: number, each?: (shot: Shot) => void): Shot {
  let shot = director.update(0, scene);
  for (let t = 0; t < seconds; t += FRAME_S) {
    shot = director.update(FRAME_S, scene);
    each?.(shot);
  }
  return shot;
}

/** Past a whole dip: down, a painted view at once, and back up. */
const DIP_S = DIP_OUT_S + DIP_IN_S + 0.2;

describe("the documentary camera", () => {
  it("rests on the whole map, still and clear", () => {
    const director = new Director(SIZES, mulberry32(1));
    const shot = run(director, sceneWith(herd()), 60);
    expect(shot).toEqual({ view: "map", centre: { x: 128, y: 75 }, dim: 0, subject: null });
  });

  it("steps map → middle → local → map at each press, dipping to dark between", () => {
    const director = new Director(SIZES, mulberry32(2));
    const scene = sceneWith(herd());
    const seen: string[] = [];
    for (let press = 0; press < 3; press++) {
      director.press();
      let darkest = 0;
      const shot = run(director, scene, DIP_S, (each) => (darkest = Math.max(darkest, each.dim)));
      expect(darkest).toBe(1);
      expect(shot.dim).toBe(0);
      seen.push(shot.view);
    }
    expect(seen).toEqual(["middle", "local", "map"]);
  });

  it("changes view only once the picture is dark", () => {
    const director = new Director(SIZES, mulberry32(3));
    const scene = sceneWith(herd());
    director.press();
    let shot = run(director, scene, DIP_OUT_S * 0.9);
    expect(shot.view).toBe("map");
    expect(shot.dim).toBeGreaterThan(0.8);
    shot = run(director, scene, DIP_OUT_S * 0.2);
    expect(shot.view).toBe("middle");
    expect(shot.dim).toBe(1);
  });

  it("waits in the dark for the view to be painted, but not for ever", () => {
    const director = new Director(SIZES, mulberry32(4));
    const unpainted = sceneWith(herd(), false);
    director.press();
    let shot = run(director, unpainted, DIP_OUT_S + WAIT_MAX_S * 0.8);
    expect(shot.dim).toBe(1);
    unpainted.ready = true;
    shot = run(director, unpainted, DIP_IN_S + 0.1);
    expect(shot.dim).toBe(0);
    // Never painted: it comes back up after the longest wait anyway.
    const never = new Director(SIZES, mulberry32(4));
    never.press();
    shot = run(never, sceneWith(herd(), false), DIP_OUT_S + WAIT_MAX_S + DIP_IN_S + 0.2);
    expect(shot.dim).toBe(0);
  });

  it("goes on from where a dip is going when pressed during it", () => {
    const director = new Director(SIZES, mulberry32(5));
    const scene = sceneWith(herd());
    director.press();
    run(director, scene, DIP_OUT_S / 2);
    director.press();
    expect(run(director, scene, DIP_S * 2).view).toBe("local");
  });

  it("goes back to the map fifteen minutes after the last press", () => {
    const director = new Director(SIZES, mulberry32(6));
    const scene = sceneWith(herd());
    director.press();
    director.press();
    expect(run(director, scene, IDLE_S - 5).view).toBe("local");
    expect(run(director, scene, 5 + DIP_S).view).toBe("map");
    // A press starts the fifteen minutes again.
    director.press();
    run(director, scene, IDLE_S - 60);
    director.press();
    expect(run(director, scene, 120).view).toBe("local");
  });

  it("drifts over the island in the middle view, never off the world, lingering now and then", () => {
    const director = new Director(SIZES, mulberry32(7));
    const scene = sceneWith(herd());
    director.press();
    run(director, scene, DIP_S);
    const places: { x: number; y: number }[] = [];
    let lingered = 0;
    run(director, scene, 600, (shot) => {
      places.push(shot.centre);
      if (director.state.motion === "linger") lingered += FRAME_S;
      expect(shot.centre.x).toBeGreaterThanOrEqual(32 - 1e-9);
      expect(shot.centre.x).toBeLessThanOrEqual(256 - 32 + 1e-9);
      expect(shot.centre.y).toBeGreaterThanOrEqual(18.75 - 1e-9);
      expect(shot.centre.y).toBeLessThanOrEqual(150 - 18.75 + 1e-9);
    });
    const xs = places.map((place) => place.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(40);
    // Over land most of the time (the sea is the west, x < 60).
    expect(places.filter((place) => place.x >= 60).length / places.length).toBeGreaterThan(0.8);
    expect(lingered).toBeGreaterThan(20);
    // Smooth: no frame jumps.
    for (let i = 1; i < places.length; i++) {
      const a = places[i - 1];
      const b = places[i];
      if (a === undefined || b === undefined) continue;
      expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(0.2);
    }
  });

  it("follows an animal in the local view, keeping it near the middle as it walks", () => {
    const director = new Director(SIZES, mulberry32(8));
    const subjects = herd();
    const scene = sceneWith(subjects);
    director.press();
    director.press();
    const first = run(director, scene, DIP_S);
    const followed = subjects.find((subject) => subject.id === first.subject);
    expect(followed).toBeDefined();
    if (followed === undefined) return;
    // It walks a cell a second for 20 s, east.
    let furthest = 0;
    run(director, scene, 20, (shot) => {
      followed.x += FRAME_S;
      furthest = Math.max(furthest, Math.abs(followed.x - shot.centre.x));
    });
    expect(furthest).toBeLessThan(SIZES.local.width / 2 - 1);
    const shot = run(director, scene, 5);
    expect(Math.abs(followed.x - shot.centre.x)).toBeLessThan(1.5);
    expect(shot.subject).toBe(followed.id);
  });

  it("picks another animal after about five minutes", () => {
    const director = new Director(SIZES, mulberry32(9));
    const scene = sceneWith(herd());
    director.press();
    director.press();
    const first = run(director, scene, DIP_S).subject;
    expect(run(director, scene, FOLLOW_MIN_S - 10).subject).toBe(first);
    expect(run(director, scene, FOLLOW_MAX_S - FOLLOW_MIN_S + 20).subject).not.toBe(first);
  });

  it("draws the species at random, not the animals: a rare species is followed as often", () => {
    const counts = new Map<number, number>();
    const subjects = herd().map((subject, i) => ({ ...subject, species: i === 0 ? 9 : 1 }));
    for (let seed = 0; seed < 200; seed++) {
      const director = new Director(SIZES, mulberry32(seed));
      director.press();
      director.press();
      const id = run(director, sceneWith(subjects), DIP_S).subject;
      const species = subjects.find((subject) => subject.id === id)?.species ?? 0;
      counts.set(species, (counts.get(species) ?? 0) + 1);
    }
    // One animal of species 9 against 29 of species 1: about half the time each.
    expect(counts.get(9) ?? 0).toBeGreaterThan(70);
    expect(counts.get(1) ?? 0).toBeGreaterThan(70);
  });

  it("prefers an animal awake", () => {
    const subjects = herd().map((subject, i) => ({ ...subject, torpid: i !== 4 }));
    for (let seed = 0; seed < 20; seed++) {
      const director = new Director(SIZES, mulberry32(seed));
      director.press();
      director.press();
      expect(run(director, sceneWith(subjects), DIP_S).subject).toBe(subjects[4]?.id);
    }
  });

  it("glides to the next animal when it is near, and cuts to it when it is far", () => {
    const near: Subject[] = [
      { id: 1, species: 1, x: 100, y: 75, torpid: false },
      { id: 2, species: 2, x: 108, y: 75, torpid: false },
    ];
    const far: Subject[] = [
      near[0] as Subject,
      { id: 2, species: 2, x: 200, y: 40, torpid: false },
    ];
    for (const [subjects, glides] of [
      [near, true],
      [far, false],
    ] as const) {
      const director = new Director(SIZES, mulberry32(11), {
        idleS: IDLE_S,
        followMinS: 10,
        followMaxS: 10,
      });
      const scene = sceneWith(subjects.map((subject) => ({ ...subject })));
      director.press();
      director.press();
      const start = run(director, scene, DIP_S);
      let dipped = false;
      let jumped = 0;
      let last = start.centre;
      // On the next for four seconds (and well before its own ten are up).
      run(director, scene, 14, (shot) => {
        dipped ||= shot.dim > 0;
        jumped = Math.max(jumped, Math.hypot(shot.centre.x - last.x, shot.centre.y - last.y));
        last = shot.centre;
      });
      const next = scene.subjects.find((subject) => subject.id !== start.subject);
      expect(Math.hypot((next?.x ?? 0) - last.x, (next?.y ?? 0) - last.y)).toBeLessThan(1.5);
      expect(dipped).toBe(!glides);
      if (glides) expect(jumped).toBeLessThan(0.5);
      else expect(jumped).toBeGreaterThan(20);
    }
  });

  it("moves on at once when the animal it follows dies", () => {
    const director = new Director(SIZES, mulberry32(12));
    const subjects = herd();
    const scene = sceneWith(subjects);
    director.press();
    director.press();
    const first = run(director, scene, DIP_S).subject;
    scene.subjects = subjects.filter((subject) => subject.id !== first);
    const shot = run(director, scene, DIP_S);
    expect(shot.subject).not.toBe(first);
    expect(scene.subjects.some((subject) => subject.id === shot.subject)).toBe(true);
  });

  it("films an empty island without anyone to follow", () => {
    const director = new Director(SIZES, mulberry32(13));
    director.press();
    director.press();
    const shot = run(director, sceneWith([]), 30);
    expect(shot.view).toBe("local");
    expect(shot.subject).toBeNull();
  });

  it("is a pure function of its seed and what it is shown", () => {
    const film = (): Shot[] => {
      const director = new Director(SIZES, mulberry32(14));
      const scene = sceneWith(herd());
      const shots: Shot[] = [];
      director.press();
      run(director, scene, 30, (shot) => shots.push(shot));
      director.press();
      run(director, scene, 30, (shot) => shots.push(shot));
      return shots;
    };
    expect(film()).toEqual(film());
  });

  it("goes straight back to the map when asked", () => {
    const director = new Director(SIZES, mulberry32(16));
    const scene = sceneWith(herd());
    director.press();
    director.press();
    run(director, scene, DIP_S);
    director.toMap();
    expect(run(director, scene, DIP_S).view).toBe("map");
    director.toMap();
    expect(run(director, scene, DIP_S)).toMatchObject({ view: "map", dim: 0 });
  });
});
