-- Radar DB (separate Supabase project) — Crossborder as an OVERLAY vertical. Applied 2026-11-04.
--
-- Contacts stay ONE row (own vertical B2B/D2C/US/Crossborder). A contact also "belongs" to
-- Crossborder whenever its company domain has a Crossborder account. `contacts.verticals` holds
-- every vertical a contact counts under (own + overlay) and is what filters/exports/stats read.

-- 1) Normalised company domain per contact (domain column, else the email's domain).
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS match_domain text GENERATED ALWAYS AS (
  NULLIF(lower(split_part(regexp_replace(regexp_replace(btrim(COALESCE(NULLIF(btrim(domain), ''), split_part(email, '@', 2))), '^https?://', '', 'i'), '^www\.', '', 'i'), '/', 1)), '')
) STORED;
CREATE INDEX IF NOT EXISTS idx_contacts_match_domain ON contacts (match_domain);
CREATE INDEX IF NOT EXISTS idx_accounts_domain_lower ON accounts (lower(domain));

-- 2) Every vertical the contact counts under.
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS verticals text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_contacts_verticals ON contacts USING gin (verticals);

CREATE OR REPLACE FUNCTION radar_norm_domain(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(lower(split_part(regexp_replace(regexp_replace(btrim(COALESCE(p, '')), '^https?://', '', 'i'), '^www\.', '', 'i'), '/', 1)), '')
$$;

CREATE OR REPLACE FUNCTION radar_contact_verticals(p_vertical text, p_match_domain text) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT (CASE WHEN COALESCE(p_vertical, '') = '' THEN '{}'::text[] ELSE ARRAY[p_vertical] END)
      || (CASE WHEN p_vertical IS DISTINCT FROM 'Crossborder' AND p_match_domain IS NOT NULL
                AND EXISTS (SELECT 1 FROM accounts a WHERE a.vertical = 'Crossborder' AND lower(a.domain) = p_match_domain)
               THEN ARRAY['Crossborder'] ELSE '{}'::text[] END)
$$;

-- 3) Keep contacts.verticals current when a contact's vertical/domain/email changes.
CREATE OR REPLACE FUNCTION trg_contacts_set_verticals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.verticals := radar_contact_verticals(NEW.vertical, radar_norm_domain(COALESCE(NULLIF(btrim(NEW.domain), ''), split_part(NEW.email, '@', 2))));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contacts_zz_verticals ON contacts;
CREATE TRIGGER trg_contacts_zz_verticals BEFORE INSERT OR UPDATE OF vertical, domain, email ON contacts
  FOR EACH ROW EXECUTE FUNCTION trg_contacts_set_verticals();

-- ...and when a Crossborder account appears / moves / goes away.
CREATE OR REPLACE FUNCTION trg_accounts_refresh_overlay() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d text[] := '{}';
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.vertical = 'Crossborder' THEN d := d || lower(NEW.domain); END IF;
  IF TG_OP <> 'INSERT' AND OLD.vertical = 'Crossborder' THEN d := d || lower(OLD.domain); END IF;
  IF cardinality(d) > 0 THEN
    UPDATE contacts c SET verticals = radar_contact_verticals(c.vertical, c.match_domain)
     WHERE c.match_domain = ANY (d)
       AND c.verticals IS DISTINCT FROM radar_contact_verticals(c.vertical, c.match_domain);
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_accounts_refresh_overlay ON accounts;
CREATE TRIGGER trg_accounts_refresh_overlay AFTER INSERT OR UPDATE OF domain, vertical OR DELETE ON accounts
  FOR EACH ROW EXECUTE FUNCTION trg_accounts_refresh_overlay();

-- A recomputed `verticals` alone isn't an edit — don't bump updated_at for it.
CREATE OR REPLACE FUNCTION public.set_updated_at_contacts()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  IF (to_jsonb(NEW) - 'verticals' - 'updated_at' - 'match_domain') = (to_jsonb(OLD) - 'verticals' - 'updated_at' - 'match_domain') THEN RETURN NEW; END IF;
  IF (NEW.email_status IS DISTINCT FROM OLD.email_status OR NEW.validated_at IS DISTINCT FROM OLD.validated_at) AND ROW(NEW.first_name,NEW.last_name,NEW.full_name,NEW.email,NEW.title,NEW.company_name,NEW.phone,NEW.phone2,NEW.location,NEW.country,NEW.linkedin_url,NEW.account_id) IS NOT DISTINCT FROM ROW(OLD.first_name,OLD.last_name,OLD.full_name,OLD.email,OLD.title,OLD.company_name,OLD.phone,OLD.phone2,OLD.location,OLD.country,OLD.linkedin_url,OLD.account_id) THEN RETURN NEW; END IF;
  NEW.updated_at = NOW();
  RETURN NEW;
END; $function$;

-- 4) One row per person across Crossborder and the other verticals.
CREATE OR REPLACE FUNCTION radar_ensure_crossborder_account(p_domain text, p_name text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_domain IS NULL THEN RETURN; END IF;
  IF EXISTS (SELECT 1 FROM accounts WHERE vertical = 'Crossborder' AND lower(domain) = p_domain) THEN RETURN; END IF;
  INSERT INTO accounts (name, domain, vertical, source) VALUES (COALESCE(NULLIF(btrim(p_name), ''), p_domain), p_domain, 'Crossborder', 'Crossborder link')
  ON CONFLICT (domain, vertical) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION trg_contacts_xb_dedupe() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex contacts%ROWTYPE; dom text;
BEGIN
  IF COALESCE(NEW.email, '') = '' AND COALESCE(NEW.linkedin_url, '') = '' THEN RETURN NEW; END IF;
  dom := radar_norm_domain(COALESCE(NULLIF(btrim(NEW.domain), ''), split_part(NEW.email, '@', 2)));
  IF NEW.vertical = 'Crossborder' THEN
    -- Already in Radar under another vertical: keep that row; just make sure its company is a
    -- Crossborder account so the person shows under Crossborder too.
    SELECT * INTO ex FROM contacts c WHERE c.vertical IS DISTINCT FROM 'Crossborder'
      AND ((COALESCE(NEW.email, '') <> '' AND c.email = lower(NEW.email))
        OR (COALESCE(NEW.linkedin_url, '') <> '' AND c.linkedin_url = NEW.linkedin_url))
      LIMIT 1;
    IF FOUND THEN
      PERFORM radar_ensure_crossborder_account(COALESCE(ex.match_domain, dom), COALESCE(NEW.company_name, ex.company_name));
      RETURN NULL;
    END IF;
  ELSIF NEW.vertical IN ('B2B', 'D2C', 'US') THEN
    -- Only exists as a Crossborder row: move that row to the given vertical (keeps one row) and
    -- keep its company as a Crossborder account so it still counts there.
    SELECT * INTO ex FROM contacts c WHERE c.vertical = 'Crossborder'
      AND ((COALESCE(NEW.email, '') <> '' AND c.email = lower(NEW.email))
        OR (COALESCE(NEW.linkedin_url, '') <> '' AND c.linkedin_url = NEW.linkedin_url))
      LIMIT 1;
    IF FOUND THEN
      PERFORM radar_ensure_crossborder_account(COALESCE(ex.match_domain, dom), COALESCE(ex.company_name, NEW.company_name));
      UPDATE contacts SET
        vertical = NEW.vertical,
        account_id = COALESCE(NEW.account_id, (SELECT a.id FROM accounts a WHERE lower(a.domain) = COALESCE(ex.match_domain, dom) AND a.vertical = NEW.vertical LIMIT 1)),
        first_name = COALESCE(NULLIF(first_name, ''), NEW.first_name),
        last_name = COALESCE(NULLIF(last_name, ''), NEW.last_name),
        full_name = COALESCE(NULLIF(full_name, ''), NEW.full_name),
        title = COALESCE(NULLIF(title, ''), NEW.title),
        linkedin_url = COALESCE(NULLIF(linkedin_url, ''), NEW.linkedin_url),
        phone = COALESCE(NULLIF(phone, ''), NEW.phone),
        company_name = COALESCE(NULLIF(company_name, ''), NEW.company_name),
        domain = COALESCE(NULLIF(domain, ''), NEW.domain),
        country = COALESCE(NULLIF(country, ''), NEW.country),
        location = COALESCE(NULLIF(location, ''), NEW.location)
      WHERE id = ex.id;
      RETURN NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contacts_xb_dedupe ON contacts;
CREATE TRIGGER trg_contacts_xb_dedupe BEFORE INSERT ON contacts FOR EACH ROW EXECUTE FUNCTION trg_contacts_xb_dedupe();

-- 5) New-account auto-link only within the same vertical (it used to grab any unlinked contact
--    with a matching email domain, which would pull D2C/US contacts into a Crossborder account).
CREATE OR REPLACE FUNCTION public.link_contacts_on_account_insert()
 RETURNS trigger LANGUAGE plpgsql AS $function$
BEGIN
  UPDATE contacts SET account_id = NEW.id
   WHERE account_id IS NULL AND LOWER(SPLIT_PART(email, '@', 2)) = LOWER(NEW.domain)
     AND (vertical IS NULL OR vertical = NEW.vertical);
  RETURN NEW;
END; $function$;

-- 6) Backfill (run with trg_contacts_updated disabled so updated_at isn't touched):
--    UPDATE contacts SET verticals = radar_contact_verticals(vertical, match_domain);

-- 7) contacts_view: append verticals + match_domain (columns appended at the end only).
-- 8) Stats RPCs count a contact under every vertical in `verticals` (see get_contact_status_matrix,
--    get_contact_domain_stats, get_account_coverage, get_growth_snapshots).
