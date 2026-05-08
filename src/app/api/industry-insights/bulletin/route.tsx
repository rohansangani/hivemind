export const maxDuration = 60;
export const dynamic = "force-dynamic";

import React from "react";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import { renderToBuffer, Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

// ─── helpers ─────────────────────────────────────────────────────────────────

function getDateRange(timeRange: string): { start: Date; end: Date; label: string } {
  const now = new Date();
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1);

  switch (timeRange) {
    case "today":
      return { start: today, end: tomorrow, label: "Today — " + fmt(now) };
    case "yesterday": {
      const start = new Date(today); start.setDate(start.getDate() - 1);
      return { start, end: today, label: "Yesterday — " + fmt(start) };
    }
    case "this_week": {
      const start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7)); // Monday
      return { start, end: tomorrow, label: `This week — ${fmt(start)} to ${fmt(now)}` };
    }
    case "last_week": {
      const thisMonday = new Date(today);
      thisMonday.setDate(thisMonday.getDate() - ((thisMonday.getDay() + 6) % 7));
      const lastMonday = new Date(thisMonday); lastMonday.setDate(lastMonday.getDate() - 7);
      const lastSunday = new Date(thisMonday); lastSunday.setDate(lastSunday.getDate() - 1);
      lastSunday.setHours(23, 59, 59, 999);
      return { start: lastMonday, end: new Date(thisMonday), label: `Last week — ${fmt(lastMonday)} to ${fmt(lastSunday)}` };
    }
    case "this_month": {
      const start = new Date(now.getFullYear(), now.getMonth(), 1);
      return { start, end: tomorrow, label: `This month — ${fmt(start)} to ${fmt(now)}` };
    }
    case "last_month": {
      const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const end = new Date(now.getFullYear(), now.getMonth(), 1);
      const endLabel = new Date(end); endLabel.setDate(endLabel.getDate() - 1);
      return { start, end, label: `Last month — ${fmt(start)} to ${fmt(endLabel)}` };
    }
    default:
      return { start: today, end: tomorrow, label: "Today — " + fmt(now) };
  }
}

function fmt(d: Date) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function fmtFull(d: Date) {
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// ─── signal config ────────────────────────────────────────────────────────────

const SIGNAL_META: Record<string, { label: string; color: string; bg: string }> = {
  competitor:           { label: "COMPETITOR INTELLIGENCE", color: "#DC2626", bg: "#FEF2F2" },
  market_trend:         { label: "MARKET TRENDS",           color: "#0D9488", bg: "#F0FDFA" },
  industry_report:      { label: "INDUSTRY REPORTS",        color: "#D97706", bg: "#FFFBEB" },
  product_launch:       { label: "PRODUCT LAUNCHES",        color: "#4361EE", bg: "#EEF2FF" },
  regulatory:           { label: "REGULATORY",              color: "#059669", bg: "#ECFDF5" },
  news_pr:              { label: "NEWS & PR",               color: "#7C3AED", bg: "#F5F3FF" },
  technology:           { label: "TECHNOLOGY",              color: "#0284C7", bg: "#F0F9FF" },
  strategic_opportunity:{ label: "STRATEGIC OPPORTUNITIES", color: "#7C3AED", bg: "#F5F3FF" },
};

const PRIORITY_COLOR: Record<string, string> = {
  high: "#DC2626",
  medium: "#D97706",
  low: "#6B7280",
};

// ─── styles ───────────────────────────────────────────────────────────────────

const S = StyleSheet.create({
  page: {
    fontFamily: "Helvetica",
    backgroundColor: "#FFFFFF",
    paddingTop: 0,
    paddingBottom: 32,
    paddingHorizontal: 0,
  },
  // Masthead
  masthead: {
    backgroundColor: "#111827",
    paddingHorizontal: 40,
    paddingTop: 28,
    paddingBottom: 22,
  },
  mastheadRule: {
    borderTopWidth: 2,
    borderTopColor: "#4361EE",
    marginBottom: 10,
  },
  mastheadTitle: {
    fontSize: 26,
    fontFamily: "Helvetica-Bold",
    color: "#FFFFFF",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  mastheadSubtitle: {
    fontSize: 8,
    color: "#9CA3AF",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginTop: 4,
  },
  mastheadRight: {
    position: "absolute",
    right: 40,
    top: 40,
    alignItems: "flex-end",
  },
  mastheadDate: {
    fontSize: 10,
    color: "#D1D5DB",
    fontFamily: "Helvetica-Bold",
  },
  mastheadPeriod: {
    fontSize: 8,
    color: "#6B7280",
    marginTop: 3,
  },
  mastheadRule2: {
    borderTopWidth: 1,
    borderTopColor: "#374151",
    marginTop: 14,
  },
  // Stats bar
  statsBar: {
    flexDirection: "row",
    backgroundColor: "#F9FAFB",
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    paddingHorizontal: 40,
    paddingVertical: 12,
    gap: 0,
  },
  statBlock: {
    flex: 1,
    paddingHorizontal: 12,
    borderRightWidth: 1,
    borderRightColor: "#E5E7EB",
  },
  statBlockLast: {
    flex: 1,
    paddingHorizontal: 12,
  },
  statNum: {
    fontSize: 20,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
  },
  statLabel: {
    fontSize: 7,
    color: "#6B7280",
    textTransform: "uppercase",
    letterSpacing: 1,
    marginTop: 2,
  },
  // Body
  body: {
    paddingHorizontal: 40,
    paddingTop: 24,
  },
  // Section header
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
    marginTop: 4,
  },
  sectionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 7,
  },
  sectionLabel: {
    fontSize: 7.5,
    fontFamily: "Helvetica-Bold",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  sectionLine: {
    flex: 1,
    borderBottomWidth: 1,
    borderBottomColor: "#E5E7EB",
    marginLeft: 10,
  },
  sectionCount: {
    fontSize: 7,
    color: "#9CA3AF",
    marginLeft: 8,
  },
  // Insight card
  card: {
    borderRadius: 4,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    borderLeftWidth: 3,
    marginBottom: 8,
    padding: 11,
  },
  cardMeta: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 5,
    gap: 6,
  },
  badge: {
    borderRadius: 2,
    paddingHorizontal: 5,
    paddingVertical: 1.5,
  },
  badgeText: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  cardTitle: {
    fontSize: 10,
    fontFamily: "Helvetica-Bold",
    color: "#111827",
    marginBottom: 4,
    lineHeight: 1.4,
  },
  cardSummary: {
    fontSize: 8.5,
    color: "#374151",
    lineHeight: 1.55,
    marginBottom: 5,
  },
  takeaway: {
    backgroundColor: "#FFFBEB",
    borderRadius: 3,
    borderWidth: 1,
    borderColor: "#FDE68A",
    padding: 7,
    marginTop: 2,
  },
  takeawayLabel: {
    fontSize: 6.5,
    fontFamily: "Helvetica-Bold",
    color: "#92400E",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  takeawayText: {
    fontSize: 8,
    color: "#92400E",
    lineHeight: 1.5,
  },
  cardFooter: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 6,
    gap: 6,
  },
  tag: {
    backgroundColor: "#F3F4F6",
    borderRadius: 2,
    paddingHorizontal: 4,
    paddingVertical: 1,
  },
  tagText: {
    fontSize: 6,
    color: "#6B7280",
  },
  sourceText: {
    fontSize: 7,
    color: "#4361EE",
    marginLeft: "auto",
  },
  // Footer
  footer: {
    position: "absolute",
    bottom: 14,
    left: 40,
    right: 40,
    borderTopWidth: 1,
    borderTopColor: "#E5E7EB",
    paddingTop: 8,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  footerText: {
    fontSize: 7,
    color: "#9CA3AF",
  },
  // Page number
  noInsights: {
    padding: 40,
    alignItems: "center",
  },
  noInsightsText: {
    fontSize: 13,
    color: "#6B7280",
    fontFamily: "Helvetica-Bold",
  },
  noInsightsSub: {
    fontSize: 10,
    color: "#9CA3AF",
    marginTop: 6,
  },
});

// ─── PDF document ─────────────────────────────────────────────────────────────

interface Insight {
  id: string;
  signalType: string;
  priority: string;
  relevanceScore: number;
  title: string;
  summary: string;
  takeaway: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  tags: string[];
  createdAt: Date;
}

function BulletinPDF({
  orgName, industry, website, periodLabel, generatedAt, insights,
}: {
  orgName: string;
  industry: string;
  website: string;
  periodLabel: string;
  generatedAt: string;
  insights: Insight[];
}) {
  const grouped: Record<string, Insight[]> = {};
  const ORDER = ["competitor", "market_trend", "industry_report", "product_launch", "regulatory", "news_pr"];
  for (const sig of ORDER) {
    const items = insights.filter(i => i.signalType === sig);
    if (items.length > 0) grouped[sig] = items;
  }
  // Any unknown signal types go last
  for (const ins of insights) {
    if (!ORDER.includes(ins.signalType) && !grouped[ins.signalType]) {
      grouped[ins.signalType] = insights.filter(i => i.signalType === ins.signalType);
    }
  }

  const highCount = insights.filter(i => i.priority === "high").length;
  const competitorCount = insights.filter(i => i.signalType === "competitor").length;
  const marketCount = insights.filter(i => i.signalType === "market_trend").length;

  return (
    <Document
      title={`${orgName} — Intelligence Bulletin`}
      author="Hivemind"
      subject={`Industry intelligence bulletin for ${periodLabel}`}
    >
      <Page size="A4" style={S.page}>

        {/* ── Masthead ── */}
        <View style={S.masthead}>
          <View style={S.mastheadRule} />
          <View style={{ flexDirection: "row", alignItems: "flex-start" }}>
            <View style={{ flex: 1 }}>
              <Text style={S.mastheadTitle}>{orgName}</Text>
              <Text style={S.mastheadSubtitle}>Intelligence Bulletin · {industry}</Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={S.mastheadDate}>{generatedAt}</Text>
              <Text style={S.mastheadPeriod}>{periodLabel}</Text>
              {website ? <Text style={[S.mastheadPeriod, { marginTop: 3 }]}>{website}</Text> : null}
            </View>
          </View>
          <View style={S.mastheadRule2} />
        </View>

        {/* ── Stats bar ── */}
        <View style={S.statsBar}>
          <View style={S.statBlock}>
            <Text style={[S.statNum, { color: "#4361EE" }]}>{insights.length}</Text>
            <Text style={S.statLabel}>Total insights</Text>
          </View>
          <View style={S.statBlock}>
            <Text style={[S.statNum, { color: "#DC2626" }]}>{highCount}</Text>
            <Text style={S.statLabel}>High priority</Text>
          </View>
          <View style={S.statBlock}>
            <Text style={[S.statNum, { color: "#DC2626" }]}>{competitorCount}</Text>
            <Text style={S.statLabel}>Competitor signals</Text>
          </View>
          <View style={S.statBlockLast}>
            <Text style={[S.statNum, { color: "#0D9488" }]}>{marketCount}</Text>
            <Text style={S.statLabel}>Market trends</Text>
          </View>
        </View>

        {/* ── Body ── */}
        <View style={S.body}>
          {insights.length === 0 ? (
            <View style={S.noInsights}>
              <Text style={S.noInsightsText}>No insights for this period</Text>
              <Text style={S.noInsightsSub}>Try selecting a broader time range and regenerating.</Text>
            </View>
          ) : (
            Object.entries(grouped).map(([signalType, items]) => {
              const meta = SIGNAL_META[signalType] || { label: signalType.toUpperCase(), color: "#4361EE", bg: "#EEF2FF" };
              return (
                <View key={signalType}>
                  {/* Section header */}
                  <View style={S.sectionHeader}>
                    <View style={[S.sectionDot, { backgroundColor: meta.color }]} />
                    <Text style={[S.sectionLabel, { color: meta.color }]}>{meta.label}</Text>
                    <Text style={S.sectionCount}>{items.length} insight{items.length !== 1 ? "s" : ""}</Text>
                    <View style={S.sectionLine} />
                  </View>

                  {/* Cards */}
                  {items.map(ins => {
                    const priorityColor = PRIORITY_COLOR[ins.priority] || "#6B7280";
                    return (
                      <View key={ins.id} style={[S.card, { borderLeftColor: meta.color }]} wrap={false}>
                        {/* Meta */}
                        <View style={S.cardMeta}>
                          <View style={[S.badge, { backgroundColor: meta.bg }]}>
                            <Text style={[S.badgeText, { color: meta.color }]}>{meta.label}</Text>
                          </View>
                          <View style={[S.badge, { backgroundColor: ins.priority === "high" ? "#FEF2F2" : ins.priority === "medium" ? "#FFFBEB" : "#F3F4F6" }]}>
                            <Text style={[S.badgeText, { color: priorityColor }]}>{ins.priority.toUpperCase()}</Text>
                          </View>
                          {typeof ins.relevanceScore === "number" && (
                            <View style={[S.badge, { backgroundColor: "#F3F4F6" }]}>
                              <Text style={[S.badgeText, { color: "#6B7280" }]}>{ins.relevanceScore}% relevant</Text>
                            </View>
                          )}
                          <Text style={{ fontSize: 7, color: "#9CA3AF", marginLeft: "auto" }}>
                            {fmt(new Date(ins.createdAt))}
                          </Text>
                        </View>

                        {/* Title */}
                        <Text style={S.cardTitle}>{ins.title}</Text>

                        {/* Summary */}
                        <Text style={S.cardSummary}>{ins.summary}</Text>

                        {/* Takeaway */}
                        {ins.takeaway ? (
                          <View style={S.takeaway}>
                            <Text style={S.takeawayLabel}>Takeaway for your team</Text>
                            <Text style={S.takeawayText}>{ins.takeaway}</Text>
                          </View>
                        ) : null}

                        {/* Tags + source */}
                        <View style={S.cardFooter}>
                          {ins.tags.slice(0, 4).map(tag => (
                            <View key={tag} style={S.tag}>
                              <Text style={S.tagText}>{tag}</Text>
                            </View>
                          ))}
                          {ins.sourceName ? (
                            <Text style={S.sourceText}>via {ins.sourceName}</Text>
                          ) : null}
                        </View>
                      </View>
                    );
                  })}

                  {/* Spacer between sections */}
                  <View style={{ height: 12 }} />
                </View>
              );
            })
          )}
        </View>

        {/* ── Footer ── */}
        <View style={S.footer} fixed>
          <Text style={S.footerText}>{orgName} — Confidential Intelligence Bulletin</Text>
          <Text style={S.footerText}>Generated by Hivemind · {generatedAt}</Text>
        </View>
      </Page>
    </Document>
  );
}

// ─── Route handler ─────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    let decoded: { orgId: string };
    try {
      decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
    } catch {
      return NextResponse.json({ error: "Invalid token" }, { status: 401 });
    }

    const timeRange = req.nextUrl.searchParams.get("timeRange") || "today";
    const { start, end, label: periodLabel } = getDateRange(timeRange);

    const [org, insights] = await Promise.all([
      db.organization.findUnique({
        where: { id: decoded.orgId },
        select: { name: true, industry: true, website: true },
      }),
      db.industryInsight.findMany({
        where: {
          organizationId: decoded.orgId,
          createdAt: { gte: start, lt: end },
        },
        orderBy: [{ relevanceScore: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    const orgName = org?.name || "Your Company";
    const industry = org?.industry || "Technology";
    const website = org?.website || "";

    const generatedAt = fmtFull(new Date());

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdfBuffer = await renderToBuffer(
      BulletinPDF({ orgName, industry, website, periodLabel, generatedAt, insights }) as any
    );

    const safeOrgName = orgName.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase();
    const safeRange = timeRange.replace(/_/g, "-");
    const filename = `${safeOrgName}-intelligence-bulletin-${safeRange}.pdf`;

    // Convert Buffer → Uint8Array for the Web Response API
    const uint8 = new Uint8Array(pdfBuffer);

    return new Response(uint8, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(uint8.length),
      },
    });
  } catch (error) {
    console.error("[bulletin] error:", error);
    return NextResponse.json({ error: "Failed to generate bulletin" }, { status: 500 });
  }
}
