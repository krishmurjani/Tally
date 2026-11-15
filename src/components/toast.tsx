"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Tone = "success" | "error";
interface Toast {
  id: number;
  tone: Tone;
  text: string;
}

const ToastContext = createContext<(t: { tone?: Tone; text: string }) => void>(() => {});

/** Confirmations as brief toasts, so "Saved" never sits inline next to a control. */
export function useToast() {
  return useContext(ToastContext);
}

function CheckIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 6.5v4.2M10 13.6v.1" />
    </svg>
  );
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    setToasts((ts) => ts.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const push = useCallback(
    ({ tone = "success", text }: { tone?: Tone; text: string }) => {
      const id = next.current++;
      setToasts((ts) => [...ts.slice(-2), { id, tone, text }]);
      // Successes fade on their own; errors stay until dismissed.
      if (tone === "success") timers.current.set(id, setTimeout(() => dismiss(id), 3500));
    },
    [dismiss],
  );

  useEffect(() => {
    const all = timers.current;
    return () => all.forEach((t) => clearTimeout(t));
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className={`pointer-events-auto flex max-w-md items-center gap-2 rounded-xl px-4 py-3 text-sm shadow-lg ${
              t.tone === "error" ? "border border-danger/30 bg-danger-50 text-danger" : "bg-ink text-canvas"
            }`}
          >
            {t.tone === "error" ? <AlertIcon /> : <CheckIcon />}
            <span className="flex-1">{t.text}</span>
            <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="-mr-1 grid size-7 place-items-center rounded-md opacity-70 hover:opacity-100">
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
