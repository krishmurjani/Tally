import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { normalizeEmail } from "@/server/owner-core";
import { allowSignIn } from "@/server/signin-policy";

/**
 * Google sign-in, allowlisted to OWNER_EMAIL. JWT sessions (no auth tables).
 * AUTH_SECRET / AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET are read from the environment by Auth.js.
 * The allowlist is checked here AND again server-side on every request via requireOwner().
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: 30 * 24 * 60 * 60 },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: {
    signIn({ account, profile }) {
      return allowSignIn(account, profile);
    },
    jwt({ token, profile }) {
      if (profile?.email) token.email = normalizeEmail(profile.email);
      return token;
    },
    session({ session, token }) {
      if (session.user) session.user.email = typeof token.email === "string" ? token.email : "";
      return session;
    },
  },
});
