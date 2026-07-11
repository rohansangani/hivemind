import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { fetchContactsForSequences } from "@/lib/radar/contactExport";

/**
 * "Load from Radar" source for Email Sequences — pulls a batch of contacts straight from
 * Radar's own DB (same filter/status logic as the Export tab and Ask Halo's search tool) instead
 * of requiring a manual CSV upload. Same access level as the rest of Email Sequences (no radar-
 * specific permission gate), matching the existing send flow's explicit access decision.
 */
export async function POST(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const { vertical, industry, title, country, emailStatuses, limit } = body as {
      vertical?: string;
      industry?: string;
      title?: string;
      country?: string;
      emailStatuses?: string[];
      limit?: number;
    };
    const batchSize = Math.min(Math.max(Number(limit) || 100, 1), 1000);

    const { rows, total } = await fetchContactsForSequences(
      { vertical, industry, title, country },
      emailStatuses,
      batchSize,
    );

    const prospects = rows.map((c) => ({
      name: [c.first_name, c.last_name].filter(Boolean).join(" ") || (c.full_name as string) || "",
      company: (c.company_name as string) || (c.account_name as string) || "",
      website: (c.domain as string) || (c.account_domain as string) || "",
      title: (c.title as string) || "",
      email: (c.email as string) || "",
      industry: (c.industry as string) || "",
      phone: (c.phone as string) || "",
    }));

    return NextResponse.json({ prospects, total });
  } catch (err) {
    console.error("Email sequences radar-contacts error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to load contacts from Radar" }, { status: 502 });
  }
}
