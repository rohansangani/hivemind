-- Radar DB — one account row per company (Stage 2). Applied 2026-11-12.
-- A domain lives in ONE accounts row; `vertical` is its main vertical, `verticals` every vertical it belongs to.
-- This BEFORE INSERT guard keeps writers (uploads, enrich saves, validation saves, Check LinkedIn) from recreating duplicates:
--   * the exact (domain, vertical) row exists                      -> normal path (ON CONFLICT handles it)
--   * another row for the domain exists:
--       - inserting US                                              -> skipped (a company in any other vertical is never also US)
--       - vertical already on that row's list                      -> skipped, blank fields filled from the insert
--       - that row is US-only and the insert isn't US              -> the row becomes that vertical (US removed)
--       - otherwise                                                 -> the vertical is added to that row's list, blanks filled
-- Also changed (see git history of this file's commit): save_enrich2_job, save_enrich_batch, save_validation_job,
-- radar_ensure_crossborder_account, trg_contacts_xb_dedupe, trg_contacts_xc_pair, get_growth_snapshots now look accounts up with
-- `<vertical> = ANY(accounts.verticals)` instead of `accounts.vertical = <vertical>`.
CREATE OR REPLACE FUNCTION public.trg_accounts_merge_on_insert() RETURNS trigger AS $$
DECLARE e accounts%ROWTYPE;
BEGIN
  IF NEW.domain IS NULL OR btrim(NEW.domain) = '' OR COALESCE(NEW.vertical, '') = '' THEN RETURN NEW; END IF;
  IF EXISTS (SELECT 1 FROM accounts WHERE domain = NEW.domain AND vertical = NEW.vertical) THEN RETURN NEW; END IF;
  SELECT * INTO e FROM accounts WHERE lower(btrim(domain)) = lower(btrim(NEW.domain))
   ORDER BY (vertical = 'D2C') DESC, COALESCE(cardinality(verticals), 0) DESC, created_at LIMIT 1;
  IF NOT FOUND THEN RETURN NEW; END IF;
  IF NEW.vertical = 'US' THEN RETURN NULL; END IF;
  IF e.verticals = ARRAY['US']::text[] THEN
    UPDATE accounts SET vertical = NEW.vertical, verticals = ARRAY[NEW.vertical] WHERE id = e.id;
  ELSIF NOT (NEW.vertical = ANY (COALESCE(e.verticals, ARRAY[e.vertical]))) THEN
    UPDATE accounts SET verticals = array_append(COALESCE(verticals, ARRAY[vertical]), NEW.vertical) WHERE id = e.id;
  END IF;
  UPDATE accounts SET
    name = COALESCE(NULLIF(name, ''), NEW.name), industry = COALESCE(industry, NEW.industry), sub_industry = COALESCE(sub_industry, NEW.sub_industry),
    account_size = COALESCE(account_size, NEW.account_size), employee_range = COALESCE(employee_range, NEW.employee_range),
    employee_count = COALESCE(employee_count, NEW.employee_count), revenue_range = COALESCE(revenue_range, NEW.revenue_range),
    annual_revenue = COALESCE(annual_revenue, NEW.annual_revenue), annual_revenue_display = COALESCE(annual_revenue_display, NEW.annual_revenue_display),
    description = COALESCE(description, NEW.description), linkedin_url = COALESCE(linkedin_url, NEW.linkedin_url), linkedin_uid = COALESCE(linkedin_uid, NEW.linkedin_uid),
    street_address = COALESCE(street_address, NEW.street_address), full_address = COALESCE(full_address, NEW.full_address),
    postal_code = COALESCE(postal_code, NEW.postal_code), state = COALESCE(state, NEW.state), country = COALESCE(country, NEW.country),
    company_location = COALESCE(company_location, NEW.company_location), platform = COALESCE(platform, NEW.platform), parent_company = COALESCE(parent_company, NEW.parent_company)
   WHERE id = e.id;
  RETURN NULL;
END $$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trg_accounts_ab_merge ON accounts;
CREATE TRIGGER trg_accounts_ab_merge BEFORE INSERT ON accounts FOR EACH ROW EXECUTE FUNCTION public.trg_accounts_merge_on_insert();
