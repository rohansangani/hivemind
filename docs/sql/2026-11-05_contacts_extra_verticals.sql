-- One contact row per person across B2B + D2C (US stays separate). D2C is the main vertical; B2B rides along in
-- contacts.extra_verticals and shows as a second tag via contacts.verticals. Applied 2026-11-05.

ALTER TABLE contacts ADD COLUMN IF NOT EXISTS extra_verticals text[] NOT NULL DEFAULT '{}';

-- verticals = own vertical + extra verticals + Crossborder overlay.
CREATE OR REPLACE FUNCTION radar_contact_verticals(p_vertical text, p_match_domain text, p_extra text[]) RETURNS text[]
LANGUAGE sql STABLE AS $$
  SELECT (CASE WHEN COALESCE(p_vertical, '') = '' THEN '{}'::text[] ELSE ARRAY[p_vertical] END)
      || COALESCE(ARRAY(SELECT DISTINCT e FROM unnest(COALESCE(p_extra, '{}')) e WHERE e IS DISTINCT FROM p_vertical AND e <> ''), '{}')
      || (CASE WHEN p_vertical IS DISTINCT FROM 'Crossborder' AND p_match_domain IS NOT NULL
                AND EXISTS (SELECT 1 FROM accounts a WHERE a.vertical = 'Crossborder' AND lower(a.domain) = p_match_domain)
               THEN ARRAY['Crossborder'] ELSE '{}'::text[] END)
$$;

CREATE OR REPLACE FUNCTION trg_contacts_set_verticals() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.verticals := radar_contact_verticals(NEW.vertical, radar_norm_domain(COALESCE(NULLIF(btrim(NEW.domain), ''), split_part(NEW.email, '@', 2))), NEW.extra_verticals);
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_contacts_zz_verticals ON contacts;
CREATE TRIGGER trg_contacts_zz_verticals BEFORE INSERT OR UPDATE OF vertical, domain, email, extra_verticals ON contacts
  FOR EACH ROW EXECUTE FUNCTION trg_contacts_set_verticals();

CREATE OR REPLACE FUNCTION trg_accounts_refresh_overlay() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d text[] := '{}';
BEGIN
  IF TG_OP <> 'DELETE' AND NEW.vertical = 'Crossborder' THEN d := d || lower(NEW.domain); END IF;
  IF TG_OP <> 'INSERT' AND OLD.vertical = 'Crossborder' THEN d := d || lower(OLD.domain); END IF;
  IF cardinality(d) > 0 THEN
    UPDATE contacts c SET verticals = radar_contact_verticals(c.vertical, c.match_domain, c.extra_verticals)
     WHERE c.match_domain = ANY (d)
       AND c.verticals IS DISTINCT FROM radar_contact_verticals(c.vertical, c.match_domain, c.extra_verticals);
  END IF;
  RETURN NULL;
END $$;

-- A B2B / D2C insert for someone who already exists in the partner vertical is absorbed into that one row
-- (D2C stays the main vertical; B2B becomes an extra tag) instead of creating a second copy.
CREATE OR REPLACE FUNCTION trg_contacts_xc_pair() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ex contacts%ROWTYPE; partner text; target text;
BEGIN
  IF NEW.vertical NOT IN ('B2B', 'D2C') THEN RETURN NEW; END IF;
  IF COALESCE(NEW.email, '') = '' AND COALESCE(NEW.linkedin_url, '') = '' THEN RETURN NEW; END IF;
  partner := CASE NEW.vertical WHEN 'B2B' THEN 'D2C' ELSE 'B2B' END;
  SELECT * INTO ex FROM contacts c WHERE c.vertical = partner
    AND ((COALESCE(NEW.email, '') <> '' AND c.email = lower(NEW.email))
      OR (COALESCE(NEW.linkedin_url, '') <> '' AND c.linkedin_url = NEW.linkedin_url)) LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  target := 'D2C';  -- D2C is the main vertical of a merged person
  UPDATE contacts SET
    vertical = target,
    extra_verticals = ARRAY(SELECT DISTINCT e FROM unnest(extra_verticals || 'B2B'::text) e WHERE e <> target),
    account_id = CASE WHEN ex.vertical = 'D2C' THEN account_id
                      ELSE COALESCE((SELECT a.id FROM accounts a WHERE lower(a.domain) = ex.match_domain AND a.vertical = 'D2C' LIMIT 1), NEW.account_id, account_id) END,
    email = CASE WHEN COALESCE(email, '') = '' AND COALESCE(NEW.email, '') <> ''
                      AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.email = lower(NEW.email) AND o.vertical = target AND o.id <> ex.id)
                 THEN lower(NEW.email) ELSE email END,
    linkedin_url = CASE WHEN COALESCE(linkedin_url, '') = '' AND COALESCE(NEW.linkedin_url, '') <> ''
                      AND NOT EXISTS (SELECT 1 FROM contacts o WHERE o.linkedin_url = NEW.linkedin_url AND o.vertical = target AND o.id <> ex.id)
                 THEN NEW.linkedin_url ELSE linkedin_url END,
    first_name = COALESCE(NULLIF(first_name, ''), NEW.first_name), last_name = COALESCE(NULLIF(last_name, ''), NEW.last_name),
    full_name = COALESCE(NULLIF(full_name, ''), NEW.full_name), title = COALESCE(NULLIF(title, ''), NEW.title),
    phone = COALESCE(NULLIF(phone, ''), NEW.phone), company_name = COALESCE(NULLIF(company_name, ''), NEW.company_name),
    domain = COALESCE(NULLIF(domain, ''), NEW.domain), country = COALESCE(NULLIF(country, ''), NEW.country), location = COALESCE(NULLIF(location, ''), NEW.location)
  WHERE id = ex.id;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS trg_contacts_xc_pair ON contacts;
CREATE TRIGGER trg_contacts_xc_pair BEFORE INSERT ON contacts FOR EACH ROW EXECUTE FUNCTION trg_contacts_xc_pair();

-- Account coverage also counts B2B accounts covered by a D2C-main contact tagged B2B.

CREATE OR REPLACE FUNCTION public.get_account_coverage() RETURNS TABLE(vertical text, total integer, with_contacts integer) LANGUAGE sql STABLE AS $f$
  -- Crossborder accounts don't own contacts; a B2B account is also covered by a D2C-main contact tagged B2B (extra_verticals).
  SELECT COALESCE(a.vertical,'Unassigned'), COUNT(*)::int,
    COUNT(*) FILTER (WHERE cc.account_id IS NOT NULL OR (a.vertical = 'Crossborder' AND xd.d IS NOT NULL) OR bd.d IS NOT NULL)::int
  FROM accounts a
  LEFT JOIN (SELECT DISTINCT account_id FROM contacts WHERE account_id IS NOT NULL AND hubspot_excluded IS NOT TRUE) cc ON cc.account_id = a.id
  LEFT JOIN (SELECT DISTINCT match_domain d FROM contacts WHERE match_domain IS NOT NULL AND hubspot_excluded IS NOT TRUE AND verticals @> ARRAY['Crossborder']) xd ON a.vertical = 'Crossborder' AND xd.d = lower(a.domain)
  LEFT JOIN (SELECT DISTINCT c.match_domain d, v FROM contacts c, unnest(c.extra_verticals) v WHERE c.match_domain IS NOT NULL AND c.hubspot_excluded IS NOT TRUE) bd ON bd.v = a.vertical AND bd.d = lower(a.domain)
  GROUP BY 1 $f$;
