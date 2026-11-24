import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  cx,
  fetchPriority,
  getFocusable,
  lockScroll,
  readDuration,
  readEasing,
  subscribeNothing,
  useDataBudget,
  useIsoLayoutEffect,
  useLatest,
} from "./dom";
import {
  fitContain,
  flipMedia,
  getCrop,
  getFlipTransform,
  getMediaTransform,
  getSlideWindow,
  parseRadius,
  relativeOffset,
  wrapIndex,
  type Flip,
  type Rect,
  type Size,
} from "./geometry";
import {
  getEdgeFrictionedDelta,
  getSwipeAxis,
  getSwipeReleaseVerdict,
  getWindowedVelocity,
  pushVelocitySample,
  shouldCloseOnVerticalDrag,
  type SwipeAxis,
  type VelocitySample,
} from "./gestures";
import { defaultIcons } from "./icons";
import { defaultLabels } from "./labels";
import { remember } from "./lru";
import { getMedia, hasUnsafeScheme } from "./media";
import { Thumbnails } from "./Thumbnails";
import { ToolbarButtons, type Tool } from "./ToolbarButtons";
import type { ImageSource, LightboxClassNames, LightboxProps, Slide, VideoSource } from "./types";
import { useFullscreen } from "./useFullscreen";
import { resolveZoom, useZoom } from "./useZoom";
import { getWheelFactor, type Point } from "./zoom";

type Phase = "closed" | "opening" | "open" | "closing";

type Mode = "swipe" | "pan" | "pinch" | null;

type ImageStatus = "loaded" | "error";

interface Tap {
  id: number;
  x: number;
  y: number;
  t: number;
  moved: boolean;
  onMedia: boolean;
}

/** Content that handles its own pointer gestures: players, controls and opted-out areas. */
const OWN_GESTURES =
  'video, iframe, button, a[href], input, select, textarea, [role="slider"], [contenteditable="true"], [data-eg-no-gestures]';

const TAP_MAX_MS = 300;
const TAP_SLOP = 10;
const DOUBLE_TAP_DISTANCE = 30;

interface Drag {
  id: number;
  x: number;
  y: number;
  axis: SwipeAxis | undefined;
  samples: VelocitySample[];
}

const FALLBACK_SCALE = 0.92;

const NO_FLIP: Flip = { x: 1, y: 1 };

const DEFAULT_IDLE_MS = 3000;

const COPIED_MS = 2000;

/** Slides whose load status and natural size are kept, most recently seen first. */
const MEMORY_LIMIT = 300;

/** Most pager dots shown at once; more slides slide a window of dots along. */
const PAGER_DOTS = 12;

/** Parts that idle hiding fades out. */
const CONTROLS = [".eg-top-bar", ".eg-arrow", ".eg-caption", ".eg-thumbnails", ".eg-pager"];

/** The video of the current slide inside `scope`, if it shows one. */
function currentVideo(scope: Element | null | undefined): HTMLVideoElement | null {
  return scope?.querySelector<HTMLVideoElement>(".eg-slide[data-current] video") ?? null;
}

function isOnScreen(rect: Rect): boolean {
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    rect.left + rect.width > 0 &&
    rect.top + rect.height > 0 &&
    rect.left < window.innerWidth &&
    rect.top < window.innerHeight
  );
}

function contentBox(el: HTMLElement): Size {
  const style = window.getComputedStyle(el);
  const pad = (side: string) => parseFloat(style.getPropertyValue(`padding-${side}`)) || 0;
  return {
    width: Math.max(el.clientWidth - pad("left") - pad("right"), 0),
    height: Math.max(el.clientHeight - pad("top") - pad("bottom"), 0),
  };
}

/**
 * The `object-position` of the picture in a thumbnail, or nothing when the
 * picture already has its box's shape and so shows uncropped.
 */
function coverPosition(origin: HTMLElement): string | undefined {
  const picture = origin.matches("img, video")
    ? origin
    : origin.querySelector<HTMLElement>("img, video");
  if (!(picture instanceof HTMLImageElement || picture instanceof HTMLVideoElement)) return;
  const [width, height] =
    picture instanceof HTMLImageElement
      ? [picture.naturalWidth, picture.naturalHeight]
      : [picture.videoWidth, picture.videoHeight];
  const box = picture.getBoundingClientRect();
  if (!width || !height || !box.width || !box.height) return;
  if (Math.abs((width * box.height) / (height * box.width) - 1) < 0.01) return;
  return window.getComputedStyle(picture).objectPosition || undefined;
}

/**
 * Keyframes that grow `media` out of `origin`, cropped like the origin at the
 * start, or a zoom and fade when there is no usable origin. `transform` is the
 * media's own rotation and flip, and `sideways` says it is turned a quarter.
 * `start`, when given, is where the media is seen at rest instead of its layout box.
 */
function openKeyframes(
  media: HTMLElement,
  origin: HTMLElement | null | undefined,
  transform: string,
  sideways: boolean,
  start?: Rect,
): Keyframe[] {
  const to = media.getBoundingClientRect();
  const from = origin?.getBoundingClientRect();
  const own = transform ? ` ${transform}` : "";
  const fits = to.width > 0 && to.height > 0;
  const toward = (rect: Rect, shift = { x: 0, y: 0 }) => {
    const { x, y, scale } = getFlipTransform(rect, to);
    return `translate(${x + shift.x}px, ${y + shift.y}px) scale(${scale})${own}`;
  };
  const rest = start && fits ? toward(start) : transform || "none";
  if (origin && from && isOnScreen(from) && fits) {
    const { scale } = getFlipTransform(from, to);
    const axes = (rect: Rect): Size =>
      sideways ? { width: rect.height, height: rect.width } : rect;
    const radius = parseRadius(window.getComputedStyle(origin).borderTopLeftRadius, from.width);
    // ponytail: rotated or flipped media flies from a centered crop, its axes no longer match the thumbnail's
    const position = transform ? undefined : coverPosition(origin);
    const crop = getCrop(axes(to), axes(from), scale, radius, position);
    return [
      { transform: toward(from, crop), clipPath: crop.clipPath },
      { transform: rest, clipPath: radius > 0 ? "inset(0px 0px round 0px)" : "inset(0px 0px)" },
    ];
  }
  return [
    { opacity: 0, transform: `scale(${FALLBACK_SCALE})${own}` },
    { opacity: 1, transform: rest },
  ];
}

function fileName(url: string): string {
  try {
    const name = new URL(url, window.location.href).pathname.split("/").pop();
    return name ? decodeURIComponent(name) : "download";
  } catch {
    return "download";
  }
}

function saveLink(href: string, name: string): void {
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.rel = "noopener";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
}

/**
 * Accessible image lightbox. Render it next to your gallery, keep it mounted,
 * and drive it with `open`, `index`, `onClose` and `onIndexChange`.
 *
 * It portals a modal dialog into `container` (or `document.body`) on the
 * client only, so it is safe to render on the server.
 *
 * @example
 * ```tsx
 * const [index, setIndex] = useState(-1);
 * <Lightbox
 *   slides={slides}
 *   open={index >= 0}
 *   index={Math.max(index, 0)}
 *   onIndexChange={setIndex}
 *   onClose={() => setIndex(-1)}
 * />
 * ```
 */
export function Lightbox({
  slides,
  open,
  index = 0,
  onClose,
  onIndexChange,
  onAfterOpen,
  onAfterClose,
  loop = true,
  transition = "slide",
  captionPosition = "bar",
  preload = 2,
  closeOnBackdropClick = true,
  swipe = true,
  swipeThreshold = 50,
  keyboard = true,
  thumbnails = true,
  zoom: zoomProp,
  fullscreen = true,
  video,
  slideshow,
  rotate = false,
  flip = false,
  share,
  toolbarOverflow = true,
  idle = false,
  pager = false,
  pinchToClose = true,
  dir,
  download,
  getThumbnail,
  labels: labelOverrides,
  icons: iconOverrides,
  classNames = {},
  render = {},
  className,
  style,
  container,
}: LightboxProps): ReactElement | null {
  const total = slides.length;
  const clamp = (i: number) => Math.min(Math.max(Math.trunc(i) || 0, 0), Math.max(total - 1, 0));

  const slideshowConfig = slideshow
    ? {
        interval: Math.max((slideshow === true ? undefined : slideshow.interval) ?? 5000, 16),
        autoplay: (slideshow === true ? undefined : slideshow.autoplay) ?? false,
        progress: (slideshow === true ? undefined : slideshow.progress) ?? true,
      }
    : null;
  const [playing, setPlaying] = useState(() => open && (slideshowConfig?.autoplay ?? false));
  const [pageHidden, setPageHidden] = useState(false);
  const [phase, setPhase] = useState<Phase>(open ? "opening" : "closed");
  const [current, setCurrent] = useState(() => clamp(index));
  const [lastOpen, setLastOpen] = useState(open);
  const [lastIndex, setLastIndex] = useState(index);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setPlaying(slideshowConfig?.autoplay ?? false);
      setPhase("opening");
      setCurrent(clamp(index));
    } else if (phase !== "closed") {
      setPhase("closing");
    }
  }
  if (index !== lastIndex) {
    setLastIndex(index);
    if (open) setCurrent(clamp(index));
  }
  const active = clamp(current);

  const [rotation, setRotation] = useState(0);
  const [flipped, setFlipped] = useState<Flip>(NO_FLIP);
  const [notice, setNotice] = useState("");
  const [lastActive, setLastActive] = useState(active);
  const [jumps, setJumps] = useState<ReadonlySet<number>>(() => new Set());
  const budget = useDataBudget();
  const reach = budget === "full" ? preload : Math.min(preload, 1);
  if (active !== lastActive) {
    setLastActive(active);
    setRotation(0);
    setFlipped(NO_FLIP);
    setNotice("");
    setJumps(
      new Set(
        getSlideWindow(active, total, reach, loop)
          .filter((s) => Math.abs(s.offset - relativeOffset(s.index, lastActive, total, loop)) > 1)
          .map((s) => s.index),
      ),
    );
  }

  const isClient = useSyncExternalStore(
    subscribeNothing,
    () => true,
    () => false,
  );
  const shown = isClient && phase !== "closed" && total > 0;

  const rootRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const topBarRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const wokeRef = useRef(false);
  const [menuShown, setMenuShown] = useState(false);
  const [idleNow, setIdleNow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inheritedRtl, setInheritedRtl] = useState(false);
  const openerRef = useRef<HTMLElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const draggedRef = useRef(false);
  const frameRef = useRef(0);
  const pointersRef = useRef(new Map<number, Point>());
  const modeRef = useRef<Mode>(null);
  const tapRef = useRef<Tap | null>(null);
  const lastTapRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [box, setBox] = useState<Size | null>(null);
  const [captionSpace, setCaptionSpace] = useState(0);
  const captionRef = useRef<HTMLDivElement>(null);
  const [natural, setNatural] = useState<Record<string, Size>>({});
  const [status, setStatus] = useState<Record<string, ImageStatus>>({});

  const zoomConfig = resolveZoom(zoomProp);
  const zoom = useZoom(zoomConfig, stageRef);
  const fs = useFullscreen(rootRef, shown);

  const labels = { ...defaultLabels, ...labelOverrides };
  const icons = { ...defaultIcons, ...iconOverrides };
  const cn = (part: keyof LightboxClassNames, base: string) => cx(base, classNames[part]);

  const rtl = dir ? dir === "rtl" : inheritedRtl;
  const sign = rtl ? -1 : 1;
  const idleDelay = idle === true ? DEFAULT_IDLE_MS : typeof idle === "number" ? idle : 0;
  const mediaTransform = getMediaTransform(rotate ? rotation : 0, flip ? flipped : NO_FLIP);

  const hasPrev = loop ? total > 1 : active > 0;
  const hasNext = loop ? total > 1 : active < total - 1;

  const advance = (target: number) => {
    if (total === 0) return;
    const next = loop ? wrapIndex(target, total) : clamp(target);
    if (next === active) return;
    setCurrent(next);
    onIndexChange?.(next);
  };

  const go = (target: number) => {
    setPlaying(false);
    advance(target);
  };

  const shownSlide = slides[active];
  const currentKind = shownSlide ? getMedia(shownSlide).kind : "image";
  const holding = currentKind !== "image";

  const advanceSlideshow = () => {
    if (hasNext) advance(active + 1);
    else setPlaying(false);
  };
  const advanceRef = useLatest(advanceSlideshow);

  const interval = slideshowConfig?.interval ?? 0;
  useEffect(() => {
    if (!playing || !shown || phase === "closing" || pageHidden || holding || !interval) return;
    const timer = window.setTimeout(() => advanceRef.current(), interval);
    return () => window.clearTimeout(timer);
  }, [playing, shown, phase, pageHidden, holding, interval, active, advanceRef]);

  const toggleSlideshow = (e: MouseEvent<HTMLElement>) => {
    if (playing) currentVideo(e.currentTarget.closest(".eg-root"))?.pause();
    setPlaying(!playing);
  };

  const mediaHandlerRef = useLatest((e: Event) => {
    const media = e.target;
    if (!playing || !(media instanceof HTMLMediaElement)) return;
    if (!media.closest(".eg-slide[data-current]")) return;
    if (e.type === "ended") advanceRef.current();
    else if (!media.ended) setPlaying(false);
  });

  useEffect(() => {
    const stage = stageRef.current;
    if (!shown || !stage) return;
    const listener = (e: Event) => mediaHandlerRef.current(e);
    stage.addEventListener("ended", listener, true);
    stage.addEventListener("pause", listener, true);
    return () => {
      stage.removeEventListener("ended", listener, true);
      stage.removeEventListener("pause", listener, true);
    };
  }, [shown, mediaHandlerRef]);

  useEffect(() => {
    if (!shown || !playing || currentKind !== "video") return;
    const el = currentVideo(stageRef.current);
    el?.play()?.catch(() => {
      el.muted = true;
      el.play()?.catch(() => {});
    });
  }, [shown, playing, currentKind, active]);

  useEffect(() => {
    if (!shown) return;
    const onVisibility = () => setPageHidden(document.visibilityState === "hidden");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [shown]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!shown || !stage) return;
    stage
      .querySelectorAll<HTMLVideoElement>(".eg-slide:not([data-current]) video")
      .forEach((el) => {
        el.pause();
      });
    const current = currentVideo(stage);
    if (current && video?.autoplay) current.play()?.catch(() => {});
  }, [shown, active, video?.autoplay]);

  useEffect(() => {
    if (!shown) return;
    return lockScroll();
  }, [shown]);

  useIsoLayoutEffect(() => {
    if (!shown || dir) return;
    setInheritedRtl(window.getComputedStyle(container ?? document.body).direction === "rtl");
  }, [shown, dir, container]);

  useEffect(() => {
    const root = rootRef.current;
    if (!shown || !root || idleDelay <= 0) return;
    let timer = 0;
    let keyboard = false;
    const busy = () => {
      if (root.hasAttribute("data-menu")) return true;
      if (root.querySelector(CONTROLS.map((part) => `${part}:hover`).join(", "))) return true;
      const focused = document.activeElement;
      return keyboard && focused instanceof HTMLElement && !!focused.closest(CONTROLS.join(", "));
    };
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (busy()) schedule();
        else setIdleNow(true);
      }, idleDelay);
    };
    const wake = (e: Event) => {
      if (e.type === "pointerdown") wokeRef.current = root.hasAttribute("data-idle");
      if (e.type !== "pointermove") keyboard = e.type === "keydown";
      setIdleNow(false);
      schedule();
    };
    const events = ["pointermove", "pointerdown", "wheel"] as const;
    for (const type of events) root.addEventListener(type, wake, { capture: true, passive: true });
    document.addEventListener("keydown", wake, true);
    schedule();
    return () => {
      window.clearTimeout(timer);
      for (const type of events) root.removeEventListener(type, wake, true);
      document.removeEventListener("keydown", wake, true);
      setIdleNow(false);
    };
  }, [shown, idleDelay]);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);

  useIsoLayoutEffect(() => {
    if (!shown) return;
    const active = document.activeElement;
    openerRef.current = active instanceof HTMLElement ? active : null;
    rootRef.current?.focus({ preventScroll: true });
  }, [shown]);

  useIsoLayoutEffect(() => {
    const stage = stageRef.current;
    if (!shown || !stage) return;
    const measure = () =>
      setBox((prev) => {
        const next = contentBox(stage);
        return prev && prev.width === next.width && prev.height === next.height ? prev : next;
      });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [shown]);

  useIsoLayoutEffect(() => {
    const caption = captionRef.current;
    if (!shown || !caption) {
      setCaptionSpace(0);
      return;
    }
    const measure = () => setCaptionSpace(caption.offsetHeight);
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(caption);
    return () => observer.disconnect();
  }, [shown, active, captionPosition]);

  const measured = box !== null;
  const zoomReset = zoom.reset;

  useIsoLayoutEffect(() => {
    zoomReset();
  }, [active, box?.width, box?.height, zoomReset]);

  const finishOpen = () => {
    setPhase("open");
    onAfterOpen?.();
  };

  const finishClose = () => {
    const thumbnail = getThumbnail?.(active);
    const target = thumbnail?.isConnected ? thumbnail : openerRef.current;
    if (target?.isConnected) target.focus();
    setPhase("closed");
    onAfterClose?.();
  };

  const animatePhase = useLatest((): (() => void) | undefined => {
    if (phase === "closing" && total === 0) {
      finishClose();
      return;
    }
    const root = rootRef.current;
    if (!shown || !root || !measured || (phase !== "opening" && phase !== "closing")) return;
    const finish = phase === "opening" ? finishOpen : finishClose;
    const media =
      root.querySelector<HTMLElement>(".eg-slide[data-current] .eg-image") ??
      root.querySelector<HTMLElement>(".eg-slide[data-current] > *");
    const start =
      phase === "closing" && zoom.targetRef.current?.style.transform
        ? media?.getBoundingClientRect()
        : undefined;
    if (phase === "closing") {
      zoom.reset();
      fs.exit();
    }
    const duration = readDuration(root);
    if (!media || duration === 0 || typeof media.animate !== "function") {
      finish();
      return;
    }
    const keyframes = openKeyframes(
      media,
      getThumbnail?.(active),
      media.matches(".eg-image") ? mediaTransform : "",
      media.matches(".eg-image") && rotate && rotation % 180 !== 0,
      start,
    );
    const animation = media.animate(phase === "opening" ? keyframes : [...keyframes].reverse(), {
      duration,
      easing: readEasing(root),
      fill: phase === "closing" ? "forwards" : "none",
    });
    let cancelled = false;
    animation.finished.then(
      () => {
        if (!cancelled) finish();
      },
      () => {},
    );
    return () => {
      cancelled = true;
      animation.cancel();
    };
  });
  useIsoLayoutEffect(() => animatePhase.current(), [phase, shown, measured, animatePhase]);

  const setDragStyle = (x: number, y: number, progress: number) => {
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;
      root.style.setProperty("--eg-drag-x", `${x}px`);
      root.style.setProperty("--eg-drag-y", `${y}px`);
      root.style.setProperty("--eg-drag-progress", String(progress));
    });
  };

  const endDrag = () => {
    dragRef.current = null;
    cancelAnimationFrame(frameRef.current);
    const root = rootRef.current;
    if (!root) return;
    root.removeAttribute("data-dragging");
    for (const name of ["--eg-drag-x", "--eg-drag-y", "--eg-drag-progress"]) {
      root.style.removeProperty(name);
    }
  };

  useEffect(() => () => cancelAnimationFrame(frameRef.current), []);

  useEffect(() => {
    if (!shown) return;
    const pointers = pointersRef.current;
    return () => {
      // A finger still down when the stage unmounts never sends its pointerup.
      pointers.clear();
      modeRef.current = null;
      dragRef.current = null;
      tapRef.current = null;
      lastTapRef.current = null;
    };
  }, [shown]);

  const capture = (ids: Iterable<number>) => {
    for (const id of ids) {
      try {
        stageRef.current?.setPointerCapture?.(id);
      } catch {
        continue;
      }
    }
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    draggedRef.current = false;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (e.target instanceof Element && e.target.closest(OWN_GESTURES)) return;
    const pointers = pointersRef.current;
    const point = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, point);
    if (pointers.size === 1) {
      tapRef.current = {
        id: e.pointerId,
        ...point,
        t: performance.now(),
        moved: false,
        onMedia: e.target instanceof Element && !!e.target.closest(".eg-zoom"),
      };
    }
    if (pointers.size === 2 && zoomConfig) {
      endDrag();
      tapRef.current = null;
      draggedRef.current = true;
      modeRef.current = "pinch";
      capture(pointers.keys());
      const [a, b] = [...pointers.values()];
      if (a && b) zoom.pinchStart(a, b, pinchToClose);
      return;
    }
    if (pointers.size > 1) return;
    if (zoomConfig && zoom.isZoomed()) {
      modeRef.current = "pan";
      capture([e.pointerId]);
      zoom.panStart(point);
      return;
    }
    if (!swipe || !e.isPrimary) return;
    modeRef.current = "swipe";
    dragRef.current = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      axis: undefined,
      samples: [{ x: e.clientX, y: e.clientY, t: performance.now() }],
    };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.has(e.pointerId)) return;
    const point = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, point);
    const tap = tapRef.current;
    if (tap?.id === e.pointerId && Math.hypot(point.x - tap.x, point.y - tap.y) > TAP_SLOP) {
      tap.moved = true;
    }
    if (modeRef.current === "pinch") {
      const [a, b] = [...pointers.values()];
      if (a && b) zoom.pinchMove(a, b);
      return;
    }
    if (modeRef.current === "pan") {
      if (tap?.moved) draggedRef.current = true;
      zoom.panMove(point);
      return;
    }
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.samples = pushVelocitySample(drag.samples, {
      x: e.clientX,
      y: e.clientY,
      t: performance.now(),
    });
    const axis = getSwipeAxis(dx, dy, drag.axis);
    if (!axis) return;
    if (!drag.axis) {
      drag.axis = axis;
      draggedRef.current = true;
      rootRef.current?.setAttribute("data-dragging", axis);
      capture([e.pointerId]);
    }
    if (axis === "horizontal") {
      setDragStyle(getEdgeFrictionedDelta(dx * sign, hasPrev, hasNext) * sign, 0, 0);
    } else setDragStyle(0, dy, Math.min(Math.abs(dy) / window.innerHeight, 1));
  };

  const releaseSwipe = (e: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    const now = performance.now();
    const velocity = getWindowedVelocity(
      pushVelocitySample(drag.samples, { x: e.clientX, y: e.clientY, t: now }),
      now,
    );
    const axis = drag.axis;
    endDrag();
    if (axis === "horizontal") {
      const verdict = getSwipeReleaseVerdict({
        deltaX: dx * sign,
        velocityX: velocity.x * sign,
        threshold: swipeThreshold,
        viewportWidth: box?.width ?? window.innerWidth,
      });
      if (verdict === "next" && hasNext) go(active + 1);
      if (verdict === "prev" && hasPrev) go(active - 1);
    } else if (
      axis === "vertical" &&
      shouldCloseOnVerticalDrag(dy, velocity.y, window.innerHeight)
    ) {
      onClose();
    }
  };

  const detectDoubleTap = (e: PointerEvent<HTMLDivElement>) => {
    const tap = tapRef.current;
    tapRef.current = null;
    const now = performance.now();
    if (!tap || tap.id !== e.pointerId || tap.moved || now - tap.t > TAP_MAX_MS) return;
    if (!zoomConfig || !tap.onMedia) {
      lastTapRef.current = null;
      return;
    }
    const last = lastTapRef.current;
    if (
      last &&
      now - last.t < TAP_MAX_MS &&
      Math.hypot(tap.x - last.x, tap.y - last.y) < DOUBLE_TAP_DISTANCE
    ) {
      lastTapRef.current = null;
      zoom.toggle({ x: e.clientX, y: e.clientY });
      return;
    }
    lastTapRef.current = { x: tap.x, y: tap.y, t: now };
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const pointers = pointersRef.current;
    if (!pointers.delete(e.pointerId)) return;
    const mode = modeRef.current;
    if (mode === "pinch") {
      if (pointers.size >= 2) return;
      const close = zoom.end();
      modeRef.current = null;
      if (close) {
        onClose();
        return;
      }
      const rest = [...pointers.values()][0];
      if (rest && zoom.isZoomed()) {
        modeRef.current = "pan";
        zoom.panStart(rest);
      }
      return;
    }
    modeRef.current = null;
    if (mode === "pan") zoom.end();
    if (mode === "swipe") releaseSwipe(e);
    detectDoubleTap(e);
  };

  const onPointerCancel = (e: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);
    if (modeRef.current === "pinch" || modeRef.current === "pan") zoom.end();
    modeRef.current = null;
    tapRef.current = null;
    endDrag();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    const root = rootRef.current;
    if (!root) return;
    if (e.key === "Tab") {
      const focusable = getFocusable(root);
      const first = focusable[0];
      const last = focusable.at(-1);
      const inside = focusable.includes(document.activeElement as HTMLElement);
      if (!first || !last) {
        e.preventDefault();
      } else if (e.shiftKey && (!inside || document.activeElement === first)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (!inside || document.activeElement === last)) {
        e.preventDefault();
        first.focus();
      }
      return;
    }
    if (
      !keyboard ||
      phase === "closing" ||
      e.defaultPrevented ||
      e.metaKey ||
      e.ctrlKey ||
      e.altKey
    ) {
      return;
    }
    const target = e.target;
    if (
      e.key !== "Escape" &&
      target instanceof HTMLElement &&
      (target instanceof HTMLMediaElement ||
        target.isContentEditable ||
        /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
    ) {
      return;
    }
    const actions: Record<string, () => void> = {
      Escape: onClose,
      ArrowLeft: () => go(active - sign),
      ArrowRight: () => go(active + sign),
      Home: () => go(0),
      End: () => go(total - 1),
    };
    if (zoomConfig) {
      actions["+"] = actions["="] = () => zoom.zoomBy(zoomConfig.step);
      actions["-"] = () => zoom.zoomBy(1 / zoomConfig.step);
      actions["0"] = () => {
        zoom.zoomTo(1);
        setRotation(0);
        setFlipped(NO_FLIP);
      };
    }
    const action = actions[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  };

  const keyHandlerRef = useLatest(onKeyDown);
  useEffect(() => {
    if (!shown) return;
    const listener = (e: KeyboardEvent) => keyHandlerRef.current(e);
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, [shown, keyHandlerRef]);

  const wheelHandlerRef = useLatest((e: WheelEvent) => {
    if (!zoomConfig?.wheel || !zoom.targetRef.current) return;
    e.preventDefault();
    zoom.zoomBy(
      getWheelFactor(e.deltaY, e.deltaMode, e.ctrlKey),
      { x: e.clientX, y: e.clientY },
      false,
    );
  });
  useEffect(() => {
    const stage = stageRef.current;
    if (!shown || !stage) return;
    const listener = (e: WheelEvent) => wheelHandlerRef.current(e);
    stage.addEventListener("wheel", listener, { passive: false });
    return () => stage.removeEventListener("wheel", listener);
  }, [shown, wheelHandlerRef]);

  useIsoLayoutEffect(() => {
    const root = rootRef.current;
    const focused = document.activeElement;
    if (!root || !(focused instanceof HTMLElement)) return;
    if ((root.contains(focused) && focused.matches(":disabled")) || focused === document.body) {
      root.focus({ preventScroll: true });
    }
  });

  const onSlideClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || draggedRef.current || !closeOnBackdropClick) return;
    if (wokeRef.current) {
      wokeRef.current = false;
      return;
    }
    onClose();
  };

  const slide = slides[active];
  if (!shown || !slide) return null;
  const button = (part: "button" | "arrow", base: string) =>
    cx(cn("button", "eg-button"), part === "arrow" && cn("arrow", base));

  const closeButton = (
    <button
      type="button"
      className={button("button", "")}
      aria-label={labels.close}
      onClick={onClose}
    >
      {icons.close}
    </button>
  );

  const captionOf = (item: Slide, i: number): ReactNode =>
    render.caption ? (
      render.caption(item, i)
    ) : item.title || item.description ? (
      <>
        {item.title ? <h2 className="eg-caption-title">{item.title}</h2> : null}
        {item.description ? <p className="eg-caption-description">{item.description}</p> : null}
      </>
    ) : null;
  const caption = captionPosition === "bar" || holding ? captionOf(slide, active) : null;

  const renderMedia = (
    item: Slide,
    i: number,
    isCurrent: boolean,
    hold: boolean,
  ): {
    node: ReactNode;
    builtIn: boolean;
    frame?: CSSProperties | undefined;
    reserved?: boolean;
  } => {
    const media = getMedia(item, { autoplay: video?.autoplay });
    const reserved = !!box && media.kind !== "image" && captionSpace > 0;
    const fit = reserved
      ? { width: box.width, height: Math.max(box.height - captionSpace, 0) }
      : box;
    const naturalSize =
      item.width && item.height ? { width: item.width, height: item.height } : natural[item.src];
    const size =
      fit && naturalSize
        ? fitContain(naturalSize.width, naturalSize.height, fit.width, fit.height)
        : undefined;
    const custom = render.slide?.({
      slide: item,
      index: i,
      current: isCurrent,
      width: size?.width ?? fit?.width ?? 0,
      height: size?.height ?? fit?.height ?? 0,
    });
    if (custom !== undefined)
      return { node: custom, builtIn: false, frame: size ?? fit ?? undefined, reserved };
    if (media.kind !== "image") {
      const frame =
        fit &&
        fitContain(naturalSize?.width ?? 1280, naturalSize?.height ?? 720, fit.width, fit.height);
      const frameStyle =
        media.kind === "iframe" && !naturalSize
          ? { width: fit?.width, height: fit?.height }
          : frame
            ? { width: frame.width, height: frame.height }
            : undefined;
      const name = item.alt ?? (typeof item.title === "string" ? item.title : labels.video);
      if (media.kind === "video") {
        const videoSources = (item.sources ?? []).filter(
          (source): source is VideoSource => "src" in source,
        );
        return {
          node: (
            // Captions come from slide.tracks below; the rule cannot see through the map.
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video
              className={cn("video", "eg-video")}
              src={videoSources.length > 0 ? undefined : item.src}
              poster={item.poster}
              aria-label={name}
              style={frameStyle}
              controls
              playsInline
              preload={isCurrent ? "metadata" : "none"}
              muted={video?.autoplay ?? false}
              onLoadedMetadata={(e) => {
                const { videoWidth: width, videoHeight: height } = e.currentTarget;
                if (!naturalSize && width && height) {
                  setNatural((prev) => remember(prev, item.src, { width, height }, MEMORY_LIMIT));
                }
              }}
            >
              {videoSources.map((source) => (
                <source key={source.src} src={source.src} type={source.type} />
              ))}
              {item.tracks?.map((track) => (
                <track
                  key={track.src}
                  src={track.src}
                  kind={track.kind ?? "captions"}
                  srcLang={track.srcLang}
                  label={track.label}
                  default={track.default}
                />
              ))}
            </video>
          ),
          builtIn: false,
          frame: frameStyle,
          reserved,
        };
      }
      const poster = item.poster ?? media.poster ?? item.thumbnail;
      return {
        node:
          isCurrent && media.embed ? (
            <iframe
              className={cn("embed", "eg-embed")}
              src={media.embed}
              title={name}
              style={frameStyle}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              referrerPolicy="strict-origin-when-cross-origin"
            />
          ) : poster ? (
            <img
              className="eg-embed-poster"
              src={poster}
              alt=""
              style={frameStyle}
              draggable={false}
            />
          ) : (
            <div className="eg-embed-poster" style={frameStyle} />
          ),
        builtIn: false,
        frame: frameStyle,
        reserved,
      };
    }
    if (status[item.src] === "error") {
      return { node: <p className="eg-error">{labels.loadError}</p>, builtIn: false };
    }
    const turn = rotate && isCurrent ? rotation : 0;
    const transform = isCurrent ? mediaTransform : "";
    const sideways = turn % 180 !== 0;
    const footprint =
      sideways && box && naturalSize
        ? fitContain(naturalSize.height, naturalSize.width, box.width, box.height)
        : size;
    const imageSize =
      sideways && footprint ? { width: footprint.height, height: footprint.width } : size;
    const renderedWidth =
      imageSize && isCurrent && zoomConfig && zoom.scale > 1
        ? imageSize.width * zoomConfig.maxScale
        : imageSize?.width;
    const fetching = isCurrent || !hold || status[item.src] !== undefined;
    const placeholder =
      item.thumbnail && status[item.src] !== "loaded"
        ? `url(${JSON.stringify(item.thumbnail)})`
        : undefined;
    const pictureSources = (item.sources ?? []).filter(
      (source): source is ImageSource => "srcSet" in source,
    );
    const sizes = item.sizes ?? (renderedWidth ? `${Math.round(renderedWidth)}px` : "100vw");
    const img = (
      <img
        className={cn("image", "eg-image")}
        src={fetching ? item.src : undefined}
        srcSet={fetching ? item.srcSet : undefined}
        {...fetchPriority(isCurrent ? "high" : "low")}
        sizes={item.srcSet ? sizes : undefined}
        alt={item.alt ?? ""}
        width={imageSize?.width}
        height={imageSize?.height}
        style={
          imageSize || transform || placeholder
            ? {
                width: imageSize?.width,
                height: imageSize?.height,
                transform: transform || undefined,
                backgroundImage: placeholder,
              }
            : undefined
        }
        decoding="async"
        draggable={false}
        onLoad={(e) => {
          const { naturalWidth: width, naturalHeight: height } = e.currentTarget;
          setStatus((prev) =>
            prev[item.src] === "loaded"
              ? prev
              : remember<ImageStatus>(prev, item.src, "loaded", MEMORY_LIMIT),
          );
          if (!naturalSize && width && height) {
            setNatural((prev) => remember(prev, item.src, { width, height }, MEMORY_LIMIT));
          }
        }}
        onError={() =>
          setStatus((prev) => remember<ImageStatus>(prev, item.src, "error", MEMORY_LIMIT))
        }
      />
    );
    const image =
      pictureSources.length > 0 ? (
        <picture className="eg-picture">
          {pictureSources.map((source) => (
            <source
              key={source.srcSet}
              srcSet={fetching ? source.srcSet : undefined}
              type={source.type}
              media={source.media}
              sizes={source.sizes ?? sizes}
            />
          ))}
          {img}
        </picture>
      ) : (
        img
      );
    const framed = rotate ? (
      <div
        className="eg-rotate"
        data-turn={sideways ? "odd" : "even"}
        style={footprint ? { width: footprint.width, height: footprint.height } : undefined}
      >
        {image}
      </div>
    ) : (
      image
    );
    return {
      node: zoomConfig ? (
        <div className="eg-zoom" ref={isCurrent ? zoom.targetRef : undefined}>
          {framed}
        </div>
      ) : (
        framed
      ),
      builtIn: true,
      frame: footprint,
    };
  };

  const currentMedia = renderMedia(slide, active, true, false);
  const hold = budget === "save" || (currentMedia.builtIn && status[slide.src] === undefined);
  const windowSlides = getSlideWindow(active, total, reach, loop).flatMap(
    ({ index: i, offset }) => {
      const item = slides[i];
      if (!item) return [];
      const isCurrent = i === active;
      return [
        {
          index: i,
          offset,
          item,
          isCurrent,
          media: isCurrent ? currentMedia : renderMedia(item, i, false, hold),
        },
      ];
    },
  );
  const currentIsImage = windowSlides.find((s) => s.isCurrent)?.media.builtIn ?? false;
  const showThumbnails = thumbnails && total > 1;

  const downloadOptions = typeof download === "object" ? download : {};
  const downloadUrl =
    download &&
    slide.download !== false &&
    (currentKind === "image" || currentKind === "video") &&
    !hasUnsafeScheme(slide.download ?? slide.src, ["data:"])
      ? (slide.download ?? slide.src)
      : null;

  const saveCurrent = async (url: string) => {
    const item = slide;
    const name = item.downloadName ?? downloadOptions.filename?.(item, active) ?? fileName(url);
    try {
      if (new URL(url, window.location.href).origin === window.location.origin) {
        saveLink(url, name);
        return;
      }
      const response = await fetch(url, { mode: "cors" });
      if (!response.ok) throw new Error(`Download failed with HTTP ${response.status}`);
      const href = URL.createObjectURL(await response.blob());
      saveLink(href, name);
      window.setTimeout(() => URL.revokeObjectURL(href), 100);
    } catch (error) {
      window.open(url, "_blank", "noopener");
      setNotice(labels.downloadError);
      downloadOptions.onError?.(error, item);
    }
  };

  const shareOptions = typeof share === "object" ? share : {};
  const canShare =
    !!share &&
    (typeof navigator.share === "function" || typeof navigator.clipboard?.writeText === "function");

  const shareCurrent = async () => {
    const url = shareOptions.url?.(slide, active) ?? window.location.href;
    const title = typeof slide.title === "string" ? slide.title : slide.alt;
    if (typeof navigator.share === "function") {
      try {
        await navigator.share(title ? { url, title } : { url });
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setNotice(labels.linkCopied);
      setCopied(true);
    } catch {
      setNotice(labels.shareError);
    }
  };

  const tools: Tool[] = [];
  if (slideshowConfig && total > 1) {
    tools.push({
      key: "slideshow",
      label: playing ? labels.pauseSlideshow : labels.playSlideshow,
      icon: playing ? icons.pauseSlideshow : icons.playSlideshow,
      onClick: toggleSlideshow,
    });
  }
  if (zoomConfig && currentIsImage) {
    tools.push(
      {
        key: "zoomIn",
        label: labels.zoomIn,
        icon: icons.zoomIn,
        disabled: zoom.scale >= zoomConfig.maxScale,
        onClick: () => zoom.zoomBy(zoomConfig.step),
      },
      {
        key: "zoomOut",
        label: labels.zoomOut,
        icon: icons.zoomOut,
        disabled: zoom.scale <= zoomConfig.minScale,
        onClick: () => zoom.zoomBy(1 / zoomConfig.step),
      },
    );
  }
  if (rotate && currentIsImage) {
    tools.push(
      {
        key: "rotateLeft",
        label: labels.rotateLeft,
        icon: icons.rotateLeft,
        onClick: () => setRotation((value) => value - 90),
      },
      {
        key: "rotateRight",
        label: labels.rotateRight,
        icon: icons.rotateRight,
        onClick: () => setRotation((value) => value + 90),
      },
    );
  }
  if (flip && currentIsImage) {
    tools.push(
      {
        key: "flipHorizontal",
        label: labels.flipHorizontal,
        icon: icons.flipHorizontal,
        onClick: () => setFlipped((value) => flipMedia(value, rotation, "horizontal")),
      },
      {
        key: "flipVertical",
        label: labels.flipVertical,
        icon: icons.flipVertical,
        onClick: () => setFlipped((value) => flipMedia(value, rotation, "vertical")),
      },
    );
  }
  if (canShare) {
    tools.push({
      key: "share",
      label: labels.share,
      icon: copied ? icons.linkCopied : icons.share,
      onClick: () => void shareCurrent(),
    });
  }
  if (downloadUrl) {
    tools.push({
      key: "download",
      label: labels.download,
      icon: icons.download,
      onClick: () => void saveCurrent(downloadUrl),
    });
  }
  if (fullscreen && fs.supported) {
    tools.push({
      key: "fullscreen",
      label: fs.active ? labels.exitFullscreen : labels.enterFullscreen,
      icon: fs.active ? icons.exitFullscreen : icons.enterFullscreen,
      onClick: fs.toggle,
    });
  }

  const toolbarButtons = (
    <ToolbarButtons
      tools={tools}
      closeButton={closeButton}
      overflow={toolbarOverflow}
      barRef={topBarRef}
      toolbarRef={toolbarRef}
      moreLabel={labels.more}
      moreIcon={icons.more}
      buttonClassName={button("button", "")}
      menuClassName={cn("menu", "eg-menu")}
      menuItemClassName={cn("menuItem", "eg-menu-item")}
      onMenuChange={setMenuShown}
    />
  );

  const showPager = pager && total > 1;
  const pagerStart = Math.min(
    Math.max(active - Math.floor(PAGER_DOTS / 2), 0),
    Math.max(total - PAGER_DOTS, 0),
  );

  const slideCaption = (item: Slide, i: number, frame: CSSProperties | undefined) => {
    if (captionPosition !== "slide" || getMedia(item).kind !== "image") return null;
    const content = captionOf(item, i);
    if (content == null || content === false) return null;
    return (
      <div className={cn("slideCaption", "eg-slide-caption")} style={frame}>
        <div className={cn("caption", "eg-caption")} dir="auto">
          {content}
        </div>
      </div>
    );
  };

  const dialog = (
    <div
      ref={rootRef}
      className={cx(cn("root", "eg-root"), className)}
      style={style}
      role="dialog"
      aria-modal="true"
      aria-label={labels.dialog}
      tabIndex={-1}
      data-state={phase}
      data-transition={transition}
      data-zoomed={zoom.scale > 1 || undefined}
      data-playing={playing || undefined}
      data-thumbnails={showThumbnails || undefined}
      data-pager={showPager || undefined}
      data-idle={idleNow || undefined}
      data-menu={menuShown || undefined}
      dir={rtl ? "rtl" : "ltr"}
    >
      <div className={cn("backdrop", "eg-backdrop")} />
      <div
        ref={stageRef}
        className={cn("stage", "eg-stage")}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        {windowSlides.map(({ index: i, offset, item, isCurrent, media }) => (
          <div
            key={i}
            className={cn("slide", "eg-slide")}
            style={
              {
                "--eg-offset": offset,
                "--eg-caption-space": media.reserved ? `${captionSpace}px` : undefined,
              } as CSSProperties
            }
            data-current={isCurrent || undefined}
            data-jump={jumps.has(i) || undefined}
            data-status={media.builtIn ? (status[item.src] ?? "loading") : status[item.src]}
            role="presentation"
            aria-hidden={isCurrent ? undefined : true}
            onClick={onSlideClick}
          >
            {media.node}
            {slideCaption(item, i, media.frame)}
          </div>
        ))}
      </div>
      <div ref={topBarRef} className={cn("topBar", "eg-top-bar")}>
        <div className={cn("counter", "eg-counter")} dir="auto">
          {render.counter ? render.counter(active + 1, total) : labels.counter(active + 1, total)}
        </div>
        <div ref={toolbarRef} className={cn("toolbar", "eg-toolbar")}>
          {render.toolbar ? render.toolbar(toolbarButtons, slide, active) : toolbarButtons}
        </div>
      </div>
      {total > 1 ? (
        <>
          <button
            type="button"
            className={button("arrow", "eg-arrow eg-arrow-prev")}
            aria-label={labels.previous}
            disabled={!hasPrev}
            onClick={() => go(active - 1)}
          >
            {icons.previous}
          </button>
          <button
            type="button"
            className={button("arrow", "eg-arrow eg-arrow-next")}
            aria-label={labels.next}
            disabled={!hasNext}
            onClick={() => go(active + 1)}
          >
            {icons.next}
          </button>
        </>
      ) : null}
      {caption != null && caption !== false ? (
        <div ref={captionRef} className={cn("caption", "eg-caption")} dir="auto">
          {caption}
        </div>
      ) : null}
      {slideshowConfig?.progress && playing && !holding && !pageHidden ? (
        <div
          key={active}
          className={cn("progress", "eg-progress")}
          style={{ "--eg-slideshow-interval": `${slideshowConfig.interval}ms` } as CSSProperties}
          aria-hidden="true"
        />
      ) : null}
      {showPager ? (
        <nav className={cn("pager", "eg-pager")} aria-label={labels.pager}>
          {slides.slice(pagerStart, pagerStart + PAGER_DOTS).map((item, offset) => {
            const i = pagerStart + offset;
            return (
              <button
                key={i}
                type="button"
                className={cn("pagerDot", "eg-pager-dot")}
                aria-label={labels.pagerItem(i + 1, total, item)}
                aria-current={i === active || undefined}
                data-more={
                  (offset === 0 && pagerStart > 0) ||
                  (offset === PAGER_DOTS - 1 && pagerStart + PAGER_DOTS < total) ||
                  undefined
                }
                onClick={() => go(i)}
              />
            );
          })}
        </nav>
      ) : null}
      {showThumbnails ? (
        <Thumbnails
          slides={slides}
          active={active}
          labels={labels}
          className={cn("thumbnails", "eg-thumbnails")}
          thumbnailClassName={cn("thumbnail", "eg-thumbnail")}
          renderThumbnail={render.thumbnail}
          onSelect={go}
        />
      ) : null}
      <div className="eg-sr-only" role="status">
        {notice}
      </div>
      <div className="eg-sr-only" aria-live="polite" aria-atomic="true">
        {labels.announcement(active + 1, total, slide)}
      </div>
    </div>
  );

  return createPortal(dialog, container ?? document.body);
}
