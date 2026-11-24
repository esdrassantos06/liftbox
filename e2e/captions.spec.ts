import { expect, test, type Page } from "@playwright/test";

const section = (page: Page) => page.getByRole("region", { name: "Interaction polish" });

async function open(page: Page, n = 1) {
  await section(page)
    .getByRole("button", { name: `Open Sample ${String(n).padStart(2, "0")}` })
    .click();
  await expect(page.locator(".eg-root")).toHaveAttribute("data-state", "open");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("lays the caption over the bottom of its own image", async ({ page }) => {
  const options = page.getByRole("form", { name: "Polish options" });
  await options.getByRole("switch", { name: "Caption inside the slide" }).click();
  await options.getByRole("switch", { name: "Thumbnail strip" }).click();
  await open(page);
  const current = page.locator(".eg-slide[data-current]");
  const caption = current.locator(".eg-caption");
  await expect(caption).toContainText("Sample 01");
  await expect(page.locator(".eg-root > .eg-caption")).toHaveCount(0);
  const image = (await current.locator(".eg-image").boundingBox())!;
  const box = (await caption.boundingBox())!;
  expect(Math.abs(box.x - image.x)).toBeLessThan(1);
  expect(Math.abs(box.width - image.width)).toBeLessThan(1);
  expect(Math.abs(box.y + box.height - (image.y + image.height))).toBeLessThan(1);
});

test("starts the flight cropped like the square thumbnail it leaves", async ({ page }) => {
  await page.addInitScript(() => {
    const animate = Element.prototype.animate;
    const flights: unknown[] = [];
    Object.assign(window, { flights });
    Element.prototype.animate = function (keyframes, options) {
      if (this.matches(".eg-image")) flights.push(keyframes);
      return animate.call(this, keyframes, options);
    };
  });
  await page.reload();
  await open(page);
  const [first] = (await page.evaluate(
    () => (window as unknown as { flights: Keyframe[][] }).flights[0],
  ))!;
  const thumbnail = (await section(page)
    .getByRole("button", { name: "Open Sample 01" })
    .boundingBox())!;
  const image = (await page.locator(".eg-slide[data-current] .eg-image").boundingBox())!;
  const scale = Math.max(thumbnail.width / image.width, thumbnail.height / image.height);
  const [top, side] = String(first?.clipPath)
    .match(/[\d.]+/g)!
    .map(Number);
  expect(top).toBe(0);
  expect((image.width - side! * 2) * scale).toBeCloseTo(thumbnail.width, 0);
});

test("keeps the caption below a video's controls", async ({ page }) => {
  await page
    .getByRole("region", { name: "Video and slideshow" })
    .getByRole("button")
    .first()
    .click();
  await expect(page.locator(".eg-root")).toHaveAttribute("data-state", "open");
  const player = (await page.locator(".eg-slide[data-current] video").boundingBox())!;
  const caption = (await page.locator(".eg-caption").boundingBox())!;
  expect(player.y + player.height).toBeLessThanOrEqual(caption.y + 1);
});
