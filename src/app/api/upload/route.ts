import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Allowed types
// ---------------------------------------------------------------------------
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "docx", "pptx", "xlsx", "txt", "md", "csv", "html", "htm",
  "jpg", "jpeg", "png", "gif", "webp", "svg", "mp4",
]);

const ALL_ALLOWED_MIMES = [
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "text/plain", "text/markdown", "text/csv", "text/html",
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml",
  "video/mp4", "application/octet-stream",
];

function verifyToken(req: NextRequest): { userId: string; orgId: string; role?: string } | null {
  const token = req.cookies.get("hm-token")?.value;
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { userId: string; orgId: string; role?: string };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// POST — client-side token generation for large files (> 4 MB)
// The browser calls this to get a signed upload token, then PUTs directly
// to Vercel Blob CDN — bypassing the 4.5 MB serverless body limit entirely.
// ---------------------------------------------------------------------------
export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: "Blob storage not configured" }, { status: 500 });
  }
  try {
    const body = (await req.json()) as HandleUploadBody;
    const jsonResponse = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async () => {
        const decoded = verifyToken(req);
        if (!decoded) throw new Error("Not authenticated");
        if (decoded.role === "viewer") throw new Error("Read-only access");
        return {
          allowedContentTypes: ALL_ALLOWED_MIMES,
          tokenPayload: JSON.stringify({ userId: decoded.userId, orgId: decoded.orgId }),
        };
      },
    });
    return NextResponse.json(jsonResponse);
  } catch (err) {
    const msg = (err as Error).message;
    return NextResponse.json({ error: msg }, { status: msg === "Not authenticated" ? 401 : msg === "Read-only access" ? 403 : 400 });
  }
}

// ---------------------------------------------------------------------------
// PUT — server-side streaming upload for files ≤ 4 MB
// Browser sends file body directly; server streams it to Vercel Blob.
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  const decoded = verifyToken(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

  const { searchParams } = new URL(req.url);
  const filename = searchParams.get("filename");
  if (!filename) return NextResponse.json({ error: "filename required" }, { status: 400 });

  const ext = (filename.split(".").pop() || "").toLowerCase();
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    return NextResponse.json({ error: "File type not allowed" }, { status: 400 });
  }

  if (!req.body) {
    return NextResponse.json({ error: "No file body provided" }, { status: 400 });
  }

  // ── Vercel Blob (production) ──────────────────────────────────────────────
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const contentType = req.headers.get("content-type") || "application/octet-stream";
      const blob = await put(filename, req.body, { access: "public", contentType, addRandomSuffix: true });
      return NextResponse.json({ success: true, fileName: filename, fileUrl: blob.url });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Blob upload error:", msg);
      return NextResponse.json({ error: "Upload failed: " + msg }, { status: 500 });
    }
  }

  // ── Local dev fallback: save to public/uploads/ ───────────────────────────
  try {
    const bytes = await req.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const fileName = `${Date.now()}-${randomUUID()}-${filename.replace(/[^a-zA-Z0-9.-]/g, "_")}`;
    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), buffer);
    return NextResponse.json({ success: true, fileName: filename, fileUrl: `/uploads/${fileName}`, fileSize: buffer.length });
  } catch (error) {
    console.error("Local upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
