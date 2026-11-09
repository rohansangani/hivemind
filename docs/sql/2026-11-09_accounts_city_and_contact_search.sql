-- Radar DB — accounts.city + trigram search on contacts. Applied 2026-11-09.
-- accounts.city: filled from the StoreLeads India/US/Canada exports (`city` column, matched by domain), then from the first
-- part of company_location ("Mumbai, Maharashtra" → Mumbai) for the rest; common India aliases normalised (Bangalore → Bengaluru …).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS city text;
CREATE INDEX IF NOT EXISTS idx_accounts_city ON accounts (city);
-- Contacts search box ("%text%" on email / first / last name) was a ~4 s sequential scan and timed out ("Failed to load contacts").
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
CREATE INDEX IF NOT EXISTS idx_contacts_email_trgm ON contacts USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_first_name_trgm ON contacts USING gin (first_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_contacts_last_name_trgm ON contacts USING gin (last_name gin_trgm_ops);
