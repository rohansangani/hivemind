import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

// POST /api/auth/set-password
// Called after login when mustResetPassword is true.
// Expects { resetToken, newPassword } — resetToken is a short-lived JWT
// issued by the login route containing { userId, mustReset: true }.
export async function POST(req: NextRequest) {
  try {
    const { resetToken, newPassword } = await req.json();
    if (!resetToken || !newPassword) {
      return NextResponse.json({ error: "Missing fields" }, { status: 400 });
    }

    // Verify the short-lived reset token
    let decoded: { userId: string; mustReset: boolean };
    try {
      decoded = jwt.verify(resetToken, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
        userId: string; mustReset: boolean;
      };
    } catch {
      return NextResponse.json({ error: "Reset link has expired — please log in again" }, { status: 401 });
    }

    if (!decoded.mustReset) {
      return NextResponse.json({ error: "Invalid reset token" }, { status: 401 });
    }

    // Validate password strength
    if (newPassword.length < 8) return NextResponse.json({ error: "Must be at least 8 characters" }, { status: 400 });
    if (!/[A-Z]/.test(newPassword)) return NextResponse.json({ error: "Must contain an uppercase letter" }, { status: 400 });
    if (!/[a-z]/.test(newPassword)) return NextResponse.json({ error: "Must contain a lowercase letter" }, { status: 400 });
    if (!/[0-9]/.test(newPassword)) return NextResponse.json({ error: "Must contain a number" }, { status: 400 });

    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      include: { organization: true },
    });
    if (!user || !user.mustResetPassword) {
      return NextResponse.json({ error: "Invalid or already completed reset" }, { status: 400 });
    }

    const hashed = await bcrypt.hash(newPassword, 12);

    await db.user.update({
      where: { id: user.id },
      data: {
        password: hashed,
        mustResetPassword: false,
        lastActiveAt: new Date(),
      },
    });

    // Issue a full session token now that password is set
    const sessionToken = jwt.sign(
      { userId: user.id, orgId: user.organizationId, role: user.role },
      process.env.NEXTAUTH_SECRET || "fallback-secret",
      { expiresIn: "30d" }
    );

    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        onboarded: user.onboarded,
        organizationId: user.organizationId,
        organization: user.organization,
      },
    });

    response.cookies.set("hm-token", sessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Set password error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
