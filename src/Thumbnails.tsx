import { useRef, useState, type ReactElement, type ReactNode } from "react";
import { fetchPriority, prefersReducedMotion, useIsoLayoutEffect } from "./dom";
import { previewOf } from "./media";
import type { LightboxLabels, Slide } from "./types";

/** Strips longer than this render only the thumbnails in view. */
const VIRTUAL_AFTER = 100;

/** Thumbnails rendered past each edge of the visible part of a long strip. */
const OVERSCAN = 8;

/** Thumbnails rendered on each side of the current one before a long strip is measured. */
const UNMEASURED_SPAN = 24;

/** Props of {@link Thumbnails}. */
export interface ThumbnailsProps {
  slides: Slide[];
  active: number;
  labels: Pick<LightboxLabels, "thumbnails" | "thumbnail">;
  className: string;
  thumbnailClassName: string;
  renderThumbnail: ((slide: Slide, index: number, current: boolean) => ReactNode) | undefined;
  onSelect: (index: number) => void;
}

interface Metrics {
  /** Width of one thumbnail in px. */
  item: number;
  /** Distance in px from one thumbnail to the next, gap included. */
  step: number;
}

/**
 * Strip of thumbnail buttons. It scrolls natively and keeps the current
 * thumbnail centered whenever the slide changes. Long strips only render the
 * thumbnails in view, with spacers standing in for the rest.
 */
export function Thumbnails({
  slides,
  active,
  labels,
  className,
  thumbnailClassName,
  renderThumbnail,
  onSelect,
}: ThumbnailsProps): ReactElement {
  const trackRef = useRef<HTMLUListElement>(null);
  const centeredRef = useRef<number | null>(null);
  const total = slides.length;
  const virtual = total > VIRTUAL_AFTER;
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [view, setView] = useState({ left: 0, width: 0 });

  const readView = () => {
    const track = trackRef.current;
    if (!track) return;
    const left = Math.abs(track.scrollLeft);
    const width = track.clientWidth;
    setView((prev) => (prev.left === left && prev.width === width ? prev : { left, width }));
  };

  useIsoLayoutEffect(() => {
    const track = trackRef.current;
    if (!virtual || !track) return;
    const measure = () => {
      const item = track.querySelector<HTMLElement>(".eg-thumbnails-item")?.offsetWidth ?? 0;
      const gap = parseFloat(window.getComputedStyle(track).columnGap) || 0;
      setMetrics((prev) =>
        !item
          ? null
          : prev?.item === item && prev.step === item + gap
            ? prev
            : { item, step: item + gap },
      );
      readView();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [virtual]);

  useIsoLayoutEffect(() => {
    const track = trackRef.current;
    if (!track || typeof track.scrollTo !== "function") return;
    let center: number;
    if (virtual) {
      if (!metrics) return;
      const pad = parseFloat(window.getComputedStyle(track).paddingInlineStart) || 0;
      center = pad + active * metrics.step + metrics.item / 2;
    } else {
      const button = track.children[active]?.firstElementChild;
      if (!(button instanceof HTMLElement)) return;
      center = button.offsetLeft + button.offsetWidth / 2;
    }
    const reduced = prefersReducedMotion();
    const previous = centeredRef.current;
    const near =
      !virtual ||
      !metrics ||
      Math.abs(active - (previous ?? active)) * metrics.step <= track.clientWidth;
    const smooth = previous !== null && previous !== active && near && !reduced;
    const left = center - track.clientWidth / 2;
    const rtl = virtual && window.getComputedStyle(track).direction === "rtl";
    track.scrollTo({ left: rtl ? -left : left, behavior: smooth ? "smooth" : "auto" });
    centeredRef.current = active;
    if (virtual && !smooth) readView();
  }, [active, metrics, virtual]);

  let first = 0;
  let last = total - 1;
  if (virtual && metrics && view.width) {
    first = Math.max(Math.floor(view.left / metrics.step) - OVERSCAN, 0);
    last = Math.min(Math.ceil((view.left + view.width) / metrics.step) + OVERSCAN, total - 1);
  } else if (virtual) {
    first = Math.max(active - UNMEASURED_SPAN, 0);
    last = Math.min(active + UNMEASURED_SPAN, total - 1);
  }
  const gap = metrics ? metrics.step - metrics.item : 0;
  const spacer = (count: number) =>
    count > 0 && metrics ? (
      <li
        aria-hidden="true"
        className="eg-thumbnails-spacer"
        style={{ flex: "none", width: count * metrics.step - gap }}
      />
    ) : null;

  return (
    <nav className={className} aria-label={labels.thumbnails}>
      <ul ref={trackRef} className="eg-thumbnails-track" onScroll={virtual ? readView : undefined}>
        {spacer(first)}
        {slides.slice(first, last + 1).map((slide, offset) => {
          const i = first + offset;
          const current = i === active;
          const preview = previewOf(slide);
          return (
            <li
              key={i}
              className="eg-thumbnails-item"
              aria-setsize={virtual ? total : undefined}
              aria-posinset={virtual ? i + 1 : undefined}
            >
              <button
                type="button"
                className={thumbnailClassName}
                aria-label={labels.thumbnail(i + 1, total, slide)}
                aria-current={current || undefined}
                onClick={() => onSelect(i)}
              >
                {renderThumbnail ? (
                  renderThumbnail(slide, i, current)
                ) : preview ? (
                  <img
                    className="eg-thumbnail-image"
                    src={preview}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    {...fetchPriority("low")}
                    draggable={false}
                  />
                ) : (
                  <span className="eg-thumbnail-image" aria-hidden="true" />
                )}
              </button>
            </li>
          );
        })}
        {spacer(total - 1 - last)}
      </ul>
    </nav>
  );
}
