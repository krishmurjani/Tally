import { signOut } from "@/auth";
import { Logo } from "@/components/logo";
import { Nav } from "@/components/nav";
import { ToastProvider } from "@/components/toast";
import { requireOwnerOrRedirect } from "@/server/auth-guard";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwnerOrRedirect();
  return (
    <ToastProvider>
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <Logo size={34} />
            <span className="text-lg font-semibold tracking-tight">Tally</span>
          </div>
          <Nav />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
            className="hidden sm:block"
          >
            <button type="submit" title={owner.email} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-surface px-4 text-sm font-medium transition hover:bg-forest-50">
              <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 4.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H8M12 6.5l3.5 3.5-3.5 3.5M15.5 10H8.5" />
              </svg>
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">{children}</main>
    </div>
    </ToastProvider>
  );
}
