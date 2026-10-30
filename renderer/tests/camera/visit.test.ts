import { describe, expect, it } from "vitest";
import {
  DIP_IN_S,
  DIP_OUT_S,
  Director,
  type Scene,
  type Shot,
  type Subject,
  type Visit,
} from "../../src/director";
import { mulberry32 } from "../../src/rng";

const SIZES = {
  map: { width: 256, height: 150 },
  middle: { width: 64, height: 37.5 },
  local: { width: 16, height: 9.375 },
};
const FRAME_S = 1 / 30;
const DIP_S = DIP_OUT_S + DIP_IN_S + 0.2;

/** One animal standing still at (100, 60), in a world of land. */
const ANIMAL: Subject = { id: 7, species: 1, x: 100, y: 60, torpid: false };

function sceneWith(place: Visit | null = null, subjects: Subject[] = [ANIMAL]): Scene {
  return { width: 256, height: 150, isLand: () => true, subjects, ready: true, place };
}

function run(director: Director, scene: Scene, seconds: number, each?: (shot: Shot) => void): Shot {
  let shot = director.update(0, scene);
  for (let t = 0; t < seconds; t += FRAME_S) {
    shot = director.update(FRAME_S, scene);
    each?.(shot);
  }
  return shot;
}

/** A director in the local view, settled on the animal. */
function following(seed = 1): Director {
  const director = new Director(SIZES, mulberry32(seed));
  director.press();
  director.press();
  run(director, sceneWith(), 2 * DIP_S + 5);
  expect(director.state.view).toBe("local");
  expect(director.state.motion).toBe("follow");
  return director;
}

const distance = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y);

describe("visiting a chronicle entry's place (R5, Scene.place)", () => {
  it("glides from the animal to a place nearby, holds there while the entry is out", () => {
    const director = following();
    const place: Visit = { entry: 12, x: 110, y: 64 };
    let darkest = 0;
    const shot = run(
      director,
      sceneWith(place),
      6,
      (each) => (darkest = Math.max(darkest, each.dim)),
    );
    expect(director.state.motion).toBe("visit");
    expect(director.state.visit).toEqual(place);
    // Near: glided to, no dip.
    expect(darkest).toBe(0);
    expect(distance(shot.centre, place)).toBeLessThan(0.5);
    // The animal is still the one followed.
    expect(shot.subject).toBe(ANIMAL.id);
  });

  it("cuts to a place far away through a dip", () => {
    const director = following();
    const place: Visit = { entry: 12, x: 200, y: 120 };
    let darkest = 0;
    const shot = run(
      director,
      sceneWith(place),
      DIP_S + 1,
      (each) => (darkest = Math.max(darkest, each.dim)),
    );
    expect(darkest).toBe(1);
    expect(distance(shot.centre, place)).toBeLessThan(0.5);
  });

  it("goes back to the same animal when the entry is read, and follows it again", () => {
    const director = following();
    run(director, sceneWith({ entry: 12, x: 110, y: 64 }), 6);
    const shot = run(director, sceneWith(null), 8);
    expect(director.state.visit).toBeNull();
    expect(director.state.motion).toBe("follow");
    expect(shot.subject).toBe(ANIMAL.id);
    expect(distance(shot.centre, ANIMAL)).toBeLessThan(2);
  });

  it("pauses the time on the animal while it is away", () => {
    const director = following();
    const left = director.state.followLeftS;
    run(director, sceneWith({ entry: 12, x: 110, y: 64 }), 10);
    expect(director.state.followLeftS).toBeCloseTo(left, 6);
  });

  it("visits each entry once: the same entry again is not visited a second time", () => {
    const director = following();
    const place: Visit = { entry: 12, x: 110, y: 64 };
    run(director, sceneWith(place), 6);
    run(director, sceneWith(null), 8);
    run(director, sceneWith(place), 6);
    expect(director.state.visit).toBeNull();
    expect(director.state.motion).toBe("follow");
  });

  it("goes on to the next entry's place if one comes while it is away", () => {
    const director = following();
    run(director, sceneWith({ entry: 12, x: 110, y: 64 }), 6);
    const next: Visit = { entry: 13, x: 95, y: 55 };
    const shot = run(director, sceneWith(next), 6);
    expect(director.state.visit).toEqual(next);
    expect(distance(shot.centre, next)).toBeLessThan(0.5);
  });

  it("does not visit an entry already out when the local view comes", () => {
    const director = new Director(SIZES, mulberry32(1));
    const scene = sceneWith({ entry: 12, x: 110, y: 64 });
    director.press();
    director.press();
    run(director, scene, 2 * DIP_S + 5);
    expect(director.state.view).toBe("local");
    expect(director.state.visit).toBeNull();
  });

  it("does not visit in the map or the middle view", () => {
    const director = new Director(SIZES, mulberry32(1));
    run(director, sceneWith({ entry: 12, x: 110, y: 64 }), 5);
    expect(director.state.visit).toBeNull();
    director.press();
    run(director, sceneWith({ entry: 13, x: 110, y: 64 }), DIP_S + 5);
    expect(director.state.view).toBe("middle");
    expect(director.state.visit).toBeNull();
  });

  it("keeps a place by the world's edge within the world", () => {
    const director = following();
    run(director, sceneWith({ entry: 12, x: 1, y: 1 }), DIP_S + 2);
    const visit = director.state.visit;
    expect(visit).not.toBeNull();
    expect(visit?.x).toBeGreaterThanOrEqual(SIZES.local.width / 2);
    expect(visit?.y).toBeGreaterThanOrEqual(SIZES.local.height / 2);
  });

  it("ends a visit with its view", () => {
    const director = following();
    run(director, sceneWith({ entry: 12, x: 110, y: 64 }), 6);
    director.press();
    run(director, sceneWith({ entry: 12, x: 110, y: 64 }), DIP_S);
    expect(director.state.view).toBe("map");
    expect(director.state.visit).toBeNull();
  });
});
