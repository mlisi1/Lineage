import { expect, test, type Page } from "@playwright/test";

async function open(page: Page, seconds: number): Promise<void> {
  await page.goto(`/look.html?still=${seconds}`);
  await page.waitForFunction(() => window.__lookReady === true, null, { timeout: 60_000 });
}

/** The picture named `name`, as the PNG the page would save. */
const png = (page: Page, name: string): Promise<string> =>
  page.evaluate(
    (picture) =>
      document
        .querySelector<HTMLCanvasElement>(`canvas[data-picture="${picture}"]`)
        ?.toDataURL("image/png") ?? "",
    name,
  );

test("the look sheet draws every picture", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await open(page, 2);
  expect(errors).toEqual([]);
  await expect(page.locator("#failure")).toBeHidden();
  await expect(page.locator("#world")).toContainText("seed 42");

  await expect(page.locator("#plant-sheet canvas")).toHaveCount(5 * 4 + 3 * 4);
  await expect(page.locator("#specimens figure.tile")).toHaveCount(15);
  await expect(page.locator("#specimens figure.tile").first()).toContainText("grazer");
  await expect(page.locator("#specimens figure.tile").first()).toContainText("herbivore");
  await expect(page.locator("#specimens")).toContainText("predator");
  await expect(page.locator("#specimens")).toContainText("swimmer");
  await expect(page.locator("#sweeps .sweep")).toHaveCount(10);
  await expect(page.locator("#sweeps figure.tile")).toHaveCount(50);

  // Nothing is left blank: every canvas holds more than one colour.
  const blank = await page.evaluate(() =>
    [...document.querySelectorAll("canvas")]
      .filter((canvas) => {
        const pixels = canvas
          .getContext("2d")
          ?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (pixels === undefined) return true;
        const seen = new Set<number>();
        for (let i = 0; i < pixels.length && seen.size < 2; i += 4) {
          seen.add(
            ((pixels[i] ?? 0) << 24) |
              ((pixels[i + 1] ?? 0) << 16) |
              ((pixels[i + 2] ?? 0) << 8) |
              (pixels[i + 3] ?? 0),
          );
        }
        return seen.size < 2;
      })
      .map((canvas) => canvas.getAttribute("aria-label")),
  );
  expect(blank).toEqual([]);

  // The staged shot is drawn at three sizes of art pixel and shown at the screen's size.
  const sizes = await page.evaluate(() =>
    ["together-1x", "together-2x", "together-4x"].map((name) => {
      const canvas = document.querySelector<HTMLCanvasElement>(`canvas[data-picture="${name}"]`);
      return [canvas?.width, canvas?.height, canvas?.getBoundingClientRect().width];
    }),
  );
  expect(sizes).toEqual([
    [1024, 600, 1024],
    [512, 300, 1024],
    [256, 150, 1024],
  ]);
  // By day the light changes nothing; by night it does. Plants and creatures show on the map.
  expect(await png(page, "light-day")).toBe(await png(page, "together-2x"));
  expect(await png(page, "light-night")).not.toBe(await png(page, "light-day"));
  expect(await png(page, "wide-map")).not.toBe(await png(page, "wide-ground"));

  // Three ways to put plants on the ground: three different pictures of one place,
  // the painted one with far fewer drawings standing on it.
  for (const place of ["wood", "shore"]) {
    const pictures = await Promise.all(
      ["now", "green", "painted"].map((style) => png(page, `style-${place}-${style}`)),
    );
    expect(new Set(pictures).size).toBe(3);
  }
  const count = async (id: string): Promise<number> =>
    Number((await page.locator(id).textContent())?.replaceAll(",", ""));
  expect(await count("#count-icons")).toBeGreaterThan(10_000);
  expect(await count("#count-scattered")).toBeGreaterThan(1000);
  expect(await count("#count-scattered")).toBeLessThan((await count("#count-icons")) / 2);
});

test("the look sheet saves itself as one self-contained page", async ({ page }) => {
  await open(page, 1);
  const pictures = await page.locator("canvas").count();
  const html = await page.evaluate(() => window.__lookStandalone?.() ?? "");
  expect(html.startsWith("<!doctype html>")).toBe(true);
  expect(html).not.toContain("<canvas");
  expect(html).not.toContain("<script");
  expect(html).not.toMatch(/\s(src|href)="(?!data:image\/png;base64,)/);

  await page.setContent(html);
  await expect(page.locator("img")).toHaveCount(pictures);
  const broken = await page.evaluate(
    () =>
      [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  );
  expect(broken).toBe(0);
  await expect(page.getByText("A still copy")).toBeVisible();
  await expect(page.getByText("This page is live")).toHaveCount(0);
  // Pixel art stays hard-edged and keeps its enlarged size.
  const tile = page.locator("#specimens img").first();
  expect(await tile.evaluate((image) => getComputedStyle(image).imageRendering)).toBe("pixelated");
  expect((await tile.boundingBox())?.width).toBe(192);
});

test("the still pictures are the same every time", async ({ page }) => {
  await open(page, 1);
  const first = [await png(page, "together-2x"), await png(page, "wide-map")];
  await open(page, 1);
  expect([await png(page, "together-2x"), await png(page, "wide-map")]).toEqual(first);
});
