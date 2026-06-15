/**
 * Super-admin auth helpers — used by /api/superadmin/* routes
 */

import { NextRequest } from "next/server";
import jwt from "jsonwebtoken";

const SUPER_ADMIN_EMAILS = [
  "rohan.sangani@clickpost.ai",
];

export function verifySuperAdmin(req: NextRequest): { userId: string; email: string } | null {
  const token = req.cookies.get("hm-admin-token")?.value;
  if (!token) return null;

  try {
    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; email: string; superAdmin?: boolean };

    if (!decoded.superAdmin || !SUPER_ADMIN_EMAILS.includes(decoded.email)) {
      return null;
    }

    return { userId: decoded.userId, email: decoded.email };
  } catch {
    return null;
  }
}
