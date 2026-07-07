import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { del } from "@vercel/blob";
import { unlink } from "fs/promises";
import path from "path";

export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const { id, name, contentType, productTags, marketTags, personaTags, competitorTags, sourceUrl } = await req.json();
    if (!id) return NextResponse.json({ error: "Asset ID required" }, { status: 400 });

    const asset = await db.contentAsset.findUnique({ where: { id } });
    if (!asset || asset.organizationId !== decoded.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await db.contentAsset.update({
      where: { id },
      data: {
        name, contentType,
        productTags: productTags || asset.productTags, marketTags: marketTags || asset.marketTags,
        personaTags: personaTags || asset.personaTags, competitorTags: competitorTags || asset.competitorTags,
        ...(sourceUrl !== undefined ? { sourceUrl: sourceUrl || null } : {}),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Asset update error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Asset ID required" }, { status: 400 });

    const asset = await db.contentAsset.findUnique({ where: { id } });
    if (!asset || asset.organizationId !== decoded.orgId) return NextResponse.json({ error: "Not found" }, { status: 404 });

    if (asset.fileUrl?.startsWith("https://")) {
      try { await del(asset.fileUrl); } catch (err) { console.error("Blob delete error for asset", id, err); }
    } else if (asset.fileUrl?.startsWith("/uploads/")) {
      try { await unlink(path.join(process.cwd(), "public", asset.fileUrl)); } catch { /* ignore */ }
    }

    // Clean up knowledge entries created from this asset's analysis (matched by asset name in title)
    await db.knowledgeEntry.deleteMany({
      where: {
        organizationId: decoded.orgId,
        source: { in: ["content_library", "content_analysis"] },
        title: { contains: asset.name, mode: "insensitive" },
      },
    });
    await db.contentAsset.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Asset delete error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
