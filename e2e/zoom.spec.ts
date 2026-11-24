import { expect, test, type Page } from "@playwright/test";

const gallery = (page: Page) => page.getByRole("region", { name: "Default look" });

async function open(page: Page, n: number) {
  await gallery(page)
    .getByRole("button", { name: `Open Sample ${String(n).padStart(2, "0")}` })
    .click();
  const viewer = page.getByRole("dialog", { name: "Image viewer" });
  await expect(page.locator(".eg-root")).toHaveAttribute("data-state", "open");
  return viewer;
}

const zoomScale = (page: Page) =>
  page.locator(".eg-slide[data-current] .eg-zoom").evaluate((el) => {
    const match = (el as HTMLElement).style.transform.match(/scale\(([\d.]+)\)/);
    return match ? Number(match[1]) : 1;
  });

async function touch(
  page: Page,
  events: { type: "touchStart" | "touchMove" | "touchEnd"; points: { x: number; y: number }[] }[],
) {
  const cdp = await page.context().newCDPSession(page);
  for (const { type, points } of events) {
    await cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: points.map((p, id) => ({ ...p, id })),
    });
  }
  await cdp.detach();
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test.describe("thumbnail strip", () => {
  test("marks the current slide, navigates and keeps the active thumbnail in view", async ({
    page,
  }) => {
    const viewer = await open(page, 1);
    const strip = viewer.getByRole("navigation", { name: "Thumbnails" });
    await expect(strip.getByRole("button")).toHaveCount(12);
    await expect(strip.getByRole("button", { name: "Show image 1", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
    await page.keyboard.press("End");
    const last = strip.getByRole("button", { name: "Show image 12", exact: true });
    await expect(last).toHaveAttribute("aria-current", "true");
    await expect(last).toBeInViewport();
    await strip.getByRole("button", { name: "Show image 11", exact: true }).click();
    await expect(viewer.locator(".eg-counter")).toHaveText("11 / 12");
  });

  test("sits below the image and the caption sits above it", async ({ page }) => {
    const viewer = await open(page, 1);
    const strip = await viewer.locator(".eg-thumbnails").boundingBox();
    const caption = await viewer.locator(".eg-caption").boundingBox();
    const image = await viewer.locator(".eg-slide[data-current] .eg-image").boundingBox();
    expect(strip && caption && image).toBeTruthy();
    expect(caption!.y + caption!.height).toBeLessThanOrEqual(strip!.y + 1);
    expect(image!.y + image!.height).toBeLessThanOrEqual(strip!.y + 1);
  });
});

test.describe("zoom", () => {
  test("zooms with the buttons and resets when the slide changes", async ({ page }) => {
    const viewer = await open(page, 3);
    await viewer.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(() => zoomScale(page)).toBe(1.5);
    await expect(page.locator(".eg-root")).toHaveAttribute("data-zoomed", "true");
    await viewer.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(() => zoomScale(page)).toBe(1);
    await viewer.getByRole("button", { name: "Zoom in" }).click();
    await page.keyboard.press("ArrowRight");
    await expect(viewer.locator(".eg-counter")).toHaveText("4 / 12");
    await expect(page.locator(".eg-root")).not.toHaveAttribute("data-zoomed");
  });

  test("zooms with the keyboard", async ({ page }) => {
    await open(page, 3);
    await page.keyboard.press("+");
    await expect.poll(() => zoomScale(page)).toBe(1.5);
    await page.keyboard.press("0");
    await expect.poll(() => zoomScale(page)).toBe(1);
  });

  test("zooms on double click at the pointer and pans without leaving the stage", async ({
    page,
  }) => {
    test.skip(test.info().project.name === "mobile", "Mouse only");
    await open(page, 5);
    const viewport = page.viewportSize()!;
    await page.mouse.dblclick(viewport.width / 2, viewport.height / 2);
    await expect.poll(() => zoomScale(page)).toBe(2);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.down();
    await page.mouse.move(viewport.width / 2 + 400, viewport.height / 2 + 600, { steps: 8 });
    await page.mouse.up();
    const box = await page.locator(".eg-slide[data-current] .eg-zoom").boundingBox();
    expect(box!.y).toBeLessThanOrEqual(1);
    await expect(page.locator(".eg-counter")).toHaveText("5 / 12");
  });

  test("zooms with the mouse wheel", async ({ page }) => {
    test.skip(test.info().project.name === "mobile", "Mouse only");
    await open(page, 2);
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -300);
    await expect.poll(() => zoomScale(page)).toBeGreaterThan(1);
  });

  test("double taps and pinches with real touches", async ({ page }) => {
    test.skip(test.info().project.name !== "mobile", "Touch only");
    await open(page, 3);
    const viewport = page.viewportSize()!;
    const c = { x: viewport.width / 2, y: viewport.height / 2 };
    await touch(page, [
      { type: "touchStart", points: [c] },
      { type: "touchEnd", points: [] },
      { type: "touchStart", points: [c] },
      { type: "touchEnd", points: [] },
    ]);
    await expect.poll(() => zoomScale(page)).toBe(2);
    await touch(page, [
      { type: "touchStart", points: [c] },
      { type: "touchEnd", points: [] },
      { type: "touchStart", points: [c] },
      { type: "touchEnd", points: [] },
    ]);
    await expect.poll(() => zoomScale(page)).toBe(1);
    const steps = Array.from({ length: 6 }, (_, i) => ({
      type: "touchMove" as const,
      points: [
        { x: c.x - 40 - i * 12, y: c.y },
        { x: c.x + 40 + i * 12, y: c.y },
      ],
    }));
    await touch(page, [
      {
        type: "touchStart",
        points: [
          { x: c.x - 40, y: c.y },
          { x: c.x + 40, y: c.y },
        ],
      },
      ...steps,
      { type: "touchEnd", points: [] },
    ]);
    await expect.poll(() => zoomScale(page)).toBeGreaterThan(1.5);
    await expect(page.locator(".eg-counter")).toHaveText("3 / 12");
  });
});

test.describe("fullscreen", () => {
  test("enters and leaves fullscreen with an accessible toggle", async ({ page }) => {
    test.skip(
      test.info().project.name === "mobile",
      "Element fullscreen is a desktop feature here",
    );
    const viewer = await open(page, 1);
    await viewer.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(viewer.getByRole("button", { name: "Exit fullscreen" })).toBeVisible();
    expect(
      await page.evaluate(() => document.fullscreenElement?.classList.contains("eg-root")),
    ).toBe(true);
    await viewer.getByRole("button", { name: "Exit fullscreen" }).click();
    await expect(viewer.getByRole("button", { name: "Enter fullscreen" })).toBeVisible();
    expect(await page.evaluate(() => document.fullscreenElement)).toBeNull();
  });
});

test("shows a message for an image that fails to load", async ({ page }) => {
  await page.route("**/samples/sample-07-*.jpg", (route) => route.abort());
  await open(page, 7);
  await expect(page.locator(".eg-slide[data-current]")).toHaveAttribute("data-status", "error");
  await expect(page.locator(".eg-slide[data-current]")).toContainText(
    "This image could not be loaded.",
  );
});
