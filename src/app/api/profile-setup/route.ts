import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

function getDecoded(req: NextRequest): { userId: string; orgId: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };
  } catch {
    return null;
  }
}

export async function GET(req: NextRequest) {
  const decoded = getDecoded(req);
  if (!decoded) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const user = await db.user.findUnique({
      where: { id: decoded.userId },
      select: {
        name: true,
        department: true,
        jobRole: true,
        jobTitle: true,
        organization: { select: { name: true, website: true } },
      },
    });

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    return NextResponse.json({ user });
  } catch (error) {
    console.error("Profile setup GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const decoded = getDecoded(req);
  if (!decoded) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  try {
    const { name, companyName, website, department, jobRole, jobTitle } =
      await req.json();

    // Validate required fields
    if (!name || !name.trim()) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (!companyName || !companyName.trim()) {
      return NextResponse.json(
        { error: "Company name is required" },
        { status: 400 }
      );
    }

    await db.user.update({
      where: { id: decoded.userId },
      data: {
        name: name.trim(),
        department: department || null,
        jobRole: jobRole || null,
        jobTitle: jobTitle || null,
        onboarded: true,
      },
    });

    await db.organization.update({
      where: { id: decoded.orgId },
      data: { name: companyName.trim(), website: website || null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Profile setup error:", error);
    return NextResponse.json(
      { error: "Something went wrong" },
      { status: 500 }
    );
  }
}