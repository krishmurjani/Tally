"use client";

import { useEffect, useState } from "react";

type Theme = "light" | "dark";
const KEY = "tally.theme";

function apply(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#181d1a" : "#24563f");
}

/** Sun / moon switch. A circle of the new theme grows out of the button (View Transitions), and the knob and icons slide and spin. */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);
  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");
  }, []);

  function toggle(e: React.MouseEvent<HTMLButtonElement>) {
    const next: Theme = theme === "dark" ? "light" : "dark";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const commit = () => {
      apply(next);
      setTheme(next);
      try {
        localStorage.setItem(KEY, next);
      } catch {
        /* storage unavailable: the choice lasts until reload */
      }
    };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => { ready: Promise<void> } };
    if (reduce || !doc.startViewTransition) return commit();
    const r = e.currentTarget.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    const t = doc.startViewTransition(commit);
    t.ready
      .then(() => document.documentElement.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] }, { duration: 520, easing: "cubic-bezier(0.4, 0, 0.2, 1)", pseudoElement: "::view-transition-new(root)" }))
      .catch(() => {});
  }

  const dark = theme === "dark";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={dark}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
      onClick={toggle}
      className={`relative inline-flex h-11 w-[5.25rem] shrink-0 items-center rounded-full border border-line bg-surface p-1 transition-colors duration-500 hover:border-forest-600 ${className}`}
    >
      {/* sky: stars appear in dark mode */}
      <span aria-hidden="true" className={`absolute inset-1 overflow-hidden rounded-full transition-colors duration-500 ${dark ? "bg-[#1f2a3a]" : "bg-[#dff0ff]"}`}>
        <span className={`absolute left-3 top-2 size-0.5 rounded-full bg-white transition-all duration-500 ${dark ? "scale-100 opacity-90 delay-200" : "scale-0 opacity-0"}`} />
        <span className={`absolute left-6 top-4 size-1 rounded-full bg-white transition-all duration-500 ${dark ? "scale-100 opacity-70 delay-300" : "scale-0 opacity-0"}`} />
        <span className={`absolute left-4 top-5 size-0.5 rounded-full bg-white transition-all duration-500 ${dark ? "scale-100 opacity-80 delay-100" : "scale-0 opacity-0"}`} />
        <span className={`absolute right-3 top-2 h-1.5 w-4 rounded-full bg-white/90 transition-all duration-500 ${dark ? "translate-x-3 opacity-0" : "opacity-100"}`} />
      </span>
      {/* knob: sun that morphs into a moon by sliding a shadow disc across it */}
      <span
        aria-hidden="true"
        className={`relative z-10 grid size-8 place-items-center rounded-full shadow transition-transform duration-500 ease-[cubic-bezier(0.34,1.4,0.5,1)] motion-reduce:transition-none ${dark ? "translate-x-[2.5rem] rotate-[360deg] bg-[#dfe6f0]" : "translate-x-0 rotate-0 bg-[#f6c453]"}`}
      >
        <span className={`absolute right-0.5 top-1 size-5 rounded-full bg-[#1f2a3a] transition-all duration-500 ${dark ? "scale-100 opacity-100" : "scale-0 opacity-0"}`} />
        <span className={`absolute inset-0 rounded-full ring-4 transition-all duration-500 ${dark ? "ring-transparent" : "ring-[#f6c453]/35"}`} />
      </span>
    </button>
  );
}
