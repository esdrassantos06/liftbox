import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from "react";
import { useIsoLayoutEffect } from "./dom";
import { wrapIndex } from "./geometry";
import { getToolbarOverflow, TOOLBAR_PRIORITY, type ToolKey } from "./toolbar";

/** One toolbar action, shown as a button in the row or as an item in the overflow menu. */
export interface Tool {
  key: ToolKey;
  label: string;
  icon: ReactNode;
  onClick: (e: MouseEvent<HTMLElement>) => void;
  disabled?: boolean;
}

/** Props of {@link ToolbarButtons}. */
export interface ToolbarButtonsProps {
  /** Tools in row order. Every new array re-measures what fits, so pass a fresh one each render. */
  tools: Tool[];
  /** Rendered last and never moved into the menu. */
  closeButton: ReactNode;
  /** Whether tools that do not fit move into a menu. */
  overflow: boolean;
  /** The top bar, measured for the room the tools have. */
  barRef: RefObject<HTMLElement | null>;
  /** The element the buttons render in. */
  toolbarRef: RefObject<HTMLElement | null>;
  moreLabel: string;
  moreIcon: ReactNode;
  buttonClassName: string;
  menuClassName: string;
  menuItemClassName: string;
  /** Called with whether the overflow menu is open, and with `false` on unmount. */
  onMenuChange: (shown: boolean) => void;
}

/** The items of an open overflow menu, in order. */
function itemsOf(menu: HTMLElement | null): HTMLElement[] {
  return [...(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
}

/**
 * The lightbox's tool buttons and close button. Tools that do not fit the top
 * bar move, lowest priority first, into a "more" menu with arrow key navigation.
 */
export function ToolbarButtons({
  tools,
  closeButton,
  overflow: overflowEnabled,
  barRef,
  toolbarRef,
  moreLabel,
  moreIcon,
  buttonClassName,
  menuClassName,
  menuItemClassName,
  onMenuChange,
}: ToolbarButtonsProps): ReactElement {
  const moreRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const widthsRef = useRef(new Map<string, number>());
  const menuId = useId();
  const [overflow, setOverflow] = useState<readonly ToolKey[]>([]);
  const [menuOpen, setMenuOpen] = useState<false | "first" | "last">(false);

  const overflowTools = tools.filter((tool) => overflow.includes(tool.key));
  const menuShown = !!menuOpen && overflowTools.length > 0;

  useIsoLayoutEffect(() => {
    const bar = barRef.current;
    const toolbar = toolbarRef.current;
    if (!bar || !toolbar) return;
    const keys = tools.map((tool) => tool.key);
    let next: ToolKey[] = [];
    if (overflowEnabled) {
      const widths = widthsRef.current;
      const gap = parseFloat(window.getComputedStyle(toolbar).columnGap) || 0;
      let visible = 0;
      for (const key of keys) {
        const el = toolbar.querySelector<HTMLElement>(`[data-eg-tool="${key}"]`);
        if (!el || el.hidden) continue;
        const width = el.offsetWidth + gap;
        widths.set(key, width);
        visible += width;
      }
      const more = toolbar.querySelector<HTMLElement>(".eg-more");
      if (more) widths.set("more", more.offsetWidth + gap);
      const moreWidth = widths.get("more") ?? widths.values().next().value ?? 0;
      const style = window.getComputedStyle(bar);
      const padding = (parseFloat(style.paddingLeft) || 0) + (parseFloat(style.paddingRight) || 0);
      const counter = bar.querySelector<HTMLElement>(".eg-counter")?.offsetWidth ?? 0;
      next = getToolbarOverflow({
        available: bar.clientWidth - padding,
        reserved: counter + toolbar.offsetWidth - visible - (more ? moreWidth : 0),
        moreWidth,
        items: keys.map((key) => ({
          width: widths.get(key) ?? 0,
          priority: TOOLBAR_PRIORITY[key],
        })),
      }).flatMap((i) => keys[i] ?? []);
    }
    if (next.join() !== overflow.join()) setOverflow(next);
    if (!next.length && menuOpen) setMenuOpen(false);
  }, [tools, overflowEnabled, overflow, menuOpen, barRef, toolbarRef]);

  useIsoLayoutEffect(() => {
    if (!menuOpen) return;
    const items = itemsOf(menuRef.current);
    (menuOpen === "first" ? items[0] : items.at(-1))?.focus();
  }, [menuOpen]);

  useIsoLayoutEffect(() => {
    onMenuChange(menuShown);
    return () => onMenuChange(false);
  }, [menuShown, onMenuChange]);

  const closeMenu = () => {
    setMenuOpen(false);
    moreRef.current?.focus();
  };

  const openMenu = (which: "first" | "last") => {
    const items = itemsOf(menuRef.current);
    if (menuShown && items.length) (which === "first" ? items[0] : items.at(-1))?.focus();
    else setMenuOpen(which);
  };

  const onMenuKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    const items = itemsOf(menuRef.current);
    const at = items.indexOf(document.activeElement as HTMLElement);
    if (at < 0) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        openMenu(e.key === "ArrowDown" ? "first" : "last");
      } else if (e.key === "Escape" && menuShown) {
        e.preventDefault();
        setMenuOpen(false);
      }
      return;
    }
    const moves: Record<string, number> = {
      ArrowDown: at + 1,
      ArrowUp: at - 1,
      Home: 0,
      End: items.length - 1,
    };
    const move = moves[e.key];
    if (move !== undefined) {
      e.preventDefault();
      items[wrapIndex(move, items.length)]?.focus();
    } else if (e.key === "Escape" || e.key === "Tab") {
      e.preventDefault();
      closeMenu();
    } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
    }
  };

  return (
    <>
      {tools.map((tool) => (
        <button
          key={tool.key}
          type="button"
          className={buttonClassName}
          aria-label={tool.label}
          disabled={tool.disabled}
          hidden={overflow.includes(tool.key)}
          data-eg-tool={tool.key}
          onClick={tool.onClick}
        >
          {tool.icon}
        </button>
      ))}
      {overflowTools.length ? (
        <div className="eg-more">
          <button
            ref={moreRef}
            type="button"
            className={buttonClassName}
            aria-label={moreLabel}
            aria-haspopup="menu"
            aria-expanded={menuShown}
            aria-controls={menuShown ? menuId : undefined}
            onClick={() => (menuShown ? setMenuOpen(false) : setMenuOpen("first"))}
            onKeyDown={onMenuKeyDown}
          >
            {moreIcon}
          </button>
          {menuShown ? (
            <>
              <div
                className="eg-menu-scrim"
                aria-hidden="true"
                onPointerDown={(e) => {
                  e.preventDefault();
                  closeMenu();
                }}
              />
              <div
                ref={menuRef}
                id={menuId}
                role="menu"
                aria-label={moreLabel}
                tabIndex={-1}
                className={menuClassName}
                onKeyDown={onMenuKeyDown}
              >
                {overflowTools.map((tool) => (
                  <button
                    key={tool.key}
                    type="button"
                    role="menuitem"
                    tabIndex={-1}
                    className={menuItemClassName}
                    aria-disabled={tool.disabled || undefined}
                    onClick={(e) => {
                      if (tool.disabled) return;
                      tool.onClick(e);
                      closeMenu();
                    }}
                  >
                    {tool.icon}
                    <span>{tool.label}</span>
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      ) : null}
      {closeButton}
    </>
  );
}
