import {
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  version,
  type RefObject,
} from "react";

/** `useLayoutEffect` in the browser, `useEffect` on the server, where layout effects do not run. */
export const useIsoLayoutEffect: typeof useEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** Ref that always holds the latest `value`, for listeners and effects that must not re-run when it changes. */
export function useLatest<T>(value: T): RefObject<T> {
  const ref = useRef(value);
  useIsoLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/** `useSyncExternalStore` subscriber for values that never change after mount. */
export const subscribeNothing = (): (() => void) => () => {};

/** Whether the user asked the system to reduce motion. */
export function prefersReducedMotion(): boolean {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}

// React 19 only knows `fetchPriority`; React 18 warns on it and passes `fetchpriority` through.
const PRIORITY_PROP = Number.parseInt(version, 10) >= 19 ? "fetchPriority" : "fetchpriority";

/** `<img>` props that set the fetch priority under React 18 and 19 alike. */
export function fetchPriority(priority: "high" | "low"): Record<string, string> {
  return { [PRIORITY_PROP]: priority };
}

/**
 * How much prefetching the device can afford: `save` with Save-Data or a 2G
 * connection, `slow` on 3G or with 2 GB of memory or less, `full` otherwise and
 * wherever the browser does not tell.
 */
export type DataBudget = "save" | "slow" | "full";

interface Connection extends EventTarget {
  saveData?: boolean;
  effectiveType?: string;
}

const connection = (): Connection | undefined =>
  (navigator as Navigator & { connection?: Connection }).connection;

function readDataBudget(): DataBudget {
  const info = connection();
  if (info?.saveData || info?.effectiveType === "slow-2g" || info?.effectiveType === "2g") {
    return "save";
  }
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  return info?.effectiveType === "3g" || memory <= 2 ? "slow" : "full";
}

function subscribeDataBudget(onChange: () => void): () => void {
  const info = connection();
  info?.addEventListener("change", onChange);
  return () => info?.removeEventListener("change", onChange);
}

/** The current {@link DataBudget}, updated when the connection changes. */
export function useDataBudget(): DataBudget {
  return useSyncExternalStore(subscribeDataBudget, readDataBudget, () => "full");
}

/** Joins the truthy class names with spaces. */
export function cx(...names: (string | false | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Controls inside `root` that Tab can reach, in DOM order. */
export function getFocusable(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (el) => !el.closest("[hidden], [inert]"),
  );
}

/**
 * Stops the page from scrolling and pads the body by the scrollbar width so
 * nothing shifts sideways. Returns a function that restores the exact inline
 * values that were there before.
 */
export function lockScroll(): () => void {
  const { body, documentElement } = document;
  const overflow = body.style.overflow;
  const paddingRight = body.style.paddingRight;
  const scrollbar = window.innerWidth - documentElement.clientWidth;
  if (scrollbar > 0) {
    const current = parseFloat(window.getComputedStyle(body).paddingRight) || 0;
    body.style.paddingRight = `${current + scrollbar}px`;
  }
  body.style.overflow = "hidden";
  return () => {
    body.style.overflow = overflow;
    body.style.paddingRight = paddingRight;
  };
}

/** Parses a CSS time such as `300ms` or `0.3s` into milliseconds. */
export function parseDuration(value: string, fallback: number): number {
  const match = /^(-?[\d.]+)(ms|s)?$/.exec(value.trim());
  if (!match) return fallback;
  const amount = Number(match[1]);
  if (Number.isNaN(amount)) return fallback;
  return match[2] === "s" ? amount * 1000 : amount;
}

/** Default length of the open, close and slide animations in ms. */
const DEFAULT_DURATION = 320;

/** Animation length for `el`: its `--eg-duration`, or zero under reduced motion. */
export function readDuration(el: Element): number {
  if (prefersReducedMotion()) return 0;
  return parseDuration(
    window.getComputedStyle(el).getPropertyValue("--eg-duration"),
    DEFAULT_DURATION,
  );
}

/** Default timing function of the open, close and slide animations. */
export const DEFAULT_EASING = "cubic-bezier(0.2, 0, 0, 1)";

/** Timing function for `el`: its `--eg-easing`, or {@link DEFAULT_EASING}. */
export function readEasing(el: Element): string {
  return window.getComputedStyle(el).getPropertyValue("--eg-easing").trim() || DEFAULT_EASING;
}
