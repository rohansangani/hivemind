import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

const SUPER_ADMIN_EMAILS = [
  "rohan.sangani@clickpost.ai",
];

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    // Check if email is in the super-admin allowlist
    if (!SUPER_ADMIN_EMAILS.includes(email.toLowerCase())) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    // Verify credentials against existing user record
    const user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.password) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    // Issue a separate admin-scoped JWT
    const token = jwt.sign(
      { userId: user.id, email: user.email, superAdmin: true },
      process.env.NEXTAUTH_SECRET || "fallback-secret",
      { expiresIn: "7d" }
    );

    const response = NextResponse.json({
      success: true,
      user: { id: user.id, email: user.email, name: user.name },
    });

    response.cookies.set("hm-admin-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7, // 7 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Super-admin login error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
