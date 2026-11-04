-- Radar DB — Enrich v2 (Blitz → Anymail → Debounce → Anymail verify) job tables + save. Applied 2026-11-04.
-- Pipeline code: src/lib/radar/enrichPipeline.ts, route: src/app/api/radar/enrich2/route.ts.

CREATE TABLE IF NOT EXISTS enrich2_jobs (
  id bigserial PRIMARY KEY,
  label text NOT NULL,
  vertical text NOT NULL,
  created_by text,
  status text NOT NULL DEFAULT 'running',      -- running | done | cancelled | error
  phase text NOT NULL DEFAULT 'resolve',       -- resolve | search | email | anymail | debounce | verify | phone | save | done
  stage text,                                  -- live progress text
  options jsonb NOT NULL DEFAULT '{}',
  counts jsonb NOT NULL DEFAULT '{}',
  error text,
  fail_count int NOT NULL DEFAULT 0,
  locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enrich2_companies (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES enrich2_jobs(id) ON DELETE CASCADE,
  domain text NOT NULL,
  brand text,
  alt_domains text[],
  input_linkedin text,
  company_linkedin_url text,
  company_name text,
  resolve_method text,       -- sheet | blitz | parent | alt | name
  confidence text,           -- high | medium | low
  status text NOT NULL DEFAULT 'pending',   -- pending | resolved | unresolved | low | searched | search_failed
  people_found int NOT NULL DEFAULT 0,
  UNIQUE (job_id, domain)
);
CREATE INDEX IF NOT EXISTS idx_enrich2_companies_job_status ON enrich2_companies (job_id, status);

CREATE TABLE IF NOT EXISTS enrich2_people (
  id bigserial PRIMARY KEY,
  job_id bigint NOT NULL REFERENCES enrich2_jobs(id) ON DELETE CASCADE,
  company_id bigint,
  domain text,
  company_name text,
  company_linkedin_url text,
  first_name text, last_name text, full_name text,
  title text, headline text,
  linkedin_url text,
  city text, country_code text,
  tier int, phase int, department text,
  dropped_reason text,                       -- intern/trainee/student, or junior-support/HR/finance filter
  email text, email_source text,             -- blitz | anymail
  email_tried boolean NOT NULL DEFAULT false,
  anymail_tried boolean NOT NULL DEFAULT false,
  debounce_result text,                      -- safe to send | risky | invalid | unknown | error
  verify_result text,                        -- anymail verify: valid | risky | invalid | error
  final_status text,
  phone text, phone_tried boolean NOT NULL DEFAULT false,
  saved boolean NOT NULL DEFAULT false,
  contact_id uuid,
  raw jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, linkedin_url)
);
CREATE INDEX IF NOT EXISTS idx_enrich2_people_job ON enrich2_people (job_id);

-- Saves a finished job's people into Radar: accounts (domain + vertical) and contacts — one row per
-- person per vertical, merged by email, else LinkedIn; existing rows get blanks filled + the fresh
-- email status. Dropped rows are skipped. Idempotent (only unsaved rows).
CREATE OR REPLACE FUNCTION save_enrich2_job(p_job bigint) RETURNS TABLE(saved_contacts int, saved_accounts int)
LANGUAGE plpgsql AS $fn$
DECLARE
  v_vert text; r enrich2_people%ROWTYPE; v_id uuid; v_acc uuid; v_li text; v_email text;
  n_c int := 0; n_a int := 0;
BEGIN
  SELECT vertical INTO v_vert FROM enrich2_jobs WHERE id = p_job;
  IF v_vert NOT IN ('B2B','D2C','US','Crossborder') THEN RAISE EXCEPTION 'job % has no valid vertical', p_job; END IF;

  INSERT INTO accounts (name, domain, vertical, linkedin_url, source)
  SELECT DISTINCT ON (c.domain) COALESCE(NULLIF(c.company_name,''), NULLIF(c.brand,''), c.domain), c.domain, v_vert, c.company_linkedin_url, 'Blitz Enrich'
  FROM enrich2_companies c
  WHERE c.job_id = p_job AND EXISTS (SELECT 1 FROM enrich2_people p WHERE p.company_id = c.id AND p.dropped_reason IS NULL)
  ON CONFLICT (domain, vertical) DO UPDATE SET
    linkedin_url = COALESCE(accounts.linkedin_url, EXCLUDED.linkedin_url),
    name = COALESCE(NULLIF(accounts.name,''), EXCLUDED.name);
  GET DIAGNOSTICS n_a = ROW_COUNT;

  FOR r IN SELECT * FROM enrich2_people WHERE job_id = p_job AND NOT saved AND dropped_reason IS NULL ORDER BY id LOOP
    v_id := NULL;
    v_email := NULLIF(lower(btrim(COALESCE(r.email,''))), '');
    v_li := public.norm_li(NULLIF(r.linkedin_url,''));
    SELECT id INTO v_acc FROM accounts WHERE domain = r.domain AND vertical = v_vert LIMIT 1;
    IF v_email IS NOT NULL THEN
      SELECT id INTO v_id FROM contacts WHERE email = v_email AND vertical = v_vert LIMIT 1;
    END IF;
    IF v_id IS NULL AND v_li IS NOT NULL THEN
      SELECT id INTO v_id FROM contacts WHERE linkedin_url = v_li AND COALESCE(vertical,'') = v_vert LIMIT 1;
    END IF;

    IF v_id IS NOT NULL THEN
      BEGIN
        UPDATE contacts SET
          email = COALESCE(email, v_email),
          email_status = CASE WHEN v_email IS NOT NULL AND (email IS NULL OR email = v_email) AND r.final_status IS NOT NULL THEN r.final_status ELSE email_status END,
          validated_at = CASE WHEN v_email IS NOT NULL AND (email IS NULL OR email = v_email) AND r.final_status IS NOT NULL THEN now() ELSE validated_at END,
          first_name = COALESCE(NULLIF(first_name,''), r.first_name),
          last_name = COALESCE(NULLIF(last_name,''), r.last_name),
          full_name = COALESCE(NULLIF(full_name,''), r.full_name),
          title = COALESCE(NULLIF(title,''), r.title),
          linkedin_url = COALESCE(NULLIF(linkedin_url,''), v_li),
          phone = COALESCE(NULLIF(phone,''), r.phone),
          company_name = COALESCE(NULLIF(company_name,''), r.company_name),
          domain = COALESCE(NULLIF(domain,''), r.domain),
          country = COALESCE(NULLIF(country,''), r.country_code),
          location = COALESCE(NULLIF(location,''), r.city),
          account_id = COALESCE(account_id, v_acc)
        WHERE id = v_id;
      EXCEPTION WHEN unique_violation THEN NULL;
      END;
    ELSE
      BEGIN
        INSERT INTO contacts (first_name, last_name, full_name, email, email_status, validated_at, title, linkedin_url, phone,
                              company_name, domain, country, location, vertical, account_id, source)
        VALUES (r.first_name, r.last_name, r.full_name, v_email, CASE WHEN v_email IS NOT NULL THEN r.final_status END,
                CASE WHEN v_email IS NOT NULL AND r.final_status IS NOT NULL THEN now() END, r.title, v_li, r.phone,
                r.company_name, r.domain, r.country_code, r.city, v_vert, v_acc, 'Blitz Enrich')
        RETURNING id INTO v_id;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO v_id FROM contacts WHERE (v_email IS NOT NULL AND email = v_email AND vertical = v_vert)
           OR (v_li IS NOT NULL AND linkedin_url = v_li AND COALESCE(vertical,'') = v_vert) LIMIT 1;
      END;
    END IF;

    UPDATE enrich2_people SET saved = true, contact_id = v_id WHERE id = r.id;
    n_c := n_c + 1;
  END LOOP;

  RETURN QUERY SELECT n_c, n_a;
END $fn$;
