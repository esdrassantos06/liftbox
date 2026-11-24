import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Slide } from "./index";
import { openAt } from "./test/harness";

const media: Slide[] = [
  { src: "/a.jpg", width: 1600, height: 1000, alt: "Photo A" },
  {
    src: "/clip.mp4",
    poster: "/clip.jpg",
    width: 1280,
    height: 720,
    alt: "Clip",
    sources: [
      { src: "/clip.webm", type: "video/webm" },
      { src: "/clip.mp4", type: "video/mp4" },
    ],
  },
  { src: "https://www.youtube.com/watch?v=abc123", title: "Talk" },
  { src: "https://vimeo.com/76979871", alt: "Vimeo film" },
  { src: "https://example.com/map", type: "iframe", title: "Map" },
  { src: "/b.jpg", width: 1600, height: 1000, alt: "Photo B" },
];

const counter = () => document.querySelector(".eg-counter")?.textContent;
const current = () => document.querySelector<HTMLElement>(".eg-slide[data-current]")!;

let pause: ReturnType<typeof vi.fn>;
let play: ReturnType<typeof vi.fn>;

beforeEach(() => {
  pause = vi.fn();
  play = vi.fn(() => Promise.resolve());
  Object.defineProperty(HTMLMediaElement.prototype, "pause", { configurable: true, value: pause });
  Object.defineProperty(HTMLMediaElement.prototype, "play", { configurable: true, value: play });
});

afterEach(() => {
  Reflect.deleteProperty(HTMLMediaElement.prototype, "pause");
  Reflect.deleteProperty(HTMLMediaElement.prototype, "play");
});

describe("video slides", () => {
  it("renders a native video with poster, inline playback and metadata preload", async () => {
    await openAt(1, { slides: media });
    const video = current().querySelector("video")!;
    expect(video).toHaveAttribute("poster", "/clip.jpg");
    expect(video).toHaveAttribute("playsinline");
    expect(video).toHaveAttribute("preload", "metadata");
    expect(video).toHaveAttribute("controls");
    expect(video).toHaveAccessibleName("Clip");
    expect([...video.querySelectorAll("source")].map((s) => s.getAttribute("type"))).toEqual([
      "video/webm",
      "video/mp4",
    ]);
  });

  it("adds caption tracks to a video", async () => {
    const slides: Slide[] = [
      {
        src: "/talk.mp4",
        alt: "Talk",
        tracks: [
          { src: "/talk.en.vtt", srcLang: "en", label: "English", default: true },
          { src: "/talk.pt.vtt", srcLang: "pt", label: "Português" },
        ],
      },
    ];
    await openAt(0, { slides });
    const tracks = [...current().querySelectorAll("track")];
    expect(
      tracks.map((t) => [
        t.getAttribute("kind"),
        t.getAttribute("srclang"),
        t.getAttribute("label"),
      ]),
    ).toEqual([
      ["captions", "en", "English"],
      ["captions", "pt", "Português"],
    ]);
    expect(tracks[0]).toHaveAttribute("default");
  });

  it("pauses a video when its slide stops being current", async () => {
    const { user } = await openAt(1, { slides: media });
    pause.mockClear();
    await user.keyboard("{ArrowRight}");
    expect(counter()).toBe("3 / 6");
    expect(pause).toHaveBeenCalled();
  });

  it("starts the current video when video autoplay is on", async () => {
    await openAt(1, { slides: media, video: { autoplay: true } });
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(current().querySelector("video")).toHaveProperty("muted", true);
  });

  it("embeds YouTube through youtube-nocookie.com only on the current slide", async () => {
    const { user } = await openAt(1, { slides: media });
    expect(document.querySelectorAll("iframe")).toHaveLength(0);
    await user.keyboard("{ArrowRight}");
    const iframe = current().querySelector("iframe")!;
    expect(iframe.src).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/abc123\?/);
    expect(iframe).toHaveAttribute("title", "Talk");
    expect(iframe.getAttribute("allow")).toContain("fullscreen");
    expect(iframe).toHaveAttribute("referrerpolicy", "strict-origin-when-cross-origin");
  });

  it("removes the embed when its slide stops being current, which stops playback", async () => {
    const { user } = await openAt(2, { slides: media });
    expect(current().querySelector("iframe")).not.toBeNull();
    await user.keyboard("{ArrowRight}");
    expect(document.querySelector("iframe[src*='youtube']")).toBeNull();
  });

  it("embeds Vimeo and custom iframes", async () => {
    const { user } = await openAt(3, { slides: media });
    expect(current().querySelector("iframe")!.src).toMatch(
      /^https:\/\/player\.vimeo\.com\/video\/76979871\?/,
    );
    await user.keyboard("{ArrowRight}");
    const iframe = current().querySelector("iframe")!;
    expect(iframe.src).toBe("https://example.com/map");
    expect(iframe).toHaveAttribute("title", "Map");
  });

  it("renders no iframe for a script URL", async () => {
    await openAt(0, {
      slides: [{ src: "javascript:alert(1)", type: "iframe", title: "Bad" }],
    });
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("shows no zoom buttons on video slides", async () => {
    const { user } = await openAt(0, { slides: media });
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    expect(screen.queryByRole("button", { name: "Zoom in" })).toBeNull();
  });

  it("leaves arrow keys to a focused video", async () => {
    await openAt(1, { slides: media });
    const video = current().querySelector("video")!;
    video.focus();
    fireEvent.keyDown(video, { key: "ArrowRight", bubbles: true });
    expect(counter()).toBe("2 / 6");
  });

  it("does not swipe when the drag starts on a video", async () => {
    await openAt(1, { slides: media });
    const video = current().querySelector("video")!;
    act(() => {
      fireEvent.pointerDown(video, { pointerId: 1, clientX: 300, clientY: 300, isPrimary: true });
      fireEvent.pointerMove(video, { pointerId: 1, clientX: 100, clientY: 300 });
      fireEvent.pointerUp(video, { pointerId: 1, clientX: 100, clientY: 300 });
    });
    expect(counter()).toBe("2 / 6");
  });
});

describe("slideshow", () => {
  const images = (count: number): Slide[] =>
    Array.from({ length: count }, (_, i) => ({
      src: `/s${i}.jpg`,
      width: 1600,
      height: 1000,
      alt: `S${i}`,
    }));
  const wait = (ms: number) => act(() => new Promise((resolve) => setTimeout(resolve, ms)));

  it("is off by default", async () => {
    await openAt(0, { slides: images(3) });
    expect(screen.queryByRole("button", { name: "Start slideshow" })).toBeNull();
  });

  it("starts and pauses from the toolbar and advances on the interval", async () => {
    const { user } = await openAt(0, { slides: images(4), slideshow: { interval: 60 } });
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    expect(screen.getByRole("button", { name: "Pause slideshow" })).toBeInTheDocument();
    expect(document.querySelector(".eg-progress")).not.toBeNull();
    await waitFor(() => expect(counter()).toBe("2 / 4"));
    await waitFor(() => expect(counter()).toBe("3 / 4"));
    await user.click(screen.getByRole("button", { name: "Pause slideshow" }));
    expect(document.querySelector(".eg-progress")).toBeNull();
    const stopped = counter();
    await wait(150);
    expect(counter()).toBe(stopped);
  });

  it("can start as soon as the lightbox opens", async () => {
    await openAt(0, { slides: images(3), slideshow: { interval: 60, autoplay: true } });
    await waitFor(() => expect(counter()).toBe("2 / 3"));
  });

  it("pauses when the user navigates by hand", async () => {
    const { user } = await openAt(0, {
      slides: images(5),
      slideshow: { interval: 80, autoplay: true },
    });
    await user.keyboard("{ArrowRight}");
    expect(screen.getByRole("button", { name: "Start slideshow" })).toBeInTheDocument();
    await wait(200);
    expect(counter()).toBe("2 / 5");
  });

  it("stops on the last slide without loop", async () => {
    await openAt(0, {
      slides: images(2),
      loop: false,
      slideshow: { interval: 50, autoplay: true },
    });
    await waitFor(() => expect(counter()).toBe("2 / 2"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Start slideshow" })).toBeInTheDocument(),
    );
  });

  it("waits while the page is hidden", async () => {
    await openAt(0, { slides: images(3), slideshow: { interval: 60, autoplay: true } });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await wait(200);
    expect(counter()).toBe("1 / 3");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => expect(counter()).toBe("2 / 3"));
    Reflect.deleteProperty(document, "visibilityState");
  });

  it("holds on a video until it ends", async () => {
    const slides: Slide[] = [{ src: "/v.mp4", alt: "V" }, ...images(2)];
    await openAt(0, { slides, slideshow: { interval: 50, autoplay: true } });
    await wait(150);
    expect(counter()).toBe("1 / 3");
    fireEvent(current().querySelector("video")!, new Event("ended"));
    await waitFor(() => expect(counter()).toBe("2 / 3"));
  });

  it("plays the current video from the slideshow button and pauses it again", async () => {
    const slides: Slide[] = [{ src: "/v.mp4", alt: "V" }, ...images(2)];
    const { user } = await openAt(0, { slides, slideshow: { interval: 5000 } });
    play.mockClear();
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    pause.mockClear();
    await user.click(screen.getByRole("button", { name: "Pause slideshow" }));
    expect(pause).toHaveBeenCalled();
  });

  it("plays a video the slideshow lands on", async () => {
    const slides: Slide[] = [...images(1), { src: "/v.mp4", alt: "V" }];
    await openAt(0, { slides, slideshow: { interval: 50, autoplay: true } });
    play.mockClear();
    await waitFor(() => expect(counter()).toBe("2 / 2"));
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it("stops the slideshow when the viewer pauses the video", async () => {
    const slides: Slide[] = [{ src: "/v.mp4", alt: "V" }, ...images(2)];
    const { user } = await openAt(0, { slides, slideshow: { interval: 5000 } });
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    fireEvent(current().querySelector("video")!, new Event("pause"));
    expect(screen.getByRole("button", { name: "Start slideshow" })).toBeInTheDocument();
  });

  it("uses custom labels", async () => {
    await openAt(0, {
      slides: images(2),
      slideshow: true,
      labels: { playSlideshow: "Iniciar", pauseSlideshow: "Pausar" },
    });
    expect(screen.getByRole("button", { name: "Iniciar" })).toBeInTheDocument();
  });
});

describe("custom players", () => {
  const images = (count: number): Slide[] =>
    Array.from({ length: count }, (_, i) => ({
      src: `/s${i}.jpg`,
      width: 1600,
      height: 1000,
      alt: `S${i}`,
    }));
  const player: Slide = { src: "/stream.m3u8", type: "video", alt: "Stream" };
  const renderPlayer = {
    slide: ({ slide }: { slide: Slide }) =>
      slide.type === "video" ? (
        <div className="my-player">
          <video src={slide.src} aria-label={slide.alt}>
            <track kind="captions" src="/stream.vtt" srcLang="en" label="English" />
          </video>
          <button type="button">Mute</button>
          <div role="slider" aria-label="Volume" aria-valuenow={50} tabIndex={0} />
        </div>
      ) : undefined,
  };

  it("drives a video rendered by render.slide from the slideshow", async () => {
    const slides = [player, ...images(2)];
    const { user } = await openAt(0, {
      slides,
      slideshow: { interval: 5000 },
      render: renderPlayer,
    });
    play.mockClear();
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    await waitFor(() => expect(play).toHaveBeenCalled());
    fireEvent(current().querySelector("video")!, new Event("ended"));
    await waitFor(() => expect(counter()).toBe("2 / 3"));
  });

  it("stops the slideshow when a custom player is paused", async () => {
    const slides = [player, ...images(2)];
    const { user } = await openAt(0, {
      slides,
      slideshow: { interval: 5000 },
      render: renderPlayer,
    });
    await user.click(screen.getByRole("button", { name: "Start slideshow" }));
    fireEvent(current().querySelector("video")!, new Event("pause"));
    expect(screen.getByRole("button", { name: "Start slideshow" })).toBeInTheDocument();
  });

  it("leaves drags on player controls to the player", async () => {
    await openAt(0, { slides: [player, ...images(2)], render: renderPlayer });
    const volume = screen.getByRole("slider", { name: "Volume" });
    act(() => {
      fireEvent.pointerDown(volume, { pointerId: 1, clientX: 300, clientY: 300, isPrimary: true });
      fireEvent.pointerMove(volume, { pointerId: 1, clientX: 100, clientY: 300 });
      fireEvent.pointerUp(volume, { pointerId: 1, clientX: 100, clientY: 300 });
    });
    expect(counter()).toBe("1 / 3");
  });

  it("leaves drags inside data-eg-no-gestures to the content", async () => {
    await openAt(0, {
      slides: images(3),
      render: {
        slide: () => (
          <div data-eg-no-gestures data-testid="area" style={{ width: 100, height: 100 }} />
        ),
      },
    });
    const area = current().querySelector("[data-testid='area']")!;
    act(() => {
      fireEvent.pointerDown(area, { pointerId: 1, clientX: 300, clientY: 300, isPrimary: true });
      fireEvent.pointerMove(area, { pointerId: 1, clientX: 100, clientY: 300 });
      fireEvent.pointerUp(area, { pointerId: 1, clientX: 100, clientY: 300 });
    });
    expect(counter()).toBe("1 / 3");
  });

  it("leaves keys the content already handled", async () => {
    await openAt(0, { slides: [player, ...images(2)], render: renderPlayer });
    const volume = screen.getByRole("slider", { name: "Volume" });
    volume.addEventListener("keydown", (e) => e.preventDefault());
    volume.focus();
    fireEvent.keyDown(volume, { key: "ArrowRight", bubbles: true, cancelable: true });
    expect(counter()).toBe("1 / 3");
    fireEvent.keyDown(document.body, { key: "ArrowRight", bubbles: true, cancelable: true });
    expect(counter()).toBe("2 / 3");
  });
});
