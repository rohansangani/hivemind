import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";

export async function GET(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string };

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Conversation ID required" }, { status: 400 });

    const conversation = await db.conversation.findUnique({
      where: { id },
      include: { messages: { orderBy: { createdAt: "asc" } } },
    });

    if (!conversation || conversation.userId !== decoded.userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: conversation.id,
      title: conversation.title,
      updatedAt: conversation.updatedAt,
      messages: conversation.messages.map((m: { id: string; role: string; content: string; createdAt: Date; citations: unknown }) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
        // enrichJob/enrichLeads/csvExportJob are the only citation fields surfaced to the client —
        // jobId/label for the live-polling status cards (Enrich and CSV export jobs), and the full
        // lead rows (+ any ICP-fit scores) for the results table. All survive reopening the
        // conversation since they're read from the DB, not just kept in the current session's
        // memory (intent/entities stay server-side only).
        enrichJob: (m.citations as { enrichJob?: { jobId: number; label: string } } | null)?.enrichJob,
        enrichLeads: (m.citations as { enrichLeads?: { leads: unknown[]; scores?: Record<string, { score: number; reason: string }> } } | null)?.enrichLeads,
        csvExportJob: (m.citations as { csvExportJob?: { jobId: string; type: "contacts" | "accounts"; label?: string } } | null)?.csvExportJob,
      })),
    });
  } catch (error) {
    console.error("Conversation load error:", error);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}
