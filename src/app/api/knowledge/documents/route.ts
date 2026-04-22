export const maxDuration = 60;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import jwt from "jsonwebtoken";
import pg from "pg";

function getRawPool() {
  return new pg.Pool({ connectionString: process.env.DATABASE_URL });
}

function authError() {
  return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
}

function serverError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error("[knowledge/documents]", msg);
  return NextResponse.json(
    { error: process.env.NODE_ENV === "development" ? msg : "Something went wrong" },
    { status: 500 }
  );
}

type Learning = { title: string; summary: string; takeaway: string; tags: string[]; kbCategory: string };

const ANALYSIS_PROMPT = (orgName: string, orgIndustry: string, fileName: string) => `You are a deep marketing intelligence analyst extracting EVERYTHING of value from a document uploaded by the ${orgName} team (${orgIndustry} industry).

Document: "${fileName}"

Your job is to extract ALL meaningful knowledge from this document — not just highlights. Be thorough. A rich document should yield 15–25+ learnings. Cover every dimension below that is present in the document.

EXTRACTION CATEGORIES (cover all that apply):
1. PRODUCT KNOWLEDGE — features, capabilities, use cases, technical specs, integrations, limitations, roadmap items
2. POSITIONING & MESSAGING — value propositions, taglines, key messages, differentiators, how the product is framed
3. CUSTOMER INTELLIGENCE — customer segments, buyer personas, pain points, jobs-to-be-done, decision criteria, objections
4. PROOF POINTS & METRICS — statistics, benchmarks, ROI claims, customer results, NPS scores, adoption numbers, awards
5. CUSTOMER STORIES — named customers, case studies, testimonials, quotes (exact where possible)
6. COMPETITIVE INTELLIGENCE — competitor names, how they are positioned against, differentiators, win/loss patterns
7. BRAND & VOICE — tone guidelines, words to use/avoid, brand personality, writing rules, visual/style guidelines
8. PRICING & PACKAGING — pricing tiers, packaging names, what's included, how value is communicated
9. CONTENT PATTERNS — headline formulas, CTA patterns, narrative frameworks, structural approaches used in the doc
10. MARKET & INDUSTRY — target markets, verticals, geographic focus, industry trends referenced, market size claims
11. PROCESS & METHODOLOGY — frameworks, how-to steps, recommended approaches, implementation patterns
12. INTERNAL KNOWLEDGE — go-to-market motion, sales process details, partner/channel info, team structure

Rules:
- Every learning MUST be grounded in something explicitly stated in the document. Quote or closely paraphrase.
- Do NOT generate generic marketing advice or invent information not present.
- Titles must be specific and scannable (e.g. "Enterprise NPS: 72" not "Customer satisfaction").
- The takeaway must be actionable for AI generating future content from this brand.
- If the same fact appears multiple times, capture it once with the best version.

Return ONLY valid JSON (no markdown, no backticks):
{
  "documentType": "brand_guidelines|product_spec|case_study|competitive_analysis|sales_deck|research_report|pricing|persona_profile|general",
  "learnings": [
    {
      "title": "Specific, scannable title — include key number or term if relevant",
      "summary": "What the document explicitly states — quote exact phrases where possible",
      "takeaway": "How this should influence AI-generated content from this brand",
      "tags": ["tag1", "tag2"],
      "kbCategory": "brand|product|market|persona|competitor|messaging|proof_point|general"
    }
  ]
}`;

async function callClaude(
  apiKey: string,
  messages: Array<{ role: string; content: unknown }>
): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-sonnet-4-6", max_tokens: 4000, messages }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error?.message || "Claude API error");
  return data.content?.[0]?.text || "";
}

function parseLearnings(raw: string): Learning[] {
  try {
    const clean = raw.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();
    const match = clean.match(/\{[\s\S]*\}/);
    if (!match) return [];
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed.learnings) ? parsed.learnings : [];
  } catch {
    return [];
  }
}

async function analyzeDocument(
  fileUrl: string,
  ext: string,
  fileName: string,
  orgName: string,
  orgIndustry: string,
  apiKey: string
): Promise<Learning[]> {
  const prompt = ANALYSIS_PROMPT(orgName, orgIndustry, fileName);

  if (ext === "pdf") {
    // Try 1: pass the public Vercel Blob URL directly — Anthropic fetches the PDF on their end.
    // No local download, no base64 encoding, no large payload. Fastest and most reliable.
    try {
      const raw = await callClaude(apiKey, [{
        role: "user",
        content: [
          { type: "document", source: { type: "url", url: fileUrl } },
          { type: "text", text: prompt },
        ],
      }]);
      const learnings = parseLearnings(raw);
      if (learnings.length > 0) return learnings;
      console.warn("[documents] URL-based PDF returned 0 learnings, trying pdf-parse");
    } catch (e) {
      console.warn("[documents] URL-based PDF error:", e instanceof Error ? e.message : e);
    }

    // Try 2: download and extract text with pdf-parse, send as plain text
    try {
      const fetchRes = await fetch(fileUrl);
      const buffer = Buffer.from(await fetchRes.arrayBuffer());

      const { PDFParse } = await import("pdf-parse");
      const parser = new PDFParse({ data: buffer });
      const result = await parser.getText() as unknown as Record<string, unknown>;

      let pdfText = "";
      if (typeof result.text === "string") {
        pdfText = result.text.trim();
      } else if (Array.isArray(result.pages)) {
        pdfText = (result.pages as Array<{ text?: string }>)
          .map(p => (typeof p.text === "string" ? p.text : ""))
          .join("\n")
          .trim();
      }
      console.log(`[documents] pdf-parse extracted ${pdfText.length} chars`);

      if (pdfText.length > 50) {
        const raw = await callClaude(apiKey, [{
          role: "user",
          content: `${prompt}\n\nDocument content:\n${pdfText.slice(0, 18000)}`,
        }]);
        const learnings = parseLearnings(raw);
        if (learnings.length > 0) return learnings;
      }
    } catch (e) {
      console.warn("[documents] pdf-parse fallback error:", e instanceof Error ? e.message : e);
    }

    return [];
  }

  // Non-PDF formats: download buffer and extract as text
  const fetchRes = await fetch(fileUrl);
  if (!fetchRes.ok) throw new Error(`Failed to fetch file: ${fetchRes.status}`);
  const buffer = Buffer.from(await fetchRes.arrayBuffer());

  let text = "";
  if (["txt", "md", "csv", "json"].includes(ext)) {
    text = buffer.toString("utf-8").slice(0, 15000);
  } else if (["html", "htm"].includes(ext)) {
    const cheerio = await import("cheerio");
    const $ = cheerio.load(buffer.toString("utf-8"));
    $("script, style").remove();
    text = $.text().replace(/\s+/g, " ").trim().slice(0, 15000);
  } else {
    // Best-effort for DOCX/PPTX/XLSX (ZIP-based XML) — strip binary noise
    text = buffer
      .toString("utf-8", 0, Math.min(buffer.length, 25000))
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 10000);
  }

  if (text.length < 30) return [];

  const raw = await callClaude(apiKey, [{
    role: "user",
    content: `${prompt}\n\nDocument content:\n${text}`,
  }]);
  return parseLearnings(raw);
}

function cuid() {
  return "c" + Math.random().toString(36).slice(2, 11) + Date.now().toString(36);
}

async function processFile(
  fileUrl: string,
  fileName: string,
  fileSize: number,
  orgId: string,
  orgName: string,
  orgIndustry: string,
  apiKey: string | undefined,
  pool: pg.Pool
) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "bin";
  const docName = fileName.replace(/\.[^.]+$/, "");
  const docId = cuid();
  const now = new Date();

  await pool.query(
    `INSERT INTO "KnowledgeDocument" (id, name, "fileName", "fileUrl", "fileType", "fileSize", status, "learningsCount", "organizationId", "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,'processing',0,$7,$8)`,
    [docId, docName, fileName, fileUrl, ext, fileSize, orgId, now]
  );

  let learnings: Learning[] = [];
  let status = "analyzed";

  try {
    if (apiKey) {
      learnings = await analyzeDocument(fileUrl, ext, fileName, orgName, orgIndustry, apiKey);
    }
  } catch (e) {
    console.error("[knowledge/documents] analysis error:", e);
    status = "analyzed"; // still mark analyzed — fallback learnings below
  }

  if (learnings.length === 0) {
    learnings = [{
      title: `Document uploaded: ${fileName}`,
      summary: `A ${ext.toUpperCase()} document was added to the knowledge base. ${!apiKey ? "Add an Anthropic API key to enable AI extraction." : "Text extraction returned no content — the document may be image-based or password-protected."}`,
      takeaway: "Review this document manually to identify key insights to add to the knowledge base.",
      tags: [ext.toUpperCase(), "Document Upload"],
      kbCategory: "general",
    }];
    if (!apiKey) status = "no_api_key";
  }

  for (const l of learnings) {
    const logId = cuid();
    await pool.query(
      `INSERT INTO "LearningLog" (id, "sourceType", title, summary, takeaway, tags, "kbCategories", "sourceDocumentId", "organizationId", "createdAt")
       VALUES ($1,'document_upload',$2,$3,$4,$5,$6,$7,$8,$9)`,
      [logId, l.title, l.summary, l.takeaway, l.tags, [l.kbCategory], docId, orgId, new Date()]
    );
  }

  await pool.query(
    `UPDATE "KnowledgeDocument" SET status=$1, "learningsCount"=$2 WHERE id=$3`,
    [status, learnings.length, docId]
  );

  return { id: docId, name: docName, fileName, fileUrl, fileType: ext, fileSize, status, learningsCount: learnings.length, createdAt: now, organizationId: orgId };
}

export async function GET(req: NextRequest) {
  const pool = getRawPool();
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return authError();
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string };

    const result = await pool.query(
      `SELECT id, name, "fileName", "fileType", "fileSize", status, "learningsCount", "createdAt"
       FROM "KnowledgeDocument" WHERE "organizationId"=$1 ORDER BY "createdAt" DESC`,
      [decoded.orgId]
    );

    return NextResponse.json({ documents: result.rows });
  } catch (e) {
    return serverError(e);
  } finally {
    await pool.end();
  }
}

export async function POST(req: NextRequest) {
  const pool = getRawPool();
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return authError();
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    // Files are uploaded directly to Vercel Blob by the client — we receive blob URLs
    const body = await req.json() as { files: Array<{ url: string; name: string; size: number }> };
    if (!Array.isArray(body.files) || !body.files.length) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
    for (const f of body.files) {
      if (f.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `File "${f.name}" exceeds the 25 MB size limit` },
          { status: 413 }
        );
      }
    }

    const org = await db.organization.findUnique({ where: { id: decoded.orgId } });
    const orgName = org?.name || "the company";
    const orgIndustry = org?.industry || "technology";
    const apiKey = process.env.ANTHROPIC_API_KEY;

    const results = [];
    for (const f of body.files) {
      const doc = await processFile(f.url, f.name, f.size, decoded.orgId, orgName, orgIndustry, apiKey, pool);
      results.push(doc);
    }

    // Fire-and-forget: re-synthesize skills with the new learnings
    fetch(new URL("/api/knowledge/synthesize-skills", req.url).toString(), {
      method: "POST",
      headers: { cookie: req.headers.get("cookie") || "" },
    }).catch(() => {});

    return NextResponse.json({ documents: results, count: results.length });
  } catch (e) {
    return serverError(e);
  } finally {
    await pool.end();
  }
}

export async function DELETE(req: NextRequest) {
  const pool = getRawPool();
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return authError();
    const decoded = jwt.verify(token, process.env.NEXTAUTH_SECRET || "fallback-secret") as { orgId: string; role?: string };
    if (decoded.role === "viewer") return NextResponse.json({ error: "Read-only access" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    if (!id) return NextResponse.json({ error: "ID required" }, { status: 400 });

    const check = await pool.query(
      `SELECT id FROM "KnowledgeDocument" WHERE id=$1 AND "organizationId"=$2`,
      [id, decoded.orgId]
    );
    if (!check.rows.length) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await pool.query(`DELETE FROM "LearningLog" WHERE "sourceDocumentId"=$1 AND "organizationId"=$2`, [id, decoded.orgId]);
    await pool.query(`DELETE FROM "KnowledgeDocument" WHERE id=$1 AND "organizationId"=$2`, [id, decoded.orgId]);

    return NextResponse.json({ success: true });
  } catch (e) {
    return serverError(e);
  } finally {
    await pool.end();
  }
}
