import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string; orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search") || "";
    const type = searchParams.get("type") || "";
    const product = searchParams.get("product") || "";
    const market = searchParams.get("market") || "";
    const scoreRange = searchParams.get("score") || "";
    const scoreStatus = searchParams.get("scoreStatus") || "";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "20", 10)));
    const skip = (page - 1) * limit;

    const where: Record<string, unknown> = { organizationId: decoded.orgId };
    if (search) where.name = { contains: search, mode: "insensitive" };
    if (type) where.contentType = type;
    if (product) where.productTags = { has: product };
    if (market) where.marketTags = { has: market };
    if (scoreStatus) where.scoreStatus = scoreStatus;
    if (scoreRange === "75+") where.brandScore = { gte: 75 };
    else if (scoreRange === "50-74") where.brandScore = { gte: 50, lt: 75 };
    else if (scoreRange === "below60") where.brandScore = { lt: 60, not: null };
    else if (scoreRange === "below50") where.brandScore = { lt: 50, not: null };

    const [assets, total, avgResult, rawProducts, rawMarkets] = await Promise.all([
      db.contentAsset.findMany({
        where,
        include: { uploadedBy: { select: { name: true } } },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip,
      }),
      db.contentAsset.count({ where }),
      db.contentAsset.aggregate({
        where: { organizationId: decoded.orgId, brandScore: { not: null } },
        _avg: { brandScore: true },
      }),
      db.product.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
      db.market.findMany({ where: { organizationId: decoded.orgId }, select: { name: true } }),
    ]);
    const products = [...new Map(rawProducts.map((p) => [p.name, p])).values()];
    const markets = [...new Map(rawMarkets.map((m) => [m.name, m])).values()];
    const avgScore = avgResult._avg.brandScore !== null ? Math.round(avgResult._avg.brandScore ?? 0) : null;

    return NextResponse.json({ assets, products, markets, avgScore, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } });
  } catch (error) {
    console.error("Content library error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { userId: string; orgId: string; role?: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }
    if (decoded.role === "viewer") return NextResponse.json({ error: "You have read-only access and cannot upload content." }, { status: 403 });
    const body = await req.json();
    const { files } = body;
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "files array is required and must be non-empty" }, { status: 400 });
    }
    for (const file of files) {
      if (!file.name || typeof file.name !== "string" || !file.name.trim()) {
        return NextResponse.json({ error: "Each file must have a non-empty name" }, { status: 400 });
      }
      if (!file.contentType || typeof file.contentType !== "string") {
        return NextResponse.json({ error: "Each file must have a contentType" }, { status: 400 });
      }
      if (!file.fileUrl && !file.linkedUrl) {
        return NextResponse.json({ error: "Each file must have either a fileUrl or a linkedUrl" }, { status: 400 });
      }
    }
    const created = [];
    for (const file of files) {
      const asset = await db.contentAsset.create({
        data: {
          name: file.name, fileName: file.fileName, fileUrl: file.fileUrl || null,
          fileType: file.fileType, fileSize: file.fileSize || null,
          contentType: file.contentType, linkedUrl: file.linkedUrl || null,
          productTags: file.productTags || [], marketTags: file.marketTags || [],
          personaTags: file.personaTags || [], customTags: file.customTags || [],
          brandScore: null,
          scoreVoice: null,
          scoreTerminology: null,
          scoreMessaging: null,
          scorePersonality: null,
          scoreCompleteness: null,
          scoreSuggestions: [],
          scoreStatus: "pending",
          uploadedById: decoded.userId, organizationId: decoded.orgId,
        },
      });
      created.push(asset);
    }

    // Fire-and-forget auto brand review for each uploaded asset.
    // Each fetch spawns an independent Vercel function invocation, so the
    // upload response returns immediately while reviews run in the background.
    if (created.length > 0 && process.env.ANTHROPIC_API_KEY) {
      try {
        const proto = req.headers.get("x-forwarded-proto") || "https";
        const host = req.headers.get("host") || "";
        const baseUrl = host ? `${proto}://${host}` : "";
        const cookie = req.headers.get("cookie") || "";
        if (baseUrl) {
          for (const asset of created) {
            fetch(`${baseUrl}/api/content-library/brand-review`, {
              method: "POST",
              headers: { "Content-Type": "application/json", "Cookie": cookie },
              body: JSON.stringify({ assetId: asset.id }),
            }).catch(() => {});
          }
        }
      } catch { /* non-critical — user can still run review manually */ }
    }

    return NextResponse.json({ assets: created });
  } catch (error) {
    console.error("Content upload error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
