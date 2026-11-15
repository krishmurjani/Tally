"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: ReactNode; children: ReactNode }) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
      prev?.focus();
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button aria-label="Close" className="animate-fade-in absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="animate-drawer-in relative flex h-full w-full max-w-xl flex-col overflow-y-auto bg-canvas shadow-2xl outline-none sm:rounded-l-3xl"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-line bg-canvas/95 px-6 py-5 backdrop-blur">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold leading-snug">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="grid size-11 shrink-0 place-items-center rounded-xl border border-line bg-surface transition hover:bg-forest-50" aria-label="Close">
            <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M5 5l10 10M15 5L5 15" />
            </svg>
          </button>
        </header>
        <div className="flex-1 px-6 py-6">{children}</div>
      </div>
    </div>
  );
}
