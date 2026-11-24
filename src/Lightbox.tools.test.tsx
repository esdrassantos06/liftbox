import { screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Slide } from "./index";
import { openAt } from "./test/harness";

const currentImage = () =>
  document.querySelector<HTMLElement>(".eg-slide[data-current] .eg-image")!;
const rotation = () =>
  Number(currentImage().style.transform.match(/rotate\((-?\d+)deg\)/)?.[1] ?? 0);

describe("rotation", () => {
  it("is off by default", async () => {
    await openAt(0);
    expect(screen.queryByRole("button", { name: "Rotate left" })).toBeNull();
  });

  it("rotates in 90 degree steps that accumulate", async () => {
    const { user } = await openAt(0, { rotate: true });
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    expect(rotation()).toBe(90);
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    expect(rotation()).toBe(360);
    await user.click(screen.getByRole("button", { name: "Rotate left" }));
    expect(rotation()).toBe(270);
  });

  it("swaps the fitted size for quarter turns so the image still fits", async () => {
    const stageSize = (axis: "clientWidth" | "clientHeight", value: number) =>
      vi.spyOn(HTMLElement.prototype, axis, "get").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("eg-stage") ? value : 0;
      });
    stageSize("clientWidth", 1000);
    stageSize("clientHeight", 800);
    const { user } = await openAt(0, { rotate: true });
    const frame = () => document.querySelector<HTMLElement>(".eg-slide[data-current] .eg-rotate")!;
    expect(frame().dataset.turn).toBe("even");
    expect([currentImage().style.width, currentImage().style.height]).toEqual(["1000px", "625px"]);
    await user.click(screen.getByRole("button", { name: "Rotate left" }));
    expect(frame().dataset.turn).toBe("odd");
    expect([frame().style.width, frame().style.height]).toEqual(["500px", "800px"]);
    expect([currentImage().style.width, currentImage().style.height]).toEqual(["800px", "500px"]);
    vi.restoreAllMocks();
  });

  it("resets on slide change and with the 0 key", async () => {
    const { user } = await openAt(0, { rotate: true });
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    await user.keyboard("{ArrowRight}");
    expect(rotation()).toBe(0);
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    await user.keyboard("0");
    expect(rotation()).toBe(0);
  });

  it("keeps zoom working on a rotated image", async () => {
    const { user } = await openAt(0, { rotate: true });
    await user.click(screen.getByRole("button", { name: "Rotate right" }));
    await user.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(document.querySelector(".eg-root")).toHaveAttribute("data-zoomed");
    expect(rotation()).toBe(90);
  });

  it("uses custom labels", async () => {
    await openAt(0, {
      rotate: true,
      labels: { rotateLeft: "Rodar esquerda", rotateRight: "Rodar direita" },
    });
    expect(screen.getByRole("button", { name: "Rodar direita" })).toBeInTheDocument();
  });
});

describe("download", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let clicks: HTMLAnchorElement[];
  let openMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicks.push(this);
    });
    fetchMock = vi.fn(() => Promise.resolve(new Response("x", { status: 200 })));
    vi.stubGlobal("fetch", fetchMock);
    URL.createObjectURL = vi.fn(() => "blob:fake");
    URL.revokeObjectURL = vi.fn();
    openMock = vi.fn();
    vi.stubGlobal("open", openMock);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("is off by default", async () => {
    await openAt(0);
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("saves a same-origin file directly with its file name", async () => {
    const { user } = await openAt(2, { download: true });
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clicks).toHaveLength(1);
    expect(clicks[0]!.getAttribute("href")).toBe("/img/3.jpg");
    expect(clicks[0]!.download).toBe("3.jpg");
  });

  it("uses a per-slide URL and name, or a filename function", async () => {
    const slides: Slide[] = [
      { src: "/a.jpg", alt: "A", download: "/a-original.tiff", downloadName: "original.tiff" },
      { src: "/b.jpg", alt: "B" },
    ];
    const { user } = await openAt(0, {
      slides,
      download: { filename: (slide, index) => `foto-${index + 1}-${slide.alt}.jpg` },
    });
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(clicks[0]!.getAttribute("href")).toBe("/a-original.tiff");
    expect(clicks[0]!.download).toBe("original.tiff");
    await user.keyboard("{ArrowRight}");
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(clicks[1]!.download).toBe("foto-2-B.jpg");
  });

  it("hides the button for slides that opt out and for embeds", async () => {
    const slides: Slide[] = [
      { src: "/a.jpg", alt: "A", download: false },
      { src: "https://youtu.be/abc", title: "Talk" },
    ];
    const { user } = await openAt(0, { slides, download: true });
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
  });

  it("hides the button for script URLs and keeps it for data URLs", async () => {
    const slides: Slide[] = [
      { src: "/a.jpg", alt: "A", download: "javascript:alert(1)" },
      { src: "/b.jpg", alt: "B", download: "data:image/png;base64,AAAA" },
    ];
    const { user } = await openAt(0, { slides, download: true });
    expect(screen.queryByRole("button", { name: "Download" })).toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Download" })).toBeInTheDocument();
  });

  it("fetches cross-origin files as a blob so the name is kept", async () => {
    const slides: Slide[] = [{ src: "https://cdn.example.com/photos/sea.jpg", alt: "Sea" }];
    const { user } = await openAt(0, { slides, download: true });
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(clicks).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith("https://cdn.example.com/photos/sea.jpg", {
      mode: "cors",
    });
    expect(clicks[0]!.getAttribute("href")).toBe("blob:fake");
    expect(clicks[0]!.download).toBe("sea.jpg");
    await waitFor(() => expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:fake"));
  });

  it("opens the file in a new tab, announces it and reports the error when the server refuses", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const onError = vi.fn();
    const slides: Slide[] = [{ src: "https://cdn.example.com/sea.jpg", alt: "Sea" }];
    const { user } = await openAt(0, { slides, download: { onError } });
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() =>
      expect(openMock).toHaveBeenCalledWith(
        "https://cdn.example.com/sea.jpg",
        "_blank",
        "noopener",
      ),
    );
    expect(onError).toHaveBeenCalledWith(expect.any(TypeError), slides[0]);
    expect(document.querySelector("[role='status']")).toHaveTextContent(
      "This file could not be downloaded here, so it opened in a new tab.",
    );
  });

  it("reports a malformed download URL instead of throwing", async () => {
    fetchMock.mockImplementation(() => Promise.reject(new TypeError("Failed to fetch")));
    const onError = vi.fn();
    const slides: Slide[] = [{ src: "/a.jpg", alt: "A", download: "http://exa mple.com/a.jpg" }];
    const { user } = await openAt(0, { slides, download: { onError } });
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(TypeError), slides[0]));
  });

  it("treats an HTTP error as a failure", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response("no", { status: 403 })));
    const onError = vi.fn();
    const slides: Slide[] = [{ src: "https://cdn.example.com/sea.jpg", alt: "Sea" }];
    const { user } = await openAt(0, { slides, download: { onError } });
    await user.click(screen.getByRole("button", { name: "Download" }));
    await waitFor(() => expect(onError).toHaveBeenCalled());
    expect(openMock).toHaveBeenCalled();
  });
});
