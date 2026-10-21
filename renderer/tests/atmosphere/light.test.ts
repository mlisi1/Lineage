import { describe, expect, it } from "vitest";
import {
  DAWN,
  DUSK,
  EASE_MAX_S,
  EASE_MIN_S,
  LightEase,
  NIGHT,
  NIGHT_LIGHT,
  SEASON_DAY,
  darkness,
  packRgb,
  seasonDay,
  skyTint,
  type Rgb,
} from "../../src/atmosphere/light";

const brightness = (rgb: Rgb): number => rgb[0] + rgb[1] + rgb[2];

describe("the scene's light", () => {
  it("is moonlit blue at night: blue above red, dark but not black", () => {
    const night = skyTint(NIGHT_LIGHT, false);
    expect(night).toEqual(NIGHT);
    expect(night[2]).toBeGreaterThan(night[0]);
    expect(Math.min(...night)).toBeGreaterThan(0.25);
    expect(brightness(night)).toBeLessThan(0.5 * brightness(skyTint(1, true)));
  });

  it("brightens steadily from night to day, whichever way it goes", () => {
    for (const rising of [true, false]) {
      let last = -1;
      for (let step = 0; step <= 20; step++) {
        const light = NIGHT_LIGHT + ((1 - NIGHT_LIGHT) * step) / 20;
        const now = brightness(skyTint(light, rising));
        expect(now).toBeGreaterThanOrEqual(last - 1e-9);
        last = now;
      }
    }
  });

  it("is rose at dusk and lilac at dawn", () => {
    const dusk = skyTint(0.4, false);
    const dawn = skyTint(0.4, true);
    expect(dusk[0]).toBeGreaterThan(dusk[2]);
    expect(dawn[2] - dawn[0]).toBeGreaterThan(dusk[2] - dusk[0]);
    // At the height of twilight its colour is twilight's own.
    const f = 0.35 * (1 - NIGHT_LIGHT) + NIGHT_LIGHT;
    expect(skyTint(f, false)[0]).toBeCloseTo(DUSK[0]);
    expect(skyTint(f, true)[2]).toBeCloseTo(DAWN[2]);
  });

  it("grades the day by the season, turning toward the next as one goes by", () => {
    expect(skyTint(1, true, "winter", 0.5)).toEqual(SEASON_DAY.winter);
    expect(skyTint(1, true, "summer", 0.5)).toEqual(SEASON_DAY.summer);
    // Winter is cool and summer warm.
    expect(SEASON_DAY.winter[2]).toBeGreaterThan(SEASON_DAY.winter[0]);
    expect(SEASON_DAY.summer[0]).toBeGreaterThan(SEASON_DAY.summer[2]);
    // The end of autumn is winter's light; no jump from one season to the next.
    const end = seasonDay("autumn", 1);
    for (let i = 0; i < 3; i++) expect(end[i]).toBeCloseTo(SEASON_DAY.winter[i] ?? 0);
  });

  it("says how dark it is: 1 at night, 0 by day", () => {
    expect(darkness(NIGHT_LIGHT)).toBe(1);
    expect(darkness(1)).toBe(0);
    expect(darkness(0.15)).toBeGreaterThan(0.5);
    expect(darkness(0.6)).toBe(0);
  });

  it("packs as 0xRRGGBB", () => {
    expect(packRgb([1, 1, 1])).toBe(0xffffff);
    expect(packRgb([1, 0, 0.5])).toBe(0xff0080);
    expect(packRgb([2, -1, 0])).toBe(0xff0000);
  });
});

describe("easing the light between the sim's steps", () => {
  it("takes the first step at once", () => {
    const ease = new LightEase(1);
    ease.step(0.05);
    expect(ease.value).toBe(0.05);
  });

  it("reaches each step over the time since the one before, without jumps", () => {
    const ease = new LightEase();
    ease.step(1);
    ease.tick(2);
    ease.step(0.8);
    // Two seconds between steps: halfway after one.
    ease.tick(1);
    expect(ease.value).toBeCloseTo(0.9);
    ease.tick(1);
    expect(ease.value).toBeCloseTo(0.8);
    ease.tick(5);
    expect(ease.value).toBeCloseTo(0.8);
    // A step that comes mid-way starts from where the light is shown, not from the last step.
    ease.step(0.2);
    ease.tick(0.01);
    expect(Math.abs(ease.value - 0.8)).toBeLessThan(0.01);
  });

  it("keeps each ease between its shortest and longest", () => {
    const quick = new LightEase();
    quick.step(1);
    quick.step(0);
    quick.tick(EASE_MIN_S);
    expect(quick.value).toBeCloseTo(0);
    const slow = new LightEase();
    slow.step(1);
    slow.tick(10 * EASE_MAX_S);
    slow.step(0);
    slow.tick(EASE_MAX_S);
    expect(slow.value).toBeCloseTo(0);
  });

  it("can be set at once", () => {
    const ease = new LightEase();
    ease.step(1);
    ease.tick(3);
    ease.step(0.1);
    ease.set(ease.target);
    expect(ease.value).toBe(0.1);
  });
});
