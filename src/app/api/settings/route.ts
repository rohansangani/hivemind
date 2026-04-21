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

    const org = await db.organization.findUnique({ where: { id: decoded.orgId } });

    const [scoringEntry, intelligenceEntry, notifEntry, kbConfigEntry] = await Promise.all([
      db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "brand_scoring_config" } }),
      db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "intelligence_config" } }),
      db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "notification_config" } }),
      db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "kb_config" } }),
    ]);

    let scoringConfig = null;
    let intelligenceConfig = null;
    let notifConfig = null;
    let kbConfig = null;

    try { if (scoringEntry) scoringConfig = JSON.parse(scoringEntry.content); } catch {}
    try { if (intelligenceEntry) intelligenceConfig = JSON.parse(intelligenceEntry.content); } catch {}
    try { if (notifEntry) notifConfig = JSON.parse(notifEntry.content); } catch {}
    try { if (kbConfigEntry) kbConfig = JSON.parse(kbConfigEntry.content); } catch {}

    return NextResponse.json({
      org: { name: org?.name, website: org?.website, allowedDomains: org?.allowedDomains ?? [] },
      scoringConfig,
      intelligenceConfig,
      notifConfig,
      kbConfig,
    });
  } catch (error) {
    console.error("Settings GET error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string; role: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role: string };
    } catch {
      return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
    }

    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const body = await req.json();
    const { action } = body;

    if (action === "update_workspace") {
      const { name, website } = body;
      if (!name || typeof name !== "string" || !name.trim()) {
        return NextResponse.json({ error: "Workspace name is required" }, { status: 400 });
      }
      await db.organization.update({ where: { id: decoded.orgId }, data: { name: name.trim(), website } });
      return NextResponse.json({ success: true, message: "Workspace updated" });
    }

    if (action === "update_domains") {
      if (decoded.role !== "admin" && decoded.role !== "owner") {
        return NextResponse.json({ error: "Only admins can manage allowed domains" }, { status: 403 });
      }
      const { domains } = body;
      if (!Array.isArray(domains)) {
        return NextResponse.json({ error: "domains must be an array" }, { status: 400 });
      }
      // Normalize: lowercase, strip whitespace, remove empty, validate format
      const domainRegex = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z]{2,})+$/;
      const cleaned: string[] = [];
      for (const d of domains) {
        const norm = String(d).trim().toLowerCase();
        if (!norm) continue;
        if (!domainRegex.test(norm)) {
          return NextResponse.json({ error: `Invalid domain: ${norm}` }, { status: 400 });
        }
        cleaned.push(norm);
      }
      await db.organization.update({ where: { id: decoded.orgId }, data: { allowedDomains: cleaned } });
      return NextResponse.json({ success: true, message: "Allowed domains updated" });
    }

    if (action === "update_scoring") {
      const { weights, threshold } = body;
      if (weights && typeof weights === "object") {
        const total = Object.values(weights).reduce((sum: number, v) => sum + (Number(v) || 0), 0);
        if (total !== 100) {
          return NextResponse.json({ error: `Weights must sum to 100. Current total: ${total}` }, { status: 400 });
        }
      }
      const configData = JSON.stringify({ weights, threshold });
      const existing = await db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "brand_scoring_config" } });
      if (existing) { await db.knowledgeEntry.update({ where: { id: existing.id }, data: { content: configData } }); }
      else { await db.knowledgeEntry.create({ data: { category: "settings", title: "brand_scoring_config", content: configData, source: "settings", organizationId: decoded.orgId } }); }
      return NextResponse.json({ success: true, message: "Scoring config saved" });
    }

    if (action === "update_notifications") {
      const { emailNotifs, lowScoreAlerts, kbNotifs } = body;
      const configData = JSON.stringify({ emailNotifs, lowScoreAlerts, kbNotifs });
      const existing = await db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "notification_config" } });
      if (existing) { await db.knowledgeEntry.update({ where: { id: existing.id }, data: { content: configData } }); }
      else { await db.knowledgeEntry.create({ data: { category: "settings", title: "notification_config", content: configData, source: "settings", organizationId: decoded.orgId } }); }
      return NextResponse.json({ success: true, message: "Notification preferences saved" });
    }

    if (action === "update_intelligence") {
      const { syncFreq, competitorMonitor, industryNews } = body;
      const configData = JSON.stringify({ syncFreq, competitorMonitor, industryNews });
      const existing = await db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "intelligence_config" } });
      if (existing) { await db.knowledgeEntry.update({ where: { id: existing.id }, data: { content: configData } }); }
      else { await db.knowledgeEntry.create({ data: { category: "settings", title: "intelligence_config", content: configData, source: "settings", organizationId: decoded.orgId } }); }
      return NextResponse.json({ success: true, message: "Intelligence config saved" });
    }

    if (action === "update_kb") {
      const { kbGrounding, autoLearn } = body;
      const configData = JSON.stringify({ kbGrounding, autoLearn });
      const existing = await db.knowledgeEntry.findFirst({ where: { organizationId: decoded.orgId, category: "settings", title: "kb_config" } });
      if (existing) { await db.knowledgeEntry.update({ where: { id: existing.id }, data: { content: configData } }); }
      else { await db.knowledgeEntry.create({ data: { category: "settings", title: "kb_config", content: configData, source: "settings", organizationId: decoded.orgId } }); }
      return NextResponse.json({ success: true, message: "Knowledge base config saved" });
    }

    if (action === "reset_kb") {
      await db.knowledgeEntry.deleteMany({ where: { organizationId: decoded.orgId, category: { not: "settings" } } });
      await db.learningLog.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.industryInsight.deleteMany({ where: { organizationId: decoded.orgId } });
      return NextResponse.json({ success: true, message: "Knowledge base reset" });
    }

    if (action === "clear_library") {
      await db.contentAsset.deleteMany({ where: { organizationId: decoded.orgId } });
      return NextResponse.json({ success: true, message: "Content library cleared" });
    }

    if (action === "delete_workspace") {
      if (decoded.role !== "admin") {
        return NextResponse.json({ error: "Only admins can delete the workspace" }, { status: 403 });
      }
      await db.message.deleteMany({ where: { conversation: { user: { organizationId: decoded.orgId } } } });
      await db.conversation.deleteMany({ where: { user: { organizationId: decoded.orgId } } });
      await db.contentAsset.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.generatedContent.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.industryInsight.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.learningLog.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.knowledgeEntry.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.knowledgeDocument.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.skill.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.brandProfile.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.competitor.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.persona.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.productMarket.deleteMany({ where: { product: { organizationId: decoded.orgId } } });
      await db.product.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.market.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.user.deleteMany({ where: { organizationId: decoded.orgId } });
      await db.organization.delete({ where: { id: decoded.orgId } });
      return NextResponse.json({ success: true, message: "Workspace deleted", redirect: "/login" });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (error) {
    console.error("Settings PUT error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
