import { NextResponse, type NextRequest } from "next/server";

/**
 * Convenience redirect only: if there's no session cookie, send page requests to /signin.
 * NOT a security boundary — every server action/route/page re-checks with requireOwner().
 */
export function proxy(request: NextRequest) {
  const hasSession =
    request.cookies.has("authjs.session-token") || request.cookies.has("__Secure-authjs.session-token");
  if (!hasSession) return NextResponse.redirect(new URL("/signin", request.url));
  return NextResponse.next();
}

export const config = {
  // Everything except sign-in, Auth.js routes, Next internals and static files.
  matcher: ["/((?!signin|api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|icon).*)"],
};
