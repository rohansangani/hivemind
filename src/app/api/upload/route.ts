import { NextRequest, NextResponse } from "next/server";
import { put } from "@vercel/blob";
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

const MAX_SIZE = 15 * 1024 * 1024; // 15 MB

// ---------------------------------------------------------------------------
// Magic-byte signatures for binary types that must be validated server-side.
// Each entry: [byteOffset, expectedBytes]
// ---------------------------------------------------------------------------
const MAGIC_BYTES: Record<string, [number, number[]][]> = {
  pdf:  [[0, [0x25, 0x50, 0x44, 0x46]]],                       // %PDF
  png:  [[0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]]],
  jpg:  [[0, [0xff, 0xd8, 0xff]]],
  jpeg: [[0, [0xff, 0xd8, 0xff]]],
  gif:  [[0, [0x47, 0x49, 0x46, 0x38]]],                       // GIF8
  webp: [[0, [0x52, 0x49, 0x46, 0x46]], [8, [0x57, 0x45, 0x42, 0x50]]], // RIFF....WEBP
  mp4:  [[4, [0x66, 0x74, 0x79, 0x70]]],                       // ....ftyp
  docx: [[0, [0x50, 0x4b, 0x03, 0x04]]],                       // PK (ZIP)
  pptx: [[0, [0x50, 0x4b, 0x03, 0x04]]],
  xlsx: [[0, [0x50, 0x4b, 0x03, 0x04]]],
};

function checkMagicBytes(ext: string, buf: Buffer): boolean {
  const signatures = MAGIC_BYTES[ext];
  if (!signatures) return true; // no magic check defined for this type — pass through
  return signatures.every(([offset, expected]) =>
    expected.every((byte, i) => buf[offset + i] === byte)
  );
}

export async function POST(req: NextRequest) {
  // -------------------------------------------------------------------------
  // 1. JWT authentication — return 401 for any token problem, not 500
  // -------------------------------------------------------------------------
  const token = req.cookies.get("hm-token")?.value;
  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let decoded: { userId: string; orgId: string };
  try {
    decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { userId: string; orgId: string };
  } catch {
    return NextResponse.json({ error: "Invalid or expired token" }, { status: 401 });
  }

  try {
    // -----------------------------------------------------------------------
    // 2. Parse form data and validate file presence
    // -----------------------------------------------------------------------
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    // -----------------------------------------------------------------------
    // 3. File size check — use file.size BEFORE reading into memory
    // -----------------------------------------------------------------------
    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: "File too large. Maximum size is 15MB." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // 4. Extension whitelist
    // -----------------------------------------------------------------------
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (!ALLOWED_TYPES[ext]) {
      return NextResponse.json({ error: "File type not allowed." }, { status: 400 });
    }

    // -----------------------------------------------------------------------
    // 5. Content-Type vs extension cross-validation
    // -----------------------------------------------------------------------
    const reportedMime = file.type.toLowerCase().split(";")[0].trim();
    if (!ALLOWED_TYPES[ext].includes(reportedMime)) {
      return NextResponse.json(
        { error: "File MIME type does not match file extension." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // 6. Read buffer and magic-byte validation
    // -----------------------------------------------------------------------
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    if (!checkMagicBytes(ext, buffer)) {
      return NextResponse.json(
        { error: "File content does not match the declared file type." },
        { status: 400 }
      );
    }

    // -----------------------------------------------------------------------
    // 7. Generate a collision-safe filename and upload to Vercel Blob
    //    (falls back to local filesystem in development when token is absent)
    // -----------------------------------------------------------------------
    const timestamp = Date.now();
    const uuid = randomUUID();
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
    const fileName = `${timestamp}-${uuid}-${safeName}`;

    const hasBlob = !!process.env.BLOB_READ_WRITE_TOKEN;

    let fileUrl: string;
    if (hasBlob) {
      const pathname = `uploads/${decoded.orgId}/${fileName}`;
      try {
        const blob = await put(pathname, buffer, { access: "public" });
        fileUrl = blob.url;
      } catch (uploadError) {
        console.error("Blob upload error:", uploadError);
        return NextResponse.json(
          { error: "File storage failed. Check BLOB_READ_WRITE_TOKEN in Vercel environment variables." },
          { status: 500 }
        );
      }
    } else if (process.env.NODE_ENV !== "production") {
      // Local dev fallback: write to public/uploads/
      const uploadDir = path.join(process.cwd(), "public", "uploads");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, fileName), buffer);
      fileUrl = `/uploads/${fileName}`;
    } else {
      // Production without blob token — fail clearly
      return NextResponse.json(
        { error: "File storage is not configured. Add BLOB_READ_WRITE_TOKEN to your Vercel environment variables, then redeploy." },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      fileName: file.name,
      fileUrl,
      fileSize: file.size,
      fileType: ext,
    });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }
}

