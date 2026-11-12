-- Radar DB — accounts.verticals (Stage 1 of "one account row per company, several verticals").
-- `vertical` stays the MAIN vertical (what code that hasn't been updated reads); `verticals` is the full list
-- (always contains `vertical`). Today every row is just ARRAY[vertical]; merging duplicates comes later (Stage 2).
-- Applied to the Radar DB 2026-11-12.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verticals text[];

CREATE OR REPLACE FUNCTION public.trg_accounts_set_verticals() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.vertical IS DISTINCT FROM OLD.vertical AND NEW.verticals IS NOT DISTINCT FROM OLD.verticals AND OLD.vertical IS NOT NULL THEN
    -- only the main vertical was changed: swap it inside the list instead of leaving the old one behind
    NEW.verticals := array_replace(NEW.verticals, OLD.vertical, NEW.vertical);
  END IF;
  IF NEW.verticals IS NULL OR cardinality(NEW.verticals) = 0 THEN
    NEW.verticals := CASE WHEN COALESCE(NEW.vertical, '') = '' THEN '{}'::text[] ELSE ARRAY[NEW.vertical] END;
  ELSIF COALESCE(NEW.vertical, '') <> '' AND NOT (NEW.vertical = ANY (NEW.verticals)) THEN
    NEW.verticals := ARRAY[NEW.vertical] || NEW.verticals;
  END IF;
  NEW.verticals := ARRAY(SELECT DISTINCT e FROM unnest(NEW.verticals) e WHERE e IS NOT NULL AND e <> '');
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_accounts_aa_verticals ON accounts;
CREATE TRIGGER trg_accounts_aa_verticals BEFORE INSERT OR UPDATE OF vertical, verticals ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_accounts_set_verticals();

-- Backfill (done in batches): UPDATE accounts SET verticals = ARRAY[vertical] WHERE verticals IS NULL ...
CREATE INDEX IF NOT EXISTS idx_accounts_verticals ON accounts USING gin (verticals);

-- Crossborder overlay now reads the list (a Crossborder tag on ANY row of the domain).
CREATE OR REPLACE FUNCTION public.radar_contact_verticals(p_vertical text, p_match_domain text) RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT (CASE WHEN COALESCE(p_vertical, '') = '' THEN '{}'::text[] ELSE ARRAY[p_vertical] END)
      || (CASE WHEN p_vertical IS DISTINCT FROM 'Crossborder' AND p_match_domain IS NOT NULL
                AND EXISTS (SELECT 1 FROM accounts a WHERE (a.vertical = 'Crossborder' OR 'Crossborder' = ANY (a.verticals)) AND lower(a.domain) = p_match_domain)
               THEN ARRAY['Crossborder'] ELSE '{}'::text[] END)
$f$;
CREATE OR REPLACE FUNCTION public.radar_contact_verticals(p_vertical text, p_match_domain text, p_extra text[]) RETURNS text[] LANGUAGE sql STABLE AS $f$
  SELECT (CASE WHEN COALESCE(p_vertical, '') = '' THEN '{}'::text[] ELSE ARRAY[p_vertical] END)
      || COALESCE(ARRAY(SELECT DISTINCT e FROM unnest(COALESCE(p_extra, '{}')) e WHERE e IS DISTINCT FROM p_vertical AND e <> ''), '{}')
      || (CASE WHEN p_vertical IS DISTINCT FROM 'Crossborder' AND p_match_domain IS NOT NULL
                AND EXISTS (SELECT 1 FROM accounts a WHERE (a.vertical = 'Crossborder' OR 'Crossborder' = ANY (a.verticals)) AND lower(a.domain) = p_match_domain)
               THEN ARRAY['Crossborder'] ELSE '{}'::text[] END)
$f$;

CREATE OR REPLACE FUNCTION public.trg_accounts_refresh_overlay() RETURNS trigger LANGUAGE plpgsql AS $f$
DECLARE d text[] := '{}';
BEGIN
  IF TG_OP <> 'DELETE' AND (NEW.vertical = 'Crossborder' OR 'Crossborder' = ANY (NEW.verticals)) THEN d := d || lower(NEW.domain); END IF;
  IF TG_OP <> 'INSERT' AND (OLD.vertical = 'Crossborder' OR 'Crossborder' = ANY (OLD.verticals)) THEN d := d || lower(OLD.domain); END IF;
  IF cardinality(d) > 0 THEN
    UPDATE contacts c SET verticals = radar_contact_verticals(c.vertical, c.match_domain, c.extra_verticals)
     WHERE c.match_domain = ANY (d)
       AND c.verticals IS DISTINCT FROM radar_contact_verticals(c.vertical, c.match_domain, c.extra_verticals);
  END IF;
  RETURN NULL;
END $f$;
DROP TRIGGER IF EXISTS trg_accounts_refresh_overlay ON accounts;
CREATE TRIGGER trg_accounts_refresh_overlay AFTER INSERT OR DELETE OR UPDATE OF domain, vertical, verticals ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_accounts_refresh_overlay();

-- Coverage per vertical: an account counts in every vertical on its list.
CREATE OR REPLACE FUNCTION public.get_account_coverage() RETURNS TABLE(vertical text, total integer, with_contacts integer) LANGUAGE sql STABLE AS $f$
  -- Crossborder accounts don't own contacts; a B2B account is also covered by a D2C-main contact tagged B2B (extra_verticals).
  SELECT COALESCE(v.v,'Unassigned'), COUNT(*)::int,
    COUNT(*) FILTER (WHERE cc.account_id IS NOT NULL OR (v.v = 'Crossborder' AND xd.d IS NOT NULL) OR bd.d IS NOT NULL)::int
  FROM accounts a
  CROSS JOIN LATERAL unnest(CASE WHEN a.verticals IS NULL OR cardinality(a.verticals) = 0 THEN ARRAY[a.vertical] ELSE a.verticals END) AS v(v)
  LEFT JOIN (SELECT DISTINCT account_id FROM contacts WHERE account_id IS NOT NULL AND hubspot_excluded IS NOT TRUE) cc ON cc.account_id = a.id
  LEFT JOIN (SELECT DISTINCT match_domain d FROM contacts WHERE match_domain IS NOT NULL AND hubspot_excluded IS NOT TRUE AND verticals @> ARRAY['Crossborder']) xd ON v.v = 'Crossborder' AND xd.d = lower(a.domain)
  LEFT JOIN (SELECT DISTINCT c.match_domain d, v FROM contacts c, unnest(c.extra_verticals) v WHERE c.match_domain IS NOT NULL AND c.hubspot_excluded IS NOT TRUE) bd ON bd.v = v.v AND bd.d = lower(a.domain)
  GROUP BY 1 $f$;
