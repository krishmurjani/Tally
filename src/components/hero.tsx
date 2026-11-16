import type { ReactNode } from "react";

/** The dark forest card that opens a page: a headline number, an optional ring, and a row of supporting figures. */
export function Hero({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl bg-forest-800 p-5 text-canvas sm:p-8 ${className}`}>{children}</section>;
}

export function HeroLabel({ children }: { children: ReactNode }) {
  return <p className="text-sm text-forest-100/80">{children}</p>;
}

export function HeroNumber({ children }: { children: ReactNode }) {
  return <p className="mt-2 text-4xl font-bold leading-none tracking-tight tabular-nums sm:text-6xl">{children}</p>;
}

export function HeroChip({ children, tone = "soft" }: { children: ReactNode; tone?: "soft" | "warn" }) {
  return <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-sm font-semibold ${tone === "warn" ? "bg-warn-50 text-warn" : "bg-white/15 text-canvas"}`}>{children}</span>;
}

export function HeroStat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="min-w-0">
      <p className="text-sm text-forest-100/80">{label}</p>
      <p className="mt-0.5 break-words text-xl font-semibold tracking-tight tabular-nums">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-forest-100/70">{hint}</p>}
    </div>
  );
}

/** A strip of figures under a hero, or on its own for pages that have no single headline. */
export function HeroStats({ items, divider = true }: { items: { label: string; value: ReactNode; hint?: ReactNode }[]; divider?: boolean }) {
  const cols = items.length >= 4 ? "sm:grid-cols-4" : items.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <div className={`grid grid-cols-1 gap-x-6 gap-y-4 min-[420px]:grid-cols-2 ${cols} ${divider ? "mt-6 border-t border-white/15 pt-5" : ""}`}>
      {items.map((i) => (
        <HeroStat key={i.label} {...i} />
      ))}
    </div>
  );
}

const R = 50;
const C = 2 * Math.PI * R;

/** A progress ring (0..1) in mint on a faint track, with a big figure and a caption in the middle. */
export function HeroRing({ fraction, label, caption, ariaLabel }: { fraction: number; label: string; caption: string; ariaLabel: string }) {
  const f = Math.max(0, Math.min(1, fraction));
  return (
    <div role="img" aria-label={ariaLabel} className="relative size-36 shrink-0 sm:size-44">
      <svg viewBox="0 0 120 120" className="size-full -rotate-90">
        <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="12" />
        {f > 0 && <circle cx="60" cy="60" r={R} fill="none" stroke="#9fd8b1" strokeWidth="12" strokeLinecap="round" strokeDasharray={`${C * f} ${C}`} />}
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <p className="text-3xl font-bold leading-none tracking-tight sm:text-4xl">{label}</p>
          <p className="mt-1 max-w-[6.5rem] text-xs text-forest-100/80">{caption}</p>
        </div>
      </div>
    </div>
  );
}
