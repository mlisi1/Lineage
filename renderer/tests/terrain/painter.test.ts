import { describe, expect, it } from "vitest";
import { BACKGROUND, Dropped, InlinePainter, paintRequest } from "../../src/terrain/painter";
import { paintGround } from "../../src/terrain/ground";
import { COSY } from "../../src/looks";
import { LAND_PALETTE } from "../../src/terrain/palette";
import { world } from "../spike/worlds";

const land = { ...world(["~~gggg", "~sggbb", "~~ggcc"]), ...LAND_PALETTE };
const request = { tile: 8, style: "blended", grain: true } as const;

describe("painting off the frame", () => {
  it("paints what the painter itself would, in the look asked for", () => {
    const painted = paintRequest(land, { ...request, look: "cosy" });
    const direct = paintGround(land, { ...request, look: COSY });
    expect(painted.rgba).toEqual(direct.rgba);
  });

  it("turns the ground place by place when given the year's time", () => {
    const summer = paintRequest(land, { ...request, time: { season: "summer", progress: 0.5 } });
    const turning = paintRequest(land, { ...request, time: { season: "autumn", progress: 0 } });
    const autumn = paintRequest(land, { ...request, time: { season: "autumn", progress: 0.5 } });
    expect(turning.rgba).not.toEqual(summer.rgba);
    expect(turning.rgba).not.toEqual(autumn.rgba);
  });

  it("paints the nearest first, the oldest of equals first, and drops what is not wanted", async () => {
    const painter = new InlinePainter();
    expect(painter.setLand(land)).toBe(1);
    const order: string[] = [];
    const ask = (name: string, priority: number): Promise<void> =>
      painter
        .paint({ ...request, cells: { x0: 0, y0: 0, x1: 2, y1: 2 } }, priority)
        .then(() => {
          order.push(name);
        })
        .catch((error: unknown) => {
          order.push(error instanceof Dropped ? `${name} dropped` : "failed");
        });
    // The first starts at once; the rest wait their turn by priority.
    const all = [ask("first", 9), ask("far", 5), ask("near", 1), ask("near too", 1)];
    const doomed = painter.paint({ ...request, tile: 4 }, 0).catch((error: unknown) => {
      order.push(error instanceof Dropped ? "small dropped" : "failed");
    });
    painter.drop((queued) => queued.tile === 4);
    await Promise.all([...all, doomed]);
    expect(order).toEqual(["small dropped", "first", "near", "near too", "far"]);
    expect(painter.busy).toBe(0);
  });

  it("says which land a painting is of", async () => {
    const painter = new InlinePainter();
    painter.setLand(land);
    const version = painter.setLand({ ...land, seaLevel: land.seaLevel + 0.01 });
    const { landVersion } = await painter.paint(request);
    expect(landVersion).toBe(version);
  });

  it("does not count what is painted in the background as busy, and paints it last", async () => {
    const painter = new InlinePainter();
    painter.setLand(land);
    const order: string[] = [];
    const behind = painter.paint(request, BACKGROUND).then(() => order.push("behind"));
    const after = painter.paint(request, BACKGROUND + 1).then(() => order.push("after"));
    const near = painter.paint(request, 3).then(() => order.push("near"));
    // The first in the background has started; the near one counts, the other does not.
    expect(painter.busy).toBe(1);
    await Promise.all([behind, after, near]);
    expect(order).toEqual(["behind", "near", "after"]);
    expect(painter.busy).toBe(0);
  });
});
