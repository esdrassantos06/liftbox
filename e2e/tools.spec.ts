import { expect, test, type Page } from "@playwright/test";

const gallery = (page: Page) => page.getByRole("region", { name: "Default look" });
const counter = (page: Page) => page.locator(".eg-counter");
const dialog = (page: Page) => page.getByRole("dialog", { name: "Image viewer" });
const hash = (page: Page) => page.evaluate(() => window.location.hash);

test.describe("deep linking", () => {
  test("opens the slide named in the URL", async ({ page }) => {
    await page.goto("/#galeria-4");
    await expect(dialog(page)).toBeVisible();
    await expect(counter(page)).toHaveText("4 / 12");
  });

  test("keeps the hash in sync, closes on back and reopens on forward", async ({ page }) => {
    await page.goto("/");
    await gallery(page).getByRole("button", { name: "Open Sample 02" }).click();
    await expect(dialog(page)).toBeVisible();
    expect(await hash(page)).toBe("#galeria-2");
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText("3 / 12");
    expect(await hash(page)).toBe("#galeria-3");
    await page.goBack();
    await expect(dialog(page)).toBeHidden();
    expect(await hash(page)).toBe("");
    await page.goForward();
    await expect(dialog(page)).toBeVisible();
    await expect(counter(page)).toHaveText("3 / 12");
  });

  test("restores the previous URL when closed from the viewer", async ({ page }) => {
    await page.goto("/?demo=1#usage");
    await gallery(page).getByRole("button", { name: "Open Sample 05" }).click();
    await expect(dialog(page)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => window.location.search + window.location.hash))
      .toBe("?demo=1#usage");
    await expect(gallery(page).getByRole("button", { name: "Open Sample 05" })).toBeFocused();
  });

  test("leaves unrelated hashes alone", async ({ page }) => {
    await page.goto("/#usage");
    await expect(dialog(page)).toBeHidden();
    await page.goto("/#galeria-99");
    await expect(dialog(page)).toBeHidden();
  });
});

test.describe("rotation", () => {
  test("turns the image in quarter steps and keeps it inside the viewport", async ({ page }) => {
    await page.goto("/");
    await gallery(page).getByRole("button", { name: "Open Sample 01" }).click();
    await expect(page.locator(".eg-root")).toHaveAttribute("data-state", "open");
    await dialog(page).getByRole("button", { name: "Rotate right" }).click();
    const image = page.locator(".eg-slide[data-current] .eg-image");
    await expect(image).toHaveCSS("transform", /matrix\(/);
    await page.waitForTimeout(500);
    const box = await image.boundingBox();
    const viewport = page.viewportSize()!;
    expect(box!.height).toBeGreaterThan(box!.width);
    expect(box!.x).toBeGreaterThanOrEqual(-1);
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
    await page.keyboard.press("0");
    await expect(image).toHaveCSS("transform", "none");
  });
});

test.describe("download", () => {
  test("saves the current image with its file name", async ({ page }) => {
    await page.goto("/");
    await gallery(page).getByRole("button", { name: "Open Sample 03" }).click();
    await expect(page.locator(".eg-root")).toHaveAttribute("data-state", "open");
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      dialog(page).getByRole("button", { name: "Download" }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("sample-03-full.jpg");
  });
});
