import { readFile } from "fs/promises";
import path from "path";

/**
 * Extract plain text from a source file URL (blob or local /public path).
 * Handles PDF, OOXML (docx/pptx/xlsx), HTML, and plain text. Used by Coach to
 * read the ORIGINAL uploaded material for lessons — not the KB's short summary,
 * which is where lesson depth was being lost.
 *
 * Best-effort: returns "" on any failure rather than throwing, so one bad file
 * never breaks a whole generation run.
 */
export async function extractSourceText(url: string, fileType: string | null | undefined, maxChars = 8000): Promise<string> {
  const ext = (fileType || url.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  try {
    const buf = await fetchBuf(url);

    if (["txt", "md", "csv", "json"].includes(ext)) {
      return buf.toString("utf-8").slice(0, maxChars);
    }
    if (["html", "htm"].includes(ext)) {
      const cheerio = await import("cheerio");
      const $ = cheerio.load(buf.toString("utf-8"));
      $("script, style, nav, footer").remove();
      return $.text().replace(/\s+/g, " ").trim().slice(0, maxChars);
    }
    if (ext === "pdf") {
      const mod = await import("pdf-parse");
      const pdf = (mod as unknown as { default?: (b: Buffer) => Promise<{ text: string }> }).default ?? (mod as unknown as (b: Buffer) => Promise<{ text: string }>);
      const data = await pdf(buf);
      return (data?.text || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
    }
    if (["docx", "pptx", "xlsx"].includes(ext)) {
      const { parseOffice } = await import("officeparser");
      const ast = await parseOffice(buf);
      const { value } = await ast.to("text");
      return (value || "").replace(/\s+/g, " ").trim().slice(0, maxChars);
    }
    return "";
  } catch (e) {
    console.error(`extractSourceText failed for ${url} (.${ext}):`, e instanceof Error ? e.message : e);
    return "";
  }
}

async function fetchBuf(url: string): Promise<Buffer> {
  if (url.startsWith("/")) {
    return readFile(path.join(process.cwd(), "public", url));
  }
  const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
