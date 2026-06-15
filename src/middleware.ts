import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

/**
 * Super-admin email allowlist — only these users can access the admin console.
 * Add more emails as needed.
 */
const SUPER_ADMIN_EMAILS = [
  "rohan.sangani@clickpost.ai",
];

const SECRET = new TextEncoder().encode(
  process.env.NEXTAUTH_SECRET || "fallback-secret"
);

export async function middleware(req: NextRequest) {
  const host = req.headers.get("host") || "";
  const isAdminSubdomain = host.startsWith("admin.");

  if (!isAdminSubdomain) return NextResponse.next();

  // ── Admin subdomain detected ──────────────────────────────────────────

  const { pathname } = req.nextUrl;

  // Allow admin login page and its API
  if (pathname === "/admin-login" || pathname.startsWith("/api/auth/")) {
    return NextResponse.next();
  }

  // Allow superadmin API routes (they do their own auth)
  if (pathname.startsWith("/api/superadmin/")) {
    return NextResponse.next();
  }

  // Allow static assets and Next.js internals
  if (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/favicon") ||
    pathname.endsWith(".svg") ||
    pathname.endsWith(".ico")
  ) {
    return NextResponse.next();
  }

  // Check for super-admin token
  const token = req.cookies.get("hm-admin-token")?.value;
  if (!token) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/admin-login";
    return NextResponse.redirect(loginUrl);
  }

  try {
    const { payload } = await jwtVerify(token, SECRET);
    const email = payload.email as string;

    if (!SUPER_ADMIN_EMAILS.includes(email)) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/admin-login";
      return NextResponse.redirect(loginUrl);
    }
  } catch {
    // Invalid token — redirect to login
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/admin-login";
    const response = NextResponse.redirect(loginUrl);
    response.cookies.delete("hm-admin-token");
    return response;
  }

  // Rewrite admin subdomain root to the (admin) route group
  if (pathname === "/" || pathname === "") {
    const url = req.nextUrl.clone();
    url.pathname = "/admin-dashboard";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
