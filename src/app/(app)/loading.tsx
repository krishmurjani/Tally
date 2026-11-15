export default function Loading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading">
      <div className="h-11 w-64 animate-pulse rounded-xl bg-line/60" />
      <div className="grid gap-4 sm:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-28 animate-pulse rounded-card bg-line/40" />
        ))}
      </div>
      <div className="h-64 animate-pulse rounded-card bg-line/40" />
    </div>
  );
}
