import "server-only";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { getDb } from "./db/client";
import { resolveOwner, UnauthorizedError, type Owner } from "./owner-core";

/**
 * Every server action, route handler and data-loading page calls this first.
 * Repository functions require the Owner it returns, so data access without it won't type-check.
 */
export async function requireOwner(): Promise<Owner> {
  return resolveOwner(await auth(), getDb());
}

/** For pages/layouts: redirect to sign-in instead of throwing. */
export async function requireOwnerOrRedirect(): Promise<Owner> {
  try {
    return await requireOwner();
  } catch (e) {
    if (e instanceof UnauthorizedError) redirect("/signin");
    throw e;
  }
}
