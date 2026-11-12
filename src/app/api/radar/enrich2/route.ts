export const maxDuration = 280;

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireRadarAccess, radarSql, selectFrom, patchByFilter } from "@/lib/radar/supabase";
import { logRadarActivity } from "@/lib/radar/activityLog";
import { streamFilteredCsv } from "@/lib/radar/csvStream";
import { createEnrichJob, runEnrichTick, refreshCounts, retryUnresolvedViaApify, ICP_TIERS, type EnrichOptions, type EnrichCompanyInput } from "@/lib/radar/enrichPipeline";
import { blitzKey } from "@/lib/radar/blitz";
import { snovConfigured } from "@/lib/radar/snov";

/**
 * Enrich v2 — Blitz → Anymail → Debounce → Anymail-verify pipeline (see lib/radar/enrichPipeline.ts).
 * Jobs run in time-budgeted ticks: the open tab's "advance" loop plus the 1-minute Vercel cron below,
 * never two at once (DB lease). Everything is resumable and saved to Radar at the end.
 */
const TICK_MS = 245000;
const VERTICALS = ["B2B", "D2C", "US", "Crossborder"];
const JOB_COLS = "id,label,vertical,created_by,status,phase,stage,options,counts,error,created_at,updated_at";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const started = Date.now();
  const { rows } = await selectFrom("enrich2_jobs", "select=id&status=eq.running&order=id.asc");
  const out: { id: number; ran: boolean }[] = [];
  for (const j of rows as { id: number }[]) {
    const left = 260000 - (Date.now() - started);
    if (left < 30000) break;
    out.push({ id: j.id, ran: await runEnrichTick(j.id, Math.min(TICK_MS, left - 15000)) });
  }
  return NextResponse.json({ ticked: out });
}

export async function POST(req: NextRequest) {
  const access = await requireRadarAccess(req, "edit");
  if (access instanceof NextResponse) return access;
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "");
  const jobId = Number(body.jobId) || 0;

  try {
    if (action === "check_keys") {
      return NextResponse.json({
        blitz: !!blitzKey(), snov: snovConfigured(), anymail: !!process.env.ANYMAIL_FINDER_API_KEY?.trim(),
        debounce: !!(process.env.DEBOUNCE_API_KEY || process.env.RADAR_DEBOUNCE_API_KEY || "").trim(),
        tiers: ICP_TIERS.map((t) => ({ label: t.label, include: t.tier.include_title, exclude: t.tier.exclude_title })),
      });
    }

    if (action === "start") {
      const label = String(body.label || "").trim();
      const vertical = String(body.vertical || "");
      if (!label) return NextResponse.json({ error: "Give the job a name" }, { status: 400 });
      if (!VERTICALS.includes(vertical)) return NextResponse.json({ error: "Pick a vertical" }, { status: 400 });
      const companies = (Array.isArray(body.companies) ? body.companies : []) as EnrichCompanyInput[];
      if (!companies.length) return NextResponse.json({ error: "Add at least one company domain" }, { status: 400 });
      if (companies.length > 5000) return NextResponse.json({ error: "Max 5,000 companies per job — split the list" }, { status: 400 });
      const o = (body.options || {}) as Partial<EnrichOptions>;
      const options: EnrichOptions = {
        maxPerCompany: Math.min(100, Math.max(1, Number(o.maxPerCompany) || 25)),
        snovFallback: o.snovFallback !== false,
        anymailFallback: o.anymailFallback !== false,
        snovVerify: o.snovVerify !== false,
        anymailVerify: o.anymailVerify !== false,
        phones: o.phones === true,
        excludeSupportHrFinance: o.excludeSupportHrFinance !== false,
        apifyFallback: o.apifyFallback !== false,
        useRadarFirst: o.useRadarFirst !== false,
        // Blitz location filter: ISO-2 country codes and city names, max 10 each.
        countries: (Array.isArray(o.countries) ? o.countries : []).map((c) => String(c).trim().toUpperCase()).filter((c) => /^[A-Z]{2}$/.test(c)).slice(0, 10),
        cities: (Array.isArray(o.cities) ? o.cities : []).map((c) => String(c).trim()).filter((c) => c && c.length <= 60).slice(0, 10),
      };
      const actor = await db.user.findUnique({ where: { id: access.userId }, select: { email: true } });
      const id = await createEnrichJob(label, vertical, actor?.email || null, companies, options);
      await logRadarActivity(access.userId, "enrich2_start", `Started Enrich job "${label}" — ${companies.length} compan(ies), ${vertical}`);
      const { rows } = await selectFrom("enrich2_jobs", `select=${JOB_COLS}&id=eq.${id}`);
      return NextResponse.json({ job: rows[0] });
    }

    if (action === "list") {
      const { rows } = await selectFrom("enrich2_jobs", `select=${JOB_COLS}&order=id.desc&limit=30`);
      return NextResponse.json({ jobs: rows });
    }

    if (!jobId) return NextResponse.json({ error: "No jobId" }, { status: 400 });

    if (action === "status") {
      const { rows } = await selectFrom("enrich2_jobs", `select=${JOB_COLS}&id=eq.${jobId}`);
      if (!rows[0]) return NextResponse.json({ error: "Job not found" }, { status: 404 });
      return NextResponse.json({ job: rows[0] });
    }

    if (action === "advance") {
      await runEnrichTick(jobId, TICK_MS);
      const { rows } = await selectFrom("enrich2_jobs", `select=${JOB_COLS}&id=eq.${jobId}`);
      return NextResponse.json({ job: rows[0] });
    }

    if (action === "people") {
      const offset = Math.max(0, Number(body.offset) || 0);
      const limit = Math.min(500, Math.max(1, Number(body.limit) || 100));
      const { rows, total } = await selectFrom("enrich2_people",
        `select=id,full_name,title,company_name,domain,tier,phase,department,dropped_reason,email,email_source,debounce_result,verify_result,final_status,phone,linkedin_url,saved&job_id=eq.${jobId}&order=dropped_reason.nullsfirst,tier.asc,id.asc`,
        { from: offset, to: offset + limit - 1 });
      return NextResponse.json({ people: rows, total });
    }

    if (action === "cancel") {
      await patchByFilter("enrich2_jobs", `id=eq.${jobId}&status=eq.running`, { status: "cancelled", stage: null, updated_at: new Date().toISOString() });
      return NextResponse.json({ ok: true });
    }

    if (action === "retry") {
      await radarSql(`UPDATE enrich2_jobs SET status = 'running', error = NULL, fail_count = 0, locked_until = NULL, stage = 'Resuming…' WHERE id = ${jobId} AND status IN ('error','cancelled')`);
      return NextResponse.json({ ok: true });
    }

    // Run Apify's LinkedIn finder over a job's "not found" companies (a batch per call), then resume the job.
    if (action === "retry_unresolved") {
      return NextResponse.json(await retryUnresolvedViaApify(jobId, Math.min(250, Math.max(10, Number(body.limit) || 100))));
    }

    if (action === "delete") {
      await radarSql(`DELETE FROM enrich2_jobs WHERE id = ${jobId} AND status <> 'running'`);
      return NextResponse.json({ ok: true });
    }

    if (action === "refresh_counts") {
      return NextResponse.json({ counts: await refreshCounts(jobId) });
    }

    // Every column of every person in the job (kept + dropped, with drop reason) as CSV.
    if (action === "export") {
      // One email status only — the final call that's also saved to Radar (no separate Debounce /
      // Anymail-verify columns to second-guess).
      const stream = streamFilteredCsv("enrich2_people", `&job_id=eq.${jobId}`, async (n) => {
        await logRadarActivity(access.userId, "enrich2_export", `Exported Enrich job ${jobId} — ${n} row(s)`);
      }, { omit: ["debounce_result", "verify_result"], rename: { final_status: "email_status" } });
      return new NextResponse(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Cache-Control": "no-store" } });
    }

    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (e) {
    console.error("enrich2 error:", e);
    return NextResponse.json({ error: (e as Error).message || "Something went wrong" }, { status: 500 });
  }
}
