import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { instantly } from "@/lib/instantly";

/** Mailbox tags available to send Email Sequences campaigns from — same Instantly workspace
 * Radar's Validate uses, so this mirrors that section's tag picker exactly. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret");
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const d = await instantly<{ items?: Array<{ id: string; label?: string; name?: string }> }>("/custom-tags?limit=100");
    const tags = (d.items || []).map((t) => ({ id: t.id, label: t.label || t.name })).filter((t) => t.label);
    return NextResponse.json({ tags });
  } catch (err) {
    console.error("Email sequences tags error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to load mailbox tags" }, { status: 502 });
  }
}
