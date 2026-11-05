-- StoreLeads installed apps (names, comma-separated) + count on accounts. Applied 2026-11-05.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS installed_apps text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS installed_apps_count integer;
