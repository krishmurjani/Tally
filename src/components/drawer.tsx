"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function Drawer({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
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
      <button aria-label="Close" className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative flex h-full w-full max-w-lg flex-col overflow-y-auto bg-surface shadow-xl outline-none sm:rounded-l-card"
      >
        <header className="sticky top-0 flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-4">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="grid size-11 place-items-center rounded-xl text-xl text-muted hover:bg-forest-50" aria-label="Close">
            ×
          </button>
        </header>
        <div className="flex-1 px-5 py-4">{children}</div>
      </div>
    </div>
  );
}
