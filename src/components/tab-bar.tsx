"use client";

import Link from "next/link";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

export interface TabItem {
  key: string;
  href: string;
  label: ReactNode;
  badge?: ReactNode;
}

const MOVE = "transform 380ms cubic-bezier(0.34, 1.25, 0.5, 1), width 380ms cubic-bezier(0.34, 1.25, 0.5, 1), height 380ms cubic-bezier(0.34, 1.25, 0.5, 1)";

/**
 * Tabs with one highlight that glides to the selected tab. The highlight is measured from the real layout, so it
 * follows whatever arrangement the bar has (a row, a grid, wrapped lines).
 *
 * The tabs are links to separate pages, so the bar can be rebuilt on each navigation. It remembers which tab was
 * selected last (per `storageKey`) and starts the new highlight there, then slides it, so it reads as one motion.
 * A tab you've just pressed responds at once, before the next page has loaded. Reduced-motion users get no sliding.
 */
export function TabBar({
  items,
  activeKey,
  ariaLabel,
  storageKey,
  className,
  itemClass,
  activeClass,
  inactiveClass,
  pillClass,
  pillColor,
}: {
  items: TabItem[];
  activeKey: string;
  ariaLabel: string;
  storageKey: string;
  className: string;
  itemClass: string;
  activeClass: string;
  inactiveClass: string;
  pillClass: string;
  /** Any CSS colour; also the fallback background of the active tab before scripts run. */
  pillColor: string;
}) {
  const nav = useRef<HTMLElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);
  const [pending, setPending] = useState<string | null>(null);

  useLayoutEffect(() => {
    const bar = nav.current;
    const p = pill.current;
    if (!bar || !p) return;
    const find = (key: string) => bar.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`);
    const place = (el: HTMLElement, animate: boolean) => {
      p.style.transition = animate ? MOVE : "none";
      p.style.transform = `translate(${el.offsetLeft}px, ${el.offsetTop}px)`;
      p.style.width = `${el.offsetWidth}px`;
      p.style.height = `${el.offsetHeight}px`;
    };
    const current = find(activeKey);
    if (!current) {
      p.style.opacity = "0";
      return;
    }
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    p.style.opacity = "1";
    if (!placed.current) {
      // First paint of this bar: begin where the previous page's highlight was, then glide to here.
      let from: HTMLElement | null = null;
      try {
        const prev = sessionStorage.getItem(`tally.tabs.${storageKey}`);
        if (prev && prev !== activeKey) from = find(prev);
      } catch {
        /* storage unavailable: no glide */
      }
      if (from && !reduce) {
        place(from, false);
        p.getBoundingClientRect(); // commit the start position before moving
        requestAnimationFrame(() => place(current, true));
      } else {
        place(current, false);
      }
      placed.current = true;
    } else {
      place(current, !reduce); // this bar stayed mounted: the highlight is already on the old tab
    }
    bar.dataset.ready = "true";
    try {
      sessionStorage.setItem(`tally.tabs.${storageKey}`, activeKey);
    } catch {
      /* ignore */
    }
    // Re-place the highlight when the bar really changes size (rotating a phone, resizing a window). The observer also
    // reports once as soon as it starts watching; reacting to that would snap the highlight and cancel the glide.
    let lastW = bar.offsetWidth;
    let lastH = bar.offsetHeight;
    const ro = new ResizeObserver(() => {
      if (bar.offsetWidth === lastW && bar.offsetHeight === lastH) return;
      lastW = bar.offsetWidth;
      lastH = bar.offsetHeight;
      const c = find(activeKey);
      if (c) place(c, false);
    });
    ro.observe(bar);
    return () => ro.disconnect();
  }, [activeKey, storageKey, items.length]);

  useEffect(() => setPending(null), [activeKey]);
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => setPending(null), 3000); // e.g. a ctrl-click that never navigated here
    return () => clearTimeout(t);
  }, [pending]);

  return (
    <nav ref={nav} aria-label={ariaLabel} data-ready="false" className={`tabbar relative ${className}`} style={{ "--tab-pill": pillColor } as React.CSSProperties}>
      <span ref={pill} aria-hidden="true" className={`pointer-events-none absolute left-0 top-0 z-0 opacity-0 ${pillClass}`} style={{ background: pillColor }} />
      {items.map((t) => {
        const active = t.key === activeKey;
        return (
          <Link
            key={t.key}
            href={t.href}
            data-key={t.key}
            aria-current={active ? "page" : undefined}
            onClick={() => setPending(t.key)}
            className={`relative z-10 select-none transition-[transform,color,background-color] duration-150 active:scale-[0.96] motion-reduce:transition-none ${itemClass} ${active ? activeClass : pending === t.key ? "text-brand-strong" : inactiveClass}`}
          >
            {t.label}
            {t.badge}
          </Link>
        );
      })}
    </nav>
  );
}
