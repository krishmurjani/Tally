import type { Metadata } from "next";
import { signIn } from "@/auth";

export const metadata: Metadata = { title: "Sign in" };

const ERRORS: Record<string, string> = {
  AccessDenied: "That Google account isn't allowed to use Tally.",
  Configuration: "Sign-in isn't configured on the server yet (check the AUTH_* environment variables).",
};

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const message = error ? (ERRORS[error] ?? "Sign-in failed. Please try again.") : null;
  return (
    <main className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-4 py-12">
      <div className="rounded-card border border-line bg-surface p-8 shadow-sm">
        <div className="mb-6 flex items-center gap-3">
          <span aria-hidden className="grid size-10 place-items-center rounded-xl bg-forest-700 text-lg font-semibold text-white">T</span>
          <div>
            <h1 className="text-xl font-semibold">Tally</h1>
            <p className="text-sm text-muted">Private — owner only</p>
          </div>
        </div>
        {message && (
          <p role="alert" className="mb-4 rounded-lg border border-danger/30 bg-danger-50 px-3 py-2 text-sm text-danger">
            {message}
          </p>
        )}
        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/expenses" });
          }}
        >
          <button
            type="submit"
            className="flex h-12 w-full items-center justify-center rounded-xl bg-forest-700 px-4 font-medium text-white transition hover:bg-forest-800"
          >
            Continue with Google
          </button>
        </form>
      </div>
    </main>
  );
}
