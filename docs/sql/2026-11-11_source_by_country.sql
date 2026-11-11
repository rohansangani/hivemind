-- Radar DB — no new source labels. Allowed sources: StoreLeadsUS / StoreLeadsIndia / StoreLeadsCanada / DTCConnect / CSV Upload by MRTeam.
-- A new account/contact whose writer-supplied label is not one of StoreLeads*/DTCConnect (e.g. "Email Validation (Anymail)", "Check LinkedIn",
-- or the generic "CSV Upload by MRTeam") gets its source from COUNTRY: India -> StoreLeadsIndia, United States -> StoreLeadsUS,
-- Canada -> StoreLeadsCanada. No country -> guessed from the domain TLD (.in / .ca / .us). Anything else -> "CSV Upload by MRTeam".
-- Standing rule from Sushant (2026-11-11): do NOT create a new source until he explicitly says so. Existing rows are not rewritten.
CREATE OR REPLACE FUNCTION public.radar_source_for_country(p_country text, p_domain text) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $f$
DECLARE c text := lower(COALESCE(public.country_name(NULLIF(trim(p_country), '')), '')); tld text;
BEGIN
  IF c = '' THEN
    tld := lower(substring(COALESCE(p_domain, '') from '\.([a-z]+)$'));
    c := CASE tld WHEN 'in' THEN 'india' WHEN 'ca' THEN 'canada' WHEN 'us' THEN 'united states' ELSE '' END;
  END IF;
  RETURN CASE
    WHEN c = 'india' THEN 'StoreLeadsIndia'
    WHEN c IN ('united states', 'usa', 'us', 'united states of america') THEN 'StoreLeadsUS'
    WHEN c = 'canada' THEN 'StoreLeadsCanada'
    ELSE NULL END;
END $f$;

CREATE OR REPLACE FUNCTION public.radar_normalize_source(p_source text, p_country text, p_domain text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN p_source IN ('StoreLeadsUS','StoreLeadsIndia','StoreLeadsCanada','DTCConnect') THEN p_source
              ELSE COALESCE(public.radar_source_for_country(p_country, p_domain), 'CSV Upload by MRTeam') END
$f$;

CREATE OR REPLACE FUNCTION public.trg_accounts_normalize_source() RETURNS trigger AS $$
BEGIN
  NEW.source := public.radar_normalize_source(NEW.source, NEW.country, NEW.domain);
  RETURN NEW;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_accounts_normalize_source ON accounts;
CREATE TRIGGER trg_accounts_normalize_source BEFORE INSERT OR UPDATE OF source ON accounts
  FOR EACH ROW EXECUTE FUNCTION public.trg_accounts_normalize_source();

-- Contacts: account's source wins (as before); with no account, normalise by the contact's own country / domain / email TLD.
CREATE OR REPLACE FUNCTION public.trg_contacts_source_from_account() RETURNS trigger AS $$
DECLARE s text;
BEGIN
  IF NEW.account_id IS NOT NULL THEN
    SELECT source INTO s FROM accounts WHERE id = NEW.account_id;
  END IF;
  IF s IS NULL AND NEW.domain IS NOT NULL AND NEW.domain <> '' THEN
    SELECT source INTO s FROM accounts
     WHERE lower(domain) = lower(NEW.domain) AND source IS NOT NULL
     ORDER BY array_position(ARRAY['StoreLeadsUS','StoreLeadsIndia','StoreLeadsCanada','DTCConnect','CSV Upload by MRTeam'], source) NULLS LAST
     LIMIT 1;
  END IF;
  IF s IS NOT NULL THEN NEW.source := s;
  ELSE NEW.source := public.radar_normalize_source(NEW.source, NEW.country, COALESCE(NULLIF(NEW.domain, ''), split_part(COALESCE(NEW.email, ''), '@', 2)));
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
