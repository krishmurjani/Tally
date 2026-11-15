"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

type Placement = { top?: number; bottom?: number; left: number; width: number; maxHeight: number };

/** A floating panel anchored to an element. Rendered on <body>, so tables and drawers never clip it. */
export function Popover({
  open,
  anchorRef,
  onClose,
  align = "start",
  minWidth = 0,
  children,
  role = "listbox",
  label,
  id,
}: {
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  align?: "start" | "end";
  minWidth?: number;
  children: ReactNode;
  role?: "listbox" | "group" | "menu";
  label?: string;
  id?: string;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const r = anchorRef.current.getBoundingClientRect();
    const width = Math.max(r.width, minWidth);
    const margin = 8;
    let left = align === "end" ? r.right - width : r.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - width - margin));
    const below = window.innerHeight - r.bottom - margin;
    const above = r.top - margin;
    if (below < 220 && above > below) setPlace({ bottom: window.innerHeight - r.top + 6, left, width, maxHeight: Math.min(340, above - 6) });
    else setPlace({ top: r.bottom + 6, left, width, maxHeight: Math.min(340, below - 6) });
  }, [open, anchorRef, align, minWidth]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (!menuRef.current?.contains(t) && !anchorRef.current?.contains(t)) onClose();
    };
    const onScroll = (e: Event) => {
      if (!menuRef.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !place || typeof document === "undefined") return null;
  const style: CSSProperties = { position: "fixed", left: place.left, minWidth: place.width, maxHeight: place.maxHeight, top: place.top, bottom: place.bottom };
  return createPortal(
    <div ref={menuRef} id={id} role={role} aria-label={label} style={style} className="animate-pop-in z-[70] overflow-y-auto rounded-xl border border-line bg-surface p-1.5 shadow-lg">
      {children}
    </div>,
    document.body,
  );
}

function Chevron() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted">
      <path d="M5.5 8l4.5 4.5L14.5 8" />
    </svg>
  );
}

function Check() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-forest-700">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

export interface SelectOption {
  value: string;
  label: string;
  /** Optional colour dot (e.g. a category colour). */
  dot?: string;
  disabled?: boolean;
}

/**
 * The app's dropdown: same look as the Columns menu, keyboard accessible (arrows, Enter, Esc, type to jump).
 * Replaces every native <select>.
 */
export function Select({
  value,
  onChange,
  options,
  placeholder = "Choose…",
  ariaLabel,
  disabled,
  size = "md",
  className = "",
  triggerClassName,
  triggerStyle,
  renderValue,
  hideChevron,
  menuMinWidth = 0,
  align = "start",
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  ariaLabel: string;
  disabled?: boolean;
  size?: "md" | "lg";
  className?: string;
  /** Replaces the default field styling (for pills etc.). */
  triggerClassName?: string;
  triggerStyle?: CSSProperties;
  renderValue?: (selected: SelectOption | undefined) => ReactNode;
  hideChevron?: boolean;
  menuMinWidth?: number;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const typed = useRef({ text: "", at: 0 });
  const selected = options.find((o) => o.value === value);
  const close = useCallback(() => setOpen(false), []);

  const openMenu = () => {
    if (disabled) return;
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (o: SelectOption) => {
    if (o.disabled) return;
    setOpen(false);
    triggerRef.current?.focus();
    if (o.value !== value) onChange(o.value);
  };

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        openMenu();
      }
      return;
    }
    const step = (d: 1 | -1) => {
      let i = active;
      for (let n = 0; n < options.length; n++) {
        i = (i + d + options.length) % options.length;
        if (!options[i]!.disabled) break;
      }
      setActive(i);
    };
    if (e.key === "ArrowDown") (e.preventDefault(), step(1));
    else if (e.key === "ArrowUp") (e.preventDefault(), step(-1));
    else if (e.key === "Home") (e.preventDefault(), setActive(0));
    else if (e.key === "End") (e.preventDefault(), setActive(options.length - 1));
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const o = options[active];
      if (o) choose(o);
    } else if (e.key === "Tab") setOpen(false);
    else if (e.key.length === 1 && /\S/.test(e.key)) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + e.key.toLowerCase(), at: now };
      const i = options.findIndex((o) => !o.disabled && o.label.toLowerCase().startsWith(typed.current.text));
      if (i >= 0) setActive(i);
    }
  }

  const base =
    triggerClassName ??
    `inline-flex w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface text-left outline-none transition hover:bg-forest-50/50 focus-visible:border-forest-600 disabled:opacity-60 ${size === "lg" ? "h-12 px-3.5 text-base" : "h-11 px-3 text-sm"}`;
  return (
    <div className={className}>
      <button
        ref={triggerRef}
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${active}` : undefined}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openMenu())}
        onKeyDown={onKeyDown}
        className={base}
        style={triggerStyle}
      >
        {renderValue ? (
          renderValue(selected)
        ) : (
          <span className={`flex min-w-0 items-center gap-2 ${selected ? "" : "text-faint"}`}>
            {selected?.dot && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: selected.dot }} />}
            <span className="truncate">{selected?.label ?? placeholder}</span>
          </span>
        )}
        {!hideChevron && <Chevron />}
      </button>
      <Popover open={open} anchorRef={triggerRef} onClose={close} minWidth={menuMinWidth} align={align} id={listId} label={ariaLabel}>
        {options.map((o, i) => (
          <div
            key={o.value}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={o.value === value}
            aria-disabled={o.disabled || undefined}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(o)}
            className={`flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition ${i === active ? "bg-forest-50" : ""} ${o.disabled ? "cursor-not-allowed opacity-50" : ""}`}
          >
            {o.dot && <span aria-hidden="true" className="size-2.5 shrink-0 rounded-full" style={{ background: o.dot }} />}
            <span className="min-w-0 flex-1 truncate">{o.label}</span>
            {o.value === value && <Check />}
          </div>
        ))}
      </Popover>
    </div>
  );
}
