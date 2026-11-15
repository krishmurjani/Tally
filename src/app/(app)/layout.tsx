import { signOut } from "@/auth";
import { Nav } from "@/components/nav";
import { requireOwnerOrRedirect } from "@/server/auth-guard";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const owner = await requireOwnerOrRedirect();
  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 border-b border-line bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-2">
          <div className="flex items-center gap-2">
            <span aria-hidden className="grid size-8 place-items-center rounded-lg bg-forest-700 text-sm font-semibold text-white">T</span>
            <span className="font-semibold">Tally</span>
          </div>
          <Nav />
          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/signin" });
            }}
            className="hidden sm:block"
          >
            <button type="submit" title={owner.email} className="h-11 rounded-xl px-3 text-sm text-muted hover:bg-forest-50 hover:text-forest-800">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6 sm:py-8">{children}</main>
    </div>
  );
}
