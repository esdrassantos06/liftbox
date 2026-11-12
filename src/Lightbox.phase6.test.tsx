import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { openAt } from "./test/harness";

const root = () => document.querySelector<HTMLElement>(".eg-root")!;
const stage = () => document.querySelector<HTMLElement>(".eg-stage")!;
const counter = () => document.querySelector(".eg-counter")?.textContent;
const currentImage = () =>
  document.querySelector<HTMLElement>(".eg-slide[data-current] .eg-image")!;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

/** Lays the top bar out `width` px wide with 44px buttons and a 50px counter. */
function layOut(width: number) {
  const widthOf = (el: HTMLElement): number => {
    if (el.hidden) return 0;
    if (el.classList.contains("eg-top-bar")) return width;
    if (el.classList.contains("eg-counter")) return 50;
    if (el.classList.contains("eg-button") || el.classList.contains("eg-more")) return 44;
    if (el.classList.contains("eg-toolbar")) {
      return [...el.children].reduce((sum, child) => sum + widthOf(child as HTMLElement), 0);
    }
    return 0;
  };
  vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.classList.contains("eg-top-bar") ? width : 0;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (
    this: HTMLElement,
  ) {
    return widthOf(this);
  });
}

const toolbarProps = { rotate: true, flip: true, share: true, download: true } as const;

describe("toolbar overflow menu", () => {
  it("moves what does not fit into a More menu, zoom first, and keeps close in the row", async () => {
    layOut(300);
    const { dialog } = await openAt(0, toolbarProps);
    const toolbar = dialog.querySelector<HTMLElement>(".eg-toolbar")!;
    const row = within(toolbar);
    expect(row.getByRole("button", { name: "More options" })).toHaveAttribute(
      "aria-haspopup",
      "menu",
    );
    expect(row.getByRole("button", { name: "Close" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Rotate left" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Download" })).toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(row.queryByRole("button", { name: "Flip vertically" })).toBeNull();
  });

  it("keeps every button in the row when they fit", async () => {
    layOut(2000);
    await openAt(0, toolbarProps);
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });

  it("can be turned off", async () => {
    layOut(300);
    await openAt(0, { ...toolbarProps, toolbarOverflow: false });
    expect(screen.queryByRole("button", { name: "More options" })).toBeNull();
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
  });

  it("follows the menu button pattern: arrows, Home, End, Escape and focus return", async () => {
    layOut(300);
    const { user } = await openAt(0, toolbarProps);
    const more = screen.getByRole("button", { name: "More options" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    const menu = screen.getByRole("menu", { name: "More options" });
    const items = within(menu).getAllByRole("menuitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "Zoom in",
      "Zoom out",
      "Rotate right",
      "Flip horizontally",
      "Flip vertically",
    ]);
    expect(items[0]).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(items[1]).toHaveFocus();
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(items[4]).toHaveFocus();
    await user.keyboard("{Home}");
    expect(items[0]).toHaveFocus();
    await user.keyboard("{End}");
    expect(items[4]).toHaveFocus();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more).toHaveFocus();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(counter()).toBe("1 / 12");
  });

  it("opens from the keyboard on the first or the last item", async () => {
    layOut(300);
    const { user } = await openAt(0, toolbarProps);
    screen.getByRole("button", { name: "More options" }).focus();
    await user.keyboard("{ArrowUp}");
    expect(screen.getAllByRole("menuitem").at(-1)).toHaveFocus();
    await user.keyboard("{Escape}{ArrowDown}");
    expect(screen.getAllByRole("menuitem")[0]).toHaveFocus();
  });

  it("runs an item, closes the menu and returns focus", async () => {
    layOut(300);
    const { user } = await openAt(0, toolbarProps);
    const more = screen.getByRole("button", { name: "More options" });
    await user.click(more);
    await user.click(screen.getByRole("menuitem", { name: "Zoom in" }));
    expect(root()).toHaveAttribute("data-zoomed");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(more).toHaveFocus();
  });

  it("closes on a press outside without closing the lightbox", async () => {
    layOut(300);
    const { user } = await openAt(0, toolbarProps);
    await user.click(screen.getByRole("button", { name: "More options" }));
    await user.click(document.querySelector(".eg-menu-scrim")!);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("uses custom labels, icons and class names", async () => {
    layOut(300);
    const { user } = await openAt(0, {
      ...toolbarProps,
      labels: { more: "Mais opções" },
      icons: { more: <span data-testid="dots" /> },
      classNames: { menu: "my-menu", menuItem: "my-item" },
    });
    await user.click(screen.getByRole("button", { name: "Mais opções" }));
    expect(screen.getByTestId("dots")).toBeInTheDocument();
    expect(screen.getByRole("menu")).toHaveClass("eg-menu", "my-menu");
    expect(screen.getAllByRole("menuitem")[0]).toHaveClass("eg-menu-item", "my-item");
  });
});

describe("idle controls", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  it("is off by default", async () => {
    await openAt(0);
    act(() => vi.advanceTimersByTime(10_000));
    expect(root()).not.toHaveAttribute("data-idle");
  });

  it("hides the controls after the delay and shows them on pointer move", async () => {
    await openAt(0, { idle: 1000 });
    fireEvent.pointerMove(stage(), { clientX: 10, clientY: 10 });
    act(() => vi.advanceTimersByTime(999));
    expect(root()).not.toHaveAttribute("data-idle");
    act(() => vi.advanceTimersByTime(1));
    expect(root()).toHaveAttribute("data-idle");
    fireEvent.pointerMove(stage(), { clientX: 10, clientY: 10 });
    expect(root()).not.toHaveAttribute("data-idle");
  });

  it("waits 3 seconds when set to true and shows the controls on a key press", async () => {
    await openAt(0, { idle: true });
    act(() => vi.advanceTimersByTime(3000));
    expect(root()).toHaveAttribute("data-idle");
    fireEvent.keyDown(document, { key: "Shift" });
    expect(root()).not.toHaveAttribute("data-idle");
  });

  it("never hides while focus is on a control", async () => {
    const { user } = await openAt(0, { idle: 1000 });
    await user.tab();
    act(() => vi.advanceTimersByTime(5000));
    expect(root()).not.toHaveAttribute("data-idle");
  });

  it("treats the tap that wakes the controls as only that", async () => {
    await openAt(0, { idle: 1000 });
    act(() => vi.advanceTimersByTime(1000));
    const slide = document.querySelector(".eg-slide[data-current]")!;
    fireEvent.pointerDown(slide, { pointerId: 1, clientX: 5, clientY: 5, isPrimary: true });
    fireEvent.pointerUp(slide, { pointerId: 1, clientX: 5, clientY: 5 });
    fireEvent.click(slide);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(root()).not.toHaveAttribute("data-idle");
  });
});

describe("right-to-left", () => {
  const swipe = (dx: number) => {
    fireEvent.pointerDown(stage(), { pointerId: 1, clientX: 300, clientY: 300, isPrimary: true });
    fireEvent.pointerMove(stage(), { pointerId: 1, clientX: 300 + dx, clientY: 300 });
    fireEvent.pointerUp(stage(), { pointerId: 1, clientX: 300 + dx, clientY: 300 });
  };

  afterEach(() => {
    document.documentElement.removeAttribute("dir");
  });

  it("mirrors the arrow keys and swipes with dir='rtl'", async () => {
    const { user } = await openAt(0, { dir: "rtl" });
    expect(root()).toHaveAttribute("dir", "rtl");
    await user.keyboard("{ArrowLeft}");
    expect(counter()).toBe("2 / 12");
    await user.keyboard("{ArrowRight}");
    expect(counter()).toBe("1 / 12");
    act(() => swipe(120));
    expect(counter()).toBe("2 / 12");
    act(() => swipe(-120));
    expect(counter()).toBe("1 / 12");
  });

  it("follows an inherited dir='rtl'", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    const { user } = await openAt(0);
    expect(root()).toHaveAttribute("dir", "rtl");
    await user.keyboard("{ArrowLeft}");
    expect(counter()).toBe("2 / 12");
  });

  it("lets dir='ltr' win over the page", async () => {
    document.documentElement.setAttribute("dir", "rtl");
    const { user } = await openAt(0, { dir: "ltr" });
    expect(root()).toHaveAttribute("dir", "ltr");
    await user.keyboard("{ArrowRight}");
    expect(counter()).toBe("2 / 12");
  });
});

describe("bidirectional text", () => {
  it("lays the counter out by its own content so it reads 1 / 12 in RTL", async () => {
    await openAt(0, { dir: "rtl" });
    expect(document.querySelector(".eg-counter")).toHaveAttribute("dir", "auto");
  });

  it("lays captions out by their own content, so English captions keep their punctuation in RTL", async () => {
    await openAt(0, { dir: "rtl" });
    expect(document.querySelector(".eg-caption")).toHaveAttribute("dir", "auto");
  });
});

describe("pinch to close", () => {
  const touch = (type: "pointerDown" | "pointerMove" | "pointerUp", id: number, x: number) =>
    fireEvent[type](stage(), {
      pointerId: id,
      clientX: x,
      clientY: 300,
      isPrimary: id === 1,
      pointerType: "touch",
    });

  const pinch = (...xs: number[]) =>
    act(() => {
      touch("pointerDown", 1, 200);
      touch("pointerDown", 2, 400);
      for (const x of xs) touch("pointerMove", 2, x);
      touch("pointerUp", 2, xs.at(-1)!);
      touch("pointerUp", 1, 200);
    });

  it("closes when pinched under fit and released", async () => {
    await openAt(2);
    pinch(300, 240);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("stays open after a small wobble", async () => {
    await openAt(2);
    pinch(395);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("does not close when the pinch zoomed in first", async () => {
    await openAt(2);
    pinch(600, 240);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("can be turned off", async () => {
    await openAt(2, { pinchToClose: false });
    pinch(240);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

describe("flip", () => {
  it("is off by default", async () => {
    await openAt(0);
    expect(screen.queryByRole("button", { name: "Flip horizontally" })).toBeNull();
  });

  it("mirrors the image on each axis and back", async () => {
    const { user } = await openAt(0, { flip: true });
    await user.click(screen.getByRole("button", { name: "Flip horizontally" }));
    expect(currentImage().style.transform).toBe("scale(-1, 1)");
    await user.click(screen.getByRole("button", { name: "Flip vertically" }));
    expect(currentImage().style.transform).toMatch(/^scale\(-1(, -1)?\)$/);
    await user.click(screen.getByRole("button", { name: "Flip horizontally" }));
    await user.click(screen.getByRole("button", { name: "Flip vertically" }));
    expect(currentImage().style.transform).toBe("");
  });

  it("flips across the screen axis on a rotated image", async () => {
    const { user } = await openAt(0, { flip: true, rotate: true });
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    await user.click(screen.getByRole("button", { name: "Flip horizontally" }));
    expect(currentImage().style.transform).toBe("rotate(90deg) scale(1, -1)");
  });

  it("keeps zoom working and resets on slide change and with the 0 key", async () => {
    const { user } = await openAt(0, { flip: true });
    await user.click(screen.getByRole("button", { name: "Flip horizontally" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(root()).toHaveAttribute("data-zoomed");
    expect(currentImage().style.transform).toBe("scale(-1, 1)");
    await user.keyboard("0");
    expect(currentImage().style.transform).toBe("");
    await user.click(screen.getByRole("button", { name: "Flip vertically" }));
    await user.keyboard("{ArrowRight}");
    expect(currentImage().style.transform).toBe("");
  });
});

describe("share", () => {
  const nav = navigator as unknown as { share?: unknown };
  const original = nav.share;

  afterEach(() => {
    nav.share = original;
  });

  it("is off by default", async () => {
    await openAt(0);
    expect(screen.queryByRole("button", { name: "Share" })).toBeNull();
  });

  it("opens the system share sheet with the page link and the slide title", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    nav.share = share;
    const { user } = await openAt(1, { share: true });
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith({ url: window.location.href, title: "Title 2" });
  });

  it("shares a custom link", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    nav.share = share;
    const { user } = await openAt(1, {
      share: { url: (slide, index) => `https://example.com/p/${index}?src=${slide.src}` },
    });
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(share).toHaveBeenCalledWith(
      expect.objectContaining({ url: "https://example.com/p/1?src=/img/2.jpg" }),
    );
  });

  it("copies the link where the share sheet is missing and says so", async () => {
    nav.share = undefined;
    const { user } = await openAt(0, { share: true });
    const write = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(write).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByRole("status")).toHaveTextContent("Link copied");
  });

  it("stays quiet when the user cancels the share sheet", async () => {
    nav.share = vi.fn().mockRejectedValue(new DOMException("Cancelled", "AbortError"));
    const { user } = await openAt(0, { share: true });
    const write = vi.spyOn(navigator.clipboard, "writeText");
    await user.click(screen.getByRole("button", { name: "Share" }));
    expect(write).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("");
  });
});

describe("pager dots", () => {
  it("is off by default", async () => {
    await openAt(0);
    expect(screen.queryByRole("navigation", { name: "Slides" })).toBeNull();
  });

  it("lists a labelled dot per slide, marks the current one and navigates", async () => {
    const { user } = await openAt(2, { pager: true, thumbnails: false });
    const pager = screen.getByRole("navigation", { name: "Slides" });
    const dots = within(pager).getAllByRole("button");
    expect(dots).toHaveLength(12);
    expect(dots[2]).toHaveAccessibleName("Go to image 3");
    expect(dots[2]).toHaveAttribute("aria-current", "true");
    await user.click(dots[6]!);
    expect(counter()).toBe("7 / 12");
    expect(dots[6]).toHaveAttribute("aria-current", "true");
    expect(root()).toHaveAttribute("data-pager");
  });

  it("works next to the thumbnails, with custom labels", async () => {
    await openAt(0, {
      pager: true,
      labels: { pager: "Fotos", pagerItem: (i, total) => `Foto ${i} de ${total}` },
    });
    expect(screen.getByRole("navigation", { name: "Thumbnails" })).toBeInTheDocument();
    const pager = screen.getByRole("navigation", { name: "Fotos" });
    expect(within(pager).getAllByRole("button")[0]).toHaveAccessibleName("Foto 1 de 12");
  });
});
