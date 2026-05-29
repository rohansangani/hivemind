import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
    const { id } = await params;

    const brief = await db.designBrief.findUnique({ where: { id }, select: { organizationId: true } });
    if (!brief || brief.organizationId !== decoded.orgId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await db.designBrief.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Design brief delete error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
