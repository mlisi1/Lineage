import { expect, test } from "@playwright/test";

test("renders the stage canvas at the desk resolution", async ({ page }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  const canvas = page.getByTestId("stage");
  await expect(canvas).toBeVisible();
  const box = await canvas.boundingBox();
  expect(box?.width).toBe(1024);
  expect(box?.height).toBe(600);
  expect(errors).toEqual([]);
});
