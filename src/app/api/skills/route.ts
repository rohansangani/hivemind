import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const activeOnly = searchParams.get("active") === "true";
    const where: Record<string, unknown> = { organizationId: decoded.orgId };
    if (activeOnly) where.isActive = true;
    const skills = await db.skill.findMany({ where, orderBy: { createdAt: "desc" } });
    return NextResponse.json({ skills });
  } catch (error) {
    console.error("Skills GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const { name, category, linkedFeature, instructions, description } = await req.json();
    if (!name || !category || !linkedFeature || !instructions) {
      return NextResponse.json({ error: "Required fields missing" }, { status: 400 });
    }
    const skill = await db.skill.create({
      data: { name, category, linkedFeature, instructions, description: description || "", isActive: true, organizationId: decoded.orgId },
    });
    return NextResponse.json({ skill });
  } catch (error) {
    console.error("Skills POST error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const { id, name, instructions, description, isActive } = await req.json();
    if (!id) return NextResponse.json({ error: "Skill ID required" }, { status: 400 });
    const existing = await db.skill.findFirst({ where: { id, organizationId: decoded.orgId } });
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (instructions !== undefined) data.instructions = instructions;
    if (description !== undefined) data.description = description;
    if (isActive !== undefined) data.isActive = isActive;
    // Include organizationId in the update where clause to prevent TOCTOU race
    const skill = await db.skill.update({ where: { id, organizationId: decoded.orgId }, data });
    return NextResponse.json({ skill });
  } catch (error) {
    console.error("Skills PUT error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Skill ID required" }, { status: 400 });
    await db.skill.deleteMany({ where: { id, organizationId: decoded.orgId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Skills DELETE error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
