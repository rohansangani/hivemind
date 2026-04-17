import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest) {
  try {
    const { email, password, name } = await req.json();

    // Validation
    if (!email || !password || !name) {
      return NextResponse.json(
        { error: "Name, email, and password are required" },
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

    if (password.length < 8) {
      return NextResponse.json(
        { error: "Password must be at least 8 characters" },
        { status: 400 }
      );
    }

    // Check if user already exists
    const existingUser = await db.user.findUnique({ where: { email } });
    if (existingUser) {
      return NextResponse.json(
        { error: "An account with this email already exists" },
        { status: 409 }
      );
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    // Check if any org has claimed this email's domain
    const domain = email.split("@")[1].toLowerCase();
    const matchingOrg = await db.organization.findFirst({
      where: { allowedDomains: { has: domain } },
    });

    const { org, user } = await db.$transaction(async (tx) => {
      if (matchingOrg) {
        // Auto-join the existing org as a member
        const user = await tx.user.create({
          data: {
            email,
            name,
            password: hashedPassword,
            role: "member",
            organizationId: matchingOrg.id,
          },
        });
        return { org: matchingOrg, user };
      } else {
        // No domain match — create a new org, user becomes admin
        const org = await tx.organization.create({
          data: { name: "My Organization" },
        });
        const user = await tx.user.create({
          data: {
            email,
            name,
            password: hashedPassword,
            role: "admin",
            organizationId: org.id,
          },
        });
        return { org, user };
      }
    });

    // Create JWT token
    const token = jwt.sign(
      { userId: user.id, orgId: org.id, role: user.role },
      process.env.NEXTAUTH_SECRET || "fallback-secret",
      { expiresIn: "30d" }
    );

    // Set cookie and return
    const response = NextResponse.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        onboarded: user.onboarded,
        organizationId: org.id,
      },
    });

    response.cookies.set("hm-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 30, // 30 days
      path: "/",
    });

    return response;
  } catch (error) {
    console.error("Signup error:", error);
    const msg = error instanceof Error ? error.message : String(error);
    return NextResponse.json(
      { error: process.env.NODE_ENV === "development" ? msg : "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}