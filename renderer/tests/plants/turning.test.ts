import { describe, expect, it } from "vitest";
import { SEASONS } from "../../src/plants/seasons";
import {
  TURN_SEASONS,
  groundEarliness,
  isTurning,
  later,
  phaseOf,
  plantEarliness,
  seasonShown,
  seasonsInPlay,
} from "../../src/plants/turning";

describe("the turn of the year", () => {
  it("shows the season everywhere in the middle of it", () => {
    for (const season of SEASONS) {
      const time = { season, progress: 0.5 };
      for (const earliness of [-1, -0.3, 0, 0.6, 1]) {
        expect(seasonShown(time, earliness)).toBe(season);
      }
      expect(isTurning(time)).toBe(false);
      expect(seasonsInPlay(time)).toEqual([season]);
    }
  });

  it("turns the earliest places first, and all of them within the window", () => {
    const change = { season: "autumn" as const, progress: 0 };
    expect(seasonShown(change, 1)).toBe("autumn");
    expect(seasonShown(change, -1)).toBe("summer");
    expect(seasonsInPlay(change)).toEqual(["summer", "autumn"]);
    // Half the window before the change only the very earliest has turned; half after, all.
    const before = later(change, -(TURN_SEASONS / 2) * 91.3 + 0.5);
    const after = later(change, (TURN_SEASONS / 2) * 91.3 + 0.5);
    expect(seasonShown(before, 0)).toBe("summer");
    expect(seasonShown(before, 1)).toBe("autumn");
    expect(seasonShown(after, -1)).toBe("autumn");
  });

  it("wraps from winter into spring", () => {
    const time = later({ season: "winter", progress: 0.95 }, 10);
    expect(time.season).toBe("spring");
    expect(phaseOf(time)).toBeLessThan(0.2);
    expect(seasonShown({ season: "spring", progress: 0 }, -1)).toBe("winter");
  });

  it("brings autumn down from the hills and spring up to them", () => {
    const intoAutumn = { season: "summer" as const, progress: 0.95 };
    const intoSpring = { season: "winter" as const, progress: 0.95 };
    const low = 0.02;
    const high = 0.4;
    expect(groundEarliness(intoAutumn, 10, 10, high)).toBeGreaterThan(
      groundEarliness(intoAutumn, 10, 10, low),
    );
    expect(groundEarliness(intoSpring, 10, 10, high)).toBeLessThan(
      groundEarliness(intoSpring, 10, 10, low),
    );
  });

  it("sweeps across the land in fronts, not in specks", () => {
    const time = { season: "summer" as const, progress: 0.95 };
    // Neighbouring places turn at nearly the same time; places far apart need not.
    const near = Math.abs(groundEarliness(time, 40, 40, 0.1) - groundEarliness(time, 41, 40, 0.1));
    expect(near).toBeLessThan(0.1);
    const spread = [0, 30, 60, 90, 120].map((x) => groundEarliness(time, x, 70, 0.1));
    expect(Math.max(...spread) - Math.min(...spread)).toBeGreaterThan(0.2);
  });

  it("keeps an evergreen's leaves longer, and its gene does not hold back spring", () => {
    const intoAutumn = { season: "summer" as const, progress: 0.95 };
    const intoWinter = { season: "autumn" as const, progress: 0.95 };
    const intoSpring = { season: "winter" as const, progress: 0.95 };
    for (const time of [intoAutumn, intoWinter]) {
      expect(plantEarliness(time, 5, 7, 0.1, 0.9)).toBeLessThan(
        plantEarliness(time, 5, 7, 0.1, 0.1),
      );
    }
    expect(plantEarliness(intoSpring, 5, 7, 0.1, 0.9)).toBe(
      plantEarliness(intoSpring, 5, 7, 0.1, 0.1),
    );
  });

  it("turns each plant on its own day near its place's", () => {
    const time = { season: "summer" as const, progress: 0.95 };
    const own = [0, 1, 2, 3, 4, 5].map((x) => plantEarliness(time, 20 + x, 20, 0.1));
    expect(new Set(own.map((value) => value.toFixed(3))).size).toBeGreaterThan(3);
  });
});
