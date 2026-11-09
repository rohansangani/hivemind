-- Contacts always carry their account's source (no per-tool labels like BlitzAPI / Anymail / Check LinkedIn).
-- Fires on INSERT and when account_id/domain change. Falls back to a domain match when no account_id is set.
-- Contacts with no linked/matching account keep whatever source the writer gave.
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
  IF s IS NOT NULL THEN NEW.source := s; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_contacts_source_from_account ON contacts;
CREATE TRIGGER trg_contacts_source_from_account
  BEFORE INSERT OR UPDATE OF account_id, domain ON contacts
  FOR EACH ROW EXECUTE FUNCTION public.trg_contacts_source_from_account();
