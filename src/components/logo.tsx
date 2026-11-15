import { useId } from "react";

/** Tally's mark: a gold coin seen at an angle on a forest-green tile. Same drawing as public/icons/logo.svg and the app icons. */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  const id = useId();
  return (
    <svg role="img" aria-label="Tally" viewBox="0 0 64 64" width={size} height={size} className={className}>
      <defs>
        <linearGradient id={`${id}bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2f6b4f" />
          <stop offset="1" stopColor="#173a2b" />
        </linearGradient>
        <linearGradient id={`${id}gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f7dc8a" />
          <stop offset="1" stopColor="#d9a93a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="14" fill={`url(#${id}bg)`} />
      <ellipse cx="32" cy="50" rx="17" ry="4" fill="#0f2a1f" opacity=".5" />
      <g transform="rotate(-18 32 32)">
        <ellipse cx="32" cy="32" rx="14" ry="20" fill="#b98a22" />
        <ellipse cx="29" cy="32" rx="14" ry="20" fill={`url(#${id}gold)`} />
        <ellipse cx="29" cy="32" rx="10" ry="15.5" fill="none" stroke="#b98a22" strokeWidth="1.5" opacity=".7" />
        <text x="29" y="39.5" textAnchor="middle" fontWeight="800" fontSize="22" fill="#7a5a10" style={{ fontFamily: "'Inter Tight', Inter, Arial, sans-serif" }}>
          $
        </text>
      </g>
    </svg>
  );
}
