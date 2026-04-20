import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import jwt from "jsonwebtoken";
import { writeFile, mkdir } from "fs/promises";
import path from "path";

// Increase serverless function timeout to handle large file uploads
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// Allowed file extensions
// ---------------------------------------------------------------------------
const ALLOWED_EXTENSIONS = new Set([
  "pdf", "docx", "pptx", "xlsx", "txt", "md", "csv", "html", "htm",
  "jpg", "jpeg", "png", "gif", "webp", "svg", "mp4",
]);

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
// PUT — streaming upload (no client-side blob library, no CORS issues)
//
// Browser  →  this function  →  Vercel Blob (if BLOB_READ_WRITE_TOKEN set)
//                           →  local filesystem (dev fallback)
//
// Query params: ?filename=<original-filename>
// Body: raw file bytes (Content-Type should be set to the file's MIME type)
// ---------------------------------------------------------------------------
export async function PUT(req: NextRequest) {
  const decoded = verifyToken(req);
  if (!decoded) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

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

  // ── Production: stream directly to Vercel Blob ───────────────────────────
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    try {
      const { put } = await import("@vercel/blob");
      const contentType = req.headers.get("content-type") || "application/octet-stream";
      const blob = await put(filename, req.body, {
        access: "public",
        contentType,
        addRandomSuffix: true,
      });
      return NextResponse.json({
        success: true,
        fileName: filename,
        fileUrl: blob.url,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error("Blob upload error:", msg);
      return NextResponse.json({ error: "Upload failed: " + msg }, { status: 500 });
    }
  }

  // ── Local dev fallback: buffer and save to public/uploads/ ───────────────
  try {
    const bytes = await req.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const timestamp = Date.now();
    const uuid = randomUUID();
    const safeName = filename.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${timestamp}-${uuid}-${safeName}`;

    const uploadDir = path.join(process.cwd(), "public", "uploads");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(path.join(uploadDir, fileName), buffer);

    return NextResponse.json({
      success: true,
      fileName: filename,
      fileUrl: `/uploads/${fileName}`,
      fileSize: buffer.length,
    });
  } catch (error) {
    console.error("Local upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}
