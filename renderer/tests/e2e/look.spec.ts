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

  // Creatures: fifteen specimens in each of three styles, and ten genes swept in five steps.
  for (const style of ["circles", "shapes", "lit"]) {
    await expect(page.locator(`#specimens-${style} figure.tile`)).toHaveCount(15);
    await expect(page.locator(`#specimens-${style} figure.tile`).first()).toContainText("grazer");
  }
  await expect(page.locator("#specimens-circles")).not.toContainText("beetle");
  for (const kind of ["beetle", "crab", "tortoise", "worm", "predator"]) {
    await expect(page.locator("#specimens-lit")).toContainText(kind);
  }
  await expect(page.locator("#sweeps .sweep")).toHaveCount(10);
  await expect(page.locator("#sweeps figure.tile")).toHaveCount(50);
  await expect(page.locator("#sweeps .sweep").nth(1)).toContainText("spider");
  // Plants: a strip of drawings per size.
  await expect(page.locator(".strip canvas")).toHaveCount(3);

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

  // Every view is drawn with art pixels of 2 and shown at the screen's size.
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>("canvas[data-picture]")].map((canvas) =>
      [canvas.width, canvas.height, canvas.getBoundingClientRect().width].join(),
    ),
  );
  expect(sizes).toHaveLength(25);
  expect(new Set(sizes)).toEqual(new Set(["512,300,1024"]));

  // Each set of proposals is so many different pictures of the same thing.
  const proposals = [
    ["map-squares", "map-smooth", "map-markers"],
    ["warped", "tiles", "smooth", "blended"].map((style) => `ground-${style}-shore`),
    ["warped", "tiles", "smooth", "blended"].map((style) => `ground-${style}-wood`),
    ["small", "medium", "large"].map((size) => `plants-${size}-wood`),
    ["1x", "1.5x", "2x"].map((size) => `creatures-${size}`),
    ["day", "dusk", "night", "dawn"].map((light) => `light-${light}`),
    ["light-day", "closer"],
  ];
  for (const names of proposals) {
    const pictures = await Promise.all(names.map((name) => png(page, name)));
    expect(pictures.every((picture) => picture.length > 1000)).toBe(true);
    expect(new Set(pictures).size).toBe(names.length);
  }
  // What the others are held at is the pick: the same picture under two names.
  expect(await png(page, "creatures-1.5x")).toBe(await png(page, "light-day"));
  expect(await png(page, "plants-medium-shore")).toBe(await png(page, "light-day"));
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
  await expect(page.getByText("A copy to read anywhere")).toBeVisible();
  await expect(page.getByText("This page is live")).toHaveCount(0);
  // Pixel art stays hard-edged and keeps its enlarged size.
  const tile = page.locator("#specimens-lit img").first();
  expect(await tile.evaluate((image) => getComputedStyle(image).imageRendering)).toBe("pixelated");
  expect((await tile.boundingBox())?.width).toBe(168);
});

test("the saved page can carry the animals moving, as loops that need no script", async ({
  page,
}) => {
  await open(page, 1);
  const html = await page.evaluate(() => window.__lookStandalone?.({ seconds: 0.5, fps: 4 }) ?? "");
  expect(html).not.toContain("<script");
  await page.setContent(html);
  /** How many frames the picture with this label holds: an animated PNG says so. */
  const frames = (label: string): Promise<number> =>
    page.evaluate((alt) => {
      const image = document.querySelector<HTMLImageElement>(`img[alt="${alt}"]`);
      const bytes = atob(image?.src.split(",")[1] ?? "");
      const at = bytes.indexOf("acTL");
      if (at < 0) return 1;
      return [4, 5, 6, 7].reduce((count, i) => count * 256 + bytes.charCodeAt(at + i), 0);
    }, label);
  // Animals in the picture: a loop. None, or a light that is only a tint: a still.
  expect(await frames("Local view by day")).toBe(2);
  expect(await frames("Map view with animals as dots")).toBe(2);
  expect(await frames("grazer: beast · herbivore · mass 0.9")).toBe(2);
  expect(await frames("Wood, medium plants")).toBe(1);
  expect(await frames("Local view at night")).toBe(1);
  const broken = await page.evaluate(
    () =>
      [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  );
  expect(broken).toBe(0);
});

test("the still pictures are the same every time", async ({ page }) => {
  await open(page, 1);
  const first = [await png(page, "light-day"), await png(page, "map-markers")];
  await open(page, 1);
  expect([await png(page, "light-day"), await png(page, "map-markers")]).toEqual(first);
});
