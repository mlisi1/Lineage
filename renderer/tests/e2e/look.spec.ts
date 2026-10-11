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

  // Creatures up close: fifteen specimens, twelve markings on two bodies, ten genes swept.
  await expect(page.locator("#specimens figure.tile")).toHaveCount(15);
  await expect(page.locator("#specimens figure.tile").first()).toContainText("grazer");
  for (const word of ["beetle", "crab", "tortoise", "worm", "predator", "eyespots", "chevrons"]) {
    await expect(page.locator("#specimens")).toContainText(word);
  }
  for (const body of ["beast", "beetle"]) {
    await expect(page.locator(`#patterns-${body} figure.tile`)).toHaveCount(12);
    await expect(page.locator(`#patterns-${body}`)).toContainText("rings");
  }
  await expect(page.locator("#sweeps .sweep")).toHaveCount(10);
  await expect(page.locator("#sweeps figure.tile")).toHaveCount(50);
  await expect(page.locator("#sweeps .sweep").nth(1)).toContainText("spider");
  await expect(page.locator("#sweeps .sweep").nth(5)).toContainText("flippers");
  // The local view's parts: two sheets of trees and bushes per style, two of small
  // plants, and a sample of every kind of ground.
  for (const style of ["bundles", "dome", "limbs"]) {
    await expect(page.locator(`#trees-${style} canvas`)).toHaveCount(2);
  }
  await expect(page.locator("#plants-small canvas")).toHaveCount(2);
  await expect(page.locator("#ground-samples figure.tile")).toHaveCount(13);
  await expect(page.locator("#ground-samples")).toContainText("lichen on rock");

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

  // Every view is drawn with art pixels of 2; all but the lights are shown at the screen's size.
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLCanvasElement>("canvas[data-picture]")].map((canvas) =>
      [canvas.width, canvas.height, canvas.getBoundingClientRect().width].join(),
    ),
  );
  expect(sizes).toHaveLength(17);
  expect(sizes.filter((size) => size === "512,300,1024")).toHaveLength(13);
  expect(sizes.filter((size) => size === "512,300,512")).toHaveLength(4);

  // The three views; the ground read over one, two and three cells; the wood in each
  // style of tree; the animals at each size; the lights: each set is so many pictures.
  const sets = [
    ["map", "mid-shore", "size-2"],
    ["mid-shore", "mid-wood"],
    ["ground-1", "ground-2", "ground-3"],
    ["wood-bundles", "wood-dome", "wood-limbs"],
    ["size-1", "size-2", "size-3"],
    ["size-2", "wood-bundles", "local-shore"],
    ["day", "dusk", "night", "dawn"].map((light) => `light-${light}`),
  ];
  for (const names of sets) {
    const pictures = await Promise.all(names.map((name) => png(page, name)));
    expect(pictures.every((picture) => picture.length > 1000)).toBe(true);
    expect(new Set(pictures).size).toBe(names.length);
  }
  // By day the light changes nothing.
  expect(await png(page, "light-day")).toBe(await png(page, "local-shore"));
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
  const tile = page.locator("#specimens img").first();
  expect(await tile.evaluate((image) => getComputedStyle(image).imageRendering)).toBe("pixelated");
  expect((await tile.boundingBox())?.width).toBe(224);
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
  expect(await frames("The local view, animals at 0.5")).toBe(2);
  expect(await frames("A wood of trees as domes")).toBe(2);
  expect(await frames("The map view")).toBe(2);
  expect(await frames("grazer: beast · herbivore · mass 0.9 · bands")).toBe(2);
  expect(await frames("eyespots")).toBe(2);
  expect(await frames("The ground read over two cells around")).toBe(1);
  expect(await frames("bundles: broadleaf trees and conifers")).toBe(1);
  expect(await frames("Ground: lichen on rock")).toBe(1);
  expect(await frames("The shore at night")).toBe(1);
  const broken = await page.evaluate(
    () =>
      [...document.images].filter((image) => !image.complete || image.naturalWidth === 0).length,
  );
  expect(broken).toBe(0);
});

test("the still pictures are the same every time", async ({ page }) => {
  await open(page, 1);
  const names = ["size-2", "wood-limbs", "ground-2", "map"];
  const first = await Promise.all(names.map((name) => png(page, name)));
  await open(page, 1);
  expect(await Promise.all(names.map((name) => png(page, name)))).toEqual(first);
});
