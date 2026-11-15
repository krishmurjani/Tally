"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Small centered confirmation. Esc or the backdrop cancels. */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  busy,
  onConfirm,
  onCancel,
  error,
}: {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  error?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4">
      <button aria-label="Cancel" onClick={onCancel} className="animate-fade-in absolute inset-0 bg-ink/30" />
      <div ref={ref} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabIndex={-1} className="animate-pop-in relative w-full max-w-sm rounded-card bg-surface p-6 shadow-xl outline-none">
        <h2 id="confirm-title" className="text-base font-semibold">
          {title}
        </h2>
        <div className="mt-2 text-sm text-muted">{children}</div>
        {error && <div className="mt-3">{error}</div>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onCancel} className="h-11 rounded-xl border border-line bg-surface px-5 text-sm font-medium transition hover:bg-forest-50">
            Cancel
          </button>
          <button disabled={busy} onClick={onConfirm} className="h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white transition hover:bg-forest-800 disabled:opacity-60">
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
