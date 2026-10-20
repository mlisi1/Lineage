import { describe, expect, it } from "vitest";
import { Spring, Velocity, framing, sight, within, type SpringOptions } from "../../src/camera";

const LAZY: SpringOptions = { periodS: 2, damping: 1, maxSpeed: 100 };

function settle(spring: Spring, target: { x: number; y: number }, seconds: number, fps = 60): void {
  for (let t = 0; t < seconds; t += 1 / fps) spring.step(target, 1 / fps);
}

describe("the camera's spring", () => {
  it("eases from rest to the target and stays there", () => {
    const spring = new Spring({ x: 0, y: 0 }, LAZY);
    spring.step({ x: 10, y: 0 }, 1 / 60);
    // It starts gently: after one frame it has hardly moved.
    expect(spring.at.x).toBeLessThan(0.05);
    settle(spring, { x: 10, y: 0 }, 6);
    expect(spring.at.x).toBeCloseTo(10, 2);
    expect(Math.hypot(spring.velocity.x, spring.velocity.y)).toBeLessThan(0.01);
  });

  it("critically damped, it never swings past; under-damped, a little", () => {
    const critical = new Spring({ x: 0, y: 0 }, LAZY);
    const loose = new Spring({ x: 0, y: 0 }, { ...LAZY, damping: 0.6 });
    let mostCritical = 0;
    let mostLoose = 0;
    for (let t = 0; t < 8; t += 1 / 60) {
      critical.step({ x: 10, y: 0 }, 1 / 60);
      loose.step({ x: 10, y: 0 }, 1 / 60);
      mostCritical = Math.max(mostCritical, critical.at.x);
      mostLoose = Math.max(mostLoose, loose.at.x);
    }
    expect(mostCritical).toBeLessThanOrEqual(10 + 1e-6);
    expect(mostLoose).toBeGreaterThan(10.2);
    expect(mostLoose).toBeLessThan(13);
  });

  it("moves alike at 30 and at 60 frames a second", () => {
    const slow = new Spring({ x: 0, y: 0 }, LAZY);
    const fast = new Spring({ x: 0, y: 0 }, LAZY);
    settle(slow, { x: 5, y: -3 }, 1.5, 30);
    settle(fast, { x: 5, y: -3 }, 1.5, 60);
    expect(slow.at.x).toBeCloseTo(fast.at.x, 1);
    expect(slow.at.y).toBeCloseTo(fast.at.y, 1);
  });

  it("never goes faster than its top speed, even after a long frame", () => {
    const spring = new Spring({ x: 0, y: 0 }, { periodS: 0.5, damping: 1, maxSpeed: 2 });
    for (let i = 0; i < 120; i++) {
      spring.step({ x: 1000, y: 0 }, 1 / 60);
      expect(Math.hypot(spring.velocity.x, spring.velocity.y)).toBeLessThanOrEqual(2 + 1e-9);
    }
    const before = spring.at.x;
    spring.step({ x: 1000, y: 0 }, 30);
    // A hidden page's half-minute frame counts as a quarter second.
    expect(spring.at.x - before).toBeLessThanOrEqual(0.5 + 1e-9);
  });

  it("cuts: snap puts it at rest where asked", () => {
    const spring = new Spring({ x: 0, y: 0 }, LAZY);
    settle(spring, { x: 10, y: 10 }, 0.5);
    spring.snap({ x: -4, y: 2 });
    expect(spring.at).toEqual({ x: -4, y: 2 });
    expect(spring.velocity).toEqual({ x: 0, y: 0 });
  });
});

describe("framing a subject", () => {
  it("stays put while the subject potters within the dead zone", () => {
    const camera = { x: 10, y: 10 };
    expect(framing(camera, { x: 10.5, y: 10.4 }, { x: 0, y: 0 }, 1, 1)).toEqual(camera);
  });

  it("past the dead zone, wants the subject at its edge, led by its walk", () => {
    const camera = { x: 0, y: 0 };
    const still = framing(camera, { x: 5, y: 0 }, { x: 0, y: 0 }, 1, 1);
    expect(still.x).toBeCloseTo(4);
    expect(still.y).toBeCloseTo(0);
    const walking = framing(camera, { x: 5, y: 0 }, { x: 2, y: 0 }, 1, 1);
    expect(walking.x).toBeCloseTo(6);
  });

  it("smooths the subject's velocity, and forgets it on reset", () => {
    const velocity = new Velocity(0.5);
    for (let t = 0; t <= 3; t += 0.1) velocity.update({ x: t * 2, y: 0 }, 0.1);
    expect(velocity.value.x).toBeCloseTo(2, 1);
    // A jump (a step of 100 cells in a frame) is taken in only partly.
    velocity.update({ x: 106, y: 0 }, 0.1);
    expect(velocity.value.x).toBeLessThan(200);
    velocity.reset();
    expect(velocity.update({ x: 0, y: 0 }, 0.1)).toEqual({ x: 0, y: 0 });
  });
});

describe("the view and the world's edge", () => {
  it("keeps the view inside the world", () => {
    expect(within({ x: 2, y: 149 }, 16, 9.375, 256, 150)).toEqual({ x: 8, y: 150 - 9.375 / 2 });
    expect(within({ x: 100, y: 60 }, 16, 9.375, 256, 150)).toEqual({ x: 100, y: 60 });
  });

  it("centres a view larger than the world", () => {
    expect(within({ x: 3, y: 3 }, 300, 200, 256, 150)).toEqual({ x: 128, y: 75 });
  });

  it("says which cells are in sight", () => {
    expect(sight({ x: 10, y: 20 }, 16, 8)).toEqual({ x0: 2, y0: 16, x1: 18, y1: 24 });
  });
});
