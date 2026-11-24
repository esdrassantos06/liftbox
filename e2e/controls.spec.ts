import { expect, test, type Page } from "@playwright/test";

const section = (page: Page) => page.getByRole("region", { name: "Interaction polish" });
const options = (page: Page) => page.getByRole("form", { name: "Polish options" });
const dialog = (page: Page) => page.getByRole("dialog", { name: "Image viewer" });
const counter = (page: Page) => page.locator(".eg-counter");
const isMobile = () => test.info().project.name === "mobile";

async function open(page: Page, n = 1) {
  await section(page)
    .getByRole("button", { name: `Open Sample ${String(n).padStart(2, "0")}` })
    .click();
  await expect(page.locator(".eg-root")).toHaveAttribute("data-state", "open");
}

const mirrored = (page: Page) =>
  page.locator(".eg-slide[data-current] .eg-image").evaluate((el) => {
    const { a, d } = new DOMMatrix(getComputedStyle(el).transform);
    return { x: Math.sign(a), y: Math.sign(d) };
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

test.describe("toolbar overflow", () => {
  test("keeps every button in the row on a wide screen", async ({ page }) => {
    test.skip(isMobile(), "Wide screens only");
    await open(page);
    await expect(dialog(page).getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "More options" })).toHaveCount(0);
  });

  test("moves what does not fit into an accessible menu on a phone", async ({ page }) => {
    test.skip(!isMobile(), "Narrow screens only");
    await open(page);
    const more = dialog(page).getByRole("button", { name: "More options" });
    await expect(more).toBeVisible();
    await expect(dialog(page).getByRole("button", { name: "Close" })).toBeInViewport();
    await expect(dialog(page).getByRole("button", { name: "Zoom in" })).toBeHidden();
    await more.click();
    const menu = page.getByRole("menu", { name: "More options" });
    await expect(menu).toBeInViewport();
    await expect(menu.getByRole("menuitem").first()).toHaveText("Zoom in");
    await expect(menu.getByRole("menuitem").first()).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(menu.getByRole("menuitem").nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
    await expect(dialog(page)).toBeVisible();
    await more.click();
    await menu.getByRole("menuitem", { name: "Zoom in" }).click();
    await expect(page.locator(".eg-root")).toHaveAttribute("data-zoomed", "true");
    await expect(menu).toBeHidden();
    await expect(more).toBeFocused();
  });
});

test("flips on both axes and composes with rotation", async ({ page }) => {
  test.skip(isMobile(), "The phone layout reaches flip through the menu, covered above");
  await open(page);
  const viewer = dialog(page);
  await viewer.getByRole("button", { name: "Flip vertically" }).click();
  await expect.poll(() => mirrored(page)).toEqual({ x: 1, y: -1 });
  await page.keyboard.press("0");
  await viewer.getByRole("button", { name: "Rotate right" }).click();
  await viewer.getByRole("button", { name: "Flip horizontally" }).click();
  const transform = await page
    .locator(".eg-slide[data-current] .eg-image")
    .evaluate((el) => (el as HTMLElement).style.transform);
  expect(transform).toBe("rotate(90deg) scale(1, -1)");
});

test.describe("share", () => {
  test("hands the page link to the system share sheet", async ({ page }) => {
    await page.addInitScript(() => {
      const calls: ShareData[] = [];
      Object.assign(window, { shareCalls: calls });
      Object.defineProperty(navigator, "share", {
        configurable: true,
        value: (data: ShareData) => {
          calls.push(data);
          return Promise.resolve();
        },
      });
    });
    await page.goto("/");
    await open(page, 2);
    await dialog(page).getByRole("button", { name: "Share" }).click();
    const calls = await page.evaluate(
      () => (window as unknown as { shareCalls: ShareData[] }).shareCalls,
    );
    expect(calls).toEqual([{ url: page.url(), title: "Sample 02 · Teal column" }]);
  });

  test("copies the link where there is no share sheet", async ({ page, context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.addInitScript(() => {
      Object.defineProperty(Navigator.prototype, "share", { configurable: true, value: undefined });
    });
    await page.goto("/");
    await open(page);
    await dialog(page).getByRole("button", { name: "Share" }).click();
    await expect(dialog(page).getByRole("status")).toHaveText("Link copied");
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(page.url());
  });
});

test("navigates with the pager dots", async ({ page }) => {
  await open(page);
  const pager = dialog(page).getByRole("navigation", { name: "Slides" });
  await pager.getByRole("button", { name: "Go to image 5" }).click();
  await expect(counter(page)).toHaveText("5 / 12");
  await expect(pager.getByRole("button", { name: "Go to image 5" })).toHaveAttribute(
    "aria-current",
    "true",
  );
});

test.describe("right-to-left", () => {
  test.beforeEach(async ({ page }) => {
    await options(page).getByRole("switch", { name: "Right to left" }).click();
  });

  test("puts the next slide on the left and mirrors the arrow keys", async ({ page }) => {
    await open(page);
    const width = page.viewportSize()!.width;
    const next = await dialog(page).getByRole("button", { name: "Next image" }).boundingBox();
    expect(next!.x + next!.width / 2).toBeLessThan(width / 2);
    await page.keyboard.press("ArrowLeft");
    await expect(counter(page)).toHaveText("2 / 12");
    await page.keyboard.press("ArrowRight");
    await expect(counter(page)).toHaveText("1 / 12");
  });

  test("goes to the next slide on a swipe to the right", async ({ page }) => {
    test.skip(isMobile(), "Mouse drag");
    await open(page);
    const { width, height } = page.viewportSize()!;
    await page.mouse.move(width / 2, height / 2);
    await page.mouse.down();
    await page.mouse.move(width / 2 + 80, height / 2, { steps: 4 });
    await page.mouse.move(width / 2 + 200, height / 2, { steps: 4 });
    await page.mouse.up();
    await expect(counter(page)).toHaveText("2 / 12");
  });
});

test("hides idle controls and brings them back on input", async ({ page }) => {
  await options(page).getByRole("switch", { name: "Hide controls when idle" }).click();
  await open(page);
  const root = page.locator(".eg-root");
  await expect(root).toHaveAttribute("data-idle", "true", { timeout: 5000 });
  await expect(page.locator(".eg-top-bar")).toHaveCSS("opacity", "0");
  await page.keyboard.press("Shift");
  await expect(root).not.toHaveAttribute("data-idle");
  await expect(dialog(page).getByRole("button", { name: "Close" })).toBeVisible();
});

test("closes on a pinch under fit", async ({ page }) => {
  test.skip(!isMobile(), "Touch only");
  await open(page, 3);
  const { width, height } = page.viewportSize()!;
  const c = { x: width / 2, y: height / 2 };
  const steps = Array.from({ length: 6 }, (_, i) => ({
    type: "touchMove" as const,
    points: [
      { x: c.x - 100 + i * 14, y: c.y },
      { x: c.x + 100 - i * 14, y: c.y },
    ],
  }));
  await touch(page, [
    {
      type: "touchStart",
      points: [
        { x: c.x - 100, y: c.y },
        { x: c.x + 100, y: c.y },
      ],
    },
    ...steps,
    { type: "touchEnd", points: [] },
  ]);
  await expect(dialog(page)).toBeHidden();
});
