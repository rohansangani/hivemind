import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest) {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  try {
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  const body = (await req.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: ["image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp"],
        maximumSizeInBytes: 5 * 1024 * 1024, // 5 MB
      }),
      onUploadCompleted: async () => {},
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
