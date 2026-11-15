import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col items-center justify-center gap-3 px-4 text-center">
      <h1 className="text-xl font-semibold">Page not found</h1>
      <p className="text-sm text-muted">That month or page doesn&apos;t exist.</p>
      <Link href="/expenses" className="h-11 content-center rounded-xl bg-forest-700 px-5 text-sm font-medium text-white">
        Go to expenses
      </Link>
    </main>
  );
}
