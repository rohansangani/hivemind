# Radar — how it works (read this before touching `src/app/api/radar/*`, `src/lib/radar/*`, `src/app/(app)/radar/page.tsx`)

Radar is HiveMind's prospecting workspace: accounts + contacts database, CSV upload, Apify enrichment, email-pattern
validation (Instantly test-sends + Debounce), exports, HubSpot lifecycle sync. It started as a standalone app
(`radar-clickpost`) and is now **fully native** in HiveMind — the old "proxy to radar-clickpost" plan is obsolete.
No secrets in this file; env var *names* only.

## 1. Data lives in a SEPARATE Supabase project (not HiveMind's Neon/Prisma DB)
- Radar data: Supabase project referenced by `RADAR_SUPABASE_PROJECT_REF`. HiveMind's own Prisma/Neon DB only holds users,
  `RadarExportLog`, `RadarActivityLog`, `LinkedinCheckJob`, `RadarCsvExportJob`, HubSpot mirror tables.
- Three ways to talk to it (all in `src/lib/radar/supabase.ts` / `contactExport.ts`):
  - `radarSql(query)` — Supabase **Management API** (`/v1/projects/<ref>/database/query`, token `RADAR_SUPABASE_ACCESS_TOKEN`). Arbitrary SQL, multi-statement = one transaction. Retries transient errors; it intermittently answers `500 "FGA Authentication Error. Unauthorized"` for minutes even with a valid token (Supabase-side flap) — retry window is ~15s.
  - PostgREST: `selectFrom(table, query, range)` (anon key; sets `count=exact`), `radarFetch(path)` (service key), `rpc(fn, args)`, `insertRows`, `updateRow`.
  - **PostgREST caps every response at 1000 rows** (db-max-rows) — a bigger `limit=`/`Range` does NOT lift it. Page (keyset `id=gt.<last>` is fastest; OFFSET gets slow deep) or use `fetchAllPages`/`fetchAllIds`.
- Direct DB work from a shell: read creds from `.env.local` (quoted values!) and POST SQL to the Management API (see "Debug playbook").

## 2. Tables / views (Radar Supabase)
- `contacts` — UNIQUE `(email, vertical)`; UNIQUE `contacts_linkedin_vertical_key` on `(linkedin_url, COALESCE(vertical,''))` where linkedin non-blank. Has `account_id` FK (ON DELETE SET NULL), `customer` bool, `hubspot_*`, `email_status`, `validated_at`, `debounce_fail_count`, `upload_job_id`, `marked_irrelevant*`.
- `accounts` — UNIQUE `(domain, vertical)`. Has `account_type` (B2B/B2C/B2C+B2B/Services), `customer` bool, `alt_names[]`, `brand_details` (B2B multi-brand-per-domain merge), `hubspot_*`.
- `contacts_view` = contacts LEFT JOIN accounts (+ `account_type`, combined `customer` = contact OR account). The Contacts tab & exports read this view. **Adding a view column: append at the END** (`CREATE OR REPLACE VIEW` can't reorder/rename; else DROP+CREATE).
- **CHECK**: `vertical IN ('B2B','D2C','US')` (or NULL) on both tables. Never write an industry name into vertical (an upload once did; fixed).
- **LinkedIn is the dedupe/reference key.** Canonical form `linkedin.com/in/<slug>` (lower-case; no scheme, `www.`, country subdomain, `?query`, `#frag`, trailing `/`). Postgres `norm_li()` + BEFORE INSERT/UPDATE triggers on contacts & accounts enforce it; JS `normLinkedin()` in `upload/route.ts` MUST stay identical (parity-tested). Merged-away duplicates are backed up in `contacts_linkedin_dedupe_bak`.
- Jobs: `email_validation_jobs` / `email_validation_candidates` (patterns; `selected`, `queued_for_send`, `instantly_lead_id`, `send_failed`, `bounce_status`), `retest_jobs` (Debounce), `upload_jobs`, `enrich_jobs` (+ `enrich_sync_batches`), `radar_api_keys` (hashed), `domain_patterns`, `domain_web_evidence`, `api_usage_logs`.
- RPCs: `save_enrich_batch(p_items, p_vertical)` (merges contacts/accounts; patched to merge by LinkedIn), `save_validation_job`, `set_instantly_lead_ids`.

## 3. Features and the non-obvious rules
- **Upload** (`api/radar/upload`): page sends 500-row chunks; each chunk: normalise → **Step L** (rows whose LinkedIn+vertical exists UPDATE that row, never insert; in-file dupes collapse; LinkedIn-only rows allowed) → email rows upsert on `(email,vertical)` → no-email rows guarded by name+domain → on the last chunk: contact→account linking SQL, `sync-exclusions` + `hubspot-match` fired. Page retries a failed chunk once (idempotent). Vertical column mapping is validated (B2B/D2C/US only).
- **Enrich** (`api/radar/enrich`, Apify actor `code_crafter~leads-finder`): `start` creates a job + run; the page polls; `fetch` returns LEAN items (no raw — raw made big jobs exceed Vercel's 4.5MB response cap; raw exports page via `fetch_raw_all` offset/limit); save goes through `sync_batch_start` → `continueEnrichSave` (resumable, cron-driven, `after()` kicked). **Auto-resurrect** relaunches TIMED-OUT/FAILED/ABORTED runs (cap 2) — but NOT runs stopped at Apify's max-cost cap, and NOT runs a person pressed Stop on (each relaunch re-scrapes from scratch and re-bills; it once overwrote a job's dataset link). A stopped-with-results run can still be opened.
- **Validate → New patterns / Email Validation**: `generate` (15 people/call with AI, 300 mechanical; client loops until backend says done, retries a stuck batch, server clears a batch's prior rows first so retries never duplicate) → `send` creates+activates an Instantly campaign then pushes leads: `continueSendCore` (15 concurrent, 20s per-lead timeout, reconciles leads already in the campaign before sending so nothing is double-sent) runs from `after()` and the 2-min cron `continue_all_sends`. A job is only marked `checked` when NO queued lead is unsent (else sending stalls). `check_all` (15 min) reads bounces from Instantly → `contacts.email_status`.
- **Debounce re-test jobs** (`retest_jobs`, `export-validate` route `validate_chunk`): 6 contacts/call, 3 concurrent (Debounce trips at 5), cron `continue_retest_jobs` runs ~235s every 5 min (don't let ticks overlap: they'd double-pay). The query only selects contacts that are *due* (never validated, or past 14d cooldown / 30d for verified) — otherwise jobs including "Unknown" loop forever on recently-checked rows. `processed` can be inflated by old loops; trust `validated` + the remaining count.
- **HubSpot lifecycle** (`api/radar/hubspot-match`): stage/status are derived from **HubSpot CONTACT** records aggregated by email domain (highest stage wins; customer outranks pre-sale) and applied to the account AND every Radar contact on that domain (incl. future ones). Company-object stage is ignored on purpose. `customer` is one-way (set true, never reset). Runs on cron + right after upload/enrich completes. Full reset+rematch each run, chunked 4000 with bounded concurrency (sequential blew the 280s limit).
- **Export** (`api/radar/export`): contacts stream back as CSV (keyset paged) — JSON/buffered export can't carry ~50k rows. "Include everything" ignores email-status/no-email/HubSpot-excluded filters. `downloadCSV` prefixes `'` on cells starting `= + - @` (Excel formula/#ERROR! guard).
- **API keys**: admin-only "API Keys" tab; `rk_…` sent as `Authorization: Bearer` or `x-radar-api-key`; acts as its creator (live role/permissions); only SHA-256 stored; manageable only from a real session. Resolved in `requireRadarAccess` / `resolveRadarActor`.
- **Access**: module `radar` — `edit` = everything; `view` = Dashboard + Export only. Logs and API Keys tabs: owner/admin. Auth is the HiveMind JWT cookie `hm-token` (see docs of auth in `src/app/api/auth`).

## 4. Crons (`vercel.json`) — all server-side; Vercel crons call GET with `Authorization: Bearer $CRON_SECRET`
`*/2` validate `continue_all_sends` · `*/5` validate `continue_retest_jobs`, `linkedin-jobs`, `hubspot sync-jobs`, `email-sequences/jobs` · `1-59/5` enrich (sync batches + resurrect) · `*/15` validate `check_all` · `6-59/15` `hubspot-match` · `0 */6` `sync-exclusions`.

## 5. Platform limits that have bitten us
- Vercel response body cap ≈ 4.5MB (stream or page big payloads). `maxDuration` is per route (most are 280s; `export-validate` 60s, small read routes 20–30s).
- Management-API `FGA Authentication Error` flaps; PostgREST 1000-row cap; PostgREST URL length (don't put thousands of ids in `in.(…)`); Postgres: `false OR NULL` is NULL (wrap in `COALESCE`); `CREATE OR REPLACE VIEW` column order; unique `(domain,vertical)` blocks vertical changes that collide.
- Apify: shared account-wide rate limit (`ThrottlerException`) — bound concurrency; Instantly lead-add can take ~15s each under load.
- Supabase compute (was NANO, `max_connections` 60) caused "too many clients" earlier; bounded concurrency (`mapWithConcurrency`) is the standard fix.

## 6. Debug playbook
- Live data: POST `{"query": "<sql>"}` to `https://api.supabase.com/v1/projects/$RADAR_SUPABASE_PROJECT_REF/database/query` with `Authorization: Bearer $RADAR_SUPABASE_ACCESS_TOKEN` (values from `.env.local`; strip the surrounding quotes). Only the LAST statement's rows come back.
- Prod logs: `vercel logs https://hivemind.clickpost.io --since 1h --json --query "radar/upload"` / `--status-code 5xx`. Prod env: `vercel env pull .env.vercel.production --environment=production` (gives `CRON_SECRET` to trigger a cron manually: `curl -H "Authorization: Bearer $CRON_SECRET" "https://hivemind.clickpost.io/api/radar/validate?cronAction=continue_all_sends"`). Sensitive Vercel vars may pull blank.
- Radar users report bugs by screenshot: find the job id (`upload_jobs`, `enrich_jobs`, `email_validation_jobs`, `retest_jobs`) and look at its row + the logs for that minute before theorising.

## 7. Working agreements (owner: Sushant Mohan, growth)
- Deploy flow: commit on `sushantprod` → `git checkout main && git merge sushantprod --ff-only && git push origin main && git push origin sushantprod` — no confirmation needed. Always `npx tsc --noEmit` + `npx next build` first.
- UI follows the `hivemind-design` skill (near-black primary, no shadows, tag tokens). Never send test emails to real prospects — only `sushant.mohan@clickpost.ai`.
- Verify live (query the DB / logs) before claiming a fix works; many "fixes" here needed a second pass once real data scale showed up.
