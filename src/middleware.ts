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

/**
 * Check whether the request targets the admin console — either via
 * subdomain (admin.yourdomain.com) or via path (/admin-login, /admin-dashboard).
 */
function isAdminRoute(req: NextRequest): boolean {
  const host = req.headers.get("host") || "";
  if (host.startsWith("admin.")) return true;
  const { pathname } = req.nextUrl;
  return pathname.startsWith("/admin-login") || pathname.startsWith("/admin-dashboard");
}

async function verifyAdminToken(req: NextRequest): Promise<boolean> {
  const token = req.cookies.get("hm-admin-token")?.value;
  if (!token) return false;
  try {
    const { payload } = await jwtVerify(token, SECRET);
    const email = payload.email as string;
    return SUPER_ADMIN_EMAILS.includes(email);
  } catch {
    return false;
  }
}

export async function middleware(req: NextRequest) {
  if (!isAdminRoute(req)) return NextResponse.next();

  // ── Admin route detected (subdomain or path) ─────────────────────────

  const { pathname } = req.nextUrl;

  // Allow admin login page — unauthenticated access
  if (pathname === "/admin-login") {
    // If already authenticated, redirect to dashboard
    if (await verifyAdminToken(req)) {
      const url = req.nextUrl.clone();
      url.pathname = "/admin-dashboard";
      return NextResponse.redirect(url);
    }
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

  // ── Protected admin routes — require valid super-admin token ──────────

  const isValid = await verifyAdminToken(req);

  if (!isValid) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/admin-login";
    const response = NextResponse.redirect(loginUrl);
    // Clear stale token if present
    if (req.cookies.get("hm-admin-token")) {
      response.cookies.delete("hm-admin-token");
    }
    return response;
  }

  // Subdomain root → rewrite to dashboard
  const host = req.headers.get("host") || "";
  if (host.startsWith("admin.") && (pathname === "/" || pathname === "")) {
    const url = req.nextUrl.clone();
    url.pathname = "/admin-dashboard";
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
