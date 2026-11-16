"use client";

import { useId, useState, type ReactNode } from "react";

/**
 * The app's one expand/collapse control: a full-width button row with a circular chevron, and content that
 * slides open. Closed content is inert, so it can't be tabbed into or read by a screen reader.
 */
export function Collapsible({
  title,
  meta,
  defaultOpen = false,
  className = "",
  children,
}: {
  title: ReactNode;
  /** Small text on the right of the row, e.g. "34 months". */
  meta?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`overflow-hidden rounded-xl border border-line bg-surface ${className}`}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((v) => !v)}
        className={`flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-forest-50/60 ${open ? "bg-forest-50/40" : ""}`}
      >
        <span aria-hidden="true" className={`grid size-7 shrink-0 place-items-center rounded-full border transition-colors duration-200 ${open ? "border-transparent bg-forest-700 text-white" : "border-line bg-canvas text-brand"}`}>
          <svg viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={`transition-transform duration-300 motion-reduce:transition-none ${open ? "rotate-180" : ""}`}>
            <path d="M5.5 8l4.5 4.5L14.5 8" />
          </svg>
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium">{title}</span>
        {meta && <span className="shrink-0 text-xs text-faint">{meta}</span>}
      </button>
      <div id={id} role="region" inert={!open} className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${open ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}>
        <div className="min-h-0 overflow-hidden">
          <div className="border-t border-line px-3 py-3 sm:px-4">{children}</div>
        </div>
      </div>
    </div>
  );
}
