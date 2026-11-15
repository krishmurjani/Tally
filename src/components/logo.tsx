/** Tally's mark: four tally strokes closed by a diagonal slash. Same drawing as the app icons. */
export function Logo({ size = 32, className = "" }: { size?: number; className?: string }) {
  return (
    <svg role="img" aria-label="Tally" viewBox="0 0 64 64" width={size} height={size} className={className}>
      <rect width="64" height="64" rx="14" fill="#24563f" />
      <g stroke="#fffdf8" strokeWidth="4.8" strokeLinecap="round">
        <path d="M16.6 15.4v33.2M25.6 15.4v33.2M34.6 15.4v33.2M43.6 15.4v33.2" />
      </g>
      <path d="M10.9 42.2L51.2 21.8" stroke="#9fd8b1" strokeWidth="4.8" strokeLinecap="round" />
    </svg>
  );
}
