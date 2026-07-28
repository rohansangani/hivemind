import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import { lemlist } from "@/lib/lemlist";

/** Team members available as lemlist senders — lemlist has no mailbox-tag concept like
 * Instantly's, so the send panel picks a specific sending user (usr_xxx) instead of a tag. */
export async function POST(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  let decoded: { orgId: string };
  try {
    decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    const d = await lemlist<{ users?: Array<{ userId: string; email?: string; name?: string }> }>("/team?version=v2", {}, decoded.orgId);
    const senders = (d.users || [])
      .filter((u) => u.email)
      .map((u) => ({ id: u.userId, label: u.name ? `${u.name} <${u.email}>` : u.email! }));
    return NextResponse.json({ senders });
  } catch (err) {
    console.error("Email sequences lemlist senders error:", err);
    return NextResponse.json({ error: (err as Error).message || "Failed to load lemlist senders" }, { status: 502 });
  }
}
