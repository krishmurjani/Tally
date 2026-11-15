import { isOwnerEmail } from "./owner-core";

/** Only a verified Google account whose email equals OWNER_EMAIL may sign in. */
export function allowSignIn(
  account: { provider?: string } | null | undefined,
  profile: { email?: string | null; email_verified?: boolean | null } | null | undefined,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (account?.provider !== "google") return false;
  if (profile?.email_verified !== true) return false;
  return isOwnerEmail(profile.email, env);
}
