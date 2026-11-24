import { act, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { openAt, slides } from "./test/harness";

const current = () => document.querySelector<HTMLElement>(".eg-slide[data-current]")!;

afterEach(() => {
  Reflect.deleteProperty(Element.prototype, "animate");
  vi.restoreAllMocks();
});

describe("caption inside the slide", () => {
  it("puts each slide's caption inside that slide instead of the bottom bar", async () => {
    await openAt(2, { captionPosition: "slide" });
    expect(document.querySelector(".eg-root > .eg-caption")).toBeNull();
    expect(current().querySelector(".eg-caption")).toHaveTextContent("Title 3");
    const next = document.querySelectorAll(".eg-slide")[3]!;
    expect(next.querySelector(".eg-caption")).toHaveTextContent("Title 4");
  });

  it("keeps the caption in the bottom bar by default", async () => {
    await openAt(2);
    expect(document.querySelector(".eg-root > .eg-caption")).toHaveTextContent("Title 3");
    expect(current().querySelector(".eg-caption")).toBeNull();
  });

  it("sizes the caption frame to the image on screen", async () => {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("eg-stage") ? 1000 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("eg-stage") ? 800 : 0;
    });
    await openAt(2, { captionPosition: "slide" });
    const frame = current().querySelector<HTMLElement>(".eg-slide-caption")!;
    expect(frame.style.width).toBe("1000px");
    expect(frame.style.height).toBe("625px");
  });

  it("renders the caption of every mounted slide and skips the ones that return null", async () => {
    const caption = vi.fn((slide: (typeof slides)[number], index: number) =>
      index === 2 ? null : <p>{slide.alt}</p>,
    );
    await openAt(2, { captionPosition: "slide", render: { caption } });
    expect(current().querySelector(".eg-slide-caption")).toBeNull();
    expect(screen.getByText("Photo 4")).toBeInTheDocument();
    expect(caption).toHaveBeenCalledWith(slides[3], 3);
  });
});

describe("cropped-thumbnail flight", () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;

  it("crops along the image's own axes when it closes turned a quarter", async () => {
    const animations: { finish: () => void }[] = [];
    const animate = vi.fn(function () {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => (finish = resolve));
      const animation = { finished, cancel: vi.fn(), finish };
      animations.push(animation);
      return animation;
    });
    Element.prototype.animate = animate as unknown as Element["animate"];
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.matches(".eg-image")) return rect(200, 100, 500, 800);
      if (this.matches("button")) return rect(10, 10, 100, 100);
      return rect(0, 0, 0, 0);
    });
    const { user } = await openAt(2, { rotate: true });
    act(() => animations.forEach((animation) => animation.finish()));
    await waitFor(() =>
      expect(document.querySelector(".eg-root")).toHaveAttribute("data-state", "open"),
    );
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(animate).toHaveBeenCalledTimes(2));
    const [keyframes] = animate.mock.calls[1] as unknown as [Keyframe[]];
    expect(keyframes.at(-1)?.clipPath).toBe("inset(0px 150px)");
  });
});

describe("caption next to a player", () => {
  const video = {
    src: "/clip.mp4",
    type: "video" as const,
    width: 1920,
    height: 1080,
    title: "Clip",
  };

  function layOut() {
    vi.spyOn(HTMLElement.prototype, "clientWidth", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("eg-stage") ? 1600 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("eg-stage") ? 800 : 0;
    });
    vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (
      this: HTMLElement,
    ) {
      return this.classList.contains("eg-caption") ? 100 : 0;
    });
  }

  it("fits a video above the caption so the caption never covers its controls", async () => {
    layOut();
    await openAt(0, { slides: [video, slides[0]!] });
    const player = current().querySelector<HTMLElement>("video")!;
    await waitFor(() => expect(player.style.height).toBe("700px"));
    expect(current().style.getPropertyValue("--eg-caption-space")).toBe("100px");
  });

  it("gives a custom player the room left above the caption", async () => {
    layOut();
    const slide = ({ slide, height }: { slide: (typeof slides)[number]; height: number }) =>
      slide.type === "video" ? <div data-testid="player">{height}</div> : undefined;
    await openAt(0, { slides: [video, slides[0]!], render: { slide } });
    await waitFor(() => expect(screen.getByTestId("player")).toHaveTextContent("700"));
  });

  it("leaves images at full size", async () => {
    layOut();
    await openAt(1, { slides: [video, slides[0]!] });
    expect(current().style.getPropertyValue("--eg-caption-space")).toBe("");
    expect(current().querySelector<HTMLElement>(".eg-image")!.style.height).toBe("800px");
  });

  it("keeps a player's caption in the bar with captionPosition slide", async () => {
    await openAt(0, { slides: [video, slides[0]!], captionPosition: "slide" });
    expect(document.querySelector(".eg-root > .eg-caption")).toHaveTextContent("Clip");
    expect(current().querySelector(".eg-slide-caption")).toBeNull();
  });
});
