import type { Metadata } from "next";
import { signIn } from "@/auth";
import { Logo } from "@/components/logo";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "That Google account isn't allowed to use Tally.",
  Configuration: "Sign-in isn't configured on the server yet (check the AUTH_* environment variables).",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null;
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-canvas px-4 py-12">
      <div aria-hidden="true" className="pointer-events-none absolute -top-40 left-1/2 size-[38rem] -translate-x-1/2 rounded-full bg-forest-100/70 blur-3xl" />
      <div className="relative w-full max-w-sm animate-pop-in rounded-3xl border border-line bg-surface p-8 text-center shadow-[0_8px_40px_-12px_rgba(27,66,49,0.25)] sm:p-10">
        <Logo size={64} className="mx-auto drop-shadow-sm" />
        <h1 className="mt-5 text-2xl font-semibold tracking-tight">Tally</h1>
        <p className="mt-1 text-sm text-muted">Your money, counted.</p>
        {message && (
          <p role="alert" className="mt-6 rounded-xl border border-danger/30 bg-danger-50 px-3 py-2 text-left text-sm text-danger">
            {message}
          </p>
        )}
        <form
          className="mt-8"
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/expenses" });
          }}
        >
          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center gap-3 rounded-xl bg-forest-700 px-4 font-medium text-white shadow-sm transition hover:bg-forest-800 active:scale-[0.99]"
          >
            <span aria-hidden="true" className="grid size-6 place-items-center rounded-full bg-white">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path fill="#4285F4" d="M22.5 12.3c0-.8-.1-1.5-.2-2.2H12v4.2h5.9a5 5 0 0 1-2.2 3.3v2.7h3.5c2.1-1.9 3.3-4.7 3.3-8z" />
                <path fill="#34A853" d="M12 23c3 0 5.5-1 7.2-2.7l-3.5-2.7c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5H2.2v2.8A11 11 0 0 0 12 23z" />
                <path fill="#FBBC05" d="M5.8 14.2a6.6 6.6 0 0 1 0-4.2V7.2H2.2a11 11 0 0 0 0 9.8l3.6-2.8z" />
                <path fill="#EA4335" d="M12 5.4c1.6 0 3.1.6 4.3 1.7l3.2-3.2A11 11 0 0 0 2.2 7.2L5.8 10c.9-2.6 3.3-4.6 6.2-4.6z" />
              </svg>
            </span>
            Continue with Google
          </button>
        </form>
        <p className="mt-5 text-xs text-faint">Private · owner only</p>
      </div>
    </main>
  );
}
