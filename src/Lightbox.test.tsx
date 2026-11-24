import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useRef, useState, type CSSProperties } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Lightbox, type LightboxProps, type Slide } from "./index";

const slides: Slide[] = Array.from({ length: 12 }, (_, i) => ({
  src: `/img/${i + 1}.jpg`,
  srcSet: `/img/${i + 1}-640.jpg 640w, /img/${i + 1}-1280.jpg 1280w`,
  sizes: "100vw",
  width: 1600,
  height: 1000,
  alt: `Photo ${i + 1}`,
  title: `Title ${i + 1}`,
  description: `Description ${i + 1}`,
}));

type HarnessProps = Partial<LightboxProps> & { start?: number };

/** Controlled host with a thumbnail button per slide, like a real page. */
function Harness({ start = 2, ...props }: HarnessProps) {
  const [index, setIndex] = useState(-1);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <>
      {slides.map((slide, i) => (
        <button
          key={slide.src}
          ref={(el) => {
            buttons.current[i] = el;
          }}
          onClick={() => setIndex(i)}
        >
          open {i + 1}
        </button>
      ))}
      <button onClick={() => setIndex(start)}>open start</button>
      <Lightbox
        slides={slides}
        open={index >= 0}
        index={Math.max(index, 0)}
        onIndexChange={setIndex}
        onClose={() => setIndex(-1)}
        getThumbnail={(i) => buttons.current[i]}
        {...props}
      />
    </>
  );
}

async function openAt(i: number, props: HarnessProps = {}) {
  const user = userEvent.setup();
  render(<Harness {...props} />);
  await user.click(screen.getByRole("button", { name: `open ${i + 1}` }));
  return { user, dialog: await screen.findByRole("dialog") };
}

describe("Lightbox", () => {
  it("renders nothing while closed", () => {
    render(<Lightbox slides={slides} open={false} onClose={() => {}} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled modal dialog that receives focus", async () => {
    const { dialog } = await openAt(2);
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Image viewer");
    await waitFor(() => expect(dialog).toHaveFocus());
  });

  it("shows the counter and the caption of the current slide", async () => {
    const { dialog } = await openAt(2);
    expect(dialog).toHaveTextContent("3 / 12");
    expect(screen.getByText("Title 3")).toBeVisible();
    expect(screen.getByText("Description 3")).toBeVisible();
  });

  it("announces the current slide in a polite live region", async () => {
    const { user } = await openAt(2);
    const live = document.querySelector("[aria-live='polite']");
    expect(live).toHaveTextContent("Image 3 of 12: Title 3");
    await user.keyboard("{ArrowRight}");
    expect(live).toHaveTextContent("Image 4 of 12: Title 4");
  });

  it("navigates with the arrow buttons", async () => {
    const { user, dialog } = await openAt(2);
    await user.click(screen.getByRole("button", { name: "Next image" }));
    expect(dialog).toHaveTextContent("4 / 12");
    await user.click(screen.getByRole("button", { name: "Previous image" }));
    await user.click(screen.getByRole("button", { name: "Previous image" }));
    expect(dialog).toHaveTextContent("2 / 12");
  });

  it("navigates with ArrowLeft, ArrowRight, Home and End", async () => {
    const { user, dialog } = await openAt(2);
    await user.keyboard("{ArrowRight}");
    expect(dialog).toHaveTextContent("4 / 12");
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(dialog).toHaveTextContent("2 / 12");
    await user.keyboard("{End}");
    expect(dialog).toHaveTextContent("12 / 12");
    await user.keyboard("{Home}");
    expect(dialog).toHaveTextContent("1 / 12");
  });

  it("wraps around by default", async () => {
    const { user, dialog } = await openAt(11);
    await user.keyboard("{ArrowRight}");
    expect(dialog).toHaveTextContent("1 / 12");
  });

  it("disables the arrows at the ends when loop is false", async () => {
    const { user, dialog } = await openAt(11, { loop: false });
    expect(screen.getByRole("button", { name: "Next image" })).toBeDisabled();
    await user.keyboard("{ArrowRight}");
    expect(dialog).toHaveTextContent("12 / 12");
    await user.keyboard("{Home}");
    expect(screen.getByRole("button", { name: "Previous image" })).toBeDisabled();
  });

  it("closes on Escape and returns focus to the thumbnail of the current slide", async () => {
    const { user } = await openAt(2);
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "open 4" })).toHaveFocus());
  });

  it("returns focus to the opener when no thumbnail getter is given", async () => {
    const user = userEvent.setup();
    render(<Harness getThumbnail={undefined} />);
    const opener = screen.getByRole("button", { name: "open start" });
    await user.click(opener);
    await user.click(await screen.findByRole("button", { name: "Close" }));
    await waitFor(() => expect(opener).toHaveFocus());
  });

  it("closes from the close button and on backdrop click", async () => {
    const { user } = await openAt(0);
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    await user.click(screen.getByRole("button", { name: "open 1" }));
    await screen.findByRole("dialog");
    fireEvent.click(document.querySelector(".eg-slide")!);
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("keeps the dialog open on backdrop click when disabled", async () => {
    await openAt(0, { closeOnBackdropClick: false });
    fireEvent.click(document.querySelector(".eg-slide")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("wraps Tab focus at both ends of the dialog", async () => {
    const { user, dialog } = await openAt(2);
    const buttons = within(dialog)
      .getAllByRole("button")
      .filter((button) => !(button as HTMLButtonElement).disabled);
    const first = buttons[0]!;
    const last = buttons.at(-1)!;
    act(() => first.focus());
    await user.tab({ shift: true });
    expect(last).toHaveFocus();
    await user.tab();
    expect(first).toHaveFocus();
  });

  it("locks page scroll while open and restores it after", async () => {
    document.body.style.overflow = "scroll";
    const { user } = await openAt(0);
    expect(document.body.style.overflow).toBe("hidden");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("only mounts images within the preload window, with srcset and sizes", async () => {
    await openAt(5, { preload: 1 });
    const imgs = [...document.querySelectorAll<HTMLImageElement>(".eg-image")];
    expect(imgs.map((img) => img.getAttribute("alt"))).toEqual(["Photo 5", "Photo 6", "Photo 7"]);
    const current = screen.getByAltText("Photo 6");
    expect(current).toHaveAttribute("srcset", slides[5]!.srcSet);
    expect(current).toHaveAttribute("sizes", "100vw");
  });

  it("marks the chosen transition on the root", async () => {
    const { dialog } = await openAt(0, { transition: "fade" });
    expect(dialog.closest(".eg-root")).toHaveAttribute("data-transition", "fade");
  });

  it("uses custom labels, icons and class names", async () => {
    const { dialog } = await openAt(2, {
      labels: {
        dialog: "Galeria",
        close: "Fechar",
        next: "Seguinte",
        previous: "Anterior",
        counter: (current, total) => `${current} de ${total}`,
        announcement: (current, total) => `Foto ${current} de ${total}`,
      },
      icons: { close: <span data-testid="my-close" /> },
      classNames: { root: "my-root", counter: "my-counter" },
    });
    expect(dialog).toHaveAccessibleName("Galeria");
    expect(screen.getByRole("button", { name: "Fechar" })).toContainElement(
      screen.getByTestId("my-close"),
    );
    expect(screen.getByRole("button", { name: "Seguinte" })).toBeInTheDocument();
    expect(document.querySelector(".my-counter")).toHaveTextContent("3 de 12");
    expect(document.querySelector(".eg-root")).toHaveClass("my-root");
    expect(document.querySelector("[aria-live='polite']")).toHaveTextContent("Foto 3 de 12");
  });

  it("supports render overrides for caption, counter and toolbar", async () => {
    await openAt(2, {
      render: {
        caption: (slide) => <p data-testid="cap">{slide.alt}</p>,
        counter: (current, total) => <b data-testid="count">{`${current}|${total}`}</b>,
        toolbar: (buttons) => (
          <>
            <button type="button">Share</button>
            {buttons}
          </>
        ),
      },
    });
    expect(screen.getByTestId("cap")).toHaveTextContent("Photo 3");
    expect(screen.getByTestId("count")).toHaveTextContent("3|12");
    expect(screen.getByRole("button", { name: "Share" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("goes to the next slide on a left swipe and closes on a downward swipe", async () => {
    const { dialog } = await openAt(2);
    const stage = document.querySelector<HTMLElement>(".eg-stage")!;
    const swipe = (dx: number, dy: number) => {
      fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 300, isPrimary: true });
      fireEvent.pointerMove(stage, { pointerId: 1, clientX: 300 + dx, clientY: 300 + dy });
      fireEvent.pointerUp(stage, { pointerId: 1, clientX: 300 + dx, clientY: 300 + dy });
    };
    act(() => swipe(-120, 0));
    expect(dialog).toHaveTextContent("4 / 12");
    act(() => swipe(120, 0));
    expect(dialog).toHaveTextContent("3 / 12");
    act(() => swipe(0, 160));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("follows a controlled index change from the parent", async () => {
    function Controlled() {
      const [index, setIndex] = useState(0);
      return (
        <>
          <button onClick={() => setIndex(7)}>jump</button>
          <Lightbox
            slides={slides}
            open
            index={index}
            onIndexChange={setIndex}
            onClose={() => {}}
          />
        </>
      );
    }
    render(<Controlled />);
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(screen.getByRole("button", { name: "jump", hidden: true }));
    expect(dialog).toHaveTextContent("8 / 12");
  });

  it("fires lifecycle callbacks", async () => {
    const onAfterOpen = vi.fn();
    const onAfterClose = vi.fn();
    const { user } = await openAt(0, { onAfterOpen, onAfterClose });
    await waitFor(() => expect(onAfterOpen).toHaveBeenCalledTimes(1));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(onAfterClose).toHaveBeenCalledTimes(1));
  });

  it("finishes closing when the slides run out, and stays closed when they come back", async () => {
    const onAfterClose = vi.fn();
    const props = { onClose: () => {}, onAfterClose };
    const { rerender } = render(<Lightbox slides={slides} open {...props} />);
    await screen.findByRole("dialog");
    rerender(<Lightbox slides={[]} open {...props} />);
    rerender(<Lightbox slides={[]} open={false} {...props} />);
    await waitFor(() => expect(onAfterClose).toHaveBeenCalledTimes(1));
    rerender(<Lightbox slides={slides} open={false} {...props} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

interface FakeAnimation {
  finished: Promise<void>;
  cancel: () => void;
  finish: () => void;
}

/** Stubs the Web Animations API, which jsdom lacks, with animations finished by hand. */
function stubAnimate() {
  const animations: FakeAnimation[] = [];
  const animate = vi.fn(function () {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const animation = { finished, cancel: vi.fn(), finish };
    animations.push(animation);
    return animation;
  });
  Element.prototype.animate = animate as unknown as Element["animate"];
  const callOn = (selector: string) => {
    const i = animate.mock.contexts.findIndex((el) => (el as Element).matches(selector));
    return i < 0
      ? undefined
      : { args: animate.mock.calls[i] as unknown[], animation: animations[i]! };
  };
  return { animate, animations, callOn };
}

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
  }) as DOMRect;

describe("Lightbox motion", () => {
  afterEach(() => {
    Reflect.deleteProperty(Element.prototype, "animate");
    Reflect.deleteProperty(window, "matchMedia");
    vi.restoreAllMocks();
  });

  it("flies the image from its thumbnail on open, scaled to cover it", async () => {
    const { callOn } = stubAnimate();
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.matches(".eg-image")) return rect(200, 100, 800, 500);
      if (this.matches("button")) return rect(10, 10, 100, 100);
      return rect(0, 0, 0, 0);
    });
    await openAt(2, { style: { "--eg-duration": "250ms" } as CSSProperties });
    const call = callOn(".eg-image");
    expect(call).toBeDefined();
    const [keyframes, options] = call!.args as [Keyframe[], KeyframeAnimationOptions];
    expect(keyframes[0]?.transform).toBe("translate(-540px, -290px) scale(0.2)");
    expect(keyframes[0]?.clipPath).toBe("inset(0px 150px)");
    expect(keyframes.at(-1)?.transform).toBe("none");
    expect(keyframes.at(-1)?.clipPath).toBe("inset(0px 0px)");
    expect(options.duration).toBe(250);
  });

  /** Opens slide 3 from a 100px square `<img>` thumbnail showing `natural` pixels at `position`. */
  async function flightFrom(natural: [number, number], position: string) {
    const { callOn } = stubAnimate();
    const thumb = document.createElement("img");
    Object.defineProperties(thumb, {
      naturalWidth: { value: natural[0] },
      naturalHeight: { value: natural[1] },
    });
    document.body.append(thumb);
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element,
    ) {
      if (this.matches(".eg-image")) return rect(200, 100, 800, 500);
      if (this === thumb) return rect(10, 10, 100, 100);
      return rect(0, 0, 0, 0);
    });
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, "getComputedStyle").mockImplementation((el, pseudo) => {
      const style = computed(el, pseudo);
      if (el !== thumb) return style;
      return new Proxy(style, {
        get: (target, key) => {
          if (key === "objectPosition") return position;
          const value: unknown = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    });
    await openAt(2, { getThumbnail: () => thumb });
    thumb.remove();
    return (callOn(".eg-image")!.args as [Keyframe[]])[0][0];
  }

  it("starts the flight from the thumbnail's object-position crop", async () => {
    const first = await flightFrom([1600, 1000], "0% 50%");
    expect(first?.transform).toBe("translate(-510px, -290px) scale(0.2)");
    expect(first?.clipPath).toBe("inset(0px 300px 0px 0px)");
  });

  it("ignores object-position on a thumbnail file that is already cropped to its box", async () => {
    const first = await flightFrom([400, 400], "0% 50%");
    expect(first?.transform).toBe("translate(-540px, -290px) scale(0.2)");
    expect(first?.clipPath).toBe("inset(0px 150px)");
  });

  it("zooms and fades in when there is no thumbnail to start from", async () => {
    const { callOn } = stubAnimate();
    await openAt(2, { getThumbnail: () => null });
    const [keyframes] = callOn(".eg-image")!.args as [Keyframe[]];
    expect(keyframes[0]).toMatchObject({ opacity: 0 });
    expect(keyframes[0]).not.toHaveProperty("clipPath");
    expect(String(keyframes[0]?.transform)).toContain("scale(");
  });

  it("stays mounted in an exit state until the close animation ends", async () => {
    const { callOn, animations } = stubAnimate();
    const onAfterClose = vi.fn();
    const { user, dialog } = await openAt(2, { onAfterClose });
    for (const animation of animations) animation.finish();
    await user.keyboard("{Escape}");
    await waitFor(() =>
      expect(dialog.closest(".eg-root")).toHaveAttribute("data-state", "closing"),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onAfterClose).not.toHaveBeenCalled();
    const closing = animations.at(-1)!;
    expect(callOn(".eg-image")).toBeDefined();
    act(() => closing.finish());
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(onAfterClose).toHaveBeenCalledTimes(1);
  });

  it("skips the animations when the user prefers reduced motion", async () => {
    const { animate } = stubAnimate();
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    const onAfterOpen = vi.fn();
    await openAt(2, { onAfterOpen });
    await waitFor(() => expect(onAfterOpen).toHaveBeenCalledTimes(1));
    expect(animate).not.toHaveBeenCalled();
  });
});

describe("Lightbox options", () => {
  const swipe = (dx: number) => {
    const stage = document.querySelector<HTMLElement>(".eg-stage")!;
    fireEvent.pointerDown(stage, { pointerId: 1, clientX: 300, clientY: 300, isPrimary: true });
    fireEvent.pointerMove(stage, { pointerId: 1, clientX: 300 + dx, clientY: 300 });
    fireEvent.pointerUp(stage, { pointerId: 1, clientX: 300 + dx, clientY: 300 });
  };

  it("navigates only past swipeThreshold", async () => {
    const { dialog } = await openAt(2);
    act(() => swipe(-40));
    expect(dialog).toHaveTextContent("3 / 12");
  });

  it("accepts a lower swipeThreshold", async () => {
    const { dialog } = await openAt(2, { swipeThreshold: 30 });
    act(() => swipe(-40));
    expect(dialog).toHaveTextContent("4 / 12");
  });

  it("ignores swipes when swipe is false", async () => {
    const { dialog } = await openAt(2, { swipe: false });
    act(() => swipe(-120));
    expect(dialog).toHaveTextContent("3 / 12");
  });

  it("does not close on the click that ends a drag", async () => {
    await openAt(2);
    act(() => swipe(-30));
    fireEvent.click(document.querySelector(".eg-slide[data-current]")!);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("portals into the given container", async () => {
    const container = document.createElement("section");
    document.body.append(container);
    const { dialog } = await openAt(0, { container });
    expect(container).toContainElement(dialog);
    container.remove();
  });

  it("ignores keys when keyboard is false", async () => {
    const { user, dialog } = await openAt(2, { keyboard: false });
    await user.keyboard("{ArrowRight}");
    expect(dialog).toHaveTextContent("3 / 12");
  });
});
