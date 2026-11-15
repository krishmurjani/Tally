export type SaveState = { kind: "idle" } | { kind: "saving" } | { kind: "saved" } | { kind: "failed"; message: string };

/** Real save states only: "Saved" appears after the server confirms, never before. */
export function SaveStatus({ state }: { state: SaveState }) {
  if (state.kind === "idle") return null;
  if (state.kind === "saving") return <span className="text-sm text-muted" aria-live="polite">Saving…</span>;
  if (state.kind === "saved") return <span className="text-sm text-forest-700" aria-live="polite">Saved</span>;
  return (
    <span className="text-sm text-danger" role="alert">
      Not saved — {state.message}
    </span>
  );
}
