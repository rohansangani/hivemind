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
- **CHECK**: `vertical IN ('B2B','D2C','US','Crossborder')` (or NULL) on both tables — Crossborder added 2026-11-04 (exact spelling; upload canonicalises 'CROSSBORDER'/'cross-border' to it). DB fns save_enrich_batch / save_validation_job / get_growth_snapshots carry the same list. Never write an industry name into vertical (an upload once did; fixed).
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

## Check LinkedIn — provider waterfall (2026-11-04)

`lib/radar/checkLinkedin.ts` (profiles) and `checkLinkedinCompany.ts` (companies), run by the
`linkedin-jobs` route in chunks of 25:

- **Profiles:** Blitz `POST /v2/enrichment/person` → misses to Anymail Finder
  `POST /v5.1/find-email/linkedin-url` → anything still missing to Apify
  `harvestapi~linkedin-profile-scraper` (always "Profile details", no email mode; ≤15 per run, runs in parallel).
- **Companies:** Blitz `POST /v2/enrichment/company` → misses to Apify `harvestapi~linkedin-company`.
- Each provider's answer is normalised to Apify's item shape, so matching/saving is one code path.
  Every result row carries `source` (blitz | anymail | apify).
- Blitz client: `lib/radar/blitz.ts`. `x-api-key: $BLITZ_API_KEY`, paced to 25 request starts/sec
  per instance, 429/503 retried. A 401/402 skips Blitz for that chunk instead of failing it.
  With no key set, the waterfall starts at Anymail.
- An Anymail-found email is saved as `safe to send` (Anymail only returns verified addresses).
- `LinkedinCheckJob.stage` holds live progress text ("Profiles 26–50 of 300 · Anymail Finder — 4 not on Blitz…").
  The UI polls it every 2.5s. `start` returns immediately; the tab's `advance` loop or the 5-min cron does the work.
- Usage log actions: `linkedin_blitz`, `linkedin_anymail`, `linkedin_check` / `linkedin_company` (Apify).

## Crossborder = overlay vertical (2026-11-04)

SQL: `docs/sql/2026-11-04_crossborder_overlay.sql` (applied live to the Radar DB).

- **Accounts**: one row per (domain, vertical) as before — a domain can be D2C *and* Crossborder (two account rows).
- **Contacts**: ONE row per person, in its own vertical. `contacts.verticals text[]` = own vertical + `Crossborder`
  whenever `contacts.match_domain` (generated: domain, else email domain, normalised) has a Crossborder account.
  Kept current by triggers on both tables (`trg_contacts_zz_verticals`, `trg_accounts_refresh_overlay`).
- **No duplicate rows** (`trg_contacts_xb_dedupe`, BEFORE INSERT, every save path): a Crossborder insert for a person
  already in B2B/D2C/US is skipped and their domain gets a Crossborder account instead; a B2B/D2C/US insert for a
  person who only exists as a Crossborder row moves that row to the new vertical (fill-blank merge) and keeps the
  domain's Crossborder account.
- **Reading by vertical = `verticals`**, never `vertical=eq.` — use `verticalsFilter()` (lib/radar/supabase.ts).
  Contacts list, exports (contactExport, export-validate), Find Emails matching, stats and the RPCs
  (`get_contact_status_matrix`, `get_contact_domain_stats`, `get_account_coverage`, `get_growth_snapshots`) all do.
  Dashboard totals leave the Crossborder row out (marked ↺) so no one is double counted.
- Crossborder account drawer lists contacts by `matchDomain` (contacts route param), not account_id.
- `link_contacts_on_account_insert` now only auto-links contacts of the SAME vertical.

## Clean firmographics (2026-11-04)

SQL: `docs/sql/2026-11-04_firmographics_clean.sql`. Raw `industry/sub_industry/employee_range/revenue_range` are
untouched; STORED generated columns on `accounts` (also on `contacts_view`) give a clean taxonomy:
- `industry_category` / `industry_subcategory` via `radar_industry_path()` — 18 categories, ordered regex rules
  (first match wins) over "industry | sub_industry". Change a rule → re-run the function, then
  `UPDATE accounts SET industry = industry;` to recompute.
- `employee_bucket` (1-10 … 10,001+, upper bound of the range; employee_count wins), `revenue_bucket`
  (Under $1M … $1B+, via `radar_revenue_usd()`; ₹ and Cr convert at ₹95 = $1; ranges use lower bound).
- Filters/exports use `industryGroup` ("Category" or "Category › Sub"), `employeeBucket`, `revenueBucket`
  (`firmographicFilters()` in lib/radar/supabase.ts). `/api/radar/options` returns the ordered tree + counts.

## Enrich v2 — Blitz → Anymail → Debounce → Anymail verify (2026-11-04)

Replaces the Apify leads-finder Enrich (old `EnrichSection`/`api/radar/enrich` left in place but not shown).
Code: `lib/radar/enrichPipeline.ts`, route `api/radar/enrich2` (cron every minute), tables
`docs/sql/2026-11-04_enrich_v2.sql` (`enrich2_jobs/companies/people`, `save_enrich2_job()`).

Steps (per-row progress markers, resumable; one tick per job at a time via `locked_until` lease):
1. resolve — sheet LinkedIn → Blitz `domain-to-linkedin` → parent domain → alt domains → Blitz company name search
   (high = domain matches, medium = same name; low = skipped). No Apify.
2. search — Blitz `waterfall-icp-keyword`, 7 tiers (`ICP_TIERS`); tiers 1-6 = phase 1, tier 7 = phase 2 (needs a dept
   keyword). Interns/trainees/students always dropped; junior support/HR/finance dropped when the option is on
   (rows kept with `dropped_reason`, never saved).
3. email — Blitz `/v2/enrichment/email` by LinkedIn URL. 4. anymail (opt) — Anymail person search for blanks.
5. debounce — every email (≤4 concurrent). 6. verify (opt) — Anymail `verify-email` on Debounce risky/unknown.
7. phone (opt) — Blitz phone. 8. save — `save_enrich2_job` (accounts by domain+vertical, contacts merged by email
   then LinkedIn within the vertical, fresh `email_status`).
Env: `BLITZ_API_KEY`, `DEBOUNCE_API_KEY` (or `RADAR_DEBOUNCE_API_KEY`), `ANYMAIL_FINDER_API_KEY`.
