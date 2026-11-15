export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

/**
 * Inline save state next to a control. Success is confirmed with a toast instead (see use-action),
 * so "saved" renders nothing here — except where `showSaved` asks for a quiet autosave indicator.
 * Failures are a clear chip, never plain text.
 */
export function SaveStatus({ state, showSaved = false }: { state: SaveState; showSaved?: boolean }) {
  if (state.kind === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
        <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" className="animate-spin">
          <circle cx="10" cy="10" r="7" fill="none" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
          <path d="M17 10a7 7 0 0 0-7-7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        Saving…
      </span>
    );
  }
  if (state.kind === "saved") {
    if (!showSaved) return null;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-muted" aria-live="polite">
        <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 10.5l3.5 3.5 7.5-8" />
        </svg>
        All changes saved
      </span>
    );
  }
  if (state.kind === "failed") {
    return (
      <span role="alert" className="inline-flex items-start gap-1.5 rounded-lg border border-danger/30 bg-danger-50 px-2.5 py-1.5 text-xs text-danger">
        <svg aria-hidden="true" viewBox="0 0 20 20" width="14" height="14" className="mt-px shrink-0" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <circle cx="10" cy="10" r="7.5" />
          <path d="M10 6.5v4.2M10 13.6v.1" />
        </svg>
        <span>Not saved — {state.message}</span>
      </span>
    );
  }
  return null;
}
