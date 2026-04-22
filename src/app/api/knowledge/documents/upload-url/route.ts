import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest) {
  // Authenticate before issuing an upload token
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
        allowedContentTypes: [
          "application/pdf",
          "text/plain",
          "text/csv",
          "text/markdown",
          "application/json",
          "text/html",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "application/msword",
          "application/vnd.ms-powerpoint",
          "application/vnd.ms-excel",
        ],
        maximumSizeInBytes: 25 * 1024 * 1024,
      }),
      onUploadCompleted: async () => {
        // Processing is triggered by the client after it POSTs the blob URL
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}
