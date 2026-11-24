import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAt } from "./test/harness";

const counter = () => document.querySelector(".eg-counter")?.textContent;
const zoomTarget = () => document.querySelector<HTMLElement>(".eg-slide[data-current] .eg-zoom");
const root = () => document.querySelector<HTMLElement>(".eg-root");

function pointer(
  type: "pointerDown" | "pointerMove" | "pointerUp",
  target: Element,
  id: number,
  x: number,
  y: number,
) {
  fireEvent[type](target, {
    pointerId: id,
    clientX: x,
    clientY: y,
    isPrimary: id === 1,
    pointerType: "touch",
  });
}

function tap(target: Element, x = 300, y = 300) {
  pointer("pointerDown", target, 1, x, y);
  pointer("pointerUp", target, 1, x, y);
}

describe("thumbnail strip", () => {
  it("lists every slide as a labelled button and marks the current one", async () => {
    await openAt(2);
    const nav = screen.getByRole("navigation", { name: "Thumbnails" });
    const buttons = within(nav).getAllByRole("button");
    expect(buttons).toHaveLength(12);
    expect(buttons[2]).toHaveAccessibleName("Show image 3");
    expect(buttons[2]).toHaveAttribute("aria-current", "true");
    expect(buttons[3]).not.toHaveAttribute("aria-current");
  });

  it("uses the thumbnail source, lazily, and never as a slide image", async () => {
    await openAt(0);
    const img = screen.getByRole("navigation", { name: "Thumbnails" }).querySelector("img");
    expect(img).toHaveAttribute("src", "/img/1-thumb.jpg");
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).not.toHaveClass("eg-image");
  });

  it("falls back to the slide source when there is no thumbnail", async () => {
    await openAt(0, {
      slides: [
        { src: "/a.jpg", alt: "A" },
        { src: "/b.jpg", alt: "B" },
      ],
    });
    const imgs = screen.getByRole("navigation", { name: "Thumbnails" }).querySelectorAll("img");
    expect(imgs[1]).toHaveAttribute("src", "/b.jpg");
  });

  it("navigates when a thumbnail is pressed", async () => {
    const { user } = await openAt(2);
    await user.click(screen.getByRole("button", { name: "Show image 8" }));
    expect(counter()).toBe("8 / 12");
    expect(screen.getByRole("button", { name: "Show image 8" })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  it("scrolls the strip to keep the current thumbnail in view", async () => {
    const scrollTo = vi.fn();
    Element.prototype.scrollTo = scrollTo as unknown as Element["scrollTo"];
    const { user } = await openAt(2);
    scrollTo.mockClear();
    await user.keyboard("{ArrowRight}");
    expect(scrollTo).toHaveBeenCalled();
    Reflect.deleteProperty(Element.prototype, "scrollTo");
  });

  it("can be turned off", async () => {
    await openAt(2, { thumbnails: false });
    expect(screen.queryByRole("navigation", { name: "Thumbnails" })).toBeNull();
  });

  it("accepts custom labels, classes and content", async () => {
    await openAt(0, {
      labels: { thumbnails: "Miniaturas", thumbnail: (current) => `Ver imagem ${current}` },
      classNames: { thumbnails: "my-strip", thumbnail: "my-thumb" },
      render: {
        thumbnail: (slide, index, current) => (
          <span data-testid={`t${index}`}>{current ? "*" : slide.alt}</span>
        ),
      },
    });
    const nav = screen.getByRole("navigation", { name: "Miniaturas" });
    expect(nav).toHaveClass("my-strip");
    expect(screen.getByRole("button", { name: "Ver imagem 2" })).toHaveClass("my-thumb");
    expect(screen.getByTestId("t0")).toHaveTextContent("*");
    expect(screen.getByTestId("t1")).toHaveTextContent("Photo 2");
  });
});

describe("zoom", () => {
  const scaleOf = () => Number(zoomTarget()?.style.transform.match(/scale\(([\d.]+)\)/)?.[1] ?? 1);

  it("zooms in and out with the toolbar buttons, within the limits", async () => {
    const { user } = await openAt(2, { zoom: { maxScale: 2, step: 2 } });
    const zoomIn = screen.getByRole("button", { name: "Zoom in" });
    const zoomOut = screen.getByRole("button", { name: "Zoom out" });
    expect(zoomOut).toBeDisabled();
    await user.click(zoomIn);
    expect(scaleOf()).toBe(2);
    expect(root()).toHaveAttribute("data-zoomed");
    expect(zoomIn).toBeDisabled();
    await user.click(zoomOut);
    expect(scaleOf()).toBe(1);
    expect(root()).not.toHaveAttribute("data-zoomed");
  });

  it("toggles zoom with a double tap on the image", async () => {
    await openAt(2);
    const image = zoomTarget()!;
    act(() => {
      tap(image);
      tap(image);
    });
    expect(scaleOf()).toBe(2);
    act(() => {
      tap(image);
      tap(image);
    });
    expect(scaleOf()).toBe(1);
  });

  it("zooms with the mouse wheel over the stage", async () => {
    await openAt(2);
    const stage = document.querySelector(".eg-stage")!;
    act(() => {
      stage.dispatchEvent(
        new WheelEvent("wheel", {
          deltaY: -200,
          clientX: 300,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    expect(scaleOf()).toBeGreaterThan(1);
  });

  it("zooms with + and - and resets with 0", async () => {
    const { user } = await openAt(2);
    await user.keyboard("+");
    expect(scaleOf()).toBeGreaterThan(1);
    await user.keyboard("-");
    expect(scaleOf()).toBe(1);
    await user.keyboard("++");
    await user.keyboard("0");
    expect(scaleOf()).toBe(1);
  });

  it("pinches with two pointers", async () => {
    await openAt(2);
    const stage = document.querySelector(".eg-stage")!;
    act(() => {
      pointer("pointerDown", stage, 1, 200, 300);
      pointer("pointerDown", stage, 2, 300, 300);
      pointer("pointerMove", stage, 2, 400, 300);
      pointer("pointerUp", stage, 2, 400, 300);
      pointer("pointerUp", stage, 1, 200, 300);
    });
    expect(scaleOf()).toBeCloseTo(2, 5);
    expect(counter()).toBe("3 / 12");
  });

  it("pans instead of changing slide while zoomed, and resets on slide change", async () => {
    const { user } = await openAt(2);
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    const stage = document.querySelector(".eg-stage")!;
    act(() => {
      pointer("pointerDown", stage, 1, 300, 300);
      pointer("pointerMove", stage, 1, 100, 300);
      pointer("pointerUp", stage, 1, 100, 300);
    });
    expect(counter()).toBe("3 / 12");
    expect(dialogOpen()).toBe(true);
    await user.keyboard("{ArrowRight}");
    expect(counter()).toBe("4 / 12");
    expect(root()).not.toHaveAttribute("data-zoomed");
  });

  it("can be turned off", async () => {
    await openAt(2, { zoom: false });
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
    expect(zoomTarget()).toBeNull();
  });
});

function dialogOpen() {
  return !!document.querySelector("[role='dialog']");
}

describe("fullscreen", () => {
  afterEach(() => {
    Reflect.deleteProperty(document, "fullscreenEnabled");
    Reflect.deleteProperty(document, "fullscreenElement");
    Reflect.deleteProperty(document, "exitFullscreen");
    Reflect.deleteProperty(Element.prototype, "requestFullscreen");
  });

  function stubFullscreen() {
    let element: Element | null = null;
    Object.defineProperty(document, "fullscreenEnabled", { configurable: true, value: true });
    Object.defineProperty(document, "fullscreenElement", {
      configurable: true,
      get: () => element,
    });
    const change = (next: Element | null) => {
      element = next;
      document.dispatchEvent(new Event("fullscreenchange"));
    };
    const request = vi.fn(function (this: Element) {
      change(this);
      return Promise.resolve();
    });
    const exit = vi.fn(() => {
      change(null);
      return Promise.resolve();
    });
    Element.prototype.requestFullscreen = request;
    document.exitFullscreen = exit;
    return { request, exit };
  }

  it("is hidden where the Fullscreen API is unavailable", async () => {
    await openAt(0);
    expect(screen.queryByRole("button", { name: "Enter fullscreen" })).toBeNull();
  });

  it("enters and exits fullscreen on the dialog and follows external changes", async () => {
    const { request, exit } = stubFullscreen();
    const { user, dialog } = await openAt(0);
    await user.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.contexts[0]).toBe(dialog);
    await user.click(await screen.findByRole("button", { name: "Exit fullscreen" }));
    expect(exit).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("button", { name: "Enter fullscreen" })).toBeInTheDocument();
  });

  it("leaves fullscreen when the lightbox closes", async () => {
    const { exit } = stubFullscreen();
    const { user } = await openAt(0);
    await user.click(screen.getByRole("button", { name: "Enter fullscreen" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(dialogOpen()).toBe(false));
    expect(exit).toHaveBeenCalled();
  });

  it("can be turned off", async () => {
    stubFullscreen();
    await openAt(0, { fullscreen: false });
    expect(screen.queryByRole("button", { name: "Enter fullscreen" })).toBeNull();
  });
});

describe("image states", () => {
  it("marks the slide as loading until the image loads", async () => {
    await openAt(2);
    const slide = document.querySelector(".eg-slide[data-current]")!;
    expect(slide).toHaveAttribute("data-status", "loading");
    fireEvent.load(slide.querySelector(".eg-image")!);
    expect(slide).toHaveAttribute("data-status", "loaded");
  });

  it("shows a message when the image fails to load", async () => {
    await openAt(2, { labels: { loadError: "Falhou" } });
    const slide = document.querySelector(".eg-slide[data-current]")!;
    fireEvent.error(slide.querySelector(".eg-image")!);
    expect(slide).toHaveAttribute("data-status", "error");
    expect(within(slide as HTMLElement).getByText("Falhou")).toBeInTheDocument();
  });
});

describe("double tap while zoomed", () => {
  it("zooms back out even when the pointer is captured by the stage", async () => {
    await openAt(2);
    const image = zoomTarget()!;
    const stage = document.querySelector(".eg-stage")!;
    act(() => {
      tap(image);
      tap(image);
    });
    expect(root()).toHaveAttribute("data-zoomed");
    act(() => {
      for (let i = 0; i < 2; i++) {
        pointer("pointerDown", image, 1, 300, 300);
        pointer("pointerUp", stage, 1, 300, 300);
      }
    });
    expect(root()).not.toHaveAttribute("data-zoomed");
  });
});
