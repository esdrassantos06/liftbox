import {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ForwardRefExoticComponent,
  type ReactElement,
  type RefAttributes,
  type RefObject,
} from "react";
import { cx, useIsoLayoutEffect } from "./dom";
import { defaultGridLabels } from "./labels";
import { getJustifiedLayout, getMasonryLayout, type GridLayout } from "./layout";
import { previewOf } from "./media";
import type {
  GridHandle,
  GridProps,
  JustifiedGridProps,
  MasonryGridProps,
  Responsive,
  Slide,
  UniformGridProps,
} from "./types";

/** Grids with more slides than this only render the items near the viewport. */
const VIRTUAL_AFTER = 200;

/** Viewport height assumed before the grid is measured, and on the server. */
const UNMEASURED_VIEWPORT = 1000;

interface Placement {
  width: number;
  height: number;
  /** Offset from the top of the grid in px, for grids that place items absolutely. */
  top?: number;
  style?: CSSProperties;
}

interface Arrangement {
  /** One entry per slide; `null` leaves the slide out. */
  items: (Placement | null)[];
  style: CSSProperties;
}

interface BaseGridProps extends GridProps {
  kind: "masonry" | "justified" | "uniform";
  arrange: (width: number, gap: number) => Arrangement;
}

const resolve = <T,>(value: Responsive<T>, width: number): T =>
  typeof value === "function" ? (value as (width: number) => T)(width) : value;

const defaultColumns = (width: number): number => (width < 640 ? 2 : width < 1024 ? 3 : 4);
const defaultRowHeight = (width: number): number => (width < 640 ? 180 : 260);
const ratiosOf = (slides: Slide[]): number[] =>
  slides.map((slide) => (slide.width ?? 0) / (slide.height ?? 0));
const percent = (value: number, total: number): string =>
  `${Number(((value / total) * 100).toFixed(4))}%`;

/** Positions every box absolutely; horizontal values are percentages so a narrower first paint never overflows. */
function absolute(layout: GridLayout, width: number): Arrangement {
  return {
    style: { height: layout.height },
    items: layout.boxes.map((box) =>
      box.width === 0 && box.height === 0
        ? null
        : {
            width: box.width,
            height: box.height,
            top: box.top,
            style: {
              top: box.top,
              insetInlineStart: percent(box.start, width),
              width: percent(box.width, width),
              height: box.height,
            },
          },
    ),
  };
}

/** Content-box width of the list, from one `ResizeObserver`, or `initial` until it is measured. */
function useContainerWidth(initial: number): [RefObject<HTMLUListElement | null>, number] {
  const ref = useRef<HTMLUListElement>(null);
  const [width, setWidth] = useState(initial);
  useIsoLayoutEffect(() => {
    const list = ref.current;
    if (!list) return;
    if (list.clientWidth > 0) setWidth(list.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.floor(entry?.contentRect.width ?? 0);
      if (next > 0) setWidth(next);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}

/**
 * Vertical span of the list, in its own px, worth rendering: the screen it is
 * on plus one screen above and below. It moves in whole screens, so scrolling
 * re-renders the grid about once per screen.
 */
function useVisibleSpan(
  ref: RefObject<HTMLUListElement | null>,
  enabled: boolean,
): [from: number, to: number] {
  const [span, setSpan] = useState<[number, number]>([0, UNMEASURED_VIEWPORT * 2]);
  useIsoLayoutEffect(() => {
    const list = ref.current;
    if (!enabled || !list) return;
    const update = () => {
      const screen = window.innerHeight || UNMEASURED_VIEWPORT;
      const base = Math.floor(-list.getBoundingClientRect().top / screen) * screen;
      const from = base - screen;
      const to = base + screen * 2;
      setSpan((prev) => (prev[0] === from && prev[1] === to ? prev : [from, to]));
    };
    update();
    window.addEventListener("scroll", update, { capture: true, passive: true });
    window.addEventListener("resize", update);
    return () => {
      window.removeEventListener("scroll", update, { capture: true });
      window.removeEventListener("resize", update);
    };
  }, [ref, enabled]);
  return span;
}

const BaseGrid = /* @__PURE__ */ forwardRef<GridHandle, BaseGridProps>(function BaseGrid(
  {
    slides,
    onOpen,
    gap = 8,
    defaultContainerWidth = 1024,
    labels,
    classNames = {},
    render,
    className,
    style,
    kind,
    arrange,
  },
  ref,
): ReactElement {
  const [listRef, width] = useContainerWidth(defaultContainerWidth);
  const virtual = slides.length > VIRTUAL_AFTER;
  const [from, to] = useVisibleSpan(listRef, virtual);
  const [opener, setOpener] = useState(-1);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  useImperativeHandle(ref, () => ({ getThumbnail: (i) => buttons.current[i] ?? null }), []);
  const gapPx = resolve(gap, width);
  const { items, style: layoutStyle } = useMemo(
    () => arrange(width, gapPx),
    [arrange, width, gapPx],
  );
  const { open } = { ...defaultGridLabels, ...labels };
  const seen = new Map<string, number>();

  return (
    <ul
      ref={listRef}
      className={cx("eg-grid", `eg-grid--${kind}`, classNames.root, className)}
      style={{ ...layoutStyle, ...style }}
      data-virtual={virtual || undefined}
    >
      {slides.map((slide, i) => {
        const copy = seen.get(slide.src) ?? 0;
        seen.set(slide.src, copy + 1);
        const item = items[i];
        if (!item) return null;
        const away = item.top !== undefined && (item.top > to || item.top + item.height < from);
        // The opener stays mounted so the lightbox can return focus to it on close.
        if (virtual && away && i !== opener) return null;
        const sizes = `${item.width}px`;
        const custom = render?.image?.({
          slide,
          index: i,
          width: item.width,
          height: item.height,
          ...(item.style ? { style: item.style } : {}),
          sizes,
        });
        const alt = onOpen ? "" : slide.alt || (typeof slide.title === "string" ? slide.title : "");
        const preview = previewOf(slide);
        const image =
          custom !== undefined ? (
            custom
          ) : preview ? (
            <img
              className={cx("eg-grid-image", classNames.image)}
              src={preview}
              srcSet={slide.srcSet}
              sizes={slide.srcSet ? sizes : undefined}
              width={item.width}
              height={item.height}
              alt={alt}
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : (
            <span
              className={cx("eg-grid-image", classNames.image)}
              role={alt ? "img" : undefined}
              aria-label={alt || undefined}
            />
          );
        return (
          <li
            key={copy ? `${slide.src}#${copy}` : slide.src}
            className={cx("eg-grid-item", classNames.item)}
            style={item.style}
          >
            {onOpen ? (
              <button
                ref={(el) => {
                  buttons.current[i] = el;
                }}
                type="button"
                className={cx("eg-grid-button", classNames.button)}
                aria-label={open(i + 1, slides.length, slide)}
                onClick={() => {
                  setOpener(i);
                  onOpen(i);
                }}
              >
                {image}
              </button>
            ) : (
              image
            )}
          </li>
        );
      })}
    </ul>
  );
});

/** A grid component: its props plus a `ref` to a {@link GridHandle}. */
export type GridComponent<P> = ForwardRefExoticComponent<P & RefAttributes<GridHandle>>;

/**
 * Equal-width columns where each image keeps its aspect ratio. Items fill the
 * shortest column, so the reading and tab order stays left to right, top to bottom.
 */
export const MasonryGrid: GridComponent<MasonryGridProps> = /* @__PURE__ */ memo(
  /* @__PURE__ */ forwardRef<GridHandle, MasonryGridProps>(function MasonryGrid(
    { columns = defaultColumns, ...props },
    ref,
  ) {
    const { slides } = props;
    const arrange = useCallback(
      (width: number, gap: number) =>
        absolute(
          getMasonryLayout({
            ratios: ratiosOf(slides),
            containerWidth: width,
            columns: resolve(columns, width),
            gap,
          }),
          width,
        ),
      [slides, columns],
    );
    return <BaseGrid {...props} ref={ref} kind="masonry" arrange={arrange} />;
  }),
);

/**
 * Rows of equal height that fill the width edge to edge, each image keeping its
 * aspect ratio and each row as close as possible to `rowHeight`.
 */
export const JustifiedGrid: GridComponent<JustifiedGridProps> = /* @__PURE__ */ memo(
  /* @__PURE__ */ forwardRef<GridHandle, JustifiedGridProps>(function JustifiedGrid(
    { rowHeight = defaultRowHeight, lastRow, ...props },
    ref,
  ) {
    const { slides } = props;
    const arrange = useCallback(
      (width: number, gap: number) =>
        absolute(
          getJustifiedLayout({
            ratios: ratiosOf(slides),
            containerWidth: width,
            targetRowHeight: resolve(rowHeight, width),
            gap,
            lastRow,
          }),
          width,
        ),
      [slides, rowHeight, lastRow],
    );
    return <BaseGrid {...props} ref={ref} kind="justified" arrange={arrange} />;
  }),
);

/**
 * Equal cells in a CSS grid. Images are cropped to `aspectRatio`. Past a few
 * hundred slides the list gets `data-virtual` and the cells are placed
 * absolutely instead, so only the ones near the viewport need to render.
 */
export const UniformGrid: GridComponent<UniformGridProps> = /* @__PURE__ */ memo(
  /* @__PURE__ */ forwardRef<GridHandle, UniformGridProps>(function UniformGrid(
    { columns = defaultColumns, aspectRatio = 1, ...props },
    ref,
  ) {
    const { slides } = props;
    const arrange = useCallback(
      (width: number, gap: number): Arrangement => {
        const count = Math.max(1, Math.floor(resolve(columns, width)) || 1);
        const cell = Math.round((width - gap * (count - 1)) / count);
        const height = Math.round(cell / aspectRatio);
        if (slides.length > VIRTUAL_AFTER) {
          const boxes = slides.map((_, i) => ({
            top: Math.floor(i / count) * (height + gap),
            start: (i % count) * (cell + gap),
            width: cell,
            height,
          }));
          const rows = Math.ceil(slides.length / count);
          return absolute({ boxes, height: Math.max(rows * (height + gap) - gap, 0) }, width);
        }
        const placement = { width: cell, height };
        return {
          style: {
            "--eg-grid-columns": count,
            "--eg-grid-gap": `${gap}px`,
            "--eg-grid-aspect-ratio": aspectRatio,
          } as CSSProperties,
          items: slides.map(() => placement),
        };
      },
      [slides, columns, aspectRatio],
    );
    return <BaseGrid {...props} ref={ref} kind="uniform" arrange={arrange} />;
  }),
);
