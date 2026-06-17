import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: "Invalid email format" },
        { status: 400 }
      );
    }

    const user = await db.user.findUnique({
      where: { email },
      include: { organization: true },
    });

    if (!user) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Admin cleared this user's password — let them set a new one with just their email
    if (user.mustResetPassword && !user.password) {
      const resetToken = jwt.sign(
        { userId: user.id, mustReset: true },
        process.env.NEXTAUTH_SECRET || "fallback-secret",
        { expiresIn: "10m" }
      );
      return NextResponse.json({ mustResetPassword: true, resetToken });
    }

    if (!user.password) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const isValid = await bcrypt.compare(password, user.password);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    // Admin requested a password reset but user still has old password — force new one
    if (user.mustResetPassword) {
      const resetToken = jwt.sign(
        { userId: user.id, mustReset: true },
        process.env.NEXTAUTH_SECRET || "fallback-secret",
        { expiresIn: "10m" }
      );
      return NextResponse.json({ mustResetPassword: true, resetToken });
    }

    await db.user.update({
      where: { id: user.id },
      data: { lastActiveAt: new Date() },
    });

    const token = jwt.sign(
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

    response.cookies.set("hm-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30,
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Login error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}