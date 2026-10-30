/**
 * The ground's colour pass on the GPU (R5, the optimization plan; the owner, 2026-10-28:
 * the same to the eye, not to the byte): the painters do it on their own GPU context, and
 * what they paint differs from the CPU's in no more than a few pixels of a piece.
 */
import { expect, test } from "@playwright/test";

test("the painters do the ground's colour pass on their GPU, and on the CPU when asked", async ({
  page,
}) => {
  for (const [query, on] of [
    ["seed=1&view=local&x=64&y=71&ground=fresh", "gpu"],
    ["seed=1&view=local&x=64&y=71&ground=fresh&painter=cpu", "cpu"],
  ] as const) {
    await page.goto(`/?${query}`);
    await page.waitForFunction(() => window.__sceneSettled?.() === true, null, {
      timeout: 120_000,
    });
    const made = await page.evaluate(() => window.__groundMade?.());
    expect(made?.[on]).toBeGreaterThan(0);
    expect(made?.[on === "gpu" ? "cpu" : "gpu"]).toBe(0);
  }
});

test("a piece painted on the GPU is the CPU's to the eye: a few pixels of thousands", async ({
  page,
}) => {
  test.setTimeout(240_000);
  for (const recording of ["life", "winter"]) {
    await page.goto(`/?film&seed=1&view=map&recording=${recording}`);
    await page.waitForFunction(() => typeof window.__frame === "function", null, {
      timeout: 60_000,
    });
    // A film is still until stepped: a few frames lay its land out.
    await page.waitForFunction(
      () => {
        window.__frame?.(1 / 30);
        return window.__paintBoth?.({ tile: 2, style: "smooth", grain: false }) != null;
      },
      null,
      { timeout: 60_000 },
    );
    for (const time of [undefined, { season: "autumn", progress: 0.97 }] as const) {
      for (const [tile, size, style] of [
        [32, 8, "blended"],
        [8, 32, "blended"],
        [2, 0, "smooth"],
      ] as const) {
        const request = {
          tile,
          style,
          grain: size > 0,
          surf: true,
          ...(time === undefined ? {} : { time }),
          ...(size === 0
            ? {}
            : {
                cells: { x0: 99, y0: 59, x1: 101 + size, y1: 61 + size },
                shown: { x0: 100, y0: 60, x1: 100 + size, y1: 60 + size },
              }),
        };
        const both = await page.evaluate((asked) => window.__paintBoth?.(asked), request);
        expect(both).not.toBeNull();
        // A pixel on the edge of a threshold may fall the other way: no more than one in a thousand.
        expect((both?.differ ?? 1) / (both?.pixels ?? 1)).toBeLessThan(0.001);
      }
    }
  }
});
