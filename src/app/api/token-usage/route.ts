import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { hasPermission } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as {
      userId: string;
      orgId: string;
      role?: string;
    };

    // Only admins/owners can view token usage
    if (!hasPermission(decoded.role || "viewer", "manage_settings")) {
      return NextResponse.json({ error: "Access denied" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const range = searchParams.get("range") || "30d"; // 7d, 30d, 90d

    const now = new Date();
    let since: Date;
    switch (range) {
      case "7d":
        since = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
        break;
      case "90d":
        since = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default:
        since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    }

    // Get all logs in the range
    const logs = await db.tokenUsageLog.findMany({
      where: {
        organizationId: decoded.orgId,
        createdAt: { gte: since },
      },
      select: {
        feature: true,
        model: true,
        inputTokens: true,
        outputTokens: true,
        totalTokens: true,
        createdAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    // ── Aggregate: totals ───────────────────────────────────────────────
    const totals = {
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      totalCalls: logs.length,
    };
    for (const l of logs) {
      totals.inputTokens += l.inputTokens;
      totals.outputTokens += l.outputTokens;
      totals.totalTokens += l.totalTokens;
    }

    // ── Aggregate: by feature ───────────────────────────────────────────
    const byFeature: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; calls: number }> = {};
    for (const l of logs) {
      if (!byFeature[l.feature]) {
        byFeature[l.feature] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 };
      }
      byFeature[l.feature].inputTokens += l.inputTokens;
      byFeature[l.feature].outputTokens += l.outputTokens;
      byFeature[l.feature].totalTokens += l.totalTokens;
      byFeature[l.feature].calls += 1;
    }

    // Sort by totalTokens descending
    const featureBreakdown = Object.entries(byFeature)
      .map(([feature, data]) => ({ feature, ...data }))
      .sort((a, b) => b.totalTokens - a.totalTokens);

    // ── Aggregate: daily time series ────────────────────────────────────
    const dailyMap: Record<string, { inputTokens: number; outputTokens: number; totalTokens: number; calls: number }> = {};
    for (const l of logs) {
      const day = l.createdAt.toISOString().slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 };
      }
      dailyMap[day].inputTokens += l.inputTokens;
      dailyMap[day].outputTokens += l.outputTokens;
      dailyMap[day].totalTokens += l.totalTokens;
      dailyMap[day].calls += 1;
    }

    // Fill in missing days with zeros
    const daily: Array<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number; calls: number }> = [];
    const cursor = new Date(since);
    while (cursor <= now) {
      const day = cursor.toISOString().slice(0, 10);
      daily.push({
        date: day,
        ...(dailyMap[day] || { inputTokens: 0, outputTokens: 0, totalTokens: 0, calls: 0 }),
      });
      cursor.setDate(cursor.getDate() + 1);
    }

    // ── Estimate cost (Anthropic Claude Sonnet pricing) ─────────────────
    // Sonnet: $3/M input, $15/M output
    const estimatedCost =
      (totals.inputTokens / 1_000_000) * 3 +
      (totals.outputTokens / 1_000_000) * 15;

    return NextResponse.json({
      range,
      since: since.toISOString(),
      totals,
      estimatedCost: Math.round(estimatedCost * 100) / 100,
      featureBreakdown,
      daily,
    });
  } catch (error) {
    console.error("Token usage error:", error);
    return NextResponse.json({ error: "Failed to fetch token usage" }, { status: 500 });
  }
}
