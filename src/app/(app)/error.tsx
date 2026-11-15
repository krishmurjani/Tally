"use client";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto max-w-lg rounded-card border border-danger/30 bg-surface p-6 text-center">
      <h1 className="text-lg font-semibold">Something went wrong loading this page</h1>
      <p className="mt-2 text-sm text-muted">Nothing was changed. {error.digest ? `Reference ${error.digest}.` : ""}</p>
      <button onClick={reset} className="mt-4 h-11 rounded-xl bg-forest-700 px-5 text-sm font-medium text-white">
        Try again
      </button>
    </div>
  );
}
