-- Enrich v2: Snov.io verify step between Debounce and Anymail verify. Applied to the Radar DB 2026-11-12.
ALTER TABLE enrich2_people ADD COLUMN IF NOT EXISTS snov_verify_tried boolean NOT NULL DEFAULT false;
ALTER TABLE enrich2_people ADD COLUMN IF NOT EXISTS verify_source text; -- 'snov' | 'anymail'
