import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createRef, useRef, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  JustifiedGrid,
  Lightbox,
  MasonryGrid,
  UniformGrid,
  type GridHandle,
  type Slide,
} from "./index";

const slides: Slide[] = [
  { src: "/a.jpg", srcSet: "/a-640.jpg 640w", width: 1500, height: 1000, alt: "Alpha" },
  { src: "/b.jpg", width: 1000, height: 1500, alt: "Bravo", thumbnail: "/b-thumb.jpg" },
  { src: "/c.jpg", width: 1000, height: 1000, alt: "Charlie" },
  { src: "/d.jpg", width: 2000, height: 1000, title: "Delta" },
];

type Callback = (entries: { contentRect: { width: number } }[]) => void;
const observers: { callback: Callback; disconnect: ReturnType<typeof vi.fn> }[] = [];

/** Reports `width` to every observed grid, like a real resize. */
function resizeTo(width: number) {
  act(() => {
    for (const observer of observers) observer.callback([{ contentRect: { width } }]);
  });
}

beforeEach(() => {
  observers.length = 0;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      disconnect = vi.fn();
      constructor(callback: Callback) {
        observers.push({ callback, disconnect: this.disconnect });
      }
      observe() {}
      unobserve() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const grids = [
  ["MasonryGrid", MasonryGrid],
  ["JustifiedGrid", JustifiedGrid],
  ["UniformGrid", UniformGrid],
] as const;

describe.each(grids)("%s", (_, Grid) => {
  it("renders a labelled button per slide in a list and reports clicks", async () => {
    const onOpen = vi.fn();
    render(<Grid slides={slides} onOpen={onOpen} />);
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items).toHaveLength(4);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Open Alpha",
      "Open Bravo",
      "Open Charlie",
      "Open Delta",
    ]);
    await userEvent.click(buttons[2]!);
    expect(onOpen).toHaveBeenCalledWith(2);
  });

  it("renders lazy images with explicit dimensions, srcset and sizes", () => {
    render(<Grid slides={slides} onOpen={() => {}} />);
    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(4);
    for (const img of images) {
      expect(img).toHaveAttribute("loading", "lazy");
      expect(img).toHaveAttribute("decoding", "async");
      expect(img).toHaveAttribute("alt", "");
      expect(Number(img.getAttribute("width"))).toBeGreaterThan(0);
      expect(Number(img.getAttribute("height"))).toBeGreaterThan(0);
    }
    expect(images[0]).toHaveAttribute("srcset", "/a-640.jpg 640w");
    expect(images[0]!.getAttribute("sizes")).toMatch(/^\d+px$/);
    expect(images[2]).not.toHaveAttribute("sizes");
    expect(images[1]).toHaveAttribute("src", "/b-thumb.jpg");
  });

  it("shows plain images with their alt text when there is no onOpen", () => {
    render(<Grid slides={slides} />);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByRole("img", { name: "Bravo" })).toBeInTheDocument();
  });

  it("exposes each thumbnail through the ref, for Lightbox getThumbnail", () => {
    const ref = createRef<GridHandle>();
    render(<Grid ref={ref} slides={slides} onOpen={() => {}} />);
    expect(ref.current?.getThumbnail(1)).toBe(screen.getByRole("button", { name: "Open Bravo" }));
    expect(ref.current?.getThumbnail(9)).toBeNull();
  });

  it("uses one ResizeObserver and disconnects it on unmount", () => {
    const { unmount } = render(<Grid slides={slides} onOpen={() => {}} />);
    expect(observers).toHaveLength(1);
    unmount();
    expect(observers[0]!.disconnect).toHaveBeenCalled();
  });

  it("accepts labels, class names, style and a custom image renderer", () => {
    const image = vi.fn(({ slide, width, height, sizes }) => (
      <span data-testid="custom">{`${String(slide.alt)} ${width}x${height} ${sizes}`}</span>
    ));
    render(
      <Grid
        slides={slides}
        onOpen={() => {}}
        labels={{ open: (index, total, slide) => `Abrir ${index} de ${total}: ${slide.src}` }}
        classNames={{ root: "r", item: "i", button: "b" }}
        className="extra"
        style={{ color: "red" }}
        render={{ image }}
      />,
    );
    const list = screen.getByRole("list");
    expect(list).toHaveClass("eg-grid", "r", "extra");
    expect(list).toHaveStyle({ color: "rgb(255, 0, 0)" });
    expect(screen.getAllByRole("listitem")[0]).toHaveClass("eg-grid-item", "i");
    const first = screen.getByRole("button", { name: "Abrir 1 de 4: /a.jpg" });
    expect(first).toHaveClass("eg-grid-button", "b");
    expect(screen.getAllByTestId("custom")).toHaveLength(4);
    expect(image.mock.calls[0]![0]).toMatchObject({ index: 0, slide: slides[0] });
    expect(screen.getAllByTestId("custom")[0]!.textContent).toMatch(/^Alpha \d+x\d+ \d+px$/);
  });

  it("opens the Lightbox on the clicked slide and returns focus to it on close", async () => {
    function Page() {
      const [index, setIndex] = useState(-1);
      const grid = useRef<GridHandle>(null);
      return (
        <>
          <Grid ref={grid} slides={slides} onOpen={setIndex} />
          <Lightbox
            slides={slides}
            open={index >= 0}
            index={Math.max(index, 0)}
            onIndexChange={setIndex}
            onClose={() => setIndex(-1)}
            getThumbnail={(i) => grid.current?.getThumbnail(i)}
          />
        </>
      );
    }
    const user = userEvent.setup();
    render(<Page />);
    await user.click(screen.getByRole("button", { name: "Open Charlie" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("3 / 4")).toBeInTheDocument();
    await user.keyboard("{ArrowRight}");
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(screen.getByRole("button", { name: "Open Delta" })).toHaveFocus());
  });
});

const item = (name: string) => screen.getByRole("button", { name }).closest("li")!;

describe("MasonryGrid layout", () => {
  it("lays items out in the shortest column, sized from the measured width", () => {
    render(<MasonryGrid slides={slides} onOpen={() => {}} columns={2} gap={10} />);
    resizeTo(410);
    expect(item("Open Alpha").style.width).toBe("48.7805%");
    expect(item("Open Alpha").style.height).toBe("133px");
    expect(item("Open Bravo").style.insetInlineStart).toBe("51.2195%");
    expect(item("Open Charlie").style.top).toBe("143px");
    expect(screen.getByRole("list").style.height).toBe("410px");
  });

  it("resolves responsive columns and gap from the container width", () => {
    const columns = vi.fn((width: number) => (width < 600 ? 1 : 4));
    render(<MasonryGrid slides={slides} onOpen={() => {}} columns={columns} gap={() => 0} />);
    resizeTo(300);
    expect(columns).toHaveBeenLastCalledWith(300);
    expect(item("Open Delta").style.width).toBe("100%");
    expect(item("Open Bravo").style.top).toBe("200px");
  });
});

describe("JustifiedGrid layout", () => {
  it("builds rows near the target height that fill the width", () => {
    render(<JustifiedGrid slides={slides} onOpen={() => {}} rowHeight={300} gap={0} />);
    resizeTo(1000);
    expect(item("Open Alpha").style.height).toBe("316px");
    expect(item("Open Alpha").style.width).toBe("47.4%");
    expect(item("Open Bravo").style.insetInlineStart).toBe("47.4%");
    expect(item("Open Charlie").style.width).toBe("31.5%");
    expect(item("Open Delta").style.top).toBe("316px");
    expect(item("Open Delta").style.height).toBe("300px");
    expect(item("Open Delta").style.width).toBe("60%");
    expect(screen.getByRole("list").style.height).toBe("616px");
  });

  it("drops leftover items with lastRow hide", () => {
    render(
      <JustifiedGrid slides={slides} onOpen={() => {}} rowHeight={300} gap={0} lastRow="hide" />,
    );
    resizeTo(1000);
    expect(screen.getAllByRole("button")).toHaveLength(3);
  });

  it("lays out at defaultContainerWidth before the first measurement", () => {
    render(<JustifiedGrid slides={slides} rowHeight={(w) => w / 4} defaultContainerWidth={800} />);
    expect(screen.getByRole("img", { name: "Alpha" }).closest("li")!.style.height).not.toBe("");
  });
});

describe("UniformGrid layout", () => {
  it("sets the column count, gap and aspect ratio as CSS variables", () => {
    render(
      <UniformGrid
        slides={slides}
        onOpen={() => {}}
        columns={(w) => (w < 600 ? 2 : 3)}
        gap={12}
        aspectRatio={4 / 3}
      />,
    );
    resizeTo(500);
    const list = screen.getByRole("list");
    expect(list.style.getPropertyValue("--eg-grid-columns")).toBe("2");
    expect(list.style.getPropertyValue("--eg-grid-gap")).toBe("12px");
    expect(list.style.getPropertyValue("--eg-grid-aspect-ratio")).toBe(String(4 / 3));
    const img = screen.getAllByRole("button")[0]!.querySelector("img")!;
    expect(img).toHaveAttribute("width", "244");
    expect(img).toHaveAttribute("height", "183");
  });
});

describe("filtering", () => {
  it("keeps each slide's own image element when slides before it are filtered out", () => {
    const { rerender } = render(<UniformGrid slides={slides} />);
    const bravo = screen.getByRole("img", { name: "Bravo" });
    rerender(<UniformGrid slides={slides.slice(1)} />);
    expect(screen.getByRole("img", { name: "Bravo" })).toBe(bravo);
  });
});
