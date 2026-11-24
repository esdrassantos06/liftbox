import { expect, test, type Page } from "@playwright/test";

const section = (page: Page) => page.getByRole("region", { name: "Video and slideshow" });
const counter = (page: Page) => page.locator(".eg-counter");
const currentVideo = (page: Page) => page.locator(".eg-slide[data-current] video");

async function openClip(page: Page) {
  await section(page).getByRole("button", { name: "Open Sample clip" }).click();
  await expect(page.locator(".eg-root")).toHaveAttribute("data-state", "open");
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("plays a native video with captions and pauses it when the slide changes", async ({
  page,
}) => {
  await openClip(page);
  const video = currentVideo(page);
  await expect(video).toHaveAttribute("playsinline", "");
  await expect(video).toHaveAttribute("preload", "metadata");
  await expect(video).toHaveAttribute("poster", "/videos/sample-clip-poster.jpg");
  expect(await video.evaluate((v: HTMLVideoElement) => v.textTracks.length)).toBe(1);
  await video.evaluate(async (v: HTMLVideoElement) => {
    v.muted = true;
    await v.play();
  });
  await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(false);
  const handle = await video.elementHandle();
  await page.getByRole("button", { name: "Next image" }).click();
  await expect(counter(page)).toHaveText("2 / 7");
  expect(await handle!.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);
});

test("hides zoom on video slides and keeps arrow keys for a focused player", async ({ page }) => {
  await openClip(page);
  await expect(page.getByRole("button", { name: "Zoom in" })).toHaveCount(0);
  await currentVideo(page).focus();
  await page.keyboard.press("ArrowRight");
  await expect(counter(page)).toHaveText("1 / 7");
});

test("shows an iframe slide only while it is current", async ({ page }) => {
  await openClip(page);
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await expect(counter(page)).toHaveText("5 / 7");
  const frame = page.locator(".eg-slide[data-current] iframe");
  await expect(frame).toHaveAttribute("title", "Embedded page · iframe slide");
  await expect(
    page
      .frameLocator(".eg-slide[data-current] iframe")
      .getByRole("heading", { name: "Embedded page" }),
  ).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".eg-root iframe")).toHaveCount(0);
});

test("runs the slideshow with a progress bar and pauses on manual navigation", async ({ page }) => {
  await page.getByRole("slider", { name: "Interval" }).focus();
  await page.keyboard.press("Home");
  await section(page).getByRole("button", { name: "Open Sample 07" }).click();
  await expect(counter(page)).toHaveText("2 / 7");
  await page.getByRole("button", { name: "Start slideshow" }).click();
  await expect(page.locator(".eg-progress")).toBeVisible();
  await expect(counter(page)).toHaveText("3 / 7", { timeout: 3000 });
  await expect(counter(page)).toHaveText("4 / 7", { timeout: 3000 });
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "Start slideshow" })).toBeVisible();
  await expect(page.locator(".eg-progress")).toHaveCount(0);
  await page.waitForTimeout(1500);
  await expect(counter(page)).toHaveText("3 / 7");
});

test("holds the slideshow on an iframe slide", async ({ page }) => {
  await page.getByRole("slider", { name: "Interval" }).focus();
  await page.keyboard.press("Home");
  await section(page).getByRole("button", { name: "Open Sample 09" }).click();
  await page.getByRole("button", { name: "Start slideshow" }).click();
  await expect(counter(page)).toHaveText("5 / 7", { timeout: 3000 });
  await page.waitForTimeout(1500);
  await expect(counter(page)).toHaveText("5 / 7");
  await expect(page.getByRole("button", { name: "Pause slideshow" })).toBeVisible();
});
