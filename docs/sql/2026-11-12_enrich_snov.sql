-- Enrich v2: Snov.io email-finder step (between Blitz and Anymail). Applied to the Radar DB 2026-11-12.
ALTER TABLE enrich2_people ADD COLUMN IF NOT EXISTS snov_tried boolean NOT NULL DEFAULT false;
