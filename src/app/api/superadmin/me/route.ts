import { NextRequest, NextResponse } from "next/server";
import { verifySuperAdmin } from "@/lib/superadmin";

export async function GET(req: NextRequest) {
  const admin = verifySuperAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ user: admin });
}
