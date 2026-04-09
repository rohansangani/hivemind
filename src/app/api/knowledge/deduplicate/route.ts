import { NextRequest, NextResponse } from "next/server";
import jwt from "jsonwebtoken";
import pg from "pg";

export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get("hm-token")?.value;
    if (!token) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
    const decoded = jwt.verify(
      token,
      process.env.NEXTAUTH_SECRET || "fallback-secret"
    ) as { orgId: string };

    const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
    const counts: Record<string, number> = {};

    try {
      // ── Products: keep newest per (name, orgId) ──────────
      // Must remove ProductMarket rows first to avoid FK constraint violations
      const dupProdRows = await pool.query(
        `WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY name, "organizationId" ORDER BY "createdAt" DESC) AS rn
          FROM "Product" WHERE "organizationId" = $1
        )
        SELECT id FROM ranked WHERE rn > 1`,
        [decoded.orgId]
      );
      const dupProdIds: string[] = dupProdRows.rows.map((r: { id: string }) => r.id);
      if (dupProdIds.length > 0) {
        await pool.query(
          `DELETE FROM "ProductMarket" WHERE "productId" = ANY($1::text[])`,
          [dupProdIds]
        );
      }
      const prodResult = await pool.query(
        `DELETE FROM "Product" WHERE id = ANY($1::text[]) AND "organizationId" = $2`,
        [dupProdIds, decoded.orgId]
      );
      counts.products = prodResult.rowCount ?? 0;

      // ── Markets: keep newest per (name, orgId) ───────────
      const mktResult = await pool.query(
        `WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY name, "organizationId" ORDER BY "createdAt" DESC) AS rn
          FROM "Market" WHERE "organizationId" = $1
        )
        DELETE FROM "Market" WHERE id IN (SELECT id FROM ranked WHERE rn > 1) AND "organizationId" = $1`,
        [decoded.orgId]
      );
      counts.markets = mktResult.rowCount ?? 0;

      // ── Personas: keep newest per (title, orgId) ─────────
      const persResult = await pool.query(
        `WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY title, "organizationId" ORDER BY "createdAt" DESC) AS rn
          FROM "Persona" WHERE "organizationId" = $1
        )
        DELETE FROM "Persona" WHERE id IN (SELECT id FROM ranked WHERE rn > 1) AND "organizationId" = $1`,
        [decoded.orgId]
      );
      counts.personas = persResult.rowCount ?? 0;

      // ── Competitors: keep newest per (name, orgId) ───────
      const compResult = await pool.query(
        `WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY name, "organizationId" ORDER BY "createdAt" DESC) AS rn
          FROM "Competitor" WHERE "organizationId" = $1
        )
        DELETE FROM "Competitor" WHERE id IN (SELECT id FROM ranked WHERE rn > 1) AND "organizationId" = $1`,
        [decoded.orgId]
      );
      counts.competitors = compResult.rowCount ?? 0;

      // ── Skills: keep newest per (name, orgId) ────────────
      const skillResult = await pool.query(
        `WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY name, "organizationId" ORDER BY "createdAt" DESC) AS rn
          FROM "Skill" WHERE "organizationId" = $1
        )
        DELETE FROM "Skill" WHERE id IN (SELECT id FROM ranked WHERE rn > 1) AND "organizationId" = $1`,
        [decoded.orgId]
      );
      counts.skills = skillResult.rowCount ?? 0;

      // ── LearningLog: keep newest per (title, orgId) ──────
      const learningResult = await pool.query(
        `WITH ranked AS (
          SELECT id, ROW_NUMBER() OVER (PARTITION BY title, "organizationId" ORDER BY "createdAt" DESC) AS rn
          FROM "LearningLog" WHERE "organizationId" = $1
        )
        DELETE FROM "LearningLog" WHERE id IN (SELECT id FROM ranked WHERE rn > 1) AND "organizationId" = $1`,
        [decoded.orgId]
      );
      counts.learnings = learningResult.rowCount ?? 0;
    } finally {
      await pool.end();
    }

    const total = Object.values(counts).reduce((s, n) => s + n, 0);
    return NextResponse.json({ removed: counts, total });
  } catch (error) {
    console.error("Deduplication error:", error);
    return NextResponse.json({ error: "Deduplication failed" }, { status: 500 });
  }
}
