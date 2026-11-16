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
        <div className="flex w-full flex-wrap items-center justify-between gap-x-2 gap-y-1 px-4 py-2 sm:px-6 lg:px-10">
          <div className="order-1 flex items-center gap-2">
            <Logo size={34} />
            <span className="text-lg font-semibold tracking-tight">Tally</span>
          </div>
          <Nav />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
            className="order-2 sm:order-3"
          >
            <button type="submit" title={owner.email} aria-label="Sign out" className="inline-flex size-11 items-center justify-center gap-2 rounded-xl border border-line bg-surface text-sm font-medium transition hover:bg-forest-50 sm:w-auto sm:px-4">
              <svg aria-hidden="true" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M8 4.5H5.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H8M12 6.5l3.5 3.5-3.5 3.5M15.5 10H8.5" />
              </svg>
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </form>
        </div>
      </header>
      <main className="w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-10">{children}</main>
    </div>
    </ToastProvider>
  );
}
