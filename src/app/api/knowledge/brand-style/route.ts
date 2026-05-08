import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

const CATEGORY = "brand_style_guide";
const TITLE = "brand_style_guide";

function authError() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

export async function GET(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return authError();
  let decoded: { orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
  } catch {
    return authError();
  }

  const entry = await db.knowledgeEntry.findFirst({
    where: { organizationId: decoded.orgId, category: CATEGORY, title: TITLE },
  });

  if (!entry) return NextResponse.json({ styleGuide: null });

  try {
    return NextResponse.json({ styleGuide: JSON.parse(entry.content) });
  } catch {
    return NextResponse.json({ styleGuide: null });
  }
}

export async function PUT(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return authError();
  let decoded: { orgId: string; role?: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role?: string };
  } catch {
    return authError();
  }
  if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

  const body = await req.json();

  const existing = await db.knowledgeEntry.findFirst({
    where: { organizationId: decoded.orgId, category: CATEGORY, title: TITLE },
  });

  if (existing) {
    await db.knowledgeEntry.update({
      where: { id: existing.id },
      data: { content: JSON.stringify(body) },
    });
  } else {
    await db.knowledgeEntry.create({
      data: {
        category: CATEGORY,
        title: TITLE,
        content: JSON.stringify(body),
        source: "manual",
        organizationId: decoded.orgId,
      },
    });
  }

  return NextResponse.json({ ok: true });
}
