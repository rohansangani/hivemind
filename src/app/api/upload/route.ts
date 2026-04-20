import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// ---------------------------------------------------------------------------
// Allowed file types: extension -> accepted MIME types
// ---------------------------------------------------------------------------
const ALLOWED_TYPES: Record<string, string[]> = {
  pdf:  ["application/pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  pptx: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  xlsx: ["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
  txt:  ["text/plain"],
  md:   ["text/plain", "text/markdown"],
  csv:  ["text/csv", "text/plain"],
  html: ["text/html"],
  htm:  ["text/html"],
  jpg:  ["image/jpeg"],
  jpeg: ["image/jpeg"],
  png:  ["image/png"],
  gif:  ["image/gif"],
  webp: ["image/webp"],
  svg:  ["image/svg+xml", "text/plain"],
  mp4:  ["video/mp4"],
};

const ALL_ALLOWED_MIMES = [...new Set(Object.values(ALLOWED_TYPES).flat())];
const MAX_SIZE = 50 * 1024 * 1024; // 50 MB (enforced by Blob token, not body)

function verifyToken(req: NextRequest): { userId: string; orgId: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST — two modes:
//   1. JSON body  → client-side Blob upload token request (production)
//   2. FormData   → direct server upload (local dev fallback)
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  const decoded = verifyToken(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const contentType = req.headers.get("content-type") || "";

  // ── Mode 1: Client-side upload token request ──────────────────────────────
  if (contentType.includes("application/json")) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return NextResponse.json({ error: "Blob storage not configured" }, { status: 500 });
    }
    try {
      const body = (await req.json()) as HandleUploadBody;
      const jsonResponse = await handleUpload({
        body,
        request: req,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: ALL_ALLOWED_MIMES,
          maximumSizeInBytes: MAX_SIZE,
          tokenPayload: JSON.stringify({ userId: decoded.userId, orgId: decoded.orgId }),
        }),
        onUploadCompleted: async ({ blob }) => {
          console.log("Client upload completed:", blob.url);
        },
      });
      return NextResponse.json(jsonResponse);
    } catch (err) {
      console.error("handleUpload error:", err);
      return NextResponse.json({ error: (err as Error).message }, { status: 400 });
    }
  }

  // ── Mode 2: FormData upload (local dev — no BLOB_READ_WRITE_TOKEN) ────────
  if (!contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Unsupported content type" }, { status: 400 });
  }

  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_TYPES[ext]) return NextResponse.json({ error: "File type not allowed." }, { status: 400 });

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const timestamp = Date.now();
    const uuid = randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${timestamp}-${uuid}-${safeName}`;

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), buffer);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileUrl: `/uploads/${fileName}`,
      fileSize: file.size,
      fileType: ext,
    });
  } catch (error) {
    console.error("Local upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
