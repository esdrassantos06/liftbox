import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from "react";
import { subscribeNothing } from "./dom";

/** What {@link useFullscreen} returns. */
export interface FullscreenController {
  /** Whether the browser lets this page enter fullscreen. */
  supported: boolean;
  /** Whether `targetRef` is the fullscreen element right now. */
  active: boolean;
  toggle: () => void;
  /** Leaves fullscreen if `targetRef` holds it. */
  exit: () => void;
}

/**
 * Fullscreen API bound to one element. Tracks changes made outside the
 * lightbox, such as the browser's own Escape handling.
 */
export function useFullscreen(
  targetRef: RefObject<HTMLElement | null>,
  listening: boolean,
): FullscreenController {
  const supported = useSyncExternalStore(
    subscribeNothing,
    () =>
      document.fullscreenEnabled === true &&
      typeof Element.prototype.requestFullscreen === "function",
    () => false,
  );
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!supported || !listening) return;
    const onChange = () =>
      setActive(!!targetRef.current && document.fullscreenElement === targetRef.current);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [supported, listening, targetRef]);

  const exit = useCallback(() => {
    if (supported && targetRef.current && document.fullscreenElement === targetRef.current) {
      document.exitFullscreen().catch(() => {});
    }
  }, [supported, targetRef]);

  const toggle = useCallback(() => {
    const target = targetRef.current;
    if (!supported || !target) return;
    if (document.fullscreenElement === target) exit();
    else target.requestFullscreen().catch(() => {});
  }, [supported, targetRef, exit]);

  return { supported, active, toggle, exit };
}
